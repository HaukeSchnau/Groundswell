import { Effect } from "effect";
import { Database } from "./db/contract";
import * as Schema from "./db/schema";

export const getNotes = Effect.gen(function* () {
	const db = yield* Database;
	return yield* db.execute((client) => client.select().from(Schema.notes));
}).pipe(Effect.withSpan("getNotes"));
