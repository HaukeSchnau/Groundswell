import type { UnknownEvent } from "@groundswell/zod-helpers";
import { Effect } from "effect";
import { ApplicatorError, type ValidationError } from "./errors";

type Applicator<
	DomainEvent extends UnknownEvent,
	EventName extends DomainEvent["type"],
	E,
	R,
> = {
	apply: (
		event: Extract<DomainEvent, { type: EventName }>,
		meta: { initiatorId: string },
	) => Effect.Effect<
		{
			invalidatedQueries: unknown[][];
		},
		E,
		R
	>;
	verify: (
		event: Extract<DomainEvent, { type: EventName }>,
		meta: { initiatorId: string },
	) => Effect.Effect<void, E | ValidationError, R>;
};
export type ApplicatorMap<DomainEvent extends UnknownEvent, E, R> = {
	[EventName in DomainEvent["type"]]: Applicator<DomainEvent, EventName, E, R>;
};

export const applicatorFactory = <DomainEvent extends UnknownEvent, E, R>(
	applicatorMap: ApplicatorMap<DomainEvent, E, R>,
) => {
	const getApplicator = Effect.fn(function* <T extends DomainEvent["type"]>(
		event: Extract<DomainEvent, { type: T }>,
	) {
		const applicator = applicatorMap[event.type];
		if (!applicator) {
			return yield* Effect.fail(
				new ApplicatorError({
					cause: new Error(`No applicator found for event type: ${event.type}`),
				}),
			);
		}
		return applicator;
	});

	const apply = Effect.fn(function* <T extends DomainEvent["type"]>(
		event: Extract<DomainEvent, { type: T }>,
		meta: { initiatorId: string },
	) {
		const applicator = yield* getApplicator(event);
		return yield* applicator.apply(event, meta);
	});

	const verify = Effect.fn(function* <T extends DomainEvent["type"]>(
		event: Extract<DomainEvent, { type: T }>,
		meta: { initiatorId: string },
	) {
		const applicator = yield* getApplicator(event);
		return yield* applicator.verify(event, meta);
	});

	return {
		apply,
		verify,
	};
};
