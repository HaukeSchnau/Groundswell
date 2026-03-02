import { describe, expect, it } from "@effect/vitest";
import { CanonicalStorageError, type CanonicalStorage } from "@groundswell/core-server";
import { createDomainEvent, createEventUnion } from "@groundswell/zod-helpers";
import { DatabaseError, type DatabaseService } from "@schnau/effect-drizzle/postgres";
import { Effect, Layer, ServiceMap } from "effect";
import { z } from "zod";
import {
	createDrizzleCanonicalStorageLayer,
	type CanonicalEventTopicsTable,
	type CanonicalEventsSentToUsersTable,
	type CanonicalEventsTable,
} from "./canonical-storage.js";

type Schema = {
	canonicalEvents: typeof CanonicalEventsTable;
	canonicalEventTopics: typeof CanonicalEventTopicsTable;
	canonicalEventsSentToUsers: typeof CanonicalEventsSentToUsersTable;
};

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

class Database extends ServiceMap.Service<Database, DatabaseService<Schema>>()("Database") {}

const makeDbError = () =>
	new DatabaseError({
		type: "unknown",
		cause: new Error("db failure"),
		drizzleError: null,
	});

const makeNoopDatabaseService = (): DatabaseService<Schema> => {
	const succeedUndefined = <T>() => Effect.succeed(undefined as T);

	const service: DatabaseService<Schema> = {
		execute: (() => succeedUndefined()) as DatabaseService<Schema>["execute"],
		makeQuery: (() => () => succeedUndefined()) as DatabaseService<Schema>["makeQuery"],
		transaction: ((txExecute) =>
			typeof txExecute === "function"
				? txExecute(service)
				: txExecute) as DatabaseService<Schema>["transaction"],
		setupConnectionListeners: Effect.void,
	};

	return service;
};

const makeDatabaseLayer = ({
	execute,
	transaction,
}: {
	execute: DatabaseService<Schema>["execute"];
	transaction?: DatabaseService<Schema>["transaction"];
}) =>
	Layer.succeed(
		Database,
		Database.of({
			execute,
			transaction:
				transaction ??
				(((txExecute) => {
					const txService = makeNoopDatabaseService();
					return typeof txExecute === "function" ? txExecute(txService) : txExecute;
				}) as DatabaseService<Schema>["transaction"]),
			makeQuery: (() => () =>
				Effect.succeed(undefined as never)) as DatabaseService<Schema>["makeQuery"],
			setupConnectionListeners: Effect.void,
		}),
	);

const makeLayer = (databaseLayer: Layer.Layer<Database>) =>
	createDrizzleCanonicalStorageLayer(DomainCanonicalStorage, {
		db: Database,
		eventSchema: TestEventUnion,
	}).pipe(Layer.provide(databaseLayer));

const makeRow = (id: string, value: number, timestampMs = 1_000) => ({
	id,
	timestamp: new Date(timestampMs),
	type: "test.event",
	data: JSON.stringify({ json: { value }, meta: { values: {} } }),
	initiator: "11111111-1111-4111-8111-111111111111",
});

describe("createDrizzleCanonicalStorageLayer (postgres)", () => {
	it.effect("maps uniqueness lookups and short-circuits empty topic requests", () => {
		let calls = 0;
		const layer = makeLayer(
			makeDatabaseLayer({
				execute: (() => {
					calls += 1;
					if (calls === 1) {
						return Effect.succeed([]);
					}
					return Effect.succeed([{ id: "already-there" }]);
				}) as DatabaseService<Schema>["execute"],
			}),
		);

		return Effect.gen(function* () {
			const storage = yield* DomainCanonicalStorage;
			expect(yield* storage.isEventUnique("one")).toBe(true);
			expect(yield* storage.isEventUnique("two")).toBe(false);
			expect(yield* storage.getMissingEventsForUser("user-1", [])).toStrictEqual([]);
			expect(calls).toBe(2);
		}).pipe(Effect.provide(layer), Effect.scoped);
	});

	it.effect("parses missing and sent event rows", () => {
		let calls = 0;
		const layer = makeLayer(
			makeDatabaseLayer({
				execute: (() => {
					calls += 1;
					if (calls === 1) {
						return Effect.succeed([makeRow("11111111-1111-4111-8111-111111111111", 1)]);
					}
					return Effect.succeed([makeRow("22222222-2222-4222-8222-222222222222", 2)]);
				}) as DatabaseService<Schema>["execute"],
			}),
		);

		return Effect.gen(function* () {
			const storage = yield* DomainCanonicalStorage;

			const missing = yield* storage.getMissingEventsForUser(
				"11111111-1111-4111-8111-111111111111",
				["topic-a"],
			);
			expect(missing[0]?.data.value).toBe(1);

			const sent = yield* storage.getEventsSentToUser("11111111-1111-4111-8111-111111111111");
			expect(sent[0]?.data.value).toBe(2);
		}).pipe(Effect.provide(layer), Effect.scoped);
	});

	it.effect("maps parse failures to CanonicalStorageError", () => {
		const layer = makeLayer(
			makeDatabaseLayer({
				execute: (() =>
					Effect.succeed([
						{
							...makeRow("33333333-3333-4333-8333-333333333333", 3),
							data: "not-superjson",
						},
					])) as DatabaseService<Schema>["execute"],
			}),
		);

		return Effect.gen(function* () {
			const storage = yield* DomainCanonicalStorage;
			const parseError = yield* Effect.flip(
				storage.getEventsSentToUser("11111111-1111-4111-8111-111111111111"),
			);
			expect(parseError).toBeInstanceOf(CanonicalStorageError);
		}).pipe(Effect.provide(layer), Effect.scoped);
	});

	it.effect("maps database errors from mark and save", () => {
		const layer = makeLayer(
			makeDatabaseLayer({
				execute: (() =>
					Effect.fail(makeDbError())) as unknown as DatabaseService<Schema>["execute"],
				transaction: (() =>
					Effect.fail(makeDbError())) as unknown as DatabaseService<Schema>["transaction"],
			}),
		);

		return Effect.gen(function* () {
			const storage = yield* DomainCanonicalStorage;

			const markError = yield* Effect.flip(
				storage.markEventAsSentToUser(
					"44444444-4444-4444-8444-444444444444",
					"11111111-1111-4111-8111-111111111111",
				),
			);
			expect(markError).toBeInstanceOf(CanonicalStorageError);

			const saveError = yield* Effect.flip(
				storage.saveEvent(
					{
						id: "55555555-5555-4555-8555-555555555555",
						timestamp: new Date(),
						type: "test.event",
						data: { value: 5 },
					},
					{
						initiatorId: "11111111-1111-4111-8111-111111111111",
						topics: ["topic-a"],
					},
				),
			);
			expect(saveError).toBeInstanceOf(CanonicalStorageError);
		}).pipe(Effect.provide(layer), Effect.scoped);
	});

	it.effect("supports successful save flows for empty and non-empty topic lists", () => {
		let transactionCalls = 0;
		const layer = makeLayer(
			makeDatabaseLayer({
				execute: (() => Effect.succeed([])) as DatabaseService<Schema>["execute"],
				transaction: ((txExecute) => {
					transactionCalls += 1;
					const txService = makeNoopDatabaseService();
					return typeof txExecute === "function" ? txExecute(txService) : txExecute;
				}) as DatabaseService<Schema>["transaction"],
			}),
		);

		return Effect.gen(function* () {
			const storage = yield* DomainCanonicalStorage;
			yield* storage.saveEvent(
				{
					id: "66666666-6666-4666-8666-666666666666",
					timestamp: new Date(),
					type: "test.event",
					data: { value: 6 },
				},
				{
					initiatorId: "11111111-1111-4111-8111-111111111111",
					topics: ["topic-a"],
				},
			);
			yield* storage.saveEvent(
				{
					id: "77777777-7777-4777-8777-777777777777",
					timestamp: new Date(),
					type: "test.event",
					data: { value: 7 },
				},
				{
					initiatorId: "11111111-1111-4111-8111-111111111111",
					topics: [],
				},
			);
			expect(transactionCalls).toBe(2);
		}).pipe(Effect.provide(layer), Effect.scoped);
	});
});
