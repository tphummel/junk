// Tests for the pure logic of web/toothup/logic.js (streaks, stats, calendar, import/export).
import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays, buildExport, currentStreak, dayKey, formatClock, freshStart, groupByDay, longestStreak, mergeEvents,
  monthGrid, normalizeAll, normalizeEvent, parseImport, summarize,
} from "../web/toothup/logic.js";

const at = (key, h = 8) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, h).getTime();
};
const s = (key, h = 8, extra = {}) => normalizeEvent({ type: "brush", start: at(key, h), seconds: 120, quadrants: 4, ...extra });
const ev = (type, key, h = 8) => normalizeEvent({ type, start: at(key, h) });

test("addDays and dayKey cross month and year boundaries", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(dayKey(at("2026-11-20", 23)), "2026-11-20");
});

test("normalizeEvent: rejects junk, clamps brush fields, zeroes them for floss and mouthwash", () => {
  assert.equal(normalizeEvent(null), null);
  assert.equal(normalizeEvent({ start: "x", seconds: 1 }), null);
  assert.equal(normalizeEvent({ start: 1000, seconds: -5 }), null);
  assert.equal(normalizeEvent({ type: "gargle", start: 1000 }), null);
  assert.deepEqual(normalizeEvent({ start: 1000.4, seconds: 90.6, quadrants: 9 }), { id: "s1000", type: "brush", start: 1000, seconds: 91, quadrants: 4 });
  assert.deepEqual(normalizeEvent({ type: "floss", start: 2000, seconds: 50, quadrants: 3 }), { id: "f2000", type: "floss", start: 2000, seconds: 0, quadrants: 0 });
  assert.equal(normalizeEvent({ type: "mouthwash", start: 3000 }).id, "m3000");
});

test("v1 sessions with flossed become a brush plus a separate timestamped floss event", () => {
  const { events, skipped } = normalizeAll([
    { id: "s5000", start: 5000, seconds: 120, quadrants: 4, flossed: true },
    { id: "s9000", start: 9000, seconds: 60, quadrants: 2, flossed: false },
  ]);
  assert.equal(skipped, 0);
  assert.deepEqual(events.map((e) => [e.type, e.id, e.start]), [
    ["brush", "s5000", 5000], ["floss", "f5000", 125000], ["brush", "s9000", 9000],
  ]);
});

test("streaks count brush events only", () => {
  const days = ["2026-11-14", "2026-11-15", "2026-11-17", "2026-11-18", "2026-11-19"];
  const list = [...days.map((d) => s(d)), ev("floss", "2026-11-16"), ev("mouthwash", "2026-11-16")];
  assert.equal(currentStreak(list, "2026-11-19"), 3);
  assert.equal(currentStreak(list, "2026-11-20"), 3); // not brushed yet today
  assert.equal(currentStreak(list, "2026-11-21"), 0);
  assert.equal(longestStreak(list), 3);
  assert.equal(longestStreak([]), 0);
});

test("summarize counts brushes, floss days and mouthwash days separately", () => {
  const list = [
    s("2026-11-20", 8), s("2026-11-20", 20, { seconds: 60 }),
    ev("floss", "2026-11-20", 20), ev("mouthwash", "2026-11-20", 8), ev("mouthwash", "2026-11-20", 20), ev("mouthwash", "2026-11-05"),
    s("2026-11-01"), s("2026-10-01"),
  ];
  const w = summarize(list, "2026-11-20", 7);
  assert.equal(w.brushes, 2);
  assert.equal(w.daysBrushed, 1);
  assert.equal(w.flossDays, 1);
  assert.equal(w.mouthwashDays, 1);
  assert.equal(w.avgSeconds, 90);
  const m = summarize(list, "2026-11-20", 30);
  assert.equal(m.daysBrushed, 2);
  assert.equal(m.mouthwashDays, 2);
  assert.equal(summarize([], "2026-11-20", 7).avgSeconds, 0);
});

test("groupByDay can filter by type", () => {
  const list = [s("2026-11-20"), ev("floss", "2026-11-20"), ev("floss", "2026-11-21")];
  assert.equal(groupByDay(list).get("2026-11-20").length, 2);
  assert.equal(groupByDay(list, "floss").size, 2);
  assert.equal(groupByDay(list, "mouthwash").size, 0);
});

test("monthGrid pads to whole Sunday-first weeks", () => {
  const weeks = monthGrid(2026, 10); // November 2026 starts on a Sunday
  assert.equal(weeks[0][0], "2026-11-01");
  assert.equal(weeks.at(-1).at(-1), null);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.equal(monthGrid(2026, 11)[0].indexOf("2026-12-01"), 2); // Dec 2026 starts on a Tuesday
});

test("export then import round-trips events; merge dedupes by id", () => {
  const list = [s("2026-11-19"), ev("floss", "2026-11-20"), ev("mouthwash", "2026-11-20", 21)];
  const out = buildExport(list);
  assert.equal(out.version, 2);
  const { events, skipped } = parseImport(JSON.stringify(out));
  assert.deepEqual(events, list);
  assert.equal(skipped, 0);
  const merged = mergeEvents(list, [...events, s("2026-11-21")]);
  assert.equal(merged.added, 1);
  assert.equal(merged.events.length, 4);
});

test("parseImport reads v1 exports and bare arrays, skips bad rows, rejects other files", () => {
  const v1 = { app: "toothup", version: 1, sessions: [{ id: "s7000", start: 7000, seconds: 30, quadrants: 1, flossed: true }] };
  assert.deepEqual(parseImport(JSON.stringify(v1)).events.map((e) => e.type), ["brush", "floss"]);
  const r = parseImport(JSON.stringify([{ start: 5000, seconds: 10 }, { nope: true }]));
  assert.equal(r.events.length, 1);
  assert.equal(r.skipped, 1);
  assert.throws(() => parseImport("not json"), /valid JSON/);
  assert.throws(() => parseImport('{"app":"other","events":[]}'), /toothup export/);
  assert.throws(() => parseImport('{"app":"toothup"}'), /No events/);
});

test("freshStart avoids an id already taken by the same type", () => {
  const list = [normalizeEvent({ type: "floss", start: 1000 })];
  assert.equal(freshStart(list, "floss", 1000), 1001);
  assert.equal(freshStart(list, "mouthwash", 1000), 1000);
});

test("formatClock rounds up", () => {
  assert.equal(formatClock(29.2), "0:30");
  assert.equal(formatClock(120), "2:00");
  assert.equal(formatClock(-1), "0:00");
});
