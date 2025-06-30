import { type Context, Effect, Layer } from "effect";
import { ServerValidationError } from "./errors";
import type {
	Broadcast,
	CanonicalStorage,
	IngestEngine,
	ServerApplicator,
} from "./index";

export const ingestEngineLive = <
	TEvent extends { id: string },
	IdSelf,
	IdApplicator,
	IdStorage,
	IdBroadcast,
>(
	tag: Context.Tag<IdSelf, IngestEngine<TEvent>>,
	serverApplicatorTag: Context.Tag<IdApplicator, ServerApplicator<TEvent>>,
	canonicalStorageTag: Context.Tag<IdStorage, CanonicalStorage<TEvent>>,
	broadcastTag: Context.Tag<IdBroadcast, Broadcast<TEvent>>,
) =>
	Layer.effect(
		tag,
		Effect.gen(function* () {
			const applicator = yield* serverApplicatorTag;
			const storage = yield* canonicalStorageTag;
			const broadcast = yield* broadcastTag;

			const ingestLogic = (event: TEvent, meta: { initiatorId: string }) =>
				Effect.gen(function* () {
					// 1. Verify business rules and event uniqueness
					yield* applicator.verify(event, meta);
					const isUnique = yield* storage.isEventUnique(event.id);
					if (!isUnique) {
						return yield* Effect.fail(
							new ServerValidationError({ reason: "Event already exists" }),
						);
					}

					// 2. Apply, Save, and Broadcast within a single transaction
					const topics = yield* applicator.getTopics(event);
					yield* storage.transactionally(
						Effect.gen(function* () {
							yield* applicator.apply(event);
							yield* storage.saveEvent(event, { ...meta, topics });
						}),
					);
					yield* broadcast.publish(topics, event);
				});

			return tag.of({
				ingest: (event, meta) => ingestLogic(event, meta),
			});
		}),
	);
