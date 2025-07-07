import { z } from "zod";

export type UnknownEvent = {
	id: string;
	timestamp: Date;
	type: string;
	data: unknown;
};

/**
 * The foundational schema for any event in the system.
 * It ensures that every event has a unique ID, a timestamp, and a type identifier.
 */
export const BaseEventSchema = z.object({
	/**
	 * A unique identifier for the event instance (e.g., a UUID).
	 */
	id: z.string().uuid(),
	/**
	 * The exact date and time when the event occurred.
	 */
	timestamp: z.date(),
});

/**
 * A type helper to create a strongly-typed domain event schema.
 *
 * @template TName - The literal string type for the event name (e.g., "note.created").
 * @template TDataSchema - The Zod schema for the event's data payload.
 *
 * @param {TName} name - The unique name of the event.
 * @param {TDataSchema} dataSchema - A Zod schema defining the structure of the event's data.
 * @returns A Zod schema for the specific domain event.
 */
export const createDomainEvent = <
	TName extends string,
	TDataSchema extends z.ZodType,
>(
	name: TName,
	dataSchema: TDataSchema,
) => {
	return BaseEventSchema.extend({
		/**
		 * The literal type of the event, used for discriminated unions.
		 */
		type: z.literal(name),
		/**
		 * The payload of the event, containing all relevant data for the state change.
		 */
		data: dataSchema,
	});
};

/**
 * A type helper to create a Zod discriminated union from a list of domain event schemas.
 * This is useful for defining a single "master" event type that encompasses all
 * possible domain events in the system.
 *
 * @template TEventSchemas - A tuple of Zod event schemas, each with a `type` literal.
 * @param {TEventSchemas} eventSchemas - An array of all domain event schemas.
 * @returns A Zod discriminated union schema over the provided event types.
 */
export const createEventUnion = <
	// Enforce that the input is a non-empty array of Zod objects, each having a 'type' literal.
	TEventSchemas extends readonly [
		z.ZodObject<{ type: z.ZodLiteral<string> }>,
		...z.ZodObject<{ type: z.ZodLiteral<string> }>[],
	],
>(
	eventSchemas: TEventSchemas,
) => {
	return z.discriminatedUnion("type", eventSchemas);
};
