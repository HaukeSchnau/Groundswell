import type { Transport } from "@groundswell/core";
import { DuplicateEventError, TransportError } from "@groundswell/core";
import { type Context, Effect, Layer, Stream } from "effect";
import superjson from "superjson";
import type z from "zod";
import { EventSourceService } from "./event-source/index.js";

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
export const createSseTransportLayer = <TEvent extends { id: string }, TagId>(
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
						catch: (cause) => new TransportError({ cause, isRetryable: true }),
					}).pipe(
						Effect.flatMap((response) =>
							Effect.gen(function* () {
								if (response.ok) {
									return yield* Effect.succeed(undefined);
								}

								if (response.status === 409) {
									return yield* Effect.fail(
										new DuplicateEventError({
											eventId: event.id,
										}),
									);
								}

								// 4xx errors are client errors and not retryable.
								// 5xx errors are server errors and are retryable.
								const isRetryable = response.status >= 500;
								return yield* Effect.fail(
									new TransportError({
										cause: `Request failed with status ${response.status}`,
										isRetryable,
									}),
								);
							}),
						),
					),

				listen: Effect.gen(function* () {
					const stream = eventSourceService.connect(
						`${config.baseUrl}/events`,
						{
							headers: config.headers ?? {},
						},
					);

					return stream.pipe(
						Stream.mapEffect((message) =>
							Effect.try({
								try: () => {
									const parsedData = superjson.parse(message.data);
									return config.eventSchema.parse(parsedData);
								},
								catch: (cause) =>
									new TransportError({ cause, isRetryable: false }),
							}),
						),
						Stream.catchTag("EventSourceError", (error) => {
							if (error.reason === "NetworkError") {
								return Stream.fail(
									new TransportError({ cause: error, isRetryable: true }),
								);
							}
							return Stream.fail(
								new TransportError({ cause: error, isRetryable: false }),
							);
						}),
					);
				}),
			});
		}),
	);
