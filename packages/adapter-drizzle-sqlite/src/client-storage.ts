import {
	DuplicateEventError,
	type LocalEventStatus,
	type Storage,
	StorageError,
} from "@groundswell/core";
import type { UnknownEvent } from "@groundswell/zod-helpers";
import type {
	DatabaseError,
	GenericDatabaseService,
	GenericSqliteError,
} from "@schnau/effect-drizzle/generic-sqlite";
import { asc, eq, or } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Effect, Layer, pipe, type ServiceMap, Stream } from "effect";
import superjson from "superjson";
import type { z } from "zod";
import { sqliteEnum, timestamp, uuid } from "./helpers.js";

const eventStatus = sqliteEnum(["pending", "error", "success"]);

export const EventsTable = sqliteTable("event_log", {
	id: uuid("id").primaryKey(),
	type: text("type").notNull(),
	data: text("data").notNull(),
	timestamp: timestamp("timestamp").notNull(),
	localStatus: eventStatus("local_status").notNull(),
	remoteStatus: eventStatus("remote_status").notNull(),
});

export type EventsTable = typeof EventsTable;

type Schema = {
	eventLog: EventsTable;
};

// Define the configuration for creating the storage layer.
export interface DrizzleStorageConfig<TEvent, TSchema extends Schema, TagId> {
	/** The Drizzle database client instance. */
	db: ServiceMap.Service<TagId, GenericDatabaseService<TSchema>>;
	/** The Zod schema for parsing events, to ensure type safety on retrieval. */
	eventSchema: z.ZodSchema<TEvent>;
}

const getPendingEvents = <TSchema extends Schema>(db: GenericDatabaseService<TSchema>) =>
	db.execute((client) =>
		client
			.select()
			.from(EventsTable)
			.where(or(eq(EventsTable.localStatus, "pending"), eq(EventsTable.remoteStatus, "pending")))
			.orderBy(asc(EventsTable.timestamp)),
	);

const saveEvent = <TSchema extends Schema, TEvent extends UnknownEvent>(
	db: GenericDatabaseService<TSchema>,
	event: TEvent,
	status: LocalEventStatus,
): Effect.Effect<void, DatabaseError<GenericSqliteError>> =>
	db.execute((client) =>
		client.insert(EventsTable).values({
			id: event.id,
			timestamp: event.timestamp,
			type: event.type,
			data: superjson.stringify(event.data),
			localStatus: status.local,
			remoteStatus: status.remote,
		}),
	);

const updateEventStatus = <TSchema extends Schema>(
	db: GenericDatabaseService<TSchema>,
	eventId: string,
	status: Partial<LocalEventStatus>,
): Effect.Effect<void, DatabaseError<GenericSqliteError>> =>
	db.execute((client) =>
		client
			.update(EventsTable)
			.set({
				localStatus: status.local,
				remoteStatus: status.remote,
			})
			.where(eq(EventsTable.id, eventId)),
	);

const parseLocalEvent = <TEvent extends UnknownEvent>(
	row: typeof EventsTable.$inferSelect,
	eventSchema: z.ZodSchema<TEvent>,
) =>
	Effect.try({
		try: () => {
			const parsedEvent = eventSchema.parse({
				...row,
				data: superjson.parse(row.data),
				timestamp: row.timestamp,
			});
			return {
				event: parsedEvent,
				status: {
					local: row.localStatus,
					remote: row.remoteStatus,
				},
			};
		},
		catch: (cause) => new StorageError({ cause }),
	}).pipe(Effect.catchTag("StorageError", () => Effect.succeed(null)));

/**
 * Creates a Layer that provides a live implementation of the Storage service
 * using Drizzle ORM with an SQLite-compatible database.
 *
 * @param config The configuration object containing the Drizzle client and table schema.
 * @returns A Layer that provides the Storage service.
 */
export const createDrizzleStorageLayer = <
	TEvent extends { id: string; timestamp: Date; type: string; data: unknown },
	TagId,
	TSchema extends Schema,
	DbTagId,
>(
	StorageTag: ServiceMap.Service<TagId, Storage<TEvent>>,
	config: DrizzleStorageConfig<TEvent, TSchema, DbTagId>,
): Layer.Layer<TagId, never, DbTagId> =>
	Layer.effect(
		StorageTag,
		Effect.gen(function* () {
			const db = yield* config.db;

			return StorageTag.of({
				getPendingEvents: Stream.fromIterableEffect(getPendingEvents(db)).pipe(
					Stream.catchTag("DatabaseError", (error) =>
						Stream.fail(new StorageError({ cause: error })),
					),
					Stream.mapEffect((row) => parseLocalEvent(row, config.eventSchema)),
					Stream.filter((row) => row !== null),
				),

				saveEvent: (event, status) =>
					pipe(
						saveEvent(db, event, status),
						Effect.catchTag("DatabaseError", (error) =>
							Effect.fail(
								error.type === "unique_violation"
									? new DuplicateEventError({ eventId: event.id })
									: new StorageError({ cause: error }),
							),
						),
					),

				updateEventStatus: (eventId, status) =>
					pipe(
						updateEventStatus(db, eventId, status),
						Effect.catchTag("DatabaseError", (error) =>
							Effect.fail(new StorageError({ cause: error })),
						),
					),
			});
		}),
	);
