import type { Broadcast, IngestEngine } from "@groundswell/core-server";
import { Cause, Effect, Option, Stream } from "effect";
import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import superjson from "superjson";
import type { z } from "zod";

interface HonoServerConfig<TEvent> {
	ingestEngine: IngestEngine<TEvent>;
	broadcast: Broadcast<TEvent>;
	/** A function to extract the user ID from the request context. */
	getUserId: (c: Context) => Promise<string | null>;
	eventSchema: z.Schema<TEvent>;
}

export const attachSyncServer = <TEvent>(hono: Hono, config: HonoServerConfig<TEvent>) => {
	hono.post("/events", async (c) => {
		const body = await c.req.text();
		const event = superjson.parse(body);
		const parsedEvent = config.eventSchema.safeParse(event);
		if (!parsedEvent.success) {
			return c.json({ error: "Invalid event" }, 400);
		}
		const initiatorId = await config.getUserId(c);
		if (!initiatorId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const result = await Effect.runPromiseExit(
			config.ingestEngine.ingest(parsedEvent.data, { initiatorId }),
		);

		if (result._tag === "Failure") {
			const failure = Cause.findErrorOption(result.cause);
			if (Option.isSome(failure)) {
				const error = failure.value;
				if (error._tag === "DuplicateEventError") {
					return c.json({ error: "Duplicate event" }, 409);
				}
				if (error._tag === "ValidationError") {
					return c.json({ error: "Invalid event" }, 400);
				}
			}
			return c.json({ error: "Failed to ingest event" }, 500);
		}
		return c.json({ success: true }, 200);
	});

	hono.get("/events", async (c) => {
		const userId = await config.getUserId(c);
		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		return streamSSE(c, async (stream) => {
			const rawOffset = c.req.query("offset");
			let offset = rawOffset != null ? Number(rawOffset) : undefined;
			if (offset !== undefined && Number.isNaN(offset)) {
				offset = 0;
			}
			const eventStream = config.broadcast.subscribe(userId, { offset }).pipe(
				Stream.runForEach((event) => {
					void stream.writeSSE({
						data: superjson.stringify(event),
					});
					return Effect.void;
				}),
			);

			await Effect.runPromise(eventStream);
		});
	});
};
