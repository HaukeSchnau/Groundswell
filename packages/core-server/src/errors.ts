import { Data } from "effect";

export class CanonicalStorageError extends Data.TaggedError("CanonicalStorageError")<{
	readonly cause: unknown;
}> {
	override get message() {
		return `CanonicalStorageError: ${this.cause}`;
	}
}
export class BroadcastError extends Data.TaggedError("BroadcastError")<{
	readonly cause: unknown;
}> {
	override get message() {
		return `BroadcastError: ${this.cause}`;
	}
}
export class UserNotFoundError extends Data.TaggedError("UserNotFoundError")<{
	readonly userId: string;
}> {
	override get message() {
		return `UserNotFoundError: ${this.userId}`;
	}
}
