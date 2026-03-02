import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { BaseEventSchema, createDomainEvent, createEventUnion } from "./index.js";

describe("zod helpers", () => {
	it("parses a valid domain event and rejects invalid shape", () => {
		const noteCreated = createDomainEvent("note.created", {
			noteId: z.string().uuid(),
			content: z.string().min(1),
		});

		const valid = noteCreated.parse({
			id: crypto.randomUUID(),
			timestamp: new Date(),
			type: "note.created",
			data: {
				noteId: crypto.randomUUID(),
				content: "hello",
			},
		});

		expect(valid.type).toBe("note.created");
		expect(() =>
			noteCreated.parse({
				id: crypto.randomUUID(),
				timestamp: new Date(),
				type: "note.created",
				data: {
					noteId: "not-a-uuid",
					content: "",
				},
			}),
		).toThrow(/Invalid|uuid|string/);
	});

	it("builds a discriminated union and narrows on type", () => {
		const noteCreated = createDomainEvent("note.created", {
			noteId: z.string().uuid(),
		});
		const noteArchived = createDomainEvent("note.archived", {
			noteId: z.string().uuid(),
			reason: z.string().optional(),
		});

		const domainEvent = createEventUnion([noteCreated, noteArchived]);

		const parsed = domainEvent.parse({
			id: crypto.randomUUID(),
			timestamp: new Date(),
			type: "note.archived",
			data: {
				noteId: crypto.randomUUID(),
				reason: "user",
			},
		});

		expect(parsed).toMatchObject({
			type: "note.archived",
			data: { reason: "user" },
		});
	});

	it("exposes correct inferred union types", () => {
		const noteCreated = createDomainEvent("note.created", {
			noteId: z.string(),
		});
		const noteArchived = createDomainEvent("note.archived", {
			noteId: z.string(),
		});

		const domainEvent = createEventUnion([noteCreated, noteArchived]);
		type DomainEvent = z.infer<typeof domainEvent>;

		expectTypeOf<DomainEvent["type"]>().toEqualTypeOf<"note.created" | "note.archived">();
	});

	it("validates base schema id and timestamp", () => {
		const result = BaseEventSchema.safeParse({
			id: crypto.randomUUID(),
			timestamp: new Date(),
		});
		expect(result.success).toBe(true);

		expect(
			BaseEventSchema.safeParse({
				id: "bad",
				timestamp: "not-a-date",
			}).success,
		).toBeFalsy();
	});
});
