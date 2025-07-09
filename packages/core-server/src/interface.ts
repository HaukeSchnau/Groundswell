import type { ApplicatorError, DuplicateEventError } from "@groundswell/core";
import type { EventMeta } from "@groundswell/zod-helpers";
import type { Effect, Stream } from "effect";
import type {
	BroadcastError,
	CanonicalStorageError,
	ServerValidationError,
	UserNotFoundError,
} from "./errors";

// --- Service Interfaces (Tags) ---

export interface ServerApplicator<TEvent> {
	readonly verify: (
		event: TEvent,
		meta: EventMeta,
	) => Effect.Effect<void, ServerValidationError>;
	readonly apply: (
		event: TEvent,
		meta: EventMeta,
	) => Effect.Effect<void, ApplicatorError>;
	readonly getEventTopics: (event: TEvent) => Effect.Effect<string[], never>;
	readonly getUserTopics: (
		userId: string,
	) => Effect.Effect<string[], UserNotFoundError>;
}

export interface CanonicalStorage<TEvent> {
	readonly isEventUnique: (
		eventId: string,
	) => Effect.Effect<boolean, CanonicalStorageError>;
	readonly saveEvent: (
		event: TEvent,
		meta: EventMeta & { topics: string[] },
	) => Effect.Effect<void, CanonicalStorageError>;
	readonly getMissingEventsForUser: (
		userId: string,
		topics: string[],
	) => Effect.Effect<TEvent[], CanonicalStorageError>;
	readonly getEventsSentToUser: (
		userId: string,
	) => Effect.Effect<TEvent[], CanonicalStorageError>;
	readonly markEventAsSentToUser: (
		eventId: string,
		userId: string,
	) => Effect.Effect<void, CanonicalStorageError>;
}

export interface Broadcast<TEvent> {
	readonly publishToTopics: (
		topics: string[],
		event: TEvent,
	) => Effect.Effect<void, BroadcastError>;
	readonly publishToUser: (
		userId: string,
		events: TEvent[],
	) => Effect.Effect<void, BroadcastError>;
	readonly subscribe: (userId: string) => Stream.Stream<TEvent, BroadcastError>;
}

export interface IngestEngine<TEvent> {
	readonly ingest: (
		event: TEvent,
		meta: EventMeta,
	) => Effect.Effect<
		void,
		| ServerValidationError
		| CanonicalStorageError
		| BroadcastError
		| ApplicatorError
		| DuplicateEventError
		| UserNotFoundError
	>;
}
