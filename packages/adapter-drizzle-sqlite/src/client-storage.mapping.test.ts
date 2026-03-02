import { describe, expect, it } from "@effect/vitest";
import { DuplicateEventError, StorageError, type Storage } from "@groundswell/core";
import type { GenericDatabaseService } from "@schnau/effect-drizzle/generic-sqlite";
import { Effect, Layer, ServiceMap } from "effect";
import { z } from "zod";
import { createDrizzleStorageLayer, EventsTable } from "./client-storage.js";

type TestEvent = {
	id: string;
	timestamp: Date;
	type: "test.event";
	data: { value: number };
};

class DomainStorage extends ServiceMap.Service<DomainStorage, Storage<TestEvent>>()(
	"DomainStorage",
) {}

const Schema = {
	eventLog: EventsTable,
};

class Database extends ServiceMap.Service<Database, GenericDatabaseService<typeof Schema>>()(
	"Database",
) {}

const EventSchema = z.object({
	id: z.string(),
	timestamp: z.date(),
	type: z.literal("test.event"),
	data: z.object({ value: z.number() }),
});

const makeDbError = (type: "unique_violation" | "unknown") =>
	({
		_tag: "DatabaseError",
		type,
		cause: { message: "db error" },
		drizzleError: null,
	}) as const;

const makeDatabaseLayer = (errorType: "unique_violation" | "unknown") =>
	Layer.succeed(
		Database,
		(() => {
			let executeCalls = 0;
			const succeedUndefined = <T>() => Effect.succeed(undefined as T);

			const makeQuery = (() => () => succeedUndefined()) as GenericDatabaseService<
				typeof Schema
			>["makeQuery"];

			const transaction = ((txExecute) => {
				const txService = {
					execute: (() => succeedUndefined()) as GenericDatabaseService<typeof Schema>["execute"],
					transaction: ((innerTx) =>
						typeof innerTx === "function" ? innerTx(txService) : innerTx) as GenericDatabaseService<
						typeof Schema
					>["transaction"],
					makeQuery,
				} satisfies GenericDatabaseService<typeof Schema>;

				return typeof txExecute === "function" ? txExecute(txService) : txExecute;
			}) as GenericDatabaseService<typeof Schema>["transaction"];

			return Database.of({
				execute: (() => {
					executeCalls += 1;
					// createDrizzleStorageLayer builds getPendingEvents eagerly once.
					if (executeCalls === 1) {
						return Effect.succeed([]);
					}
					return Effect.fail(makeDbError(errorType));
				}) as GenericDatabaseService<typeof Schema>["execute"],
				transaction,
				makeQuery,
			});
		})(),
	);

const makeStorageLayer = (databaseLayer: Layer.Layer<Database>) =>
	createDrizzleStorageLayer(DomainStorage, {
		db: Database,
		eventSchema: EventSchema,
	}).pipe(Layer.provide(databaseLayer));

const testEvent: TestEvent = {
	id: "123e4567-e89b-42d3-a456-426614174777",
	timestamp: new Date(),
	type: "test.event",
	data: { value: 1 },
};

describe("createDrizzleStorageLayer error mapping", () => {
	it.effect("maps unique_violation to DuplicateEventError", () => {
		const layer = makeStorageLayer(makeDatabaseLayer("unique_violation"));
		return Effect.gen(function* () {
			const storage = yield* DomainStorage;
			const error = yield* Effect.flip(
				storage.saveEvent(testEvent, { local: "pending", remote: "pending" }),
			);
			expect(error).toBeInstanceOf(DuplicateEventError);
		}).pipe(Effect.provide(layer));
	});

	it.effect("maps non-unique DB errors to StorageError", () => {
		const layer = makeStorageLayer(makeDatabaseLayer("unknown"));
		return Effect.gen(function* () {
			const storage = yield* DomainStorage;
			const error = yield* Effect.flip(
				storage.saveEvent(testEvent, { local: "pending", remote: "pending" }),
			);
			expect(error).toBeInstanceOf(StorageError);
		}).pipe(Effect.provide(layer));
	});
});
