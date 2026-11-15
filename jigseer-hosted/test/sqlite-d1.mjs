// Test double for D1: applies the real migration files to in-memory SQLite (node:sqlite) behind
// the subset of the D1 API the app uses (ADR 0007). Not a substitute for D1-specific behavior.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const MIGRATIONS = new URL("../migrations/", import.meta.url);

export function createDb({ migrate = true } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON"); // D1 enforces foreign keys by default
  if (migrate) {
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
      sqlite.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
    }
  }
  const statement = (sql, params = []) => ({
    bind: (...values) => statement(sql, values),
    first: async (column) => {
      const row = sqlite.prepare(sql).get(...params) ?? null;
      return column && row ? row[column] : row;
    },
    all: async () => ({ results: sqlite.prepare(sql).all(...params), success: true }),
    run: async () => {
      const info = sqlite.prepare(sql).run(...params);
      return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    },
  });
  return { prepare: (sql) => statement(sql), sqlite };
}

/** A db whose queries always fail, for error paths. */
export function brokenDb() {
  const fail = async () => {
    throw new Error("D1_ERROR: unavailable");
  };
  const statement = { bind: () => statement, first: fail, all: fail, run: fail };
  return { prepare: () => statement };
}
