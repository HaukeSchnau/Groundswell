import { type ApplicatorMap, applicatorFactory } from "@groundswell/core";
import type {
	DatabaseError,
	GenericSqliteError,
} from "@schnau/effect-drizzle/generic-sqlite";
import { eq } from "drizzle-orm";
import { type Cause, Effect, pipe } from "effect";
import { queryClient } from "@/query-client";
import { Database } from "./db/contract";
import { notes } from "./db/schema";
import type { DomainEvent } from "./events";

export const applicatorMap: ApplicatorMap<
	DomainEvent,
	DatabaseError<GenericSqliteError> | Cause.UnknownException,
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
				Effect.tap(() =>
					queryClient.invalidateQueries({ queryKey: ["notes"] }),
				),
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
				Effect.tap(() =>
					queryClient.invalidateQueries({ queryKey: ["notes"] }),
				),
			);
		},
		verify: () => Effect.void,
	},
};

export const applicator = applicatorFactory(applicatorMap);
