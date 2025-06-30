import { Data } from "effect";

/**
 * The base class for all errors thrown by the sync engine.
 * Using a tagged error allows for exhaustive matching on error types.
 */
export class SyncError extends Data.TaggedError("SyncError")<{
	readonly reason: unknown;
}> {}

export class StorageError extends Data.TaggedError("StorageError")<{
	readonly reason: unknown;
}> {}

export class TransportError extends Data.TaggedError("TransportError")<{
	readonly reason: unknown;
	readonly isRetryable: boolean;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
	readonly reason: unknown;
}> {}

export class ApplicatorError extends Data.TaggedError("ApplicatorError")<{
	readonly reason: unknown;
}> {}
