import { Context, Data, type Option, type Stream } from "effect";

/**
 * Represents a single message received from an EventSource.
 */
export type EventSourceMessage = {
	readonly data: string;
	readonly id: Option.Option<string>;
	readonly event: Option.Option<string>;
	readonly retry: Option.Option<number>;
};

/**
 * Custom error type for EventSource operations.
 */
export class EventSourceError extends Data.TaggedError("EventSourceError")<{
	reason: "NetworkError" | "ParsingError" | "UnknownError";
	originalError?: unknown;
}> {
	override get message() {
		switch (this.reason) {
		}
		return `EventSourceError: ${this.reason}. Cause: ${this.originalError}`;
	}
}

/**
 * Effect Context Tag for the EventSourceService.
 * This is used for dependency injection.
 */
export class EventSourceService extends Context.Tag("EventSourceService")<
	EventSourceService,
	{
		readonly connect: (
			url: string,
			options?: {
				headers: () => Record<string, string>;
			}, // Standard EventSourceInit options
		) => Stream.Stream<EventSourceMessage, EventSourceError>;
	}
>() {}
