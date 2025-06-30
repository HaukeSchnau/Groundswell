import { Data } from "effect";

export class ServerValidationError extends Data.TaggedError(
	"ServerValidationError",
)<{
	readonly reason: unknown;
}> {}
export class CanonicalStorageError extends Data.TaggedError(
	"CanonicalStorageError",
)<{
	readonly reason: unknown;
}> {}
export class BroadcastError extends Data.TaggedError("BroadcastError")<{
	readonly reason: unknown;
}> {}
