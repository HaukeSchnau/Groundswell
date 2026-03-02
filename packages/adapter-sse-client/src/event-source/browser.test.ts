import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { once } from "node:events";
import { createServer } from "node:http";
import { BrowserEventSourceServiceLive } from "./browser.js";
import { EventSourceError, EventSourceService } from "./index.js";

const withSseTestServer = async <T>(run: (baseUrl: string) => Promise<T>): Promise<T> => {
	const server = createServer((request, response) => {
		if (request.method === "POST" && request.url === "/events") {
			response.writeHead(200, { "Content-Type": "application/json" });
			response.end(JSON.stringify({ ok: true }));
			return;
		}

		if (request.method === "GET" && request.url?.startsWith("/events")) {
			response.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			});
			response.write('data: {"msg":"one"}\n\n');
			response.write('data: {"msg":"two"}\n\n');
			response.write('data: {"msg":"three"}\n\n');
			response.end();
			return;
		}

		response.writeHead(404);
		response.end();
	});

	server.listen(0, "127.0.0.1");
	await once(server, "listening");

	const address = server.address();
	if (address == null || typeof address === "string") {
		server.close();
		throw new Error("Failed to determine SSE test server address");
	}

	try {
		return await run(`http://127.0.0.1:${address.port}`);
	} finally {
		server.close();
		await once(server, "close");
	}
};

describe("BrowserEventSourceServiceLive", () => {
	it.effect("connects to a local SSE endpoint and receives messages", () =>
		Effect.promise(() =>
			withSseTestServer(async (baseUrl) => {
				const program = Effect.gen(function* () {
					const eventSource = yield* EventSourceService;

					const collectedMessages = yield* eventSource.connect(`${baseUrl}/events`).pipe(
						Stream.take(3),
						Stream.runCollect,
						Effect.timeoutOrElse({
							duration: Duration.seconds(5),
							onTimeout: () =>
								Effect.fail(
									new EventSourceError({
										reason: "NetworkError",
										originalError: new Error("Timed out waiting for local SSE messages"),
									}),
								),
						}),
					);

					expect(collectedMessages).toHaveLength(3);
					expect(collectedMessages.every((msg) => typeof msg.data === "string")).toBe(true);
					const [
						firstMessage = {
							id: Option.none(),
							data: "",
							event: Option.none(),
							retry: Option.none(),
						},
					] = collectedMessages;
					expect(Option.getOrNull(firstMessage.id)).toBe("");
					expect(firstMessage.data).toContain('"msg":"one"');
				});

				await Effect.runPromise(program.pipe(Effect.provide(BrowserEventSourceServiceLive)));
			}),
		),
	);

	it.effect("fails gracefully when connecting to an invalid URL", () =>
		Effect.gen(function* () {
			const eventSource = yield* EventSourceService;
			const invalidUrl = "http://127.0.0.1:65535/non-existent-events";

			const outcome = yield* eventSource.connect(invalidUrl).pipe(Stream.runDrain, Effect.flip);

			expect(outcome._tag).toBe("EventSourceError");
			expect(outcome.reason).toBe("NetworkError");
		}).pipe(Effect.provide(BrowserEventSourceServiceLive)),
	);
});
