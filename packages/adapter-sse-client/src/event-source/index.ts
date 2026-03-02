import { Data, ServiceMap, type Option, type Stream } from "effect";

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
		const cause =
			this.originalError === undefined
				? ""
				: this.originalError instanceof Error
					? ` Cause: ${this.originalError.message}`
					: ` Cause: ${JSON.stringify(this.originalError)}`;
		return `EventSourceError: ${this.reason}.${cause}`;
	}
}

/**
 * Effect Context Tag for the EventSourceService.
 * This is used for dependency injection.
 */
export class EventSourceService extends ServiceMap.Service<
	EventSourceService,
	{
		readonly connect: (
			url: string,
			options?: {
				headers: () => Record<string, string>;
			}, // Standard EventSourceInit options
		) => Stream.Stream<EventSourceMessage, EventSourceError>;
	}
>()("EventSourceService") {}
