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
				Effect.gen(function* () {
					const es = new EventSource(url, {
						fetch: (url, init) => {
							return fetch(url, {
								...init,
								headers: {
									...init.headers,
									...options?.headers,
								},
							});
						},
					});

					es.onopen = () => {
						// Connection opened, no data to emit for this event
					};

					es.onmessage = (event) => {
						emit.single({
							data: event.data,
							id: Option.fromNullable(event.lastEventId),
							event: Option.fromNullable(event.type),
							retry: Option.none(), // Native EventSource doesn't expose this directly
						});
					};

					es.onerror = (errorEvent) => {
						// Emit an error, which will terminate the stream
						emit.fail(
							new EventSourceError({
								reason: "NetworkError",
								originalError: errorEvent,
							}),
						);
					};

					return Stream.finalizer(Effect.sync(() => es.close()));
				}),
			),
	}),
);
