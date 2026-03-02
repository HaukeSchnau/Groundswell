import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, pipe, Ref, ServiceMap, Stream } from "effect";
import { CanonicalStorageError } from "./errors.js";
import type { Broadcast, CanonicalStorage, IngestEngine, ServerApplicator } from "./interface.js";
import { ingestEngineLive } from "./live.js";

type TestEvent = {
	id: string;
	timestamp: Date;
	type: "test.event";
	data: { value: number };
};

class DomainIngestEngine extends ServiceMap.Service<
	DomainIngestEngine,
	IngestEngine<TestEvent>
>()("DomainIngestEngine") {}

class DomainServerApplicator extends ServiceMap.Service<
	DomainServerApplicator,
	ServerApplicator<TestEvent>
>()("DomainServerApplicator") {}

class DomainCanonicalStorage extends ServiceMap.Service<
	DomainCanonicalStorage,
	CanonicalStorage<TestEvent>
>()("DomainCanonicalStorage") {}

class DomainBroadcast extends ServiceMap.Service<
	DomainBroadcast,
	Broadcast<TestEvent>
>()("DomainBroadcast") {}

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
	it.effect("should run the full ingest flow on success", () => {
		const testLayer = Layer.provide(
			ingestEngineLive(
				DomainIngestEngine,
				DomainServerApplicator,
				DomainCanonicalStorage,
				DomainBroadcast,
			),
			Layer.mergeAll(mockApplicator, mockStorage(Ref.unsafeMake(true)), mockBroadcast()),
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
			Layer.mergeAll(mockApplicator, mockStorage(Ref.unsafeMake(false)), mockBroadcast()),
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

	it.effect("marks every published event as sent for the user", () =>
		Effect.gen(function* () {
			const markedEventsRef = yield* Ref.make<
				Array<{
					eventId: string;
					userId: string;
				}>
			>([]);

			const testLayer = Layer.provide(
				ingestEngineLive(
					DomainIngestEngine,
					DomainServerApplicator,
					DomainCanonicalStorage,
					DomainBroadcast,
				),
				Layer.mergeAll(
					mockApplicator,
					mockStorage(Ref.unsafeMake(true), { markedEventsRef }),
					mockBroadcast(),
				),
			);

			const engine = yield* DomainIngestEngine.pipe(Effect.provide(testLayer));
			const event = {
				id: "8efea19d-47ad-4696-b4f6-b78d796f8f9c",
				timestamp: new Date(),
				type: "test.event" as const,
				data: { value: 1 },
			};

			yield* engine.ingest(event, { initiatorId: "user-1" });

			const markedEvents = yield* Ref.get(markedEventsRef);
			expect(markedEvents).toEqual([{ eventId: event.id, userId: "user-1" }]);
		}),
	);

	it.effect("publishes a deduplicated event list when current event is already missing", () =>
		Effect.gen(function* () {
			const markedEventsRef = yield* Ref.make<
				Array<{
					eventId: string;
					userId: string;
				}>
			>([]);
			const publishedEventsRef = yield* Ref.make<TestEvent[][]>([]);
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
					mockStorage(Ref.unsafeMake(true), {
						missingEvents: [previousEvent, currentEvent],
						markedEventsRef,
					}),
					mockBroadcast(publishedEventsRef),
				),
			);

			const engine = yield* DomainIngestEngine.pipe(Effect.provide(testLayer));
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
		}),
	);

	it.effect("does not fail ingest when sent markers cannot be persisted after publish", () =>
		Effect.gen(function* () {
			const publishedEventsRef = yield* Ref.make<TestEvent[][]>([]);
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
					mockStorage(Ref.unsafeMake(true), {
						failMarkedEventIds: [event.id],
					}),
					mockBroadcast(publishedEventsRef),
				),
			);

			const engine = yield* DomainIngestEngine.pipe(Effect.provide(testLayer));
			const result = yield* Effect.exit(engine.ingest(event, { initiatorId: "user-1" }));
			const publishedEvents = yield* Ref.get(publishedEventsRef);

			expect(result._tag).toBe("Success");
			expect(publishedEvents).toHaveLength(1);
			expect(publishedEvents[0]?.map((publishedEvent) => publishedEvent.id)).toEqual([event.id]);
		}),
	);
});
