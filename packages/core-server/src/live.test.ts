import { describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, pipe, Ref, Stream } from "effect";
import type {
	Broadcast,
	CanonicalStorage,
	IngestEngine,
	ServerApplicator,
} from "./index";
import { ingestEngineLive } from "./live";

type TestEvent = {
	id: string;
	timestamp: Date;
	type: "test.event";
	data: { value: number };
};

class DomainIngestEngine extends Context.Tag("DomainIngestEngine")<
	DomainIngestEngine,
	IngestEngine<TestEvent>
>() {}

class DomainServerApplicator extends Context.Tag("DomainServerApplicator")<
	DomainServerApplicator,
	ServerApplicator<TestEvent>
>() {}

class DomainCanonicalStorage extends Context.Tag("DomainCanonicalStorage")<
	DomainCanonicalStorage,
	CanonicalStorage<TestEvent>
>() {}

class DomainBroadcast extends Context.Tag("DomainBroadcast")<
	DomainBroadcast,
	Broadcast<TestEvent>
>() {}

// Mock implementations for testing the engine's orchestration
const mockApplicator = Layer.succeed(
	DomainServerApplicator,
	DomainServerApplicator.of({
		verify: () => Effect.succeed(void 0),
		apply: () => Effect.succeed(void 0),
		getTopics: () => Effect.succeed(["topic1"]),
	}),
);
const mockStorage = (isUniqueRef: Ref.Ref<boolean>) =>
	Layer.succeed(
		DomainCanonicalStorage,
		DomainCanonicalStorage.of({
			isEventUnique: () => Ref.get(isUniqueRef),
			saveEvent: () => Effect.succeed(void 0),
			transactionally: (self) => self, // Passthrough for tests
		}),
	);
const mockBroadcast = Layer.succeed(
	DomainBroadcast,
	DomainBroadcast.of({
		publish: () => Effect.succeed(void 0),
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
			Layer.mergeAll(
				mockApplicator,
				mockStorage(Ref.unsafeMake(true)),
				mockBroadcast,
			),
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
			Layer.mergeAll(
				mockApplicator,
				mockStorage(Ref.unsafeMake(false)),
				mockBroadcast,
			),
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

			expect(result._tag).toBe("ServerValidationError");
		}).pipe(Effect.provide(testLayer));
	});
});
