import {
	applicatorTreeFactory,
	type NamespaceApplicatorMap,
	type NamespaceApplicatorTree,
} from "@groundswell/core";
import type {
	DatabaseError,
	GenericSqliteError,
} from "@schnau/effect-drizzle/generic-sqlite";
import { eq } from "drizzle-orm";
import { type Cause, Effect, pipe } from "effect";
import { queryClient } from "@/query-client";
import { Database } from "./db/contract";
import * as t from "./db/schema";
import type { DomainEvent } from "./events";

const note: NamespaceApplicatorMap<
	DomainEvent,
	"note",
	DatabaseError<GenericSqliteError> | Cause.UnknownException,
	Database
> = {
	created: {
		apply: (event) => {
			return pipe(
				Database,
				Effect.flatMap((db) =>
					db.execute((client) =>
						client
							.insert(t.notes)
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
	archived: {
		apply: (event) => {
			return pipe(
				Database,
				Effect.flatMap((db) =>
					db.execute((client) =>
						client
							.update(t.notes)
							.set({ isArchived: true })
							.where(eq(t.notes.id, event.data.noteId)),
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
const todo: NamespaceApplicatorMap<
	DomainEvent,
	"todo",
	DatabaseError<GenericSqliteError> | Cause.UnknownException,
	Database
> = {
	created: {
		apply: () => Effect.void,
		verify: () => Effect.void,
	},
};

const tree: Partial<
	NamespaceApplicatorTree<
		DomainEvent,
		DatabaseError<GenericSqliteError> | Cause.UnknownException,
		Database
	>
> = {
	note,
	todo,
};

export const applicator = applicatorTreeFactory(tree);
