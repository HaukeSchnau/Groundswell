import {
	Context,
	Effect,
	Layer,
	Option,
	PubSub, // Corrected: Use PubSub instead of Hub
	pipe,
	Queue,
	Schedule,
	Stream,
} from "effect";
import type { ApplicatorError, StorageError, ValidationError } from "./errors";
import type {
	Applicator,
	LocalEvent,
	Storage,
	SyncEngine,
	Transport,
} from "./index";

class RandomUUID extends Context.Tag("RandomUUID")<
	RandomUUID,
	{ readonly next: Effect.Effect<string> }
>() {}

const randomUUID = pipe(
	Effect.serviceOption(RandomUUID),
	Effect.flatMap(
		Option.match({
			onNone: () => Effect.succeed(crypto.randomUUID()),
			onSome: (randomService) => randomService.next,
		}),
	),
);

/**
 * The live implementation of the SyncEngine service.
 *
 * This Layer is responsible for:
 * 1.  Creating and managing a concurrent Queue for processing events.
 * 2.  Creating PubSubs to broadcast event and status updates to consumers.
 * 3.  Forking background fibers for:
 *     - Loading pending events from Storage on startup.
 *     - Listening for remote events from the Transport.
 *     - Processing events from the queue (verify, apply, publish).
 *     - Broadcasting the queue status periodically.
 * 4.  Providing the public `ingest` and stream APIs.
 *
 * The entire lifecycle is managed by `Layer.scoped`, ensuring that all
 * background fibers are gracefully shut down when the application scope closes.
 */
export const syncEngineLive = <
	TEvent extends { id: string },
	IdSelf,
	IdApplicator,
	IdStorage,
	IdTransport,
>(
	tag: Context.Tag<IdSelf, SyncEngine<TEvent>>,
	applicatorTag: Context.Tag<IdApplicator, Applicator<TEvent>>,
	storageTag: Context.Tag<IdStorage, Storage<TEvent>>,
	transportTag: Context.Tag<IdTransport, Transport<TEvent>>,
) =>
	Layer.scoped(
		tag,
		Effect.gen(function* () {
			// 1. Get required services from the context
			const applicator = yield* applicatorTag;
			const storage = yield* storageTag;
			const transport = yield* transportTag;

			// 2. Create state management primitives
			const queue = yield* Queue.unbounded<LocalEvent<TEvent>>();
			const eventsPubSub = yield* PubSub.unbounded<LocalEvent<TEvent>>();
			const statusPubSub = yield* PubSub.unbounded<{ queueSize: number }>();

			const applyEventLocally = (localEvent: LocalEvent<TEvent>) =>
				Effect.gen(function* () {
					yield* applicator.verify(localEvent.event).pipe(
						Effect.tapErrorTag("ValidationError", () =>
							storage.updateEventStatus(localEvent.event.id, {
								local: "error",
							}),
						),
					);

					yield* applicator.apply(localEvent.event);
					yield* storage.updateEventStatus(localEvent.event.id, {
						local: "success",
					});

					const result = {
						...localEvent,
						status: {
							...localEvent.status,
							local: "success" as const,
						},
					};

					yield* eventsPubSub.publish(result);
					return result;
				});

			const publishEventRemotely = (
				localEvent: LocalEvent<TEvent>,
			): Effect.Effect<void, StorageError> =>
				Effect.gen(function* () {
					const published = yield* pipe(
						transport.publish(localEvent.event),
						// Retry on retryable network errors with a backoff schedule
						Effect.retry(
							Schedule.exponential("1 second").pipe(
								Schedule.whileInput(
									// @ts-expect-error -- TODO fix
									(e) => e.isRetryable && e._tag === "TransportError",
								),
								Schedule.jittered,
							),
						),
						Effect.as({ ...localEvent.status, remote: "success" } as const),
						Effect.catchTag("TransportError", () =>
							Effect.succeed({
								...localEvent.status,
								remote: "error",
							} as const),
						),
					);

					yield* storage.updateEventStatus(localEvent.event.id, {
						remote: published.remote,
					});

					yield* eventsPubSub.publish({
						...localEvent,
						status: {
							...localEvent.status,
							remote: published.remote,
						},
					});
				});

			// 3. Define the core processing logic for a single event
			const processEvent = (
				localEvent: LocalEvent<TEvent>,
			): Effect.Effect<
				void,
				StorageError | ApplicatorError | ValidationError
			> =>
				Effect.gen(function* () {
					// --- Step A: Local Application. Aborts if local application fails ---
					if (localEvent.status.local === "pending")
						yield* applyEventLocally(localEvent);

					// --- Step B: Remote Publishing ---
					if (localEvent.status.remote === "pending")
						yield* publishEventRemotely(localEvent);
				});

			// 4. Fork all background fibers, their lifecycle is tied to the Layer's scope
			//    - Main worker processing events from the queue
			yield* pipe(
				queue.take,
				Effect.flatMap((event) =>
					processEvent(event).pipe(
						Effect.catchAll((error) => Effect.logError(error)),
					),
				),
				Effect.forever,
				Effect.forkScoped,
			);

			//    - Load pending events from storage on startup
			yield* pipe(
				storage.getPendingEvents,
				Stream.runForEach((localEvent) => queue.offer(localEvent)),
				Effect.forkScoped,
			);

			//    - Listen for remote events and add them to the queue
			yield* pipe(
				transport.listen,
				Effect.andThen((stream) =>
					stream.pipe(
						Stream.mapEffect((event) =>
							Effect.succeed({
								event,
								status: { local: "pending", remote: "success" },
							} as LocalEvent<TEvent>),
						),
						Stream.runForEach((localEvent) => queue.offer(localEvent)),
					),
				),
				Effect.forkScoped,
			);

			//    - Periodically broadcast the queue size
			yield* pipe(
				queue.size,
				Effect.flatMap((size) => statusPubSub.publish({ queueSize: size })),
				Effect.repeat(Schedule.spaced("1 second")),
				Effect.forkScoped,
			);

			// 5. Implement and provide the SyncEngine service interface
			return tag.of({
				ingest: (unidentifiedEvent) =>
					Effect.gen(function* () {
						const event = {
							...unidentifiedEvent,
							id: yield* randomUUID,
							timestamp: new Date(),
						} as unknown as TEvent;

						const localEvent: LocalEvent<TEvent> = {
							event,
							status: { local: "pending", remote: "pending" },
						};
						yield* storage.saveEvent(event, localEvent.status);
						const applied = yield* applyEventLocally(localEvent);

						yield* queue.offer(applied);
					}).pipe(
						Effect.tapError((error) =>
							Effect.logError("Error ingesting event", error),
						),
					),
				events: eventsPubSub,
				status: statusPubSub,
			});
		}),
	);
