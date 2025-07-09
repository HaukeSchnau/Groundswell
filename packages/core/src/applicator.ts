import type { EventMeta, UnknownEvent } from "@groundswell/zod-helpers";
import type { Effect } from "effect";
import type { ValidationError } from "./errors";

type Applicator<
	DomainEvent extends UnknownEvent,
	EventName extends DomainEvent["type"],
	E,
	R,
> = {
	apply: (
		event: Extract<DomainEvent, { type: EventName }>,
		meta: EventMeta,
	) => Effect.Effect<void, E, R>;
	verify: (
		event: Extract<DomainEvent, { type: EventName }>,
		meta: EventMeta,
	) => Effect.Effect<void, E | ValidationError, R>;
};
export type ApplicatorMap<DomainEvent extends UnknownEvent, E, R> = {
	[EventName in DomainEvent["type"]]: Applicator<DomainEvent, EventName, E, R>;
};

export const applicatorFactory = <DomainEvent extends UnknownEvent, E, R>(
	applicatorMap: ApplicatorMap<DomainEvent, E, R>,
) => {
	const apply = <T extends DomainEvent["type"]>(
		event: Extract<DomainEvent, { type: T }>,
		meta: EventMeta,
	) => {
		const applicator = applicatorMap[event.type];
		return applicator.apply(event, meta);
	};

	const verify = <T extends DomainEvent["type"]>(
		event: Extract<DomainEvent, { type: T }>,
		meta: EventMeta,
	) => {
		const applicator = applicatorMap[event.type];
		return applicator.verify(event, meta);
	};

	return {
		apply,
		verify,
	};
};

type ServerApplicator<
	DomainEvent extends UnknownEvent,
	EventName extends DomainEvent["type"],
	E,
	R,
> = Applicator<DomainEvent, EventName, E, R> & {
	getEventTopics: (
		event: Extract<DomainEvent, { type: EventName }>,
	) => Effect.Effect<string[], E, R>;
	getUserTopics: (
		event: Extract<DomainEvent, { type: EventName }>,
	) => Effect.Effect<string[], E, R>;
};
export type ServerApplicatorMap<DomainEvent extends UnknownEvent, E, R> = {
	[EventName in DomainEvent["type"]]: ServerApplicator<
		DomainEvent,
		EventName,
		E,
		R
	>;
};

export const serverApplicatorFactory = <DomainEvent extends UnknownEvent, E, R>(
	applicatorMap: ServerApplicatorMap<DomainEvent, E, R>,
) => {
	const apply = <T extends DomainEvent["type"]>(
		event: Extract<DomainEvent, { type: T }>,
		meta: EventMeta,
	) => {
		const applicator = applicatorMap[event.type];
		return applicator.apply(event, meta);
	};

	const verify = <T extends DomainEvent["type"]>(
		event: Extract<DomainEvent, { type: T }>,
		meta: EventMeta,
	) => {
		const applicator = applicatorMap[event.type];
		return applicator.verify(event, meta);
	};

	const getEventTopics = <T extends DomainEvent["type"]>(
		event: Extract<DomainEvent, { type: T }>,
	) => {
		const applicator = applicatorMap[event.type];
		return applicator.getEventTopics(event);
	};

	const getUserTopics = <T extends DomainEvent["type"]>(
		event: Extract<DomainEvent, { type: T }>,
	) => {
		const applicator = applicatorMap[event.type];
		return applicator.getUserTopics(event);
	};

	return {
		apply,
		verify,
		getEventTopics,
		getUserTopics,
	};
};
