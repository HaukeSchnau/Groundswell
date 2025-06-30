import type { Transport } from "@groundswell/core";
import { TransportError } from "@groundswell/core/errors";
import { type Context, Effect, Layer, Stream } from "effect";
import superjson from "superjson";
import type z from "zod";
import { EventSourceService } from "./event-source";

// Define the configuration for creating the transport layer.
export interface HonoTransportConfig<TEvent> {
	/** The base URL of the server API. */
	baseUrl: string;
	/** The Zod schema for parsing incoming events. */
	eventSchema: z.Schema<TEvent>;
	/** Optional headers to be sent with every request (e.g., for authorization). */
	headers?: Record<string, string>;
}

/**
 * Creates a Layer that provides a live implementation of the Transport service
 * using HTTP requests for publishing and Server-Sent Events (SSE) for listening.
 *
 * @param config The configuration object.
 * @returns A Layer that provides the Transport service.
 */
export const createHonoTransportLayer = <TEvent, TagId>(
	TransportTag: Context.Tag<TagId, Transport<TEvent>>,
	config: HonoTransportConfig<TEvent>,
) =>
	Layer.effect(
		TransportTag,
		Effect.gen(function* () {
			const eventSourceService = yield* EventSourceService;

			return TransportTag.of({
				publish: (event) =>
					Effect.tryPromise({
						try: () =>
							fetch(`${config.baseUrl}/events`, {
								method: "POST",
								headers: {
									"Content-Type": "application/json",
									...config.headers,
								},
								body: superjson.stringify(event),
							}),
						catch: (reason) =>
							new TransportError({ reason, isRetryable: true }),
					}).pipe(
						Effect.flatMap((response) => {
							if (response.ok) {
								return Effect.succeed(undefined);
							}
							// 4xx errors are client errors and not retryable.
							// 5xx errors are server errors and are retryable.
							const isRetryable = response.status >= 500;
							return Effect.fail(
								new TransportError({
									reason: `Request failed with status ${response.status}`,
									isRetryable,
								}),
							);
						}),
					),

				listen: Effect.gen(function* () {
					const stream = eventSourceService.connect(
						`${config.baseUrl}/events`,
						{
							headers: config.headers ?? {},
						},
					);

					return stream.pipe(
						Stream.map((message) => {
							const parsedData = superjson.parse(message.data);
							const parsedEvent = config.eventSchema.parse(parsedData);
							return parsedEvent;
						}),
						Stream.catchTag("EventSourceError", (error) => {
							if (error.reason === "NetworkError") {
								return Stream.fail(
									new TransportError({ reason: error, isRetryable: true }),
								);
							}
							return Stream.fail(
								new TransportError({ reason: error, isRetryable: false }),
							);
						}),
					);
				}),
			});
		}),
	);
