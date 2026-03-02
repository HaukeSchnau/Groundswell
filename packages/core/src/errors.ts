import { Data } from "effect";

export class StorageError extends Data.TaggedError("StorageError")<{
	readonly cause: unknown;
}> {
	override get message() {
		return `StorageError: ${this.cause}`;
	}
}

export class TransportError extends Data.TaggedError("TransportError")<{
	readonly cause: unknown;
	readonly isRetryable: boolean;
}> {
	override get message() {
		return `${this.isRetryable ? "Retryable " : ""} TransportError: ${this.cause}`;
	}
}

export class ValidationError extends Data.TaggedError("ValidationError")<{
	readonly cause: unknown;
	readonly reason: "DUPLICATE" | "NOT_FOUND" | "NOT_ALLOWED" | "INVALID" | "UNKNOWN";
}> {
	override get message() {
		return `ValidationError: ${this.reason}. Cause: ${this.cause}`;
	}
}

export class ApplicatorError extends Data.TaggedError("ApplicatorError")<{
	readonly cause: unknown;
}> {
	override get message() {
		return `ApplicatorError: ${this.cause}`;
	}
}

export class DuplicateEventError extends Data.TaggedError("DuplicateEventError")<{
	readonly eventId: string;
}> {
	override get message() {
		return `DuplicateEventError: ${this.eventId}`;
	}
}
