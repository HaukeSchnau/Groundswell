import { genericDatabaseFactory } from "@schnau/effect-drizzle/generic-sqlite";
import type * as Schema from "./schema";

const DatabaseService = genericDatabaseFactory<typeof Schema>();
export class Database extends DatabaseService.Database {}
export const TransactionContext = DatabaseService.TransactionContext;
