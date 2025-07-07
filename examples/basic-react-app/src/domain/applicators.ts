import { ApplicatorError } from "@groundswell/core/errors";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import type {
	DatabaseError,
	GenericDatabaseService,
	GenericSqliteError,
} from "effect-drizzle/generic-sqlite";
import type * as Schema from "./db/schema";
import { notes } from "./db/schema";
import type { DomainEvent } from "./events";

type DomainEventType = DomainEvent["type"];
type ApplicatorMap = {
	[EventName in DomainEventType]: {
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
};

const applicatorMap: ApplicatorMap = {
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

const getApplicator = Effect.fn(function* <T extends DomainEventType>(
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

export const apply = Effect.fn(function* <T extends DomainEventType>(
	event: Extract<DomainEvent, { type: T }>,
	db: GenericDatabaseService<typeof Schema>,
	meta: { initiatorId: string },
) {
	const applicator = yield* getApplicator(event);
	return yield* applicator.apply(event, db, meta);
});

export const verify = Effect.fn(function* <T extends DomainEventType>(
	event: Extract<DomainEvent, { type: T }>,
	db: GenericDatabaseService<typeof Schema>,
	meta: { initiatorId: string },
) {
	const applicator = yield* getApplicator(event);
	return yield* applicator.verify(event, db, meta);
});
