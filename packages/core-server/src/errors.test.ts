import { describe, expect, it } from "vitest";
import { BroadcastError, CanonicalStorageError, UserNotFoundError } from "./errors.js";

describe("core-server errors", () => {
	it("formats tagged error messages", () => {
		expect(new CanonicalStorageError({ cause: "db" }).message).toContain("CanonicalStorageError");
		expect(new BroadcastError({ cause: "pubsub" }).message).toContain("BroadcastError");
		expect(new UserNotFoundError({ userId: "user-1" }).message).toContain("user-1");
	});
});
