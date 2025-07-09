import {
	type CanonicalStorage,
	CanonicalStorageError,
} from "@groundswell/core-server";
import type { EventMeta, UnknownEvent } from "@groundswell/zod-helpers";
import type {
	GenericDatabaseService,
	genericDatabaseFactory,
} from "@schnau/effect-drizzle/generic-sqlite";
import { and, asc, eq, getTableColumns, inArray, isNull } from "drizzle-orm";
import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { type Context, Effect, Layer, pipe } from "effect";
import superjson from "superjson";
import type { z } from "zod";
import { timestamp, uuid } from "./helpers";

export const CanonicalEventsTable = sqliteTable("canonical_events", {
	id: uuid("id").primaryKey(),
	timestamp: timestamp("timestamp").notNull(),
	type: text("type").notNull(),
	data: text("data").notNull(),
	initiator: text("initiator").notNull(),
});
type CanonicalEventsTable = typeof CanonicalEventsTable;

export const CanonicalEventTopicsTable = sqliteTable(
	"canonical_event_topics",
	{
		event: text("event")
			.notNull()
			.references(() => CanonicalEventsTable.id),
		topic: text("topic").notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.event, table.topic] }),
	}),
);
type CanonicalEventTopicsTable = typeof CanonicalEventTopicsTable;

export const CanonicalEventsSentToUsersTable = sqliteTable(
	"canonical_events_sent_to_users",
	{
		event: text("event")
			.notNull()
			.references(() => CanonicalEventsTable.id),
		user: text("user").notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.event, table.user] }),
	}),
);
type CanonicalEventsSentToUsersTable = typeof CanonicalEventsSentToUsersTable;

type Schema = {
	canonicalEvents: CanonicalEventsTable;
	canonicalEventTopics: CanonicalEventTopicsTable;
	canonicalEventsSentToUsers: CanonicalEventsSentToUsersTable;
};

type DbTag<TSchema extends Schema> = ReturnType<
	typeof genericDatabaseFactory<TSchema>
>["Database"];

export interface DrizzleCanonicalStorageConfig<TEvent, TSchema extends Schema> {
	db: DbTag<TSchema>;
	eventSchema: z.ZodSchema<TEvent>;
}

const isEventUnique = <TSchema extends Schema>(
	db: GenericDatabaseService<TSchema>,
	eventId: string,
) =>
	db
		.execute((db) =>
			db
				.select({ id: CanonicalEventsTable.id })
				.from(CanonicalEventsTable)
				.where(eq(CanonicalEventsTable.id, eventId))
				.limit(1),
		)
		.pipe(Effect.map((result) => result.length === 0));

const saveEvent = <TSchema extends Schema, TEvent extends UnknownEvent>(
	db: GenericDatabaseService<TSchema>,
	event: TEvent,
	meta: EventMeta & { topics: string[] },
) =>
	Effect.gen(function* () {
		yield* db.transaction(
			Effect.fn(function* (tx) {
				yield* tx((db) =>
					db.insert(CanonicalEventsTable).values({
						id: event.id,
						timestamp: event.timestamp,
						type: event.type,
						data: superjson.stringify(event.data),
						initiator: meta.initiatorId,
					}),
				);

				if (meta.topics.length > 0) {
					yield* tx((db) =>
						db.insert(CanonicalEventTopicsTable).values(
							meta.topics.map((topic) => ({
								event: event.id,
								topic,
							})),
						),
					);
				}
			}),
		);
	});

const getMissingEventsForUser = <TSchema extends Schema>(
	db: GenericDatabaseService<TSchema>,
	userId: string,
	topics: string[],
) =>
	db.execute((db) =>
		db
			.select({
				...getTableColumns(CanonicalEventsTable),
			})
			.from(CanonicalEventsTable)
			.leftJoin(
				CanonicalEventsSentToUsersTable,
				and(
					eq(CanonicalEventsSentToUsersTable.event, CanonicalEventsTable.id),
					eq(CanonicalEventsSentToUsersTable.user, userId),
				),
			)
			.innerJoin(
				CanonicalEventTopicsTable,
				eq(CanonicalEventTopicsTable.event, CanonicalEventsTable.id),
			)
			.where(
				and(
					isNull(CanonicalEventsSentToUsersTable.user),
					inArray(CanonicalEventTopicsTable.topic, topics),
				),
			)
			.orderBy(asc(CanonicalEventsTable.timestamp)),
	);

const getEventsSentToUser = <TSchema extends Schema>(
	db: GenericDatabaseService<TSchema>,
	userId: string,
) =>
	db.execute((db) =>
		db
			.select({ ...getTableColumns(CanonicalEventsTable) })
			.from(CanonicalEventsTable)
			.where(eq(CanonicalEventsTable.initiator, userId)),
	);

const parseCanonicalEvent = <TEvent extends UnknownEvent>(
	row: typeof CanonicalEventsTable.$inferSelect,
	eventSchema: z.ZodSchema<TEvent>,
) =>
	Effect.try({
		try: () => {
			return eventSchema.parse({
				...row,
				data: superjson.parse(row.data),
				timestamp: row.timestamp,
			});
		},
		catch: (cause) => new CanonicalStorageError({ cause }),
	});

const markEventAsSentToUser = <TSchema extends Schema>(
	db: GenericDatabaseService<TSchema>,
	eventId: string,
	userId: string,
) =>
	db.execute((db) =>
		db
			.insert(CanonicalEventsSentToUsersTable)
			.values({ event: eventId, user: userId }),
	);

export const createDrizzleCanonicalStorageLayer = <
	TEvent extends UnknownEvent,
	TagId,
	TSchema extends Schema,
>(
	CanonicalStorageTag: Context.Tag<TagId, CanonicalStorage<TEvent>>,
	config: DrizzleCanonicalStorageConfig<TEvent, TSchema>,
) =>
	Layer.effect(
		CanonicalStorageTag,
		Effect.gen(function* () {
			const db = yield* config.db;

			return CanonicalStorageTag.of({
				isEventUnique: (eventId) =>
					pipe(
						isEventUnique(db, eventId),
						Effect.catchTag("DatabaseError", (error) =>
							Effect.fail(new CanonicalStorageError({ cause: error })),
						),
					),

				saveEvent: (event, meta) =>
					pipe(
						saveEvent(db, event, meta),
						Effect.catchTag("DatabaseError", (error) =>
							Effect.fail(new CanonicalStorageError({ cause: error })),
						),
					),

				getMissingEventsForUser: (userId, topics) =>
					pipe(
						getMissingEventsForUser(db, userId, topics),
						Effect.andThen((rows) =>
							Effect.allSuccesses(
								rows.map((row) => parseCanonicalEvent(row, config.eventSchema)),
							),
						),
						Effect.catchTag("DatabaseError", (error) =>
							Effect.fail(new CanonicalStorageError({ cause: error })),
						),
					),

				getEventsSentToUser: (userId) =>
					pipe(
						getEventsSentToUser(db, userId),
						Effect.andThen((rows) =>
							Effect.allSuccesses(
								rows.map((row) => parseCanonicalEvent(row, config.eventSchema)),
							),
						),
						Effect.catchTag("DatabaseError", (error) =>
							Effect.fail(new CanonicalStorageError({ cause: error })),
						),
					),

				markEventAsSentToUser: (eventId, userId) =>
					pipe(
						markEventAsSentToUser(db, eventId, userId),
						Effect.catchTag("DatabaseError", (error) =>
							Effect.fail(new CanonicalStorageError({ cause: error })),
						),
					),
			});
		}),
	);
