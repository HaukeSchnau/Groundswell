import { describe, expect, it } from "@effect/vitest";
import { CanonicalStorageError, type CanonicalStorage } from "@groundswell/core-server";
import { createDomainEvent, createEventUnion } from "@groundswell/zod-helpers";
import { makeService, type DatabaseService } from "@schnau/effect-drizzle/postgres";
import { sql } from "drizzle-orm";
import { Effect, Layer, ServiceMap } from "effect";
import { z } from "zod";
import {
	CanonicalEventTopicsTable,
	CanonicalEventsSentToUsersTable,
	CanonicalEventsTable,
	createDrizzleCanonicalStorageLayer,
} from "./canonical-storage.js";

type TestEvent = {
	id: string;
	timestamp: Date;
	type: "test.event";
	data: { value: number };
};

const eventDefinition = createDomainEvent("test.event", { value: z.number() });
const eventUnion = createEventUnion([eventDefinition]) as z.ZodSchema<TestEvent>;

const Schema = {
	canonicalEvents: CanonicalEventsTable,
	canonicalEventTopics: CanonicalEventTopicsTable,
	canonicalEventsSentToUsers: CanonicalEventsSentToUsersTable,
};

class DomainCanonicalStorage extends ServiceMap.Service<
	DomainCanonicalStorage,
	CanonicalStorage<TestEvent>
>()("DomainCanonicalStorage") {}

class Database extends ServiceMap.Service<Database, DatabaseService<typeof Schema>>()(
	"PostgresDatabase",
) {}

const postgresUrl = process.env.GROUNDSWELL_TEST_POSTGRES_URL;
const describePostgres = postgresUrl === undefined ? describe.skip : describe;

const makeDatabaseLayer = (url: string): Layer.Layer<Database, unknown> =>
	Layer.effect(
		Database,
		makeService(
			{
				url,
				ssl: false,
				schema: Schema,
			},
			Database,
		),
	);

const makeStorageLayer = (): Layer.Layer<DomainCanonicalStorage, never, Database> =>
	createDrizzleCanonicalStorageLayer(DomainCanonicalStorage, {
		db: Database,
		eventSchema: eventUnion,
	});

const ensureTablesExist: Effect.Effect<void, unknown, Database> = Effect.gen(function* () {
	const db = yield* Database;
	yield* db.execute((client) =>
		client.execute(sql`
			CREATE TABLE IF NOT EXISTS canonical_events (
				id UUID PRIMARY KEY,
				timestamp TIMESTAMP NOT NULL,
				type TEXT NOT NULL,
				data TEXT NOT NULL,
				initiator UUID NOT NULL
			);
		`),
	);
	yield* db.execute((client) =>
		client.execute(sql`
			CREATE TABLE IF NOT EXISTS canonical_event_topics (
				event UUID NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
				topic TEXT NOT NULL,
				PRIMARY KEY(event, topic)
			);
		`),
	);
	yield* db.execute((client) =>
		client.execute(sql`
			CREATE TABLE IF NOT EXISTS canonical_events_sent_to_users (
				event UUID NOT NULL REFERENCES canonical_events(id) ON DELETE CASCADE,
				"user" UUID NOT NULL,
				sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
				PRIMARY KEY(event, "user")
			);
		`),
	);
	yield* db.execute((client) =>
		client.execute(sql`
			CREATE INDEX IF NOT EXISTS canonical_event_topics_event_topic_idx
			ON canonical_event_topics (event, topic);
		`),
	);
	yield* db.execute((client) =>
		client.execute(sql`
			CREATE INDEX IF NOT EXISTS canonical_events_sent_to_users_event_user_idx
			ON canonical_events_sent_to_users (event, "user");
		`),
	);
});

const resetTables: Effect.Effect<void, unknown, Database> = Effect.gen(function* () {
	const db = yield* Database;
	yield* db.execute((client) =>
		client.execute(sql`
			TRUNCATE TABLE canonical_events_sent_to_users, canonical_event_topics, canonical_events;
		`),
	);
});

const migrateAndReset: Effect.Effect<void, unknown, Database> = Effect.andThen(
	ensureTablesExist,
	resetTables,
);

const runWithLivePostgres = <A, E>(
	program: Effect.Effect<A, E, DomainCanonicalStorage | Database>,
): Effect.Effect<A, unknown> => {
	if (postgresUrl === undefined) {
		throw new Error("GROUNDSWELL_TEST_POSTGRES_URL is required for postgres integration tests");
	}

	return program.pipe(
		Effect.provide(makeStorageLayer()),
		Effect.provide(makeDatabaseLayer(postgresUrl)),
		Effect.scoped,
	);
};

const makeEvent = (id: string, timestampMs: number, value: number): TestEvent => ({
	id,
	timestamp: new Date(timestampMs),
	type: "test.event",
	data: { value },
});

const countCanonicalEvents = (db: DatabaseService<typeof Schema>) =>
	db
		.execute((client) =>
			client.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(CanonicalEventsTable),
		)
		.pipe(Effect.map((rows) => rows[0]?.count ?? 0));

const countCanonicalEventTopics = (db: DatabaseService<typeof Schema>) =>
	db
		.execute((client) =>
			client
				.select({ count: sql<number>`count(*)`.mapWith(Number) })
				.from(CanonicalEventTopicsTable),
		)
		.pipe(Effect.map((rows) => rows[0]?.count ?? 0));

const countCanonicalEventsSentToUsers = (db: DatabaseService<typeof Schema>) =>
	db
		.execute((client) =>
			client
				.select({ count: sql<number>`count(*)`.mapWith(Number) })
				.from(CanonicalEventsSentToUsersTable),
		)
		.pipe(Effect.map((rows) => rows[0]?.count ?? 0));

describePostgres("postgres canonical storage integration", () => {
	it.effect("persists events, preserves ordering, and tracks sent markers", () =>
		runWithLivePostgres(
			Effect.gen(function* () {
				yield* migrateAndReset;
				const storage = yield* DomainCanonicalStorage;
				const userId = "11111111-1111-4111-8111-111111111111";

				const older = makeEvent("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 1_000, 1);
				const newer = makeEvent("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 2_000, 2);

				expect(yield* storage.isEventUnique(older.id)).toBe(true);
				yield* storage.saveEvent(older, { initiatorId: userId, topics: ["topic-a"] });
				yield* storage.saveEvent(newer, { initiatorId: userId, topics: ["topic-a", "topic-b"] });

				expect(yield* storage.isEventUnique(older.id)).toBe(false);

				const missingA = yield* storage.getMissingEventsForUser(userId, ["topic-a"]);
				expect(missingA.map((event) => event.id)).toStrictEqual([older.id, newer.id]);

				yield* storage.markEventAsSentToUser(older.id, userId);

				const missingAfterMark = yield* storage.getMissingEventsForUser(userId, ["topic-a"]);
				expect(missingAfterMark.map((event) => event.id)).toStrictEqual([newer.id]);

				const sent = yield* storage.getEventsSentToUser(userId);
				expect(sent.map((event) => event.id)).toStrictEqual([older.id]);
			}),
		),
	);

	it.effect("filters by topic and maps malformed persisted payloads", () =>
		runWithLivePostgres(
			Effect.gen(function* () {
				yield* migrateAndReset;
				const db = yield* Database;
				const storage = yield* DomainCanonicalStorage;
				const userId = "22222222-2222-4222-8222-222222222222";

				const topicAEvent = makeEvent("cccccccc-cccc-4ccc-8ccc-cccccccccccc", 3_000, 3);
				const topicBEvent = makeEvent("dddddddd-dddd-4ddd-8ddd-dddddddddddd", 4_000, 4);

				yield* storage.saveEvent(topicAEvent, { initiatorId: userId, topics: ["topic-a"] });
				yield* storage.saveEvent(topicBEvent, { initiatorId: userId, topics: ["topic-b"] });

				const onlyTopicA = yield* storage.getMissingEventsForUser(userId, ["topic-a"]);
				expect(onlyTopicA.map((event) => event.id)).toStrictEqual([topicAEvent.id]);

				yield* db.execute((client) =>
					client.insert(CanonicalEventsTable).values({
						id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
						timestamp: new Date(5_000),
						type: "test.event",
						data: "not-superjson",
						initiator: userId,
					}),
				);
				yield* db.execute((client) =>
					client.insert(CanonicalEventsSentToUsersTable).values({
						event: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
						user: userId,
					}),
				);

				const parseError = yield* Effect.flip(storage.getEventsSentToUser(userId));
				expect(parseError).toBeInstanceOf(CanonicalStorageError);
			}),
		),
	);

	it.effect("maps duplicate save attempts and preserves canonical rows", () =>
		runWithLivePostgres(
			Effect.gen(function* () {
				yield* migrateAndReset;
				const db = yield* Database;
				const storage = yield* DomainCanonicalStorage;
				const userId = "33333333-3333-4333-8333-333333333333";
				const event = makeEvent("12121212-1212-4212-8212-121212121212", 6_000, 6);

				yield* storage.saveEvent(event, { initiatorId: userId, topics: ["topic-a"] });

				const duplicateError = yield* Effect.flip(
					storage.saveEvent(event, { initiatorId: userId, topics: ["topic-a"] }),
				);
				expect(duplicateError).toBeInstanceOf(CanonicalStorageError);
				expect(yield* countCanonicalEvents(db)).toBe(1);
				expect(yield* countCanonicalEventTopics(db)).toBe(1);
			}),
		),
	);

	it.effect("maps markEventAsSentToUser foreign-key failures", () =>
		runWithLivePostgres(
			Effect.gen(function* () {
				yield* migrateAndReset;
				const db = yield* Database;
				const storage = yield* DomainCanonicalStorage;
				const userId = "44444444-4444-4444-8444-444444444444";

				const markError = yield* Effect.flip(
					storage.markEventAsSentToUser("99999999-9999-4999-8999-999999999999", userId),
				);
				expect(markError).toBeInstanceOf(CanonicalStorageError);
				expect(yield* countCanonicalEventsSentToUsers(db)).toBe(0);
			}),
		),
	);

	it.effect("keeps one sent marker under concurrent duplicate mark requests", () =>
		runWithLivePostgres(
			Effect.gen(function* () {
				yield* migrateAndReset;
				const db = yield* Database;
				const storage = yield* DomainCanonicalStorage;
				const userId = "55555555-5555-4555-8555-555555555555";
				const event = makeEvent("34343434-3434-4434-8434-343434343434", 7_000, 7);

				yield* storage.saveEvent(event, { initiatorId: userId, topics: ["topic-a"] });

				const results = yield* Effect.all(
					[
						Effect.result(storage.markEventAsSentToUser(event.id, userId)),
						Effect.result(storage.markEventAsSentToUser(event.id, userId)),
					],
					{ concurrency: "unbounded" },
				);

				let successCount = 0;
				let failureCount = 0;
				for (const result of results) {
					if (result._tag === "Success") {
						successCount += 1;
					} else {
						failureCount += 1;
						expect(result.failure).toBeInstanceOf(CanonicalStorageError);
					}
				}

				expect(successCount).toBe(1);
				expect(failureCount).toBe(1);
				expect(yield* countCanonicalEventsSentToUsers(db)).toBe(1);

				const sent = yield* storage.getEventsSentToUser(userId);
				expect(sent.map((storedEvent) => storedEvent.id)).toStrictEqual([event.id]);
			}),
		),
	);
});
