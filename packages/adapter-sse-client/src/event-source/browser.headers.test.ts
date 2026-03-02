import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { vi } from "vitest";
import { BrowserEventSourceServiceLive } from "./browser.js";
import { EventSourceService } from "./index.js";

const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

vi.stubGlobal("fetch", fetchMock);

vi.mock("eventsource", () => {
	class MockEventSource {
		onopen?: () => void;
		onmessage?: (event: { data: string; lastEventId?: string; type?: string }) => void;
		onerror?: (error: unknown) => void;

		constructor(
			url: string,
			init?: {
				fetch?: (url: string, init?: RequestInit) => Promise<Response>;
			},
		) {
			void init?.fetch?.(url, {
				headers: {
					"X-Existing": "1",
				},
			});
			queueMicrotask(() => {
				this.onmessage?.({
					data: '{"ok":true}',
					lastEventId: "evt-1",
					type: "message",
				});
			});
		}

		close() {}
	}

	return { EventSource: MockEventSource };
});

describe("BrowserEventSourceServiceLive", () => {
	it.effect("merges headers from the callback into the EventSource fetch", () =>
		Effect.gen(function* () {
			fetchMock.mockClear();

			const service = yield* EventSourceService;
			const messages = yield* service
				.connect("https://example.com/events", {
					headers: () => ({
						Authorization: "Bearer token",
					}),
				})
				.pipe(Stream.take(1), Stream.runCollect);

			expect(messages[0]).toEqual({
				data: '{"ok":true}',
				id: Option.some("evt-1"),
				event: Option.some("message"),
				retry: Option.none(),
			});
			expect(fetchMock).toHaveBeenCalledWith(
				"https://example.com/events",
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: "Bearer token",
						"X-Existing": "1",
					}),
				}),
			);
		}).pipe(Effect.provide(BrowserEventSourceServiceLive)),
	);
});
