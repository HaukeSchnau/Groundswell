import { describe, expect, it } from "@effect/vitest";
import { CanonicalStorageError, type CanonicalStorage } from "@groundswell/core-server";
import { createDomainEvent, createEventUnion } from "@groundswell/zod-helpers";
import type { GenericDatabaseService } from "@schnau/effect-drizzle/generic-sqlite";
import { makeService } from "@schnau/effect-drizzle/libsql";
import { eq } from "drizzle-orm";
import { Effect, Layer, ServiceMap } from "effect";
import { z } from "zod";
import {
	CanonicalEventTopicsTable,
	CanonicalEventsSentToUsersTable,
	CanonicalEventsTable,
	createDrizzleCanonicalStorageLayer,
} from "./canonical-storage.js";

const testEvent = createDomainEvent("test.event", { value: z.number() });

type TestEvent = {
	id: string;
	timestamp: Date;
	type: "test.event";
	data: { value: number };
};

const TestEventUnion = createEventUnion([testEvent]) as z.ZodSchema<TestEvent>;

class DomainCanonicalStorage extends ServiceMap.Service<
	DomainCanonicalStorage,
	CanonicalStorage<TestEvent>
>()("CanonicalStorage") {}

const Schema = {
	canonicalEvents: CanonicalEventsTable,
	canonicalEventTopics: CanonicalEventTopicsTable,
	canonicalEventsSentToUsers: CanonicalEventsSentToUsersTable,
};

class Database extends ServiceMap.Service<Database, GenericDatabaseService<typeof Schema>>()(
	"Database",
) {}

const ensurePromise = <T>(value: T | Promise<T>): Promise<T> => {
	if (value instanceof Promise) return value;
	return Promise.resolve(value);
};

const sqliteLive = Layer.effect(
	Database,
	Effect.gen(function* () {
		const service: GenericDatabaseService<typeof Schema> = makeService(
			{
				url: `file:/tmp/groundswell-canonical-storage-${crypto.randomUUID()}.sqlite`,
				schema: Schema,
			},
			Database,
		);

		yield* service.execute((db) =>
			ensurePromise(
				db.run(
					`CREATE TABLE IF NOT EXISTS canonical_events (id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, initiator TEXT NOT NULL);`,
				),
			),
		);
		yield* service.execute((db) =>
			ensurePromise(
				db.run(
					`CREATE TABLE IF NOT EXISTS canonical_event_topics (event TEXT NOT NULL, topic TEXT NOT NULL, PRIMARY KEY(event, topic));`,
				),
			),
		);
		yield* service.execute((db) =>
			ensurePromise(
				db.run(
					`CREATE TABLE IF NOT EXISTS canonical_events_sent_to_users (event TEXT NOT NULL, user TEXT NOT NULL, PRIMARY KEY(event, user));`,
				),
			),
		);

		return service;
	}),
);

const makeLayer = () =>
	createDrizzleCanonicalStorageLayer(DomainCanonicalStorage, {
		db: Database,
		eventSchema: TestEventUnion,
	});

const makeEvent = (id: string, value: number, timestampMs: number): TestEvent => ({
	id,
	timestamp: new Date(timestampMs),
	type: "test.event",
	data: { value },
});

describe("createDrizzleCanonicalStorageLayer (sqlite)", () => {
	it.effect("saves events and returns topic-filtered missing events in timestamp order", () =>
		Effect.gen(function* () {
			const storage = yield* DomainCanonicalStorage;

			const older = makeEvent("11111111-1111-4111-8111-111111111111", 1, 1_000);
			const newer = makeEvent("22222222-2222-4222-8222-222222222222", 2, 2_000);

			yield* storage.saveEvent(older, { initiatorId: "user-1", topics: ["topic-a"] });
			yield* storage.saveEvent(newer, { initiatorId: "user-1", topics: ["topic-a", "topic-b"] });

			const missing = yield* storage.getMissingEventsForUser("user-1", ["topic-a"]);
			expect(missing.map((event) => event.id)).toEqual([older.id, newer.id]);

			yield* storage.markEventAsSentToUser(older.id, "user-1");

			const afterMark = yield* storage.getMissingEventsForUser("user-1", ["topic-a"]);
			expect(afterMark.map((event) => event.id)).toEqual([newer.id]);
		}).pipe(Effect.provide(makeLayer()), Effect.provide(sqliteLive)),
	);

	it.effect("returns sent events and short-circuits empty topic lookups", () =>
		Effect.gen(function* () {
			const storage = yield* DomainCanonicalStorage;
			const event = makeEvent("33333333-3333-4333-8333-333333333333", 3, 3_000);

			yield* storage.saveEvent(event, { initiatorId: "user-1", topics: ["topic-a"] });
			yield* storage.markEventAsSentToUser(event.id, "user-1");

			const sent = yield* storage.getEventsSentToUser("user-1");
			expect(sent).toHaveLength(1);
			expect(sent[0]?.id).toBe(event.id);

			const none = yield* storage.getMissingEventsForUser("user-1", []);
			expect(none).toEqual([]);
		}).pipe(Effect.provide(makeLayer()), Effect.provide(sqliteLive)),
	);

	it.effect("maps parse failures to CanonicalStorageError", () =>
		Effect.gen(function* () {
			const db = yield* Database;
			const storage = yield* DomainCanonicalStorage;
			const eventId = "44444444-4444-4444-8444-444444444444";

			yield* db.execute((client) =>
				client.insert(CanonicalEventsTable).values({
					id: eventId,
					timestamp: new Date(4_000),
					type: "test.event",
					data: "not-superjson",
					initiator: "user-1",
				}),
			);
			yield* db.execute((client) =>
				client.insert(CanonicalEventsSentToUsersTable).values({
					event: eventId,
					user: "user-1",
				}),
			);

			const error = yield* Effect.flip(storage.getEventsSentToUser("user-1"));
			expect(error).toBeInstanceOf(CanonicalStorageError);
		}).pipe(Effect.provide(makeLayer()), Effect.provide(sqliteLive)),
	);

	it.effect("marks uniqueness correctly", () =>
		Effect.gen(function* () {
			const storage = yield* DomainCanonicalStorage;
			const event = makeEvent("55555555-5555-4555-8555-555555555555", 5, 5_000);

			expect(yield* storage.isEventUnique(event.id)).toBe(true);
			yield* storage.saveEvent(event, { initiatorId: "user-1", topics: ["topic-z"] });
			expect(yield* storage.isEventUnique(event.id)).toBe(false);

			const db = yield* Database;
			const rows = yield* db.execute((client) =>
				client.select().from(CanonicalEventsTable).where(eq(CanonicalEventsTable.id, event.id)),
			);
			expect(rows).toHaveLength(1);
		}).pipe(Effect.provide(makeLayer()), Effect.provide(sqliteLive)),
	);
});
