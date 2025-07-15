import { DuplicateEventError } from "@groundswell/core";
import type { EventMeta } from "@groundswell/zod-helpers";
import { type Context, Effect, Layer } from "effect";
import type {
	Broadcast,
	CanonicalStorage,
	IngestEngine,
	ServerApplicator,
} from "./interface.js";

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

			const ingestLogic = Effect.fn("ingest")(function* (
				event: TEvent,
				meta: EventMeta,
			) {
				// 1. Verify business rules and event uniqueness
				const isUnique = yield* storage.isEventUnique(event.id);
				if (!isUnique) {
					return yield* Effect.fail(
						new DuplicateEventError({ eventId: event.id }),
					);
				}
				yield* applicator.verify(event, meta);

				// 2. Apply, Save, and Broadcast
				const topics = yield* applicator.getEventTopics(event);
				yield* storage.saveEvent(event, { ...meta, topics });
				yield* applicator.apply(event, meta);

				const userTopics = yield* applicator.getUserTopics(meta.initiatorId);
				const missingEvents = yield* storage.getMissingEventsForUser(
					meta.initiatorId,
					userTopics,
				);

				yield* broadcast.publishToUser(meta.initiatorId, missingEvents);
				yield* broadcast.publishToUser(meta.initiatorId, [event]);
				yield* broadcast.publishToTopics(topics, event);
			});

			return tag.of({
				ingest: (event, meta) => ingestLogic(event, meta),
			});
		}),
	);
