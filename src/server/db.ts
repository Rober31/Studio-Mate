import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { createClient, type Client, type InStatement, type InValue, type ResultSet, type Transaction } from "@libsql/client";
import { SCHEMA_SQL } from "./schema";

// libSQL: a local SQLite file in development (`file:`), Turso in production
// (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN). All access is async; `tx()` routes
// every query made inside it to the same write transaction via AsyncLocalStorage.

type State = { client: Client; ready: Promise<void>; local: boolean; demo: boolean };
const g = globalThis as unknown as { __smDb?: State; __smQueries?: number };
const txStore = new AsyncLocalStorage<Transaction>();
// Set while the schema/demo initialization itself runs queries, so they don't wait on `ready`.
const initStore = new AsyncLocalStorage<boolean>();

async function whenReady(s: State) {
  if (!initStore.getStore()) await s.ready;
}

/** Demo mode: a throwaway database in /tmp, filled with sample data on first use (no persistence). */
export function isDemo(): boolean {
  return process.env.STUDIOMATE_DEMO === "1" && !(process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL);
}

function resolveUrl(): { url: string; authToken?: string; local: boolean } {
  const remote = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
  if (remote) return { url: remote, authToken: process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN, local: remote.startsWith("file:") };
  if (isDemo() && process.env.VERCEL) return { url: "file:/tmp/studiomate-demo.db", local: true };
  if (process.env.VERCEL) {
    throw new Error("No database configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the Vercel project settings (or STUDIOMATE_DEMO=1 for a throwaway demo).");
  }
  const file = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "studiomate.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return { url: `file:${file}`, local: true };
}

function state(): State {
  if (!g.__smDb) {
    const { url, authToken, local } = resolveUrl();
    const client = createClient({ url, authToken, intMode: "number" });
    const demo = isDemo();
    const ready = (async () => {
      if (local) await client.execute("PRAGMA journal_mode = WAL");
      await client.executeMultiple(SCHEMA_SQL);
      if (demo) {
        const has = await client.execute("SELECT 1 FROM studios LIMIT 1");
        if (!has.rows.length) {
          const { seedDemo } = await import("./demo");
          await initStore.run(true, () => seedDemo());
        }
      }
    })();
    ready.catch(() => {
      // Allow a retry on the next request if initialization failed.
      if (g.__smDb?.client === client) g.__smDb = undefined;
    });
    g.__smDb = { client, ready, local, demo };
  }
  return g.__smDb;
}

export async function ready(): Promise<void> {
  await state().ready;
}

function args(params: unknown[]): InValue[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    return p as InValue;
  });
}

function toObjects<T>(rs: ResultSet): T[] {
  const cols = rs.columns;
  return rs.rows.map((row) => {
    const o: Record<string, unknown> = {};
    for (let i = 0; i < cols.length; i++) o[cols[i]] = row[i];
    return o as T;
  });
}

function isBusy(e: unknown): boolean {
  const msg = String((e as { code?: string; message?: string })?.code ?? "") + String((e as Error)?.message ?? "");
  return /SQLITE_BUSY|database is locked/i.test(msg);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function execute(sql: string, params: unknown[]): Promise<ResultSet> {
  g.__smQueries = (g.__smQueries ?? 0) + 1;
  const t = txStore.getStore();
  const stmt = { sql, args: args(params) };
  if (t) return t.execute(stmt);
  const s = state();
  await whenReady(s);
  for (let attempt = 0; ; attempt++) {
    try {
      return await s.client.execute(stmt);
    } catch (e) {
      if (!isBusy(e) || attempt >= 8) throw e;
      await sleep(15 * 2 ** attempt);
    }
  }
}

export async function one<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  return toObjects<T>(await execute(sql, params))[0];
}

export async function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
  return toObjects<T>(await execute(sql, params));
}

export async function run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
  const rs = await execute(sql, params);
  return { changes: rs.rowsAffected };
}

/**
 * Runs several write statements in one round trip. Atomic on its own, or part
 * of the surrounding `tx()` when called inside one.
 */
export async function batch(stmts: [string, ...unknown[]][]): Promise<{ changes: number }[]> {
  if (!stmts.length) return [];
  g.__smQueries = (g.__smQueries ?? 0) + 1;
  const list: InStatement[] = stmts.map(([sql, ...p]) => ({ sql, args: args(p) }));
  const t = txStore.getStore();
  if (t) return (await t.batch(list)).map((r) => ({ changes: r.rowsAffected }));
  const s = state();
  await whenReady(s);
  for (let attempt = 0; ; attempt++) {
    try {
      return (await s.client.batch(list, "write")).map((r) => ({ changes: r.rowsAffected }));
    } catch (e) {
      if (!isBusy(e) || attempt >= 8) throw e;
      await sleep(15 * 2 ** attempt);
    }
  }
}

/** Runs fn inside a write transaction. Nested calls join the outer transaction. */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (txStore.getStore()) return fn();
  const s = state();
  await whenReady(s);
  for (let attempt = 0; ; attempt++) {
    let t: Transaction | undefined;
    try {
      t = await s.client.transaction("write");
      const result = await txStore.run(t, fn);
      await t.commit();
      return result;
    } catch (e) {
      if (t) await t.rollback().catch(() => {});
      if (!isBusy(e) || attempt >= 8) throw e;
      await sleep(20 * 2 ** attempt + Math.random() * 20);
    } finally {
      t?.close();
    }
  }
}

/** Number of statements executed so far in this process (diagnostics and tests). */
export function queryCount(): number {
  return g.__smQueries ?? 0;
}

/** "?, ?, ?" for an IN (...) list. */
export function placeholders(n: number): string {
  return n ? Array(n).fill("?").join(", ") : "NULL";
}
