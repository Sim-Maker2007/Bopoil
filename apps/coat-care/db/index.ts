import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// The whole data layer commits multi-statement writes through db.batch([...]),
// the atomic API the previous libSQL driver provided natively. Postgres has no
// equivalent, so batch() opens one transaction and, through this storage, every
// statement awaited inside it executes on the transaction's connection instead
// of the pool. Statements keep their normal drizzle result mapping, and any
// failure rolls the whole batch back — the same contract call sites relied on.
type ClientTypes = { bigint: number; numeric: number };
type ClientSql = postgres.Sql<ClientTypes>;

const activeBatchTx = new AsyncLocalStorage<postgres.TransactionSql<ClientTypes>>();

export type DbBatchItem = PromiseLike<unknown>;

// drizzle wraps failed statements in "Failed query: ..." and keeps the real
// Postgres error (not-null violation, duplicate key, ...) on error.cause. The
// claim-guard catch blocks match on that underlying text, so give them both.
export function databaseErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `\n${error.cause.message}` : "";
  return `${error.message}${cause}`;
}
type BatchResults<T extends readonly DbBatchItem[]> = { -readonly [K in keyof T]: Awaited<T[K]> };
type DbWithBatch = PostgresJsDatabase<typeof schema> & {
  batch<T extends readonly DbBatchItem[]>(statements: T): Promise<BatchResults<T>>;
};

// Routes every property access (drizzle only calls client.unsafe/client.begin at
// query time) to the batch transaction connection when one is active.
function routeToActiveBatch(base: ClientSql): ClientSql {
  return new Proxy(base, {
    get(target, property) {
      const current = activeBatchTx.getStore() ?? target;
      const value = Reflect.get(current, property, current);
      return typeof value === "function" ? value.bind(current) : value;
    },
    apply(target, _thisArg, args) {
      const current = activeBatchTx.getStore() ?? target;
      return Reflect.apply(current as unknown as (...callArgs: unknown[]) => unknown, current, args);
    },
  });
}

let db: DbWithBatch | undefined;

export function getDb() {
  if (db) return db;
  const url = process.env.DATABASE_URL?.trim() || "postgres://postgres:postgres@127.0.0.1:5432/coat_care";
  // prepare:false keeps the driver compatible with Supabase's transaction-mode
  // connection pooler (Supavisor on port 6543), which rejects prepared statements.
  // bigint/numeric parse as JS numbers because sum()/count() return them and the
  // app does money math in integer cents — well within Number's safe range.
  const client = postgres(url, {
    prepare: false,
    // Serverless functions come and go; release idle pooled connections quickly
    // and fail fast when Supavisor is unreachable instead of hanging a request.
    idle_timeout: 20,
    connect_timeout: 10,
    types: {
      bigint: { to: 20, from: [20], serialize: (value: unknown) => String(value), parse: (value: string) => Number(value) },
      numeric: { to: 1700, from: [1700], serialize: (value: unknown) => String(value), parse: (value: string) => Number(value) },
    },
  });
  const instance: DbWithBatch = Object.assign(drizzle(routeToActiveBatch(client), { schema }), {
    batch: async <T extends readonly DbBatchItem[]>(statements: T): Promise<BatchResults<T>> => {
      if (!statements.length) return [] as unknown as BatchResults<T>;
      return await client.begin((tx) => activeBatchTx.run(tx, async () => {
        const results: unknown[] = [];
        for (const statement of statements) results.push(await statement);
        return results;
      })) as BatchResults<T>;
    },
  });
  db = instance;
  return db;
}
