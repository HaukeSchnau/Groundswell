import type { EventMeta } from "@groundswell/zod-helpers";
import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	applicatorFactory,
	applicatorTreeFactory,
	serverApplicatorFactory,
	serverApplicatorTreeFactory,
} from "./applicator.js";
import { ApplicatorError } from "./errors.js";

type DomainEvent =
	| {
			id: string;
			timestamp: Date;
			type: "note.created";
			data: { content: string };
	  }
	| {
			id: string;
			timestamp: Date;
			type: "todo.done";
			data: { id: string };
	  };

const meta: EventMeta = { initiatorId: "user-1" };

const createdEvent: Extract<DomainEvent, { type: "note.created" }> = {
	id: crypto.randomUUID(),
	timestamp: new Date(),
	type: "note.created",
	data: { content: "hello" },
};

const failureError = <A, E>(exit: Exit.Exit<A, E>) => {
	if (Exit.isSuccess(exit)) {
		throw new Error("Expected effect to fail");
	}
	const failure = Cause.findErrorOption(exit.cause);
	if (Option.isNone(failure)) {
		throw new Error("Expected a typed error cause");
	}
	return failure.value;
};

describe("applicator factories", () => {
	it("routes apply/verify by event type", async () => {
		const apply = vi.fn(() => Effect.void);
		const verify = vi.fn(() => Effect.void);
		const applicator = applicatorFactory<DomainEvent, never, never>({
			"note.created": { apply, verify },
			"todo.done": {
				apply: () => Effect.void,
				verify: () => Effect.void,
			},
		});

		await Effect.runPromise(applicator.apply(createdEvent, meta));
		await Effect.runPromise(applicator.verify(createdEvent, meta));

		expect(apply).toHaveBeenCalledWith(createdEvent, meta);
		expect(verify).toHaveBeenCalledWith(createdEvent, meta);
	});

	it("uses tree applicators and fails for missing handlers", async () => {
		const apply = vi.fn(() => Effect.void);
		const verify = vi.fn(() => Effect.void);

		const treeApplicator = applicatorTreeFactory<DomainEvent, never, never>({
			note: {
				created: { apply, verify },
			},
		});

		const missingEvent: Extract<DomainEvent, { type: "todo.done" }> = {
			id: crypto.randomUUID(),
			timestamp: new Date(),
			type: "todo.done",
			data: { id: "x" },
		};

		await Effect.runPromise(treeApplicator.apply(createdEvent, meta) as Effect.Effect<void>);
		await Effect.runPromise(treeApplicator.verify(createdEvent, meta) as Effect.Effect<void>);

		const applyResult = await Effect.runPromiseExit(
			treeApplicator.apply(missingEvent, meta) as Effect.Effect<void, ApplicatorError>,
		);
		const verifyResult = await Effect.runPromiseExit(
			treeApplicator.verify(missingEvent, meta) as Effect.Effect<void, ApplicatorError>,
		);
		const applyErr = failureError(applyResult);
		const verifyErr = failureError(verifyResult);

		expect(apply).toHaveBeenCalledTimes(1);
		expect(verify).toHaveBeenCalledTimes(1);
		expect(applyResult._tag).toBe("Failure");
		expect(verifyResult._tag).toBe("Failure");
		expect(applyErr).toBeInstanceOf(ApplicatorError);
		expect(verifyErr).toBeInstanceOf(ApplicatorError);
		expect(applyErr.cause).toBe("no applicator found for todo.done");
		expect(verifyErr.cause).toBe("no applicator found for todo.done");
	});

	it("exposes server getEventTopics for map and tree forms", async () => {
		const getTopics = vi.fn(() => Effect.succeed(["topic-a"]));
		const serverApplicator = serverApplicatorFactory<DomainEvent, never, never>({
			"note.created": {
				apply: () => Effect.void,
				verify: () => Effect.void,
				getEventTopics: getTopics,
			},
			"todo.done": {
				apply: () => Effect.void,
				verify: () => Effect.void,
				getEventTopics: () => Effect.succeed(["topic-b"]),
			},
		});

		const topics = await Effect.runPromise(serverApplicator.getEventTopics(createdEvent));
		expect(topics).toStrictEqual(["topic-a"]);
		expect(getTopics).toHaveBeenCalledWith(createdEvent);

		const tree = serverApplicatorTreeFactory<DomainEvent, never, never>({
			note: {
				created: {
					apply: () => Effect.void,
					verify: () => Effect.void,
					getEventTopics: () => Effect.succeed(["topic-tree"]),
				},
			},
		});

		const treeTopics = await Effect.runPromise(tree.getEventTopics(createdEvent));
		expect(treeTopics).toStrictEqual(["topic-tree"]);

		const missingTopicsResult = await Effect.runPromiseExit(
			tree.getEventTopics({
				id: crypto.randomUUID(),
				timestamp: new Date(),
				type: "todo.done",
				data: { id: "x" },
			}) as Effect.Effect<string[], ApplicatorError>,
		);
		const missingTopicsErr = failureError(missingTopicsResult);
		expect(missingTopicsResult._tag).toBe("Failure");
		expect(missingTopicsErr).toBeInstanceOf(ApplicatorError);
		expect(missingTopicsErr.cause).toBe("no applicator found for todo.done");
	});
});
