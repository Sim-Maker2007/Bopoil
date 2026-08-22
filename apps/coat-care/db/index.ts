import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

let client: Client | undefined;

export function getDb() {
  const url = process.env.TURSO_DATABASE_URL?.trim() || "file:local.db";
  client ||= createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined });
  return drizzle(client, { schema });
}
