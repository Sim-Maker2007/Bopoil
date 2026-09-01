import { sql } from "drizzle-orm";
import { pgTable, serial, text } from "drizzle-orm/pg-core";

export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')`),
});
