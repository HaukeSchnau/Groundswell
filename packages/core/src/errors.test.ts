import { describe, expect, it } from "vitest";
import {
	ApplicatorError,
	DuplicateEventError,
	StorageError,
	TransportError,
	ValidationError,
} from "./errors.js";

describe("core errors", () => {
	it("formats tagged error messages", () => {
		expect(new StorageError({ cause: "disk" }).message).toContain("StorageError");
		expect(new TransportError({ cause: "net", isRetryable: true }).message).toContain(
			"TransportError",
		);
		expect(new ValidationError({ cause: "bad", reason: "INVALID" }).message).toContain(
			"ValidationError",
		);
		expect(new ApplicatorError({ cause: "boom" }).message).toContain("ApplicatorError");
		expect(new DuplicateEventError({ eventId: "evt-1" }).message).toContain("evt-1");
	});
});
