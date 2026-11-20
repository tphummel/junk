// Tests for the pure logic of web/toothup/logic.js (routine steps, daily goals, streaks, stats, calendar, import/export).
// Times are built as UTC with offset 0 so results do not depend on the machine's time zone.
import assert from "node:assert/strict";
import test from "node:test";
import {
  GOALS, STEPS, TOTAL_SECONDS, addDays, buildExport, currentStreak, dayGoals, eventDay, formatClock, groupByDay,
  longestStreak, makeEvent, mergeEvents, monthGrid, normalizeEvent, normalizeEvents, parseImport, rangeStats,
} from "../web/toothup/logic.js";

const at = (key, h = 8) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d, h);
};
/** A full brush by default; pass opts to override. */
const brush = (key, h = 8, opts = {}) => makeEvent([], "brush", at(key, h), { seconds: 125, steps: 9, offset: 0, ...opts });
const ev = (type, key, h = 8) => makeEvent([], type, at(key, h), { offset: 0 });
/** The two standard brushes of a day. */
const fullDay = (key) => [brush(key, 7), brush(key, 21)];

test("addDays crosses month and year boundaries", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
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

test("makeEvent: ids come from type and time, a taken id moves the start by 1 ms, only brushes carry seconds and steps", () => {
  assert.deepEqual(makeEvent([], "floss", 2000, { offset: 60 }), { id: "f2000", type: "floss", start: 2000, offset: 60 });
  assert.deepEqual(makeEvent([], "brush", 1000, { seconds: 90, steps: 8, offset: 0 }), { id: "s1000", type: "brush", start: 1000, offset: 0, seconds: 90, steps: 8 });
  const taken = [makeEvent([], "floss", 1000, { offset: 0 })];
  assert.equal(makeEvent(taken, "floss", 1000, { offset: 0 }).start, 1001);
  assert.equal(makeEvent(taken, "mouthwash", 1000, { offset: 0 }).start, 1000);
});

test("normalizeEvent keeps well-formed events and rejects everything else", () => {
  const good = { id: "s1", type: "brush", start: 1000, offset: -300, seconds: 125, steps: 9 };
  assert.deepEqual(normalizeEvent(good), good);
  assert.deepEqual(normalizeEvent({ id: "f1", type: "floss", start: 5, offset: 0, seconds: 9, steps: 3 }), { id: "f1", type: "floss", start: 5, offset: 0 });
  for (const bad of [
    null, {}, { ...good, id: "" }, { ...good, type: "gargle" }, { ...good, start: "x" }, { ...good, start: 0 },
    { ...good, offset: undefined }, { ...good, offset: 900 }, { ...good, seconds: -1 }, { ...good, steps: 10 }, { ...good, steps: undefined },
  ]) assert.equal(normalizeEvent(bad), null);
  assert.deepEqual(normalizeEvents([good, { nope: true }]), { events: [good], skipped: 1 });
});

test("events stay on the day they happened when the time zone changes", () => {
  // Same moment, 03:00 UTC. In New York (UTC-5) it is the evening of the 19th; in Tokyo (UTC+9) it is noon on the 20th.
  const t = Date.UTC(2026, 10, 20, 3);
  assert.equal(eventDay(makeEvent([], "floss", t, { offset: -300 })), "2026-11-19");
  assert.equal(eventDay(makeEvent([], "floss", t, { offset: 540 })), "2026-11-20");
  // Brushing in New York at 21:00 and then in Tokyo the next morning gives two events on two days, not a shifted pair.
  const ny = makeEvent([], "brush", Date.UTC(2026, 10, 20, 2), { seconds: 125, steps: 9, offset: -300 });
  const tokyo = makeEvent([], "brush", Date.UTC(2026, 10, 20, 22), { seconds: 125, steps: 9, offset: 540 });
  assert.deepEqual([...groupByDay([ny, tokyo]).keys()], ["2026-11-19", "2026-11-21"]);
});

test("a day is complete with two full brushes; floss and mouthwash are tracked on top", () => {
  const g = dayGoals([brush("2026-11-18", 7), brush("2026-11-18", 21)]);
  assert.ok(g.complete);
  assert.deepEqual(g.done, { brush: 2, floss: 0, mouthwash: 0 });
  assert.equal(g.extras, 0);
  const all = dayGoals([
    ev("mouthwash", "2026-11-18", 7), brush("2026-11-18", 7), ev("floss", "2026-11-18", 20), brush("2026-11-18", 21), ev("mouthwash", "2026-11-18", 21),
  ]);
  assert.deepEqual(all.done, { brush: GOALS.brush, floss: GOALS.floss, mouthwash: GOALS.mouthwash });
  assert.equal(all.extras, 0);
});

test("anything beyond a goal, and partial brushes, are extras and do not break completion", () => {
  const partial = brush("2026-11-18", 8, { steps: 4 });
  const midday = brush("2026-11-18", 13);
  const g = dayGoals([brush("2026-11-18", 7), midday, brush("2026-11-18", 21), partial, ev("floss", "2026-11-18"), ev("floss", "2026-11-18", 13)]);
  assert.ok(g.complete);
  assert.equal(g.extras, 3); // third brush, partial brush, second floss
  assert.equal(g.roles.get(partial.id), "extra");
  // Goals fill in time order: the 7:00 and 13:00 brushes count and the 21:00 one is the extra.
  assert.deepEqual([midday.id, brush("2026-11-18", 21).id].map((id) => g.roles.get(id)), ["goal", "extra"]);
});

test("a partial brush does not count toward the key goal", () => {
  const g = dayGoals([brush("2026-11-18", 7), brush("2026-11-18", 21, { steps: 8 })]);
  assert.ok(!g.complete);
  assert.equal(g.done.brush, 1);
});

test("streaks count days with both brushes", () => {
  const list = [
    ...["2026-11-14", "2026-11-15", "2026-11-17", "2026-11-18", "2026-11-19"].flatMap(fullDay),
    brush("2026-11-16"), ev("floss", "2026-11-16"), // only one brush: breaks the streak
  ];
  assert.equal(currentStreak(list, "2026-11-19"), 3);
  assert.equal(currentStreak(list, "2026-11-20"), 3); // today not finished yet
  assert.equal(currentStreak(list, "2026-11-21"), 0);
  assert.equal(longestStreak(list), 3);
  assert.equal(longestStreak([]), 0);
});

test("rangeStats: counts from the first event, ignores an unfinished today, tracks floss and mouthwash goals", () => {
  const std = (d) => [...fullDay(d), ev("floss", d, 21), ev("mouthwash", d, 7), ev("mouthwash", d, 21)];
  const events = [...std("2026-11-18"), ...fullDay("2026-11-19"), brush("2026-11-20", 7), ev("floss", "2026-11-19", 13), ev("floss", "2026-11-19", 14)];
  const r = rangeStats(events, "2026-11-20", 30); // the 20th has one brush, so it is still open
  assert.equal(r.days, 2); // the 18th and 19th, not 30 days
  assert.equal(r.fullDays, 2);
  assert.equal(r.brushPct, 100);
  assert.equal(r.flossDays, 2);
  assert.equal(r.mouthwashDays, 1);
  assert.equal(r.extras, 1); // the second floss on the 19th (the first one meets the goal)
  assert.equal(r.avgSeconds, 125);
  assert.equal(rangeStats(events, "2026-11-20", 1).days, 0);
  assert.equal(rangeStats([], "2026-11-20", 7).brushPct, null);
});

test("rangeStats: a missed brush lowers the brushing percentage", () => {
  const events = [...fullDay("2026-11-18"), brush("2026-11-19")];
  const r = rangeStats(events, "2026-11-20", 7);
  assert.equal(r.days, 2);
  assert.equal(r.brushPct, 75);
  assert.equal(r.fullDays, 1);
});

test("monthGrid pads to whole Sunday-first weeks", () => {
  const weeks = monthGrid(2026, 10); // November 2026 starts on a Sunday
  assert.equal(weeks[0][0], "2026-11-01");
  assert.equal(weeks.at(-1).at(-1), null);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.equal(monthGrid(2026, 11)[0].indexOf("2026-12-01"), 2); // Dec 2026 starts on a Tuesday
});

test("export then import round-trips events; merge dedupes by id", () => {
  const list = [brush("2026-11-19"), ev("floss", "2026-11-20"), ev("mouthwash", "2026-11-20", 21)];
  const { events, skipped } = parseImport(JSON.stringify(buildExport(list)));
  assert.deepEqual(events, list);
  assert.equal(skipped, 0);
  const merged = mergeEvents(list, [...events, brush("2026-11-21")]);
  assert.equal(merged.added, 1);
  assert.equal(merged.events.length, 4);
});

test("parseImport skips bad events and rejects other files", () => {
  const good = brush("2026-11-19");
  assert.deepEqual(parseImport(JSON.stringify({ app: "toothup", events: [good, { nope: true }] })), { events: [good], skipped: 1 });
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
