import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

type DB = Database.Database;

const globalForDb = globalThis as unknown as { __studiomateDb?: DB };

function open(): DB {
  const file = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "studiomate.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(fs.readFileSync(path.join(process.cwd(), "src", "server", "schema.sql"), "utf8"));
  return db;
}

export function db(): DB {
  if (!globalForDb.__studiomateDb) globalForDb.__studiomateDb = open();
  return globalForDb.__studiomateDb;
}

/** Runs fn inside an IMMEDIATE transaction (write lock taken up front). */
export function tx<T>(fn: () => T): T {
  return db().transaction(fn).immediate();
}

export function one<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}

export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}

export function run(sql: string, ...params: unknown[]) {
  return db().prepare(sql).run(...params);
}
