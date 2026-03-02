import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
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
			Stream.asyncEffect((emit) =>
				Effect.sync(() => {
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
						void emit.single({
							data: String(event.data),
							id: Option.fromNullable(event.lastEventId),
							event: Option.fromNullable(event.type),
							retry: Option.none(), // Native EventSource doesn't expose this directly
						});
					};
					const handleError = (errorEvent: Event) => {
						// Emit an error, which will terminate the stream
						void emit.fail(
							new EventSourceError({
								reason: "NetworkError",
								originalError: errorEvent,
							}),
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

					return Stream.finalizer(Effect.sync(() => es.close()));
				}),
			),
	}),
);
