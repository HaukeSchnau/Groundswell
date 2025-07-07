import { Effect } from "effect";
import { Database } from "./db/contract";
import * as Schema from "./db/schema";

export const getNotes = Database.use((db) =>
	db.execute((db) => db.select().from(Schema.notes)),
).pipe(Effect.withSpan("getNotes"));
