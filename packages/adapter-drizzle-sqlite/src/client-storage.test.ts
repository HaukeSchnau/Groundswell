import { describe, expect, it } from "@effect/vitest";
import type { LocalEvent, Storage } from "@groundswell/core";
import { createDomainEvent, createEventUnion } from "@groundswell/zod-helpers";
import type { GenericDatabaseService } from "@schnau/effect-drizzle/generic-sqlite";
import { makeService } from "@schnau/effect-drizzle/libsql";
import { eq } from "drizzle-orm";
import { Chunk, Context, Effect, Layer, pipe, Redacted, Stream } from "effect";
import { z } from "zod";
import { createDrizzleStorageLayer, EventsTable } from "./client-storage.js";

// --- Test Setup ---

// 1. Define a test event schema
const testEvent = createDomainEvent("test.event", { value: z.number() });
const TestEventUnion = createEventUnion([testEvent]);
type TestEvent = z.infer<typeof TestEventUnion>;

const ensurePromise = <T>(value: T | Promise<T>): Promise<T> => {
	if (value instanceof Promise) return value;
	return Promise.resolve(value);
};

describe("DrizzleStorageAdapter", () => {
	class DomainStorage extends Context.Tag("DomainStorage")<
		DomainStorage,
		Storage<TestEvent>
	>() {}

	const Schema = {
		eventLog: EventsTable,
	};
	// const Database = genericDatabaseFactory<typeof Schema>();
	class Database extends Context.Tag("Database")<
		Database,
		GenericDatabaseService<typeof Schema>
	>() {}

	const bunDatabaseLive = Layer.scoped(
		Database,
		Effect.gen(function* () {
			const service: GenericDatabaseService<typeof Schema> = makeService(
				{
					url: Redacted.make(":memory:"),
					schema: Schema,
				},
				Database,
			);
			yield* service.execute((db) =>
				ensurePromise(
					db.run(
						`CREATE TABLE event_log (id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, local_status TEXT NOT NULL, remote_status TEXT NOT NULL);`,
					),
				),
			);
			return service;
		}),
	);

	it.effect("should save an event correctly", () =>
		Effect.gen(function* () {
			const storage = yield* DomainStorage;
			const event: TestEvent = {
				id: "uuid-1",
				timestamp: new Date(),
				type: "test.event",
				data: { value: 42 },
			};
			const status = { local: "pending", remote: "pending" } as const;
			yield* storage.saveEvent(event, status);
			const db = yield* Database;
			const result = yield* db.execute((db) => db.select().from(EventsTable));
			expect(result).toHaveLength(1);
			expect(result[0]?.id).toBe("uuid-1");
			expect(result[0]?.localStatus).toBe("pending");
		}).pipe(
			Effect.provide(
				createDrizzleStorageLayer(DomainStorage, {
					db: Database,
					eventSchema: TestEventUnion,
				}),
			),
			Effect.provide(bunDatabaseLive),
		),
	);

	it.effect("should update an event's status", () =>
		Effect.gen(function* () {
			const storage = yield* DomainStorage;
			const event: TestEvent = {
				id: "uuid-2",
				timestamp: new Date(),
				type: "test.event",
				data: { value: 42 },
			};
			yield* storage.saveEvent(event, { local: "pending", remote: "pending" });

			yield* storage.updateEventStatus("uuid-2", { local: "success" });

			const db = yield* Database;
			const results = yield* db.execute((db) =>
				db.select().from(EventsTable).where(eq(EventsTable.id, "uuid-2")),
			);
			const result = results[0];
			expect(result?.localStatus).toBe("success");
			expect(result?.remoteStatus).toBe("pending"); // Should not be touched
		}).pipe(
			Effect.provide(
				createDrizzleStorageLayer(DomainStorage, {
					db: Database,
					eventSchema: TestEventUnion,
				}),
			),
			Effect.provide(bunDatabaseLive),
		),
	);

	it.effect("should get only pending events", () =>
		Effect.gen(function* () {
			const storage = yield* DomainStorage;
			const events: LocalEvent<TestEvent>[] = [
				{
					event: {
						id: "123e4567-e89b-12d3-a456-426614174000",
						timestamp: new Date(1000),
						type: "test.event",
						data: { value: 1 },
					},
					status: { local: "pending", remote: "success" },
				},
				{
					event: {
						id: "123e4567-e89b-12d3-a456-426614174002",
						timestamp: new Date(2000),
						type: "test.event",
						data: { value: 2 },
					},
					status: { local: "success", remote: "pending" },
				},
				{
					event: {
						id: "123e4567-e89b-12d3-a456-426614174003",
						timestamp: new Date(3000),
						type: "test.event",
						data: { value: 3 },
					},
					status: { local: "success", remote: "success" },
				},
			];

			// Save all events
			yield* Effect.forEach(events, ({ event, status }) =>
				storage.saveEvent(event, status),
			);

			const pendingStream = storage.getPendingEvents;
			const result = yield* pipe(
				pendingStream,
				Stream.runCollect,
				Effect.map(Chunk.toReadonlyArray),
			);

			expect(result).toHaveLength(2);
			// Should be ordered by timestamp
			expect(result[0]?.event.id).toBe("123e4567-e89b-12d3-a456-426614174000");
			expect(result[1]?.event.id).toBe("123e4567-e89b-12d3-a456-426614174002");
			expect(result[0]?.event.data.value).toBe(1);
		}).pipe(
			Effect.provide(
				createDrizzleStorageLayer(DomainStorage, {
					db: Database,
					eventSchema: TestEventUnion,
				}),
			),
			Effect.provide(bunDatabaseLive),
		),
	);
});
