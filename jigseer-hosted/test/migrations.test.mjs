import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";
import { createDb } from "./sqlite-d1.mjs";

const now = "2026-11-14T10:00:00Z";

test("migration files are numbered 0001, 0002, ... with no gaps", () => {
  const files = readdirSync(new URL("../migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
  files.forEach((file, i) => assert.match(file, new RegExp(`^${String(i + 1).padStart(4, "0")}_[a-z0-9_]+\\.sql$`)));
});

test("migrations create the tables and the hot-path indexes", () => {
  const { sqlite } = createDb();
  const names = (type) => sqlite.prepare("SELECT name FROM sqlite_master WHERE type = ?").all(type).map((r) => r.name);
  assert.ok(names("table").includes("puzzles"));
  assert.ok(names("table").includes("hits"));
  assert.ok(names("index").includes("hits_puzzle_created"));
  assert.ok(names("index").includes("hits_puzzle_updated"));
});

test("hot-path hit queries use an index, not a scan", () => {
  const { sqlite } = createDb();
  for (const sql of [
    "SELECT * FROM hits WHERE puzzle_id = 'A' ORDER BY created_at DESC, id DESC",
    "SELECT MAX(updated_at) FROM hits WHERE puzzle_id = 'A'",
  ]) {
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(" | ");
    assert.match(plan, /USING (COVERING )?INDEX hits_puzzle_/, plan);
  }
});

test("deleting a puzzle deletes its hits", () => {
  const { sqlite } = createDb();
  sqlite.prepare("INSERT INTO puzzles (id, name, created_at, updated_at) VALUES ('A', 'Alps', ?, ?)").run(now, now);
  sqlite
    .prepare("INSERT INTO hits (puzzle_id, player_name, created_at, updated_at) VALUES ('A', 'Sam', ?, ?)")
    .run(now, now);
  sqlite.prepare("DELETE FROM puzzles WHERE id = 'A'").run();
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM hits").get().n, 0);
});

test("a hit needs an existing puzzle", () => {
  const { sqlite } = createDb();
  assert.throws(() =>
    sqlite
      .prepare("INSERT INTO hits (puzzle_id, player_name, created_at, updated_at) VALUES ('NOPE', 'Sam', ?, ?)")
      .run(now, now),
  );
});
