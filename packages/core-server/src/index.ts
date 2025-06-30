import { Context, type Effect, type Stream } from "effect";
import type {
	BroadcastError,
	CanonicalStorageError,
	ServerValidationError,
} from "./errors";

// --- Service Interfaces (Tags) ---

export interface ServerApplicator<TEvent> {
	readonly verify: (
		event: TEvent,
		meta: { initiatorId: string },
	) => Effect.Effect<void, ServerValidationError>;
	readonly apply: (event: TEvent) => Effect.Effect<void, never>;
	readonly getTopics: (event: TEvent) => Effect.Effect<string[], never>;
}

export interface CanonicalStorage<TEvent> {
	readonly isEventUnique: (
		eventId: string,
	) => Effect.Effect<boolean, CanonicalStorageError>;
	readonly saveEvent: (
		event: TEvent,
		meta: { initiatorId: string; topics: string[] },
	) => Effect.Effect<void, CanonicalStorageError>;
	/** Executes an Effect within a database transaction. */
	readonly transactionally: <A, E, R>(
		self: Effect.Effect<A, E, R>,
	) => Effect.Effect<A, E | CanonicalStorageError, R>;
}

export interface Broadcast<TEvent> {
	readonly publish: (
		topics: string[],
		event: TEvent,
	) => Effect.Effect<void, BroadcastError>;
	readonly subscribe: (userId: string) => Stream.Stream<TEvent, BroadcastError>;
}

export interface IngestEngine<TEvent> {
	readonly ingest: (
		event: TEvent,
		meta: { initiatorId: string },
	) => Effect.Effect<void, ServerValidationError | CanonicalStorageError | BroadcastError>;
}
