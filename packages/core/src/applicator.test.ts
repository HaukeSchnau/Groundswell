import type { EventMeta } from "@groundswell/zod-helpers";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	applicatorFactory,
	applicatorTreeFactory,
	serverApplicatorFactory,
	serverApplicatorTreeFactory,
} from "./applicator.js";

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

	it("uses tree applicators and warns for missing handlers", async () => {
		const apply = vi.fn(() => Effect.void);
		const verify = vi.fn(() => Effect.void);
		const warn = vi.spyOn(console, "warn").mockReturnValue(undefined);

		const treeApplicator = applicatorTreeFactory<DomainEvent, never, never>({
			note: {
				created: { apply, verify },
			},
		});

		await Effect.runPromise(treeApplicator.apply(createdEvent, meta));
		await Effect.runPromise(treeApplicator.verify(createdEvent, meta));
		await Effect.runPromise(
			treeApplicator.apply(
				{
					id: crypto.randomUUID(),
					timestamp: new Date(),
					type: "todo.done",
					data: { id: "x" },
				},
				meta,
			),
		);

		expect(apply).toHaveBeenCalledTimes(1);
		expect(verify).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith("no applicator found for todo.done");
		warn.mockRestore();
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

		const warn = vi.spyOn(console, "warn").mockReturnValue(undefined);
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

		const missingTopics = await Effect.runPromise(
			tree.getEventTopics({
				id: crypto.randomUUID(),
				timestamp: new Date(),
				type: "todo.done",
				data: { id: "x" },
			}),
		);
		expect(missingTopics).toStrictEqual([]);
		expect(warn).toHaveBeenCalledWith("no applicator found for todo.done");
		warn.mockRestore();
	});
});
