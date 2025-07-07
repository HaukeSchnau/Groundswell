import type { Effect, PubSub, Stream } from "effect";
import type {
	ApplicatorError,
	DuplicateEventError,
	StorageError,
	TransportError,
	ValidationError,
} from "./errors";

// --- Data Structures ---

export type LocalEventStatus = {
	local: "pending" | "success" | "error";
	remote: "pending" | "success" | "error";
};

export type LocalEvent<TEvent> = {
	event: TEvent;
	status: LocalEventStatus;
};

// --- Service Interfaces (Tags) ---

/**
 * The Applicator service is responsible for the business logic of
 * verifying and applying an event to the local state.
 *
 * Provided by: The library consumer.
 */
export interface Applicator<TEvent> {
	readonly verify: (event: TEvent) => Effect.Effect<void, ValidationError>;
	readonly apply: (event: TEvent) => Effect.Effect<void, ApplicatorError>;
}

/**
 * The Storage service defines the contract for persisting events and their
 * sync status to a local database.
 *
 * Provided by: An adapter package (e.g., @stu-sync/adapter-drizzle-sqlite).
 */
export interface Storage<TEvent> {
	readonly getPendingEvents: Stream.Stream<LocalEvent<TEvent>, StorageError>;
	readonly saveEvent: (
		event: TEvent,
		status: LocalEventStatus,
	) => Effect.Effect<void, StorageError | DuplicateEventError>;
	readonly updateEventStatus: (
		eventId: string,
		status: Partial<LocalEventStatus>,
	) => Effect.Effect<void, StorageError>;
}

/**
 * The Transport service defines the contract for network communication:
 * publishing local events and listening for remote events.
 *
 * Provided by: An adapter package (e.g., @groundswell/adapter-sse-client).
 */
export interface Transport<TEvent extends { id: string }> {
	readonly publish: (
		event: TEvent,
	) => Effect.Effect<void, TransportError | DuplicateEventError>;
	readonly listen: Effect.Effect<Stream.Stream<TEvent, TransportError>>;
}

/**
 * The SyncEngine service, the core orchestrator of the library.
 * It requires all other services to function.
 *
 * Provided by: This package (@stu-sync/core).
 */
export interface SyncEngine<TEvent> {
	readonly ingest: (
		event: Omit<TEvent, "id" | "timestamp">,
	) => Effect.Effect<void, ValidationError | ApplicatorError | StorageError>;
	readonly events: PubSub.PubSub<LocalEvent<TEvent>>; // A stream of all events and their status
	readonly status: PubSub.PubSub<{ queueSize: number }>;
}
