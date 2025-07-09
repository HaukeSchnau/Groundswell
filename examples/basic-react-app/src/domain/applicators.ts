import { type ApplicatorMap, applicatorFactory } from "@groundswell/core";
import type {
	DatabaseError,
	GenericSqliteError,
} from "@schnau/effect-drizzle/generic-sqlite";
import { eq } from "drizzle-orm";
import { Effect, pipe } from "effect";
import { Database } from "./db/contract";
import { notes } from "./db/schema";
import type { DomainEvent } from "./events";

export const applicatorMap: ApplicatorMap<
	DomainEvent,
	DatabaseError<GenericSqliteError>,
	Database
> = {
	"note.created": {
		apply: (event) => {
			return pipe(
				Database,
				Effect.flatMap((db) =>
					db.execute((client) =>
						client
							.insert(notes)
							.values({ id: event.data.id, content: event.data.content })
							.onConflictDoNothing(),
					),
				),
				Effect.as({
					invalidatedQueries: [["notes"]],
				}),
			);
		},
		verify: () => Effect.void,
	},
	"note.archived": {
		apply: (event) => {
			return pipe(
				Database,
				Effect.flatMap((db) =>
					db.execute((client) =>
						client
							.update(notes)
							.set({ isArchived: true })
							.where(eq(notes.id, event.data.noteId)),
					),
				),
				Effect.as({
					invalidatedQueries: [["notes"]],
				}),
			);
		},
		verify: () => Effect.void,
	},
};

export const applicator = applicatorFactory(applicatorMap);
