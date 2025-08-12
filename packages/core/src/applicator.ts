import type { EventMeta, UnknownEvent } from "@groundswell/zod-helpers";
import { Effect } from "effect";
import type { ValidationError } from "./errors.js";

type SplitNamespace<T> = T extends `${infer Prefix}.${infer Suffix}`
	? [Prefix, Suffix]
	: [T, ""];
type NamespaceEvents<
	DomainEvent extends UnknownEvent,
	Namespace extends SplitNamespace<DomainEvent["type"]>[0],
> = Extract<DomainEvent, { type: `${Namespace}.${string}` }>;
type Namespaces<DomainEvent extends UnknownEvent> = SplitNamespace<
	DomainEvent["type"]
>[0];

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
export type NamespaceApplicatorMap<
	DomainEvent extends UnknownEvent,
	Namespace extends Namespaces<DomainEvent>,
	E,
	R,
> = {
	[EventName in SplitNamespace<
		NamespaceEvents<DomainEvent, Namespace>["type"]
	>[1]]: Applicator<DomainEvent, `${Namespace}.${EventName}`, E, R>;
};
export type NamespaceApplicatorTree<DomainEvent extends UnknownEvent, E, R> = {
	[Namespace in Namespaces<DomainEvent>]: NamespaceApplicatorMap<
		DomainEvent,
		Namespace,
		E,
		R
	>;
};

export const applicatorFactory = <DomainEvent extends UnknownEvent, E, R>(
	applicatorMap: ApplicatorMap<DomainEvent, E, R>,
) => {
	const apply = <T extends DomainEvent["type"]>(
		event: Extract<DomainEvent, { type: T }>,
		meta: EventMeta,
	) => {
		const applicator = applicatorMap[event.type];
		return applicator.apply(event, meta).pipe(
			Effect.withSpan("SYNC/Apply", {
				attributes: {
					event,
				},
			}),
		);
	};

	const verify = <T extends DomainEvent["type"]>(
		event: Extract<DomainEvent, { type: T }>,
		meta: EventMeta,
	) => {
		const applicator = applicatorMap[event.type];
		return applicator.verify(event, meta).pipe(
			Effect.withSpan("SYNC/Verify", {
				attributes: {
					event,
				},
			}),
		);
	};

	return {
		apply,
		verify,
	};
};

// biome-ignore lint/suspicious/noExplicitAny: libray code, not worth the effort to type it properly
const getApplicator = (event: UnknownEvent, applicatorTree: any) => {
	const [namespace, ...eventNameParts] = event.type.split(".") as [
		string,
		string,
	];
	const eventName = eventNameParts.join(".");
	return applicatorTree[namespace]?.[eventName];
};

export const applicatorTreeFactory = <DomainEvent extends UnknownEvent, E, R>(
	applicatorTree: Partial<NamespaceApplicatorTree<DomainEvent, E, R>>,
) => {
	const apply = <T extends DomainEvent["type"]>(
		event: Extract<DomainEvent, { type: T }>,
		meta: EventMeta,
	) => {
		const applicator = getApplicator(event, applicatorTree) as
			| Applicator<Extract<DomainEvent, { type: T }>, T, E, R>
			| undefined;
		if (!applicator) {
			console.warn(`no applicator found for ${event.type}`); // TODO: Effect.fail
			return Effect.void;
		}
		return applicator.apply(event, meta).pipe(
			Effect.withSpan("SYNC/Apply", {
				attributes: {
					event: event.type,
				},
			}),
		);
	};

	const verify = <T extends DomainEvent["type"]>(
		event: Extract<DomainEvent, { type: T }>,
		meta: EventMeta,
	) => {
		const applicator = getApplicator(event, applicatorTree) as Applicator<
			Extract<DomainEvent, { type: T }>,
			T,
			E,
			R
		>;
		if (!applicator) {
			console.warn(`no applicator found for ${event.type}`); // TODO: Effect.fail
			return Effect.void;
		}
		return applicator.verify(event, meta).pipe(
			Effect.withSpan("SYNC/Verify", {
				attributes: {
					event: event.type,
				},
			}),
		);
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
};
export type ServerApplicatorMap<DomainEvent extends UnknownEvent, E, R> = {
	[EventName in DomainEvent["type"]]: ServerApplicator<
		DomainEvent,
		EventName,
		E,
		R
	>;
};
export type NamespaceServerApplicatorMap<
	DomainEvent extends UnknownEvent,
	Namespace extends Namespaces<DomainEvent>,
	E,
	R,
> = {
	[EventName in SplitNamespace<
		NamespaceEvents<DomainEvent, Namespace>["type"]
	>[1]]: ServerApplicator<DomainEvent, `${Namespace}.${EventName}`, E, R>;
};
export type NamespaceServerApplicatorTree<
	DomainEvent extends UnknownEvent,
	E,
	R,
> = {
	[Namespace in Namespaces<DomainEvent>]: NamespaceServerApplicatorMap<
		DomainEvent,
		Namespace,
		E,
		R
	>;
};

export const serverApplicatorFactory = <DomainEvent extends UnknownEvent, E, R>(
	applicatorMap: ServerApplicatorMap<DomainEvent, E, R>,
) => {
	const getEventTopics = <T extends DomainEvent["type"]>(
		event: Extract<DomainEvent, { type: T }>,
	) => {
		const applicator = applicatorMap[event.type];
		return applicator.getEventTopics(event);
	};

	return {
		...applicatorFactory(applicatorMap),
		getEventTopics,
	};
};

export const serverApplicatorTreeFactory = <
	DomainEvent extends UnknownEvent,
	E,
	R,
>(
	applicatorTree: Partial<NamespaceServerApplicatorTree<DomainEvent, E, R>>,
) => {
	const getEventTopics = <T extends DomainEvent["type"]>(
		event: Extract<DomainEvent, { type: T }>,
	) => {
		const applicator = getApplicator(event, applicatorTree) as
			| ServerApplicator<Extract<DomainEvent, { type: T }>, T, E, R>
			| undefined;
		if (!applicator) {
			console.warn(`no applicator found for ${event.type}`); // TODO: Effect.fail
			return Effect.succeed([]);
		}
		return applicator.getEventTopics(event);
	};

	return {
		...applicatorTreeFactory(applicatorTree),
		getEventTopics,
	};
};
