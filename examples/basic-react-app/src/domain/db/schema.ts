import { CanonicalStorage, ClientStorage } from "@groundswell/adapter-drizzle-sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// A single schema for both client (SQLite) and server (can also use SQLite for simplicity)
export const notes = sqliteTable("notes", {
	id: text("id").primaryKey(),
	content: text("content").notNull(),
	isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
});

// The events table schema required by the Drizzle storage adapter
export const eventLog = ClientStorage.EventsTable;

export const canonicalEvents = CanonicalStorage.CanonicalEventsTable;
export const canonicalEventTopics = CanonicalStorage.CanonicalEventTopicsTable;
export const canonicalEventsSentToUsers = CanonicalStorage.CanonicalEventsSentToUsersTable;
