import { CanonicalStorage as CanonicalStorageAdapter } from "@groundswell/adapter-drizzle-sqlite";
import { ApplicatorError } from "@groundswell/core";
import {
	BroadcastError,
	type CanonicalStorage,
	ServerValidationError,
} from "@groundswell/core-server";
import { Effect, Layer, PubSub, pipe, Stream } from "effect";
import {
	DomainBroadcast,
	DomainCanonicalStorage,
	DomainServerApplicator,
	ingestEngine,
} from "@/boilerplate";
import { apply, verify } from "@/domain/applicators";
import { Database } from "@/domain/db/contract";
import { DomainEvent } from "@/domain/events";

const serverApplicatorLive = Layer.effect(
	DomainServerApplicator,
	Effect.gen(function* () {
		const db = yield* Database;
		return DomainServerApplicator.of({
			verify: (event: DomainEvent) =>
				verify(event, db, {
					initiatorId: "1",
				}).pipe(
					Effect.catchTags({
						DatabaseError: (error) =>
							Effect.fail(new ServerValidationError({ cause: error })),
						ApplicatorError: (error) =>
							Effect.fail(new ServerValidationError({ cause: error })),
					}),
				),
			apply: (event: DomainEvent) =>
				apply(event, db, {
					initiatorId: "1",
				}).pipe(
					Effect.catchTag("DatabaseError", (error) =>
						Effect.fail(
							new ApplicatorError({
								cause: error,
							}),
						),
					),
				),
			getEventTopics: () => Effect.succeed(["all_notes"]), // Static topic
			getUserTopics: () => Effect.succeed(["all_notes"]), // Static topic
		});
	}),
);

const initializeEventStream = (
	userId: string,
	canonicalStorage: CanonicalStorage<DomainEvent>,
) => {
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
			publishToTopics: (topics, event) => {
				console.log("publishing to topics", topics, event);
				return pubsub.publish(event);
			}, // Simple broadcast, ignores topics
			publishToUser: (userId, event) => {
				console.log("publishing to user", userId, event);
				return pubsub.publishAll(event);
			}, // Simple broadcast, ignores topics
			subscribe: (userId) => {
				const initStream = Stream.fromIterableEffect(
					initializeEventStream(userId, canonicalStorage).pipe(
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

export const canonicalStorageLive =
	CanonicalStorageAdapter.createDrizzleCanonicalStorageLayer(
		DomainCanonicalStorage,
		{
			db: Database,
			eventSchema: DomainEvent,
		},
	);

export const appServerLayer = Layer.provide(ingestEngine, serverApplicatorLive);
