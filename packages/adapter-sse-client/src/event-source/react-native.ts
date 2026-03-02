import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import EventSource from "react-native-sse";
import { EventSourceError, EventSourceService } from "./index.js";

/**
 * Live Layer for EventSourceService using the React Native EventSource API.
 */
export const ReactNativeEventSourceServiceLive = Layer.succeed(
	EventSourceService,
	EventSourceService.of({
		connect: (url, options) =>
			Stream.callback((queue) =>
				Effect.gen(function* () {
					const scope = yield* Scope.Scope;
					const es = new EventSource(url, {
						headers: options?.headers(),
					});

					es.addEventListener("message", (event) => {
						Queue.offerUnsafe(queue, {
							data: event.data ?? "",
							id: Option.fromNullishOr(event.lastEventId),
							event: Option.fromNullishOr(event.type),
							retry: Option.none(), // Native EventSource doesn't expose this directly
						});
					});

					es.addEventListener("error", (errorEvent) => {
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
					});

					yield* Scope.addFinalizer(
						scope,
						Effect.sync(() => es.close()),
					);
				}),
			),
	}),
);
