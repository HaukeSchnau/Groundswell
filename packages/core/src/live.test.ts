import { beforeEach, describe, expect, it } from "@effect/vitest";
import { Effect, Layer, PubSub, pipe, Ref, ServiceMap, Stream } from "effect";
import { TestClock } from "effect/testing";
import { DuplicateEventError, StorageError, TransportError, ValidationError } from "./errors.js";
import type { Applicator, LocalEvent, Storage, SyncEngine, Transport } from "./interface.js";
import { syncEngineLive } from "./live.js";

// Define a simple event type for testing
type TestEvent = {
	id: string;
	timestamp: Date;
	type: "test.event";
	data: { value: number };
};

class DomainApplicator extends ServiceMap.Service<DomainApplicator, Applicator<TestEvent>>()(
	"Applicator",
) {}

class DomainStorage extends ServiceMap.Service<DomainStorage, Storage<TestEvent>>()("Storage") {}

class DomainTransport extends ServiceMap.Service<DomainTransport, Transport<TestEvent>>()(
	"Transport",
) {}

class DomainSyncEngine extends ServiceMap.Service<DomainSyncEngine, SyncEngine<TestEvent>>()(
	"SyncEngine",
) {}

describe("SyncEngine", () => {
	// --- Mocks and Test State ---

	// Refs to track calls to our mock services
	let applicatorVerifyCalls: Ref.Ref<TestEvent[]>;
	let applicatorApplyCalls: Ref.Ref<TestEvent[]>;
	let storageSaveCalls: Ref.Ref<LocalEvent<TestEvent>[]>;
	let storageUpdateCalls: Ref.Ref<
		{ id: string; status: Partial<LocalEvent<TestEvent>["status"]> }[]
	>;
	let transportPublishCalls: Ref.Ref<TestEvent[]>;

	// PubSubs to control mock streams
	let remoteEventsPubSub: PubSub.PubSub<TestEvent>;
	let pendingEventsPubSub: PubSub.PubSub<LocalEvent<TestEvent>>;

	// Mock Layers
	let mockApplicator: Layer.Layer<DomainApplicator>;
	let mockStorage: Layer.Layer<DomainStorage>;
	let mockTransport: Layer.Layer<DomainTransport>;

	let engine: Layer.Layer<
		DomainSyncEngine,
		never,
		DomainApplicator | DomainStorage | DomainTransport
	>;

	// The final composed layer for testing
	let testLayer: Layer.Layer<DomainSyncEngine>;

	beforeEach(() => {
		// Reset state before each test
		const setup = Effect.gen(function* () {
			applicatorVerifyCalls = yield* Ref.make<TestEvent[]>([]);
			applicatorApplyCalls = yield* Ref.make<TestEvent[]>([]);
			storageSaveCalls = yield* Ref.make<LocalEvent<TestEvent>[]>([]);
			storageUpdateCalls = yield* Ref.make<
				{ id: string; status: Partial<LocalEvent<TestEvent>["status"]> }[]
			>([]);
			transportPublishCalls = yield* Ref.make<TestEvent[]>([]);
			remoteEventsPubSub = yield* PubSub.unbounded<TestEvent>();

			pendingEventsPubSub = yield* PubSub.unbounded<LocalEvent<TestEvent>>();
		});
		Effect.runSync(setup);

		// --- Mock Service Implementations ---
		mockApplicator = Layer.succeed(
			DomainApplicator,
			DomainApplicator.of({
				verify: (event) => Ref.update(applicatorVerifyCalls, (calls) => [...calls, event]),
				apply: (event) => Ref.update(applicatorApplyCalls, (calls) => [...calls, event]),
			}),
		);

		mockStorage = Layer.succeed(
			DomainStorage,
			DomainStorage.of({
				getPendingEvents: Stream.fromPubSub(pendingEventsPubSub),
				saveEvent: (event, status) =>
					Ref.update(storageSaveCalls, (calls) => [...calls, { event, status }]),
				updateEventStatus: (eventId, status) =>
					Ref.update(storageUpdateCalls, (calls) => [...calls, { id: eventId, status }]),
			}),
		);

		mockTransport = Layer.succeed(
			DomainTransport,
			DomainTransport.of({
				publish: (event) => Ref.update(transportPublishCalls, (calls) => [...calls, event]),
				listen: () => Effect.succeed(Stream.fromPubSub(remoteEventsPubSub)),
			}),
		);

		// Compose the final layer with the live engine and mock dependencies
		engine = syncEngineLive(DomainSyncEngine, DomainApplicator, DomainStorage, DomainTransport, {
			offset: 0,
		});
		testLayer = Layer.provide(engine, Layer.mergeAll(mockApplicator, mockStorage, mockTransport));
	});

	it.effect("should process a successfully ingested event through the full lifecycle", () =>
		Effect.gen(function* () {
			const engine = yield* DomainSyncEngine;
			const eventSubscription = yield* PubSub.subscribe(engine.events);

			// Ingest a new event
			yield* engine.ingest({ type: "test.event", data: { value: 1 } });

			// Advance the virtual clock to allow the queue worker to run
			yield* TestClock.adjust("2 seconds");

			// --- Assertions ---
			const saved = yield* Ref.get(storageSaveCalls);
			expect(saved).toHaveLength(1);
			expect(saved[0]?.event.data.value).toBe(1);
			expect(saved[0]?.status).toEqual({
				local: "pending",
				remote: "pending",
			});

			const verified = yield* Ref.get(applicatorVerifyCalls);
			expect(verified).toHaveLength(1);

			const applied = yield* Ref.get(applicatorApplyCalls);
			expect(applied).toHaveLength(1);

			const published = yield* Ref.get(transportPublishCalls);
			expect(published).toHaveLength(1);

			const updates = yield* Ref.get(storageUpdateCalls);
			expect(updates).toHaveLength(2);
			expect(updates[0]?.status).toEqual({ local: "success" });
			expect(updates[1]?.status).toEqual({ remote: "success" });

			const events = yield* PubSub.takeAll(eventSubscription);

			// Check the broadcasted events
			expect(events).toHaveLength(2); // initial, local:success, remote:success
			const [firstEvent, secondEvent] = events as [LocalEvent<TestEvent>, LocalEvent<TestEvent>];
			expect(firstEvent.status).toEqual({
				local: "success",
				remote: "pending",
			});
			expect(secondEvent.status).toEqual({
				local: "success",
				remote: "success",
			});
		}).pipe(Effect.scoped, Effect.provide(testLayer)),
	);

	it.effect("should fail ingestion if verification fails", () => {
		const failingApplicator = Layer.succeed(
			DomainApplicator,
			DomainApplicator.of({
				verify: () =>
					Effect.fail(new ValidationError({ cause: "Invalid value", reason: "INVALID" })),
				apply: () => Effect.succeed(undefined),
			}),
		);

		const testLayer = Layer.provide(
			engine,
			Layer.mergeAll(failingApplicator, mockStorage, mockTransport),
		);

		return Effect.gen(function* () {
			const engine = yield* DomainSyncEngine;

			// // Attempt to ingest
			const err = yield* pipe(
				engine.ingest({ type: "test.event", data: { value: -1 } }),
				Effect.flip,
			);

			// // --- Assertions ---
			expect(err._tag).toBe("ValidationError");
			if (err._tag === "ValidationError") {
				expect(err.cause).toBe("Invalid value");
			}

			const saved = yield* Ref.get(storageSaveCalls);
			expect(saved).toHaveLength(1); // Should still be saved even if it fails verification
		}).pipe(Effect.scoped, Effect.provide(testLayer));
	});

	it.effect("should process a remote event without publishing it", () => {
		const mockTransport = Layer.effect(
			DomainTransport,
			Effect.gen(function* () {
				const subscription = yield* PubSub.subscribe(remoteEventsPubSub);
				const stream = Stream.fromEffectRepeat(PubSub.take(subscription));
				return DomainTransport.of({
					publish: () => Effect.succeed(undefined),
					listen: () => Effect.succeed(stream),
				});
			}),
		);

		const testLayer = Layer.provide(
			engine,
			Layer.mergeAll(mockTransport, mockStorage, mockApplicator),
		);

		return Effect.gen(function* () {
			const remoteEvent: TestEvent = {
				id: "remote-1",
				timestamp: new Date(),
				type: "test.event",
				data: { value: 100 },
			};

			// Simulate a remote event arriving
			yield* PubSub.publish(remoteEventsPubSub, remoteEvent);
			yield* TestClock.adjust("2 seconds");

			// --- Assertions ---
			const applied = yield* Ref.get(applicatorApplyCalls);
			expect(applied).toHaveLength(1);
			expect(applied[0]?.id).toBe("remote-1");

			// Check that the event was saved to the local event log
			const saved = yield* Ref.get(storageSaveCalls);
			expect(saved).toHaveLength(1);
			expect(saved[0]?.event.id).toBe("remote-1");
			expect(saved[0]?.event.data.value).toBe(100);
			expect(saved[0]?.status).toEqual({
				local: "pending",
				remote: "success",
			});

			// Crucially, it should NOT be published back
			const published = yield* Ref.get(transportPublishCalls);
			expect(published).toHaveLength(0);
			const updates = yield* Ref.get(storageUpdateCalls);
			expect(updates).toHaveLength(1);
			expect(updates[0]?.status).toEqual({ local: "success" });
		}).pipe(Effect.provide(testLayer), Effect.scoped);
	});

	it.effect("should retry publishing on a retryable transport error", () => {
		return Effect.gen(function* () {
			const publishAttempts = yield* Ref.make(0);
			const failingTransport = Layer.succeed(
				DomainTransport,
				DomainTransport.of({
					publish: (event) =>
						Ref.getAndUpdate(publishAttempts, (n) => n + 1).pipe(
							Effect.flatMap((attempts) =>
								attempts === 0
									? Effect.fail(
											new TransportError({
												cause: new Error("Network down"),
												isRetryable: true,
											}),
										)
									: Ref.update(transportPublishCalls, (c) => [...c, event]),
							),
						),
					listen: () => Effect.succeed(Stream.empty),
				}),
			);
			const testLayer = Layer.provide(
				engine,
				Layer.mergeAll(failingTransport, mockStorage, mockApplicator),
			);

			const engineLive = yield* testLayer.pipe(
				Layer.build,
				Effect.map((layer) => ServiceMap.get(layer, DomainSyncEngine)),
			);

			yield* engineLive.ingest({ type: "test.event", data: { value: 1 } });
			yield* TestClock.adjust("5 seconds"); // Adjust past the retry schedule
			// --- Assertions ---
			const attempts = yield* Ref.get(publishAttempts);
			expect(attempts).toBe(2); // Initial attempt + 1 retry
			const published = yield* Ref.get(transportPublishCalls);
			expect(published).toHaveLength(1); // Eventually succeeded
			const updates = yield* Ref.get(storageUpdateCalls);
			const remoteUpdate = updates.find((u) => "remote" in u.status);
			expect(remoteUpdate?.status).toEqual({ remote: "success" });
		}).pipe(Effect.scoped);
	});

	it.effect("should mark remote status as error on non-retryable transport failures", () =>
		Effect.gen(function* () {
			const failingTransport = Layer.succeed(
				DomainTransport,
				DomainTransport.of({
					publish: () =>
						Effect.fail(
							new TransportError({
								cause: new Error("Bad request"),
								isRetryable: false,
							}),
						),
					listen: () => Effect.succeed(Stream.empty),
				}),
			);
			const testLayer = Layer.provide(
				engine,
				Layer.mergeAll(failingTransport, mockStorage, mockApplicator),
			);
			const engineLive = yield* testLayer.pipe(
				Layer.build,
				Effect.map((layer) => ServiceMap.get(layer, DomainSyncEngine)),
			);

			yield* engineLive.ingest({ type: "test.event", data: { value: 1 } });
			yield* TestClock.adjust("2 seconds");

			const updates = yield* Ref.get(storageUpdateCalls);
			const remoteUpdate = updates.find((update) => update.status.remote !== undefined);
			expect(remoteUpdate?.status).toEqual({ remote: "error" });
		}).pipe(Effect.scoped),
	);

	it.effect("should treat duplicate publish as remote success", () =>
		Effect.gen(function* () {
			const duplicateTransport = Layer.succeed(
				DomainTransport,
				DomainTransport.of({
					publish: (event) =>
						Effect.fail(
							new DuplicateEventError({
								eventId: event.id,
							}),
						),
					listen: () => Effect.succeed(Stream.empty),
				}),
			);
			const testLayer = Layer.provide(
				engine,
				Layer.mergeAll(duplicateTransport, mockStorage, mockApplicator),
			);
			const engineLive = yield* testLayer.pipe(
				Layer.build,
				Effect.map((layer) => ServiceMap.get(layer, DomainSyncEngine)),
			);

			yield* engineLive.ingest({ type: "test.event", data: { value: 5 } });
			yield* TestClock.adjust("2 seconds");

			const updates = yield* Ref.get(storageUpdateCalls);
			const remoteUpdate = updates.find((update) => update.status.remote !== undefined);
			expect(remoteUpdate?.status).toEqual({ remote: "success" });
		}).pipe(Effect.scoped),
	);

	it.effect("replays pending events in order and only publishes remote-pending items", () => {
		const pendingA: LocalEvent<TestEvent> = {
			event: {
				id: "pending-a",
				timestamp: new Date(1_000),
				type: "test.event",
				data: { value: 1 },
			},
			status: {
				local: "pending",
				remote: "pending",
			},
		};
		const pendingB: LocalEvent<TestEvent> = {
			event: {
				id: "pending-b",
				timestamp: new Date(2_000),
				type: "test.event",
				data: { value: 2 },
			},
			status: {
				local: "pending",
				remote: "success",
			},
		};

		const replayStorage = Layer.succeed(
			DomainStorage,
			DomainStorage.of({
				getPendingEvents: Stream.fromIterable([pendingA, pendingB]),
				saveEvent: (event, status) =>
					Ref.update(storageSaveCalls, (calls) => [...calls, { event, status }]),
				updateEventStatus: (eventId, status) =>
					Ref.update(storageUpdateCalls, (calls) => [...calls, { id: eventId, status }]),
			}),
		);
		const replayTransport = Layer.succeed(
			DomainTransport,
			DomainTransport.of({
				publish: (event) => Ref.update(transportPublishCalls, (calls) => [...calls, event]),
				listen: () => Effect.succeed(Stream.empty),
			}),
		);
		const testLayer = Layer.provide(
			engine,
			Layer.mergeAll(replayStorage, replayTransport, mockApplicator),
		);

		return Effect.gen(function* () {
			yield* TestClock.adjust("2 seconds");

			const applied = yield* Ref.get(applicatorApplyCalls);
			expect(applied[0]?.id).toBe("pending-a");

			const published = yield* Ref.get(transportPublishCalls);
			expect(published.map((event) => event.id)).toEqual(["pending-a"]);
		}).pipe(Effect.provide(testLayer), Effect.scoped);
	});

	it.effect("continues local ingest when listen stream setup fails", () =>
		Effect.gen(function* () {
			const brokenListenerTransport = Layer.succeed(
				DomainTransport,
				DomainTransport.of({
					publish: (event) => Ref.update(transportPublishCalls, (calls) => [...calls, event]),
					listen: () =>
						Effect.succeed(
							Stream.fail(
								new TransportError({
									cause: new Error("listen failed"),
									isRetryable: true,
								}),
							),
						),
				}),
			);
			const testLayer = Layer.provide(
				engine,
				Layer.mergeAll(brokenListenerTransport, mockStorage, mockApplicator),
			);
			const engineLive = yield* testLayer.pipe(
				Layer.build,
				Effect.map((layer) => ServiceMap.get(layer, DomainSyncEngine)),
			);

			yield* engineLive.ingest({ type: "test.event", data: { value: 7 } });
			yield* TestClock.adjust("2 seconds");

			const published = yield* Ref.get(transportPublishCalls);
			expect(published).toHaveLength(1);
		}).pipe(Effect.scoped),
	);

	it.effect("should handle duplicate events gracefully without processing them", () => {
		const mockStorageWithDuplicate = Layer.succeed(
			DomainStorage,
			DomainStorage.of({
				getPendingEvents: Stream.fromPubSub(pendingEventsPubSub),
				saveEvent: () =>
					Effect.fail(
						new StorageError({
							cause: new Error("Duplicate event"),
						}),
					),
				updateEventStatus: (eventId, status) =>
					Ref.update(storageUpdateCalls, (calls) => [...calls, { id: eventId, status }]),
			}),
		);

		const testLayer = Layer.provide(
			engine,
			Layer.mergeAll(mockTransport, mockStorageWithDuplicate, mockApplicator),
		);

		return Effect.gen(function* () {
			const duplicateEvent: TestEvent = {
				id: "duplicate-1",
				timestamp: new Date(),
				type: "test.event",
				data: { value: 200 },
			};

			// Simulate a duplicate remote event arriving
			yield* PubSub.publish(remoteEventsPubSub, duplicateEvent);
			yield* TestClock.adjust("2 seconds");

			// --- Assertions ---
			// Should NOT be applied (duplicate events should be ignored)
			const applied = yield* Ref.get(applicatorApplyCalls);
			expect(applied).toHaveLength(0);

			// Should NOT be verified (duplicate events should be ignored)
			const verified = yield* Ref.get(applicatorVerifyCalls);
			expect(verified).toHaveLength(0);

			// Should NOT be published (duplicate events should be ignored)
			const published = yield* Ref.get(transportPublishCalls);
			expect(published).toHaveLength(0);

			// Should NOT have any status updates (duplicate events should be ignored)
			const updates = yield* Ref.get(storageUpdateCalls);
			expect(updates).toHaveLength(0);
		}).pipe(Effect.provide(testLayer), Effect.scoped);
	});
});
