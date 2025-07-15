import { z } from "zod";
import { createDomainEvent, createEventUnion } from "./index.js";

// Define individual event schemas
export const noteCreatedEvent = createDomainEvent("note.created", {
	title: z.string().min(1),
	content: z.string(),
});

export const noteArchivedEvent = createDomainEvent("note.archived", {
	noteId: z.string().uuid(),
	reason: z.string().optional(),
});

// Combine them into a single union type using the new helper
export const DomainEvent = createEventUnion([
	noteCreatedEvent,
	noteArchivedEvent,
]);

// Infer the TypeScript types directly from the schemas.
export type NoteCreatedEvent = z.infer<typeof noteCreatedEvent>;
export type NoteArchivedEvent = z.infer<typeof noteArchivedEvent>;
export type DomainEvent = z.infer<typeof DomainEvent>; // This is the comprehensive type
