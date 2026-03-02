import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { vi } from "vitest";
import { EventSourceError, EventSourceService } from "./index.js";
import { ReactNativeEventSourceServiceLive } from "./react-native.js";

vi.mock("react-native-sse", () => {
	class MockEventSource {
		private readonly listeners = new Map<string, ((event: unknown) => void)[]>();
		private readonly url: string;

		constructor(url: string) {
			this.url = url;
			queueMicrotask(() => {
				if (this.url.includes("error")) {
					this.emit("error", { message: "network down" });
					return;
				}
				if (this.url.includes("nodata")) {
					this.emit("message", {
						data: undefined,
						lastEventId: undefined,
						type: undefined,
					});
					return;
				}
				this.emit("message", {
					data: '{"ok":true}',
					lastEventId: "evt-1",
					type: "message",
				});
			});
		}

		addEventListener(type: string, handler: (event: unknown) => void) {
			const current = this.listeners.get(type) ?? [];
			this.listeners.set(type, [...current, handler]);
		}

		emit(type: string, event: unknown) {
			for (const handler of this.listeners.get(type) ?? []) {
				handler(event);
			}
		}

		close() {}
	}

	return {
		default: MockEventSource,
	};
});

describe("ReactNativeEventSourceServiceLive", () => {
	it.effect("yields message events", () =>
		Effect.gen(function* () {
			const service = yield* EventSourceService;
			const messages = yield* service
				.connect("https://example.com/events", {
					headers: () => ({ Authorization: "Bearer token" }),
				})
				.pipe(Stream.take(1), Stream.runCollect);

			expect(messages[0]).toEqual({
				data: '{"ok":true}',
				id: Option.some("evt-1"),
				event: Option.some("message"),
				retry: Option.none(),
			});
		}).pipe(Effect.provide(ReactNativeEventSourceServiceLive)),
	);

	it.effect("maps source errors into EventSourceError", () =>
		Effect.gen(function* () {
			const service = yield* EventSourceService;
			const error = yield* Effect.flip(
				service.connect("https://example.com/error").pipe(Stream.runDrain),
			);
			expect(error._tag).toBe("EventSourceError");
			expect(error.reason).toBe("NetworkError");
		}).pipe(Effect.provide(ReactNativeEventSourceServiceLive)),
	);

	it.effect("normalizes empty message fields for react-native events", () =>
		Effect.gen(function* () {
			const service = yield* EventSourceService;
			const messages = yield* service
				.connect("https://example.com/nodata")
				.pipe(Stream.take(1), Stream.runCollect);
			expect(messages[0]?.data).toBe("");
			expect(messages[0]?.id).toEqual(Option.none());
			expect(messages[0]?.event).toEqual(Option.none());
		}).pipe(Effect.provide(ReactNativeEventSourceServiceLive)),
	);

	it("formats EventSourceError messages with causes", () => {
		const error = new EventSourceError({
			reason: "UnknownError",
			originalError: new Error("boom"),
		});
		expect(error.message).toContain("UnknownError");
		expect(error.message).toContain("boom");
	});

	it("formats EventSourceError messages without a cause and with non-Error causes", () => {
		const withoutCause = new EventSourceError({ reason: "ParsingError" });
		expect(withoutCause.message).toBe("EventSourceError: ParsingError.");

		const nonErrorCause = new EventSourceError({
			reason: "UnknownError",
			originalError: { code: "E_FAIL" },
		});
		expect(nonErrorCause.message).toContain('{"code":"E_FAIL"}');
	});
});
