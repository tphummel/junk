// Tests for the pure logic of web/toothup/logic.js (streaks, stats, calendar, import/export).
import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays, buildExport, currentStreak, dayKey, formatClock, longestStreak, mergeSessions, monthGrid,
  normalizeSession, parseImport, summarize,
} from "../web/toothup/logic.js";

const at = (key, h = 8) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, h).getTime();
};
const s = (key, h = 8, extra = {}) => normalizeSession({ start: at(key, h), seconds: 120, quadrants: 4, ...extra });

test("addDays and dayKey cross month and year boundaries", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(dayKey(at("2026-11-20", 23)), "2026-11-20");
});

test("normalizeSession rejects junk and clamps fields", () => {
  assert.equal(normalizeSession(null), null);
  assert.equal(normalizeSession({ start: "x", seconds: 1 }), null);
  assert.equal(normalizeSession({ start: 1000, seconds: -5 }), null);
  const n = normalizeSession({ start: 1000.4, seconds: 90.6, quadrants: 9, flossed: 1 });
  assert.deepEqual(n, { id: "s1000", start: 1000, seconds: 91, flossed: true, quadrants: 4 });
});

test("streaks: today optional, gaps break, longest tracked", () => {
  const days = ["2026-11-14", "2026-11-15", "2026-11-17", "2026-11-18", "2026-11-19"];
  const list = days.map((d) => s(d));
  assert.equal(currentStreak(list, "2026-11-19"), 3);
  assert.equal(currentStreak(list, "2026-11-20"), 3); // not brushed yet today
  assert.equal(currentStreak(list, "2026-11-21"), 0);
  assert.equal(longestStreak(list), 3);
  assert.equal(longestStreak([]), 0);
});

test("summarize counts days, floss days and average", () => {
  const list = [s("2026-11-20", 8), s("2026-11-20", 20, { flossed: true, seconds: 60 }), s("2026-11-01"), s("2026-10-01")];
  const w = summarize(list, "2026-11-20", 7);
  assert.equal(w.sessions, 2);
  assert.equal(w.daysBrushed, 1);
  assert.equal(w.flossDays, 1);
  assert.equal(w.avgSeconds, 90);
  assert.equal(summarize(list, "2026-11-20", 30).daysBrushed, 2);
  assert.equal(summarize([], "2026-11-20", 7).avgSeconds, 0);
});

test("monthGrid pads to whole Sunday-first weeks", () => {
  const weeks = monthGrid(2026, 10); // November 2026 starts on a Sunday
  assert.equal(weeks[0][0], "2026-11-01");
  assert.equal(weeks.at(-1).at(-1), null);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.equal(monthGrid(2026, 1)[0].indexOf("2026-02-01"), 0); // Feb 2026 starts on a Sunday too
  assert.equal(monthGrid(2026, 11)[0].indexOf("2026-12-01"), 2); // Dec 2026 starts on a Tuesday
});

test("export then import round-trips; merge dedupes by id", () => {
  const list = [s("2026-11-19"), s("2026-11-20", 8, { flossed: true })];
  const { sessions, skipped } = parseImport(JSON.stringify(buildExport(list)));
  assert.deepEqual(sessions, list);
  assert.equal(skipped, 0);
  const merged = mergeSessions(list, [...sessions, s("2026-11-21")]);
  assert.equal(merged.added, 1);
  assert.equal(merged.sessions.length, 3);
});

test("parseImport accepts bare arrays, skips bad rows, rejects other files", () => {
  const r = parseImport(JSON.stringify([{ start: 5000, seconds: 10 }, { nope: true }]));
  assert.equal(r.sessions.length, 1);
  assert.equal(r.skipped, 1);
  assert.throws(() => parseImport("not json"), /valid JSON/);
  assert.throws(() => parseImport('{"app":"other","sessions":[]}'), /toothup export/);
  assert.throws(() => parseImport('{"app":"toothup"}'), /No sessions/);
});

test("formatClock rounds up", () => {
  assert.equal(formatClock(29.2), "0:30");
  assert.equal(formatClock(120), "2:00");
  assert.equal(formatClock(-1), "0:00");
});
