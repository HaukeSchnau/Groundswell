import { describe, expect, it } from "@effect/vitest";
import { ApplicatorError, ValidationError } from "@groundswell/core";
import { Effect, Layer, pipe, Ref, ServiceMap, Stream } from "effect";
import { BroadcastError, CanonicalStorageError, UserNotFoundError } from "./errors.js";
import type { Broadcast, CanonicalStorage, IngestEngine, ServerApplicator } from "./interface.js";
import { ingestEngineLive } from "./live.js";

type TestEvent = {
	id: string;
	timestamp: Date;
	type: "test.event";
	data: { value: number };
};

class DomainIngestEngine extends ServiceMap.Service<DomainIngestEngine, IngestEngine<TestEvent>>()(
	"DomainIngestEngine",
) {}

class DomainServerApplicator extends ServiceMap.Service<
	DomainServerApplicator,
	ServerApplicator<TestEvent>
>()("DomainServerApplicator") {}

class DomainCanonicalStorage extends ServiceMap.Service<
	DomainCanonicalStorage,
	CanonicalStorage<TestEvent>
>()("DomainCanonicalStorage") {}

class DomainBroadcast extends ServiceMap.Service<DomainBroadcast, Broadcast<TestEvent>>()(
	"DomainBroadcast",
) {}

// Mock implementations for testing the engine's orchestration
const mockApplicator = Layer.succeed(
	DomainServerApplicator,
	DomainServerApplicator.of({
		verify: () => Effect.succeed(void 0),
		apply: () => Effect.succeed(void 0),
		getEventTopics: () => Effect.succeed(["topic1"]),
		getUserTopics: () => Effect.succeed(["topic1"]),
	}),
);
const mockStorage = (
	isUniqueRef: Ref.Ref<boolean>,
	options?: {
		missingEvents?: TestEvent[];
		markedEventsRef?: Ref.Ref<Array<{ eventId: string; userId: string }>>;
		failMarkedEventIds?: string[];
	},
) =>
	Layer.succeed(
		DomainCanonicalStorage,
		DomainCanonicalStorage.of({
			isEventUnique: () => Ref.get(isUniqueRef),
			saveEvent: () => Effect.succeed(void 0),
			getMissingEventsForUser: () => Effect.succeed(options?.missingEvents ?? []),
			getEventsSentToUser: () => Effect.succeed([]),
			markEventAsSentToUser: (eventId, userId) =>
				options?.failMarkedEventIds?.includes(eventId)
					? Effect.fail(
							new CanonicalStorageError({
								cause: `failed to mark ${eventId}`,
							}),
						)
					: options?.markedEventsRef == null
						? Effect.succeed(void 0)
						: Ref.update(options.markedEventsRef, (events) => [...events, { eventId, userId }]),
		}),
	);
const mockBroadcast = (publishedEventsRef?: Ref.Ref<TestEvent[][]>) =>
	Layer.succeed(
		DomainBroadcast,
		DomainBroadcast.of({
			publishToUser: (_userId, events) =>
				publishedEventsRef == null
					? Effect.succeed(void 0)
					: Ref.update(publishedEventsRef, (published) => [...published, events]),
			subscribe: () => Stream.empty,
		}),
	);

describe("IngestEngine", () => {
	const makeRef = <A>(value: A): Ref.Ref<A> => Effect.runSync(Ref.make(value));

	it.effect("should run the full ingest flow on success", () => {
		const testLayer = Layer.provide(
			ingestEngineLive(
				DomainIngestEngine,
				DomainServerApplicator,
				DomainCanonicalStorage,
				DomainBroadcast,
			),
			Layer.mergeAll(mockApplicator, mockStorage(makeRef(true)), mockBroadcast()),
		);
		return Effect.gen(function* () {
			const engine = yield* DomainIngestEngine;
			const result = yield* pipe(
				engine.ingest(
					{
						id: "1",
						timestamp: new Date(),
						type: "test.event",
						data: { value: 1 },
					},
					{ initiatorId: "user-1" },
				),
				Effect.exit,
			);
			expect(result._tag).toBe("Success");
		}).pipe(Effect.provide(testLayer));
	});

	it.effect("should fail if event is not unique", () => {
		const testLayer = Layer.provide(
			ingestEngineLive(
				DomainIngestEngine,
				DomainServerApplicator,
				DomainCanonicalStorage,
				DomainBroadcast,
			),
			Layer.mergeAll(mockApplicator, mockStorage(makeRef(false)), mockBroadcast()),
		);

		return Effect.gen(function* () {
			const engine = yield* DomainIngestEngine;

			const result = yield* pipe(
				engine.ingest(
					{
						id: "1",
						timestamp: new Date(),
						type: "test.event",
						data: { value: 1 },
					},
					{ initiatorId: "user-1" },
				),
				Effect.flip,
			);

			expect(result._tag).toBe("DuplicateEventError");
		}).pipe(Effect.provide(testLayer));
	});

	it.effect("marks every published event as sent for the user", () => {
		const markedEventsRef = makeRef<Array<{ eventId: string; userId: string }>>([]);
		const testLayer = Layer.provide(
			ingestEngineLive(
				DomainIngestEngine,
				DomainServerApplicator,
				DomainCanonicalStorage,
				DomainBroadcast,
			),
			Layer.mergeAll(
				mockApplicator,
				mockStorage(makeRef(true), { markedEventsRef }),
				mockBroadcast(),
			),
		);

		return Effect.gen(function* () {
			const engine = yield* DomainIngestEngine;
			const event = {
				id: "8efea19d-47ad-4696-b4f6-b78d796f8f9c",
				timestamp: new Date(),
				type: "test.event" as const,
				data: { value: 1 },
			};

			yield* engine.ingest(event, { initiatorId: "user-1" });

			const markedEvents = yield* Ref.get(markedEventsRef);
			expect(markedEvents).toEqual([{ eventId: event.id, userId: "user-1" }]);
		}).pipe(Effect.provide(testLayer));
	});

	it.effect("publishes a deduplicated event list when current event is already missing", () => {
		const markedEventsRef = makeRef<Array<{ eventId: string; userId: string }>>([]);
		const publishedEventsRef = makeRef<TestEvent[][]>([]);
		const currentEvent = {
			id: "8efea19d-47ad-4696-b4f6-b78d796f8f9c",
			timestamp: new Date(),
			type: "test.event" as const,
			data: { value: 1 },
		};
		const previousEvent = {
			id: "f4a4e8c2-c472-47af-a435-ad61f94f3558",
			timestamp: new Date(),
			type: "test.event" as const,
			data: { value: 2 },
		};

		const testLayer = Layer.provide(
			ingestEngineLive(
				DomainIngestEngine,
				DomainServerApplicator,
				DomainCanonicalStorage,
				DomainBroadcast,
			),
			Layer.mergeAll(
				mockApplicator,
				mockStorage(makeRef(true), {
					missingEvents: [previousEvent, currentEvent],
					markedEventsRef,
				}),
				mockBroadcast(publishedEventsRef),
			),
		);

		return Effect.gen(function* () {
			const engine = yield* DomainIngestEngine;
			yield* engine.ingest(currentEvent, { initiatorId: "user-1" });

			const publishedEvents = yield* Ref.get(publishedEventsRef);
			const markedEvents = yield* Ref.get(markedEventsRef);

			expect(publishedEvents).toHaveLength(1);
			expect(publishedEvents[0]?.map((event) => event.id)).toEqual([
				previousEvent.id,
				currentEvent.id,
			]);
			expect(markedEvents).toEqual([
				{ eventId: previousEvent.id, userId: "user-1" },
				{ eventId: currentEvent.id, userId: "user-1" },
			]);
		}).pipe(Effect.provide(testLayer));
	});

	it.effect("does not fail ingest when sent markers cannot be persisted after publish", () => {
		const publishedEventsRef = makeRef<TestEvent[][]>([]);
		const event = {
			id: "8efea19d-47ad-4696-b4f6-b78d796f8f9c",
			timestamp: new Date(),
			type: "test.event" as const,
			data: { value: 1 },
		};

		const testLayer = Layer.provide(
			ingestEngineLive(
				DomainIngestEngine,
				DomainServerApplicator,
				DomainCanonicalStorage,
				DomainBroadcast,
			),
			Layer.mergeAll(
				mockApplicator,
				mockStorage(makeRef(true), {
					failMarkedEventIds: [event.id],
				}),
				mockBroadcast(publishedEventsRef),
			),
		);

		return Effect.gen(function* () {
			const engine = yield* DomainIngestEngine;
			const result = yield* Effect.exit(engine.ingest(event, { initiatorId: "user-1" }));
			const publishedEvents = yield* Ref.get(publishedEventsRef);

			expect(result._tag).toBe("Success");
			expect(publishedEvents).toHaveLength(1);
			expect(publishedEvents[0]?.map((publishedEvent) => publishedEvent.id)).toEqual([event.id]);
		}).pipe(Effect.provide(testLayer));
	});

	it.effect("fails ingest when verify fails", () => {
		const failingApplicator = Layer.succeed(
			DomainServerApplicator,
			DomainServerApplicator.of({
				verify: () => Effect.fail(new ValidationError({ cause: "invalid", reason: "INVALID" })),
				apply: () => Effect.void,
				getEventTopics: () => Effect.succeed(["topic1"]),
				getUserTopics: () => Effect.succeed(["topic1"]),
			}),
		);
		const testLayer = Layer.provide(
			ingestEngineLive(
				DomainIngestEngine,
				DomainServerApplicator,
				DomainCanonicalStorage,
				DomainBroadcast,
			),
			Layer.mergeAll(failingApplicator, mockStorage(makeRef(true)), mockBroadcast()),
		);

		return Effect.gen(function* () {
			const engine = yield* DomainIngestEngine;
			const error = yield* Effect.flip(
				engine.ingest(
					{
						id: "verify-failure",
						timestamp: new Date(),
						type: "test.event",
						data: { value: 1 },
					},
					{ initiatorId: "user-1" },
				),
			);
			expect(error._tag).toBe("ValidationError");
		}).pipe(Effect.provide(testLayer));
	});

	it.effect("fails ingest when apply fails", () => {
		const failingApplicator = Layer.succeed(
			DomainServerApplicator,
			DomainServerApplicator.of({
				verify: () => Effect.void,
				apply: () => Effect.fail(new ApplicatorError({ cause: "apply failed" })),
				getEventTopics: () => Effect.succeed(["topic1"]),
				getUserTopics: () => Effect.succeed(["topic1"]),
			}),
		);
		const testLayer = Layer.provide(
			ingestEngineLive(
				DomainIngestEngine,
				DomainServerApplicator,
				DomainCanonicalStorage,
				DomainBroadcast,
			),
			Layer.mergeAll(failingApplicator, mockStorage(makeRef(true)), mockBroadcast()),
		);

		return Effect.gen(function* () {
			const engine = yield* DomainIngestEngine;
			const error = yield* Effect.flip(
				engine.ingest(
					{
						id: "apply-failure",
						timestamp: new Date(),
						type: "test.event",
						data: { value: 1 },
					},
					{ initiatorId: "user-1" },
				),
			);
			expect(error._tag).toBe("ApplicatorError");
		}).pipe(Effect.provide(testLayer));
	});

	it.effect("fails ingest when broadcast fails", () => {
		const failingBroadcast = Layer.succeed(
			DomainBroadcast,
			DomainBroadcast.of({
				publishToUser: () => Effect.fail(new BroadcastError({ cause: "publish failed" })),
				subscribe: () => Stream.empty,
			}),
		);
		const testLayer = Layer.provide(
			ingestEngineLive(
				DomainIngestEngine,
				DomainServerApplicator,
				DomainCanonicalStorage,
				DomainBroadcast,
			),
			Layer.mergeAll(mockApplicator, mockStorage(makeRef(true)), failingBroadcast),
		);

		return Effect.gen(function* () {
			const engine = yield* DomainIngestEngine;
			const error = yield* Effect.flip(
				engine.ingest(
					{
						id: "broadcast-failure",
						timestamp: new Date(),
						type: "test.event",
						data: { value: 1 },
					},
					{ initiatorId: "user-1" },
				),
			);
			expect(error._tag).toBe("BroadcastError");
		}).pipe(Effect.provide(testLayer));
	});

	it.effect("publishes only current event when no missing events are returned", () => {
		const publishedEventsRef = makeRef<TestEvent[][]>([]);
		const recordedTopicsRef = makeRef<string[][]>([]);
		const applicatorWithEmptyTopics = Layer.succeed(
			DomainServerApplicator,
			DomainServerApplicator.of({
				verify: () => Effect.succeed(void 0),
				apply: () => Effect.succeed(void 0),
				getEventTopics: () => Effect.succeed([]),
				getUserTopics: () => Effect.succeed([]),
			}),
		);
		const storageWithTopicCapture = Layer.succeed(
			DomainCanonicalStorage,
			DomainCanonicalStorage.of({
				isEventUnique: () => Effect.succeed(true),
				saveEvent: () => Effect.succeed(void 0),
				getMissingEventsForUser: (_userId, topics) =>
					Ref.update(recordedTopicsRef, (allTopics) => [...allTopics, topics]).pipe(Effect.as([])),
				getEventsSentToUser: () => Effect.succeed([]),
				markEventAsSentToUser: () => Effect.succeed(void 0),
			}),
		);
		const testLayer = Layer.provide(
			ingestEngineLive(
				DomainIngestEngine,
				DomainServerApplicator,
				DomainCanonicalStorage,
				DomainBroadcast,
			),
			Layer.mergeAll(
				applicatorWithEmptyTopics,
				storageWithTopicCapture,
				mockBroadcast(publishedEventsRef),
			),
		);

		return Effect.gen(function* () {
			const engine = yield* DomainIngestEngine;
			const event = {
				id: "single-event",
				timestamp: new Date(),
				type: "test.event" as const,
				data: { value: 1 },
			};

			yield* engine.ingest(event, { initiatorId: "user-1" });

			const recordedTopics = yield* Ref.get(recordedTopicsRef);
			const publishedEvents = yield* Ref.get(publishedEventsRef);
			expect(recordedTopics).toEqual([[]]);
			expect(publishedEvents).toHaveLength(1);
			expect(publishedEvents[0]?.map((publishedEvent) => publishedEvent.id)).toEqual([event.id]);
		}).pipe(Effect.provide(testLayer));
	});

	it.effect("fails ingest when user topics cannot be loaded", () => {
		const noUserApplicator = Layer.succeed(
			DomainServerApplicator,
			DomainServerApplicator.of({
				verify: () => Effect.void,
				apply: () => Effect.void,
				getEventTopics: () => Effect.succeed(["topic1"]),
				getUserTopics: () => Effect.fail(new UserNotFoundError({ userId: "missing" })),
			}),
		);
		const testLayer = Layer.provide(
			ingestEngineLive(
				DomainIngestEngine,
				DomainServerApplicator,
				DomainCanonicalStorage,
				DomainBroadcast,
			),
			Layer.mergeAll(noUserApplicator, mockStorage(makeRef(true)), mockBroadcast()),
		);

		return Effect.gen(function* () {
			const engine = yield* DomainIngestEngine;
			const error = yield* Effect.flip(
				engine.ingest(
					{
						id: "user-not-found",
						timestamp: new Date(),
						type: "test.event",
						data: { value: 1 },
					},
					{ initiatorId: "user-1" },
				),
			);
			expect(error._tag).toBe("UserNotFoundError");
		}).pipe(Effect.provide(testLayer));
	});
});
