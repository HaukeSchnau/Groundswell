import {
	applicatorTreeFactory,
	type NamespaceApplicatorMap,
	type NamespaceApplicatorTree,
} from "@groundswell/core";
import type { DatabaseError } from "@schnau/effect-drizzle/generic-sqlite";
import { eq } from "drizzle-orm";
import { Effect, type Cause } from "effect";
import { queryClient } from "../query-client";
import { Database } from "./db/contract";
import * as t from "./db/schema";
import type { DomainEvent } from "./events";

type ApplicatorError = DatabaseError | Cause.UnknownError;

const invalidateNotesQuery = Effect.promise(() =>
	queryClient.invalidateQueries({
		queryKey: ["notes"],
	}),
);

const note: NamespaceApplicatorMap<DomainEvent, "note", ApplicatorError, Database> = {
	created: {
		apply: (event) =>
			Effect.gen(function* () {
				const db = yield* Database;
				yield* db.execute((client) =>
					client
						.insert(t.notes)
						.values({ id: event.data.id, content: event.data.content })
						.onConflictDoNothing(),
				);
				yield* invalidateNotesQuery;
			}),
		verify: () => Effect.void,
	},
	archived: {
		apply: (event) =>
			Effect.gen(function* () {
				const db = yield* Database;
				yield* db.execute((client) =>
					client.update(t.notes).set({ isArchived: true }).where(eq(t.notes.id, event.data.noteId)),
				);
				yield* invalidateNotesQuery;
			}),
		verify: () => Effect.void,
	},
};
const todo: NamespaceApplicatorMap<DomainEvent, "todo", ApplicatorError, Database> = {
	created: {
		apply: () => Effect.void,
		verify: () => Effect.void,
	},
};

const tree: Partial<NamespaceApplicatorTree<DomainEvent, ApplicatorError, Database>> = {
	note,
	todo,
};

export const applicator = applicatorTreeFactory(tree);
