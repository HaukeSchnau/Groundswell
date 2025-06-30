import type { LocalEvent, Storage } from "@groundswell/core";
import { StorageError } from "@groundswell/core/errors";
import { asc, eq, or } from "drizzle-orm";
import {
	type BaseSQLiteDatabase,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import { type Context, Effect, Layer, Stream } from "effect";
import superjson from "superjson";
import type { z } from "zod";
import { sqliteEnum, timestamp, uuid } from "./helpers";

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

export type DB = BaseSQLiteDatabase<
	"sync" | "async",
	any,
	{
		eventLog: EventsTable;
	}
>;

// Define the configuration for creating the storage layer.
export interface DrizzleStorageConfig<TEvent> {
	/** The Drizzle database client instance. */
	db: DB;
	/** The Zod schema for parsing events, to ensure type safety on retrieval. */
	eventSchema: z.ZodSchema<TEvent>;
}

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
>(
	StorageTag: Context.Tag<TagId, Storage<TEvent>>,
	config: DrizzleStorageConfig<TEvent>,
) =>
	Layer.succeed(
		StorageTag,
		StorageTag.of({
			getPendingEvents: Stream.fromIterableEffect(
				Effect.tryPromise({
					try: () =>
						config.db
							.select()
							.from(EventsTable)
							.where(
								or(
									eq(EventsTable.localStatus, "pending"),
									eq(EventsTable.remoteStatus, "pending"),
								),
							)
							.orderBy(asc(EventsTable.timestamp)),
					catch: (reason) => new StorageError({ reason }),
				}),
			).pipe(
				// Attempt to parse each row back into a LocalEvent
				Stream.mapEffect((row) =>
					Effect.try({
						try: () => {
							const parsedEvent = config.eventSchema.parse({
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
							} as LocalEvent<TEvent>;
						},
						catch: (reason) => new StorageError({ reason }),
					}),
				),
			),

			saveEvent: (event, status) =>
				Effect.tryPromise({
					try: () =>
						config.db.insert(EventsTable).values({
							id: event.id,
							timestamp: event.timestamp,
							type: event.type,
							data: superjson.stringify(event.data),
							localStatus: status.local,
							remoteStatus: status.remote,
						}),
					catch: (reason) => new StorageError({ reason }),
				}),

			updateEventStatus: (eventId, status) =>
				Effect.tryPromise({
					try: () =>
						config.db
							.update(EventsTable)
							.set({
								localStatus: status.local,
								remoteStatus: status.remote,
							})
							.where(eq(EventsTable.id, eventId)),
					catch: (reason) => new StorageError({ reason }),
				}),
		}),
	);
