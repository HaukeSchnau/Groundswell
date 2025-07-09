import { ApplicatorError } from "@groundswell/core";
import type { UnknownEvent } from "@groundswell/zod-helpers";
import type {
	DatabaseError,
	GenericDatabaseService,
	GenericSqliteError,
} from "@schnau/effect-drizzle/generic-sqlite";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import type * as Schema from "./db/schema";
import { notes } from "./db/schema";
import type { DomainEvent } from "./events";

export const applicatorMap: ApplicatorMap<DomainEvent> = {
	"note.created": {
		apply: (event, db) => {
			return db
				.execute((client) =>
					client
						.insert(notes)
						.values({ id: event.data.id, content: event.data.content })
						.onConflictDoNothing(),
				)
				.pipe(
					Effect.as({
						invalidatedQueries: [["notes"]],
					}),
				);
		},
		verify: () => Effect.succeed(true),
	},
	"note.archived": {
		apply: (event, db) => {
			return db
				.execute((client) =>
					client
						.update(notes)
						.set({ isArchived: true })
						.where(eq(notes.id, event.data.noteId)),
				)
				.pipe(
					Effect.as({
						invalidatedQueries: [["notes"]],
					}),
				);
		},
		verify: () => Effect.succeed(true),
	},
};

type Applicator<
	DomainEvent extends UnknownEvent,
	EventName extends DomainEvent["type"],
> = {
	apply: (
		event: Extract<DomainEvent, { type: EventName }>,
		db: GenericDatabaseService<typeof Schema>,
		meta: { initiatorId: string },
	) => Effect.Effect<
		{
			invalidatedQueries: unknown[][];
		},
		DatabaseError<GenericSqliteError>
	>;
	verify: (
		event: Extract<DomainEvent, { type: EventName }>,
		db: GenericDatabaseService<typeof Schema>,
		meta: { initiatorId: string },
	) => Effect.Effect<boolean, DatabaseError<GenericSqliteError>>;
};
type ApplicatorMap<DomainEvent extends UnknownEvent> = {
	[EventName in DomainEvent["type"]]: Applicator<DomainEvent, EventName>;
};

// type ServerApplicator<DomainEvent extends UnknownEvent> = Applicator<
// 	DomainEvent,
// 	DomainEvent["type"]
// > & {
// 	getEventTopics: () => Effect.Effect<string[], never>;
// 	getUserTopics: () => Effect.Effect<string[], never>;
// };
// type ServerApplicatorMap<DomainEvent extends UnknownEvent> = {
// 	[EventName in DomainEvent["type"]]: ServerApplicator<DomainEvent>;
// };

export const applicatorFactory = <DomainEvent extends UnknownEvent>(
	applicatorMap: ApplicatorMap<DomainEvent>,
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
		db: GenericDatabaseService<typeof Schema>,
		meta: { initiatorId: string },
	) {
		const applicator = yield* getApplicator(event);
		return yield* applicator.apply(event, db, meta);
	});

	const verify = Effect.fn(function* <T extends DomainEvent["type"]>(
		event: Extract<DomainEvent, { type: T }>,
		db: GenericDatabaseService<typeof Schema>,
		meta: { initiatorId: string },
	) {
		const applicator = yield* getApplicator(event);
		return yield* applicator.verify(event, db, meta);
	});

	return {
		apply,
		verify,
	};
};

export const applicator = applicatorFactory(applicatorMap);
