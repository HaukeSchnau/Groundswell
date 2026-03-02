import type { GenericDatabaseService } from "@schnau/effect-drizzle/generic-sqlite";
import { ServiceMap } from "effect";
import type * as Schema from "./schema";

export class Database extends ServiceMap.Service<
	Database,
	GenericDatabaseService<typeof Schema>
>()("Database") {}
