import type { GenericDatabaseService } from "@schnau/effect-drizzle/generic-sqlite";
import { Context } from "effect";
import type * as Schema from "./schema";

export class Database extends Context.Tag("Database")<
	Database,
	GenericDatabaseService<typeof Schema>
>() {}
