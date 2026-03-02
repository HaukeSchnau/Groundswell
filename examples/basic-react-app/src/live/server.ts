import { CanonicalStorage as CanonicalStorageAdapter } from "@groundswell/adapter-drizzle-sqlite";
import { ApplicatorError, ValidationError } from "@groundswell/core";
import { BroadcastError, type CanonicalStorage } from "@groundswell/core-server";
import { Effect, Layer, PubSub, pipe, Stream } from "effect";
import {
	DomainBroadcast,
	DomainCanonicalStorage,
	DomainServerApplicator,
	ingestEngine,
} from "../boilerplate";
import { applicator } from "../domain/applicators";
import { Database } from "../domain/db/contract";
import { DomainEvent } from "../domain/events";

const serverApplicatorLive = Layer.effect(
	DomainServerApplicator,
	Effect.gen(function* () {
		const db = yield* Database;
		return DomainServerApplicator.of({
			verify: (event, meta) =>
				pipe(
					applicator.verify(event, meta),
					Effect.provideService(Database, db),
					Effect.catchTags({
						DatabaseError: (error) =>
							Effect.fail(new ValidationError({ cause: error, reason: "INVALID" })),
						ValidationError: (error) =>
							Effect.fail(new ValidationError({ cause: error, reason: "INVALID" })),
						UnknownException: (error) =>
							Effect.fail(new ValidationError({ cause: error, reason: "UNKNOWN" })),
					}),
				),
			apply: (event, meta) =>
				pipe(
					applicator.apply(event, meta),
					Effect.provideService(Database, db),
					Effect.catchTags({
						DatabaseError: (error) => Effect.fail(new ApplicatorError({ cause: error })),
						UnknownException: (error) => Effect.fail(new ApplicatorError({ cause: error })),
					}),
				),
			getEventTopics: () => Effect.succeed(["all_notes"]), // Static topic
			getUserTopics: () => Effect.succeed(["all_notes"]), // Static topic
		});
	}),
);

const initializeEventStream = (userId: string, canonicalStorage: CanonicalStorage<DomainEvent>) => {
	return Effect.gen(function* () {
		const events = yield* canonicalStorage.getEventsSentToUser(userId);
		return events;
	});
};

export const memoryBroadcastLive = Layer.effect(
	DomainBroadcast,
	Effect.gen(function* () {
		const pubsub = yield* PubSub.unbounded<DomainEvent>();
		const canonicalStorage = yield* DomainCanonicalStorage;

		return DomainBroadcast.of({
			publishToUser: (userId, events) => {
				console.log("publishing to user", userId, events);
				return pubsub.publishAll(events).pipe(Effect.andThen(Effect.void));
			}, // Simple broadcast, ignores topics
			subscribe: (userId, options) => {
				const initStream = Stream.fromIterableEffect(
					initializeEventStream(userId, canonicalStorage).pipe(
						Effect.map((events) => {
							const offset = options?.offset;
							if (offset === undefined) return events;
							if (offset < 0) return events;
							return events.slice(offset);
						}),
						Effect.catchTag("CanonicalStorageError", (error) => {
							return Effect.fail(new BroadcastError({ cause: error }));
						}),
					),
				);
				return pipe(Stream.concat(initStream, Stream.fromPubSub(pubsub)));
			},
		});
	}),
);

export const canonicalStorageLive = CanonicalStorageAdapter.createDrizzleCanonicalStorageLayer(
	DomainCanonicalStorage,
	{
		db: Database,
		eventSchema: DomainEvent,
	},
);

export const appServerLayer = Layer.provide(ingestEngine, serverApplicatorLive);
