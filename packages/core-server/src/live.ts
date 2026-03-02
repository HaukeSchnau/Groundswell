import { DuplicateEventError } from "@groundswell/core";
import type { EventMeta } from "@groundswell/zod-helpers";
import { Effect, Layer, type ServiceMap } from "effect";
import type { Broadcast, CanonicalStorage, IngestEngine, ServerApplicator } from "./interface.js";

export const ingestEngineLive = <
	TEvent extends { id: string },
	IdSelf,
	IdApplicator,
	IdStorage,
	IdBroadcast,
>(
	tag: ServiceMap.Service<IdSelf, IngestEngine<TEvent>>,
	serverApplicatorTag: ServiceMap.Service<IdApplicator, ServerApplicator<TEvent>>,
	canonicalStorageTag: ServiceMap.Service<IdStorage, CanonicalStorage<TEvent>>,
	broadcastTag: ServiceMap.Service<IdBroadcast, Broadcast<TEvent>>,
) =>
	Layer.effect(
		tag,
		Effect.gen(function* () {
			const applicator = yield* serverApplicatorTag;
			const storage = yield* canonicalStorageTag;
			const broadcast = yield* broadcastTag;

			const ingestLogic = Effect.fn("SYNC/Server Ingest")(function* (
				event: TEvent,
				meta: EventMeta,
			) {
				yield* Effect.annotateCurrentSpan({
					meta,
					event,
				});

				// 1. Verify business rules and event uniqueness
				const isUnique = yield* storage.isEventUnique(event.id);
				if (!isUnique) {
					return yield* Effect.fail(new DuplicateEventError({ eventId: event.id }));
				}
				yield* applicator.verify(event, meta);

				// 2. Apply, Save, and Broadcast
				const topics = yield* applicator.getEventTopics(event);
				yield* storage.saveEvent(event, { ...meta, topics });
				yield* applicator.apply(event, meta);

				const userTopics = yield* applicator.getUserTopics(meta.initiatorId);
				const missingEvents = yield* storage.getMissingEventsForUser(meta.initiatorId, userTopics);
				const eventsToPublish = [
					...new Map([...missingEvents, event].map((event) => [event.id, event])).values(),
				];

				if (eventsToPublish.length > 0) {
					yield* broadcast.publishToUser(meta.initiatorId, eventsToPublish);
					yield* Effect.forEach(eventsToPublish, (event) =>
						storage
							.markEventAsSentToUser(event.id, meta.initiatorId)
							.pipe(
								Effect.catchAll((error) =>
									Effect.logWarning(
										`Failed to mark event ${event.id} as sent to user ${meta.initiatorId}: ${error.message}`,
									),
								),
							),
					);
				}
			});

			return tag.of({
				ingest: (event, meta) => ingestLogic(event, meta),
			});
		}),
	);
