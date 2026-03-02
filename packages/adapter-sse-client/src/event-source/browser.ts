import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { EventSource } from "eventsource";
import { EventSourceError, EventSourceService } from "./index.js";

/**
 * Live Layer for EventSourceService using the browser's native EventSource API.
 */
export const BrowserEventSourceServiceLive = Layer.succeed(
	EventSourceService,
	EventSourceService.of({
		connect: (url, options) =>
			Stream.callback((queue) =>
				Effect.gen(function* () {
					const scope = yield* Scope.Scope;
					const es = new EventSource(url, {
						fetch: (requestUrl, init) => {
							return fetch(requestUrl, {
								...init,
								headers: {
									...init.headers,
									...options?.headers(),
								},
							});
						},
					});

					const handleMessage = (event: MessageEvent) => {
						Queue.offerUnsafe(queue, {
							data: String(event.data),
							id: Option.fromNullishOr(event.lastEventId),
							event: Option.fromNullishOr(event.type),
							retry: Option.none(), // Native EventSource doesn't expose this directly
						});
					};
					const handleError = (errorEvent: Event) => {
						// Emit an error, which will terminate the stream
						Queue.failCauseUnsafe(
							queue,
							Cause.fail(
								new EventSourceError({
									reason: "NetworkError",
									originalError: errorEvent,
								}),
							),
						);
					};
					const legacyEventSource = es as {
						onmessage?: ((event: MessageEvent) => void) | null;
						onerror?: ((event: Event) => void) | null;
					};

					if (typeof es.addEventListener === "function") {
						es.addEventListener("message", handleMessage);
						es.addEventListener("error", handleError);
					} else {
						legacyEventSource.onmessage = handleMessage;
						legacyEventSource.onerror = handleError;
					}

					yield* Scope.addFinalizer(
						scope,
						Effect.sync(() => es.close()),
					);
				}),
			),
	}),
);
