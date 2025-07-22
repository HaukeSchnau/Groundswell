import { Data } from "effect";

export class CanonicalStorageError extends Data.TaggedError(
	"CanonicalStorageError",
)<{
	readonly cause: unknown;
}> {}
export class BroadcastError extends Data.TaggedError("BroadcastError")<{
	readonly cause: unknown;
}> {}
export class UserNotFoundError extends Data.TaggedError("UserNotFoundError")<{
	readonly userId: string;
}> {}
