import { createDomainEvent, createEventUnion } from "@groundswell/zod-helpers";
import { z } from "zod";

export const noteCreated = createDomainEvent(
	"note.created",
	z.object({
		id: z.string().uuid(), // Note: We pre-generate the ID on the client
		content: z.string().min(1),
	}),
);

export const noteArchived = createDomainEvent(
	"note.archived",
	z.object({
		noteId: z.string().uuid(),
	}),
);

export const todoCreated = createDomainEvent(
	"todo.created",
	z.object({
		id: z.string().uuid(),
		content: z.string().min(1),
	}),
);

export const DomainEvent = createEventUnion([noteCreated, noteArchived, todoCreated]);
export type DomainEvent = z.infer<typeof DomainEvent>;
