import type { Broadcast, IngestEngine } from "@groundswell/core-server";
import { Effect, Stream } from "effect";
import superjson from "superjson";
import type z from "zod";

interface HonoServerConfig<TEvent> {
	ingestEngine: IngestEngine<TEvent>;
	broadcast: Broadcast<TEvent>;
	/** A function to extract the user ID from the request context. */
	getUserId: (c: Request) => Promise<string | null>;
	eventSchema: z.Schema<TEvent>;
}

const sseMessage = (data: string) => `data: ${data}\n\n`;

export const syncServer = <TEvent>(config: HonoServerConfig<TEvent>) => ({
	async POST(request: Request) {
		const body = await request.text();
		const event = superjson.parse(body);
		const parsedEvent = config.eventSchema.safeParse(event);
		if (!parsedEvent.success) {
			return new Response("Invalid event", { status: 400 });
		}

		const initiatorId = await config.getUserId(request);
		if (!initiatorId) {
			return new Response("Unauthorized", { status: 401 });
		}

		const result = await Effect.runPromiseExit(
			config.ingestEngine.ingest(parsedEvent.data, { initiatorId }),
		);

		if (result._tag === "Failure") {
			if (result.cause._tag === "Fail") {
				if (result.cause.error._tag === "DuplicateEventError") {
					return new Response("Duplicate event", { status: 409 });
				}
				if (result.cause.error._tag === "ValidationError") {
					return new Response("Invalid event", { status: 400 });
				}
				if (result.cause.error._tag === "UserNotFoundError") {
					return new Response("Unauthorized", { status: 403 });
				}
			}
			console.error(result);
			return new Response("Failed to ingest event", { status: 500 });
		}

		return new Response("Event ingested", { status: 200 });
	},

	async GET(request: Request) {
		const userId = await config.getUserId(request);
		if (!userId) {
			return new Response("Unauthorized", { status: 401 });
		}

		return new Response(
			new ReadableStream({
				async start(controller) {
					const eventStream = config.broadcast.subscribe(userId).pipe(
						Stream.runForEach((event) => {
							controller.enqueue(sseMessage(superjson.stringify(event)));
							return Effect.void;
						}),
					);

					await Effect.runPromise(eventStream);
					controller.close();
				},
			}),
			{
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				},
			},
		);
	},
});
