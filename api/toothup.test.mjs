// Tests for the pure logic of web/toothup/logic.js (streaks, stats, calendar, import/export).
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS, STEPS, TOTAL_SECONDS, addDays, buildExport, currentStreak, dayKey, dayRoutine, formatClock, groupByDay,
  longestStreak, makeEvent, mergeEvents, monthGrid, normalizeEvent, normalizeEvents, normalizeSettings, parseImport,
  routineStats, summarize,
} from "../web/toothup/logic.js";

const at = (key, h = 8) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, h).getTime();
};
const s = (key, h = 8, extra = {}) => makeEvent([], "brush", at(key, h), { seconds: 125, steps: 9, ...extra });
const ev = (type, key, h = 8) => makeEvent([], type, at(key, h));

test("addDays and dayKey cross month and year boundaries", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(dayKey(at("2026-11-20", 23)), "2026-11-20");
});

test("routine: 8 facial/lingual steps of 15s per quadrant, then 5s of tongue", () => {
  assert.equal(STEPS.length, 9);
  assert.deepEqual(STEPS.slice(0, 8).map((x) => x.seconds), Array(8).fill(15));
  assert.deepEqual(STEPS.slice(0, 4).map((x) => x.label), [
    "Upper right facial", "Upper right lingual", "Upper left facial", "Upper left lingual",
  ]);
  assert.deepEqual(STEPS.slice(0, 8).map((x) => x.surface), ["facial", "lingual", "facial", "lingual", "facial", "lingual", "facial", "lingual"]);
  assert.deepEqual(STEPS.slice(0, 8).map((x) => x.quadrant), [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.deepEqual(STEPS[8], { label: "Tongue", quadrant: null, surface: "tongue", seconds: 5 });
  assert.equal(TOTAL_SECONDS, 125);
});

test("makeEvent: ids come from type and time, and a taken id moves the start by 1 ms", () => {
  assert.deepEqual(makeEvent([], "floss", 2000), { id: "f2000", type: "floss", start: 2000 });
  assert.deepEqual(makeEvent([], "brush", 1000, { seconds: 90, steps: 8 }), { id: "s1000", type: "brush", start: 1000, seconds: 90, steps: 8 });
  const taken = [makeEvent([], "floss", 1000)];
  assert.equal(makeEvent(taken, "floss", 1000).start, 1001);
  assert.equal(makeEvent(taken, "mouthwash", 1000).start, 1000);
});

test("normalizeEvent keeps well-formed events and rejects everything else", () => {
  const brush = { id: "s1", type: "brush", start: 1000, seconds: 125, steps: 9 };
  assert.deepEqual(normalizeEvent(brush), brush);
  assert.deepEqual(normalizeEvent({ id: "f1", type: "floss", start: 5, seconds: 9, steps: 3 }), { id: "f1", type: "floss", start: 5 });
  for (const bad of [
    null, {}, { ...brush, id: "" }, { ...brush, type: "gargle" }, { ...brush, start: "x" }, { ...brush, start: 0 },
    { ...brush, seconds: -1 }, { ...brush, steps: 10 }, { ...brush, steps: undefined },
  ]) assert.equal(normalizeEvent(bad), null);
  assert.deepEqual(normalizeEvents([brush, { nope: true }]), { events: [brush], skipped: 1 });
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
    s("2026-11-20", 8, { seconds: 120 }), s("2026-11-20", 20, { seconds: 60 }),
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
  const { events, skipped } = parseImport(JSON.stringify(buildExport(list)));
  assert.deepEqual(events, list);
  assert.equal(skipped, 0);
  const merged = mergeEvents(list, [...events, s("2026-11-21")]);
  assert.equal(merged.added, 1);
  assert.equal(merged.events.length, 4);
});

test("parseImport skips bad events and rejects other files", () => {
  const good = s("2026-11-19");
  const r = parseImport(JSON.stringify({ app: "toothup", events: [good, { nope: true }] }));
  assert.deepEqual(r, { events: [good], skipped: 1 });
  assert.throws(() => parseImport("not json"), /valid JSON/);
  assert.throws(() => parseImport("[]"), /toothup export/);
  assert.throws(() => parseImport('{"app":"other","events":[]}'), /toothup export/);
  assert.throws(() => parseImport('{"app":"toothup"}'), /No events/);
});

test("formatClock rounds up", () => {
  assert.equal(formatClock(29.2), "0:30");
  assert.equal(formatClock(120), "2:00");
  assert.equal(formatClock(-1), "0:00");
});

// ---------- routine ----------
const D = "2026-11-18";
const AFTER = at("2026-11-25", 12); // "now" well after D, so every slot of D is due
const full = (key, h, extra = {}) => s(key, h, extra);
const routine = (events, now = AFTER) => dayRoutine(events, D, DEFAULT_SETTINGS, now);

test("floss and mouthwash events carry no empty fields", () => {
  assert.deepEqual(Object.keys(ev("floss", D)), ["id", "type", "start"]);
  assert.deepEqual(JSON.parse(JSON.stringify(buildExport([ev("mouthwash", D)]))).events[0], ev("mouthwash", D));
  assert.deepEqual(Object.keys(s(D)), ["id", "type", "start", "seconds", "steps"]);
});

test("normalizeSettings clamps to valid hours", () => {
  assert.deepEqual(normalizeSettings(null), { morningEnd: 11, eveningStart: 17 });
  assert.deepEqual(normalizeSettings({ morningEnd: 99, eveningStart: 1.5 }), { morningEnd: 11, eveningStart: 17 });
  assert.deepEqual(normalizeSettings({ morningEnd: 9, eveningStart: 19 }), { morningEnd: 9, eveningStart: 19 });
});

test("a standard day fills every slot with no extras", () => {
  const r = routine([
    ev("mouthwash", D, 7), full(D, 7),
    ev("floss", D, 21), full(D, 21), ev("mouthwash", D, 21),
  ]);
  assert.equal(r.done, 5);
  assert.equal(r.total, 5);
  assert.ok(r.complete);
  assert.equal(r.extras.length, 0);
});

test("midday events and repeats are extras; the routine is still complete", () => {
  const midday = full(D, 13);
  const r = routine([ev("mouthwash", D, 7), full(D, 7), midday, ev("floss", D, 21), full(D, 21), ev("mouthwash", D, 21), ev("mouthwash", D, 22)]);
  assert.ok(r.complete);
  assert.deepEqual(r.extras.map((e) => e.id).sort(), [midday.id, ev("mouthwash", D, 22).id].sort());
  assert.equal(r.roles.get(midday.id), "extra");
});

test("missing slots are reported; a partial brush does not count and becomes an extra", () => {
  const partial = full(D, 8, { steps: 4 });
  const r = routine([ev("mouthwash", D, 7), partial, ev("floss", D, 20)]);
  assert.equal(r.done, 2);
  assert.ok(!r.complete);
  assert.deepEqual(r.windows[0].slots.map((x) => x.done), [true, false]);
  assert.deepEqual(r.windows[1].slots.map((x) => x.done), [true, false, false]);
  assert.equal(r.roles.get(partial.id), "extra");
});

test("window boundaries follow settings", () => {
  const e = [ev("mouthwash", D, 10), full(D, 10)];
  assert.equal(routine(e).windows[0].done, 2);
  assert.equal(dayRoutine(e, D, { morningEnd: 9, eveningStart: 17 }, AFTER).windows[0].done, 0);
  const late = [ev("floss", D, 17), full(D, 17), ev("mouthwash", D, 17)];
  assert.equal(routine(late).windows[1].done, 3);
  assert.equal(dayRoutine(late, D, { morningEnd: 11, eveningStart: 18 }, AFTER).windows[1].done, 0);
});

test("today: open slots are not due until their window ends; done slots always count", () => {
  const day = "2026-11-20";
  const settings = DEFAULT_SETTINGS;
  const morning = [ev("mouthwash", day, 7), full(day, 7)];
  const at9 = dayRoutine([], day, settings, at(day, 9));
  assert.equal(at9.due, 0);
  const at14 = dayRoutine(morning.slice(0, 1), day, settings, at(day, 14));
  assert.equal(at14.due, 2); // morning window over: mouthwash done, brush missed
  assert.equal(at14.done, 1);
  const evening = dayRoutine([...morning, ev("floss", day, 19)], day, settings, at(day, 19, 30));
  assert.equal(evening.done, 3);
  assert.equal(evening.due, 3); // evening slots only due once done, until the day ends
});

test("routineStats counts from the first event and totals completion and extras", () => {
  const std = (d) => [ev("mouthwash", d, 7), full(d, 7), ev("floss", d, 21), full(d, 21), ev("mouthwash", d, 21)];
  const events = [...std("2026-11-18"), ...std("2026-11-19"), ev("mouthwash", "2026-11-19", 13), ev("mouthwash", "2026-11-20", 7)];
  const now = at("2026-11-21", 8);
  const r = routineStats(events, "2026-11-21", 30, DEFAULT_SETTINGS, now);
  assert.equal(r.days, 4); // 18th to 21st, not 30 days
  assert.equal(r.completeDays, 2);
  assert.equal(r.extras, 1);
  assert.equal(r.done, 5 + 5 + 1);
  assert.equal(r.due, 5 + 5 + 5 + 0); // the 20th is over, the 21st morning is still open
  assert.equal(routineStats([], "2026-11-21", 7, DEFAULT_SETTINGS).pct, null);
});
