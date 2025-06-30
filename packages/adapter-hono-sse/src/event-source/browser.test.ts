import { describe, expect, it } from "@effect/vitest";
import { pipe } from "effect";
import * as Chunk from "effect/Chunk";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
// Import the service interface and the Node.js implementation
import { EventSourceError, EventSourceService } from ".";
import { BrowserEventSourceServiceLive } from "./browser";

// URL for the sse.dev/test server
const TEST_SSE_URL = "https://sse.dev/test";

describe("NodeEventSourceService", () => {
	it.effect(
		"should connect to sse.dev/test and receive diverse messages",
		() =>
			Effect.gen(function* () {
				const eventSource = yield* EventSourceService;

				console.log(`[Test] Connecting to ${TEST_SSE_URL}...`);

				const collectedMessages = yield* eventSource.connect(TEST_SSE_URL).pipe(
					Stream.take(5), // Take the first 10 messages (sse.dev/test sends a mix)
					Stream.runCollect, // Collect them into an Effect.Chunk
					Effect.timeoutFail({
						duration: Duration.seconds(10), // Allow up to 15 seconds for connection and messages
						onTimeout: () =>
							new EventSourceError({
								reason: "NetworkError",
								originalError: new Error(
									"Connection to sse.dev/test timed out or did not receive enough messages.",
								),
							}),
					}),
					Effect.tap((chunk) =>
						Effect.log(
							`[Test] Received ${Chunk.size(chunk)} messages: ${JSON.stringify(
								chunk,
							)}`,
						),
					),
					Effect.tapError((error) =>
						Effect.logError(`[Test] Stream failed with error:`, error),
					),
				);

				// --- Assertions ---
				expect(Chunk.size(collectedMessages)).toBeGreaterThanOrEqual(5); // Expect a reasonable number of messages
				expect(
					Chunk.every(collectedMessages, (msg) => typeof msg.data === "string"),
				).toBe(true);

				// Check for messages known to be sent by sse.dev/test
				const firstMessage = Chunk.head(collectedMessages).pipe(
					Option.getOrNull,
				);
				expect(firstMessage?.data).toContain(
					`{"testing":true,"sse_dev":"is great","msg":"It works!",`,
				);
			}).pipe(
				Effect.provide(BrowserEventSourceServiceLive), // Provide the Node.js implementation
			),
		15000,
	);

	it.effect("should fail gracefully when connecting to an invalid URL", () =>
		Effect.gen(function* () {
			const eventSource = yield* EventSourceService;
			const invalidUrl = "http://localhost:9999/non-existent-events"; // A URL that should consistently fail

			console.log(`[Test] Attempting connection to invalid URL: ${invalidUrl}`);

			// Attempt to run the stream, expecting it to fail
			const outcome = yield* pipe(
				eventSource.connect(invalidUrl),
				Stream.runDrain, // Run until the stream completes or errors
				Effect.flip,
			);

			// --- Assertions for error handling ---
			expect(outcome._tag).toBe("EventSourceError"); // Expect the Effect to result in a failure
			if (outcome._tag === "EventSourceError") {
				expect(outcome.reason).toBe("NetworkError");
			}
		}).pipe(
			Effect.provide(BrowserEventSourceServiceLive), // Provide the Node.js implementation
		),
	);
});
