// Tests for the pure logic of web/toothup/logic.js (routine steps, daily goals, streaks, stats, calendar, import/export).
// Times are built as UTC with offset 0 so results do not depend on the machine's time zone.
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS, GOALS, STEPS, TOTAL_SECONDS, addDays, addMonths, buildExport, currentStreak, daysBetween, dayGoals, eventDay,
  formatClock, groupByDay, longestStreak, makeEvent, mergeEvents, monthGrid, normalizeEvent, normalizeEvents, normalizeSettings,
  parseImport, rangeStats, reminderStatus,
} from "../web/toothup/logic.js";

const at = (key, h = 8) => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d, h);
};
const S = DEFAULT_SETTINGS; // day starts at 4:00
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
  assert.equal(eventDay(makeEvent([], "floss", t, { offset: -300 }), S), "2026-11-19");
  assert.equal(eventDay(makeEvent([], "floss", t, { offset: 540 }), S), "2026-11-20");
  // Brushing in New York at 21:00 and then in Tokyo the next morning gives two events on two days, not a shifted pair.
  const ny = makeEvent([], "brush", Date.UTC(2026, 10, 20, 2), { seconds: 125, steps: 9, offset: -300 });
  const tokyo = makeEvent([], "brush", Date.UTC(2026, 10, 20, 22), { seconds: 125, steps: 9, offset: 540 });
  assert.deepEqual([...groupByDay([ny, tokyo], S).keys()], ["2026-11-19", "2026-11-21"]);
});

test("the day rolls over at 4am, not midnight: a 12:30am routine belongs to the night before", () => {
  const late = ev("floss", "2026-11-21", 0);
  const brushed = brush("2026-11-21", 0);
  assert.equal(S.dayStartsAt, 4);
  assert.equal(eventDay(late, S), "2026-11-20");
  assert.equal(eventDay(brushed, S), "2026-11-20");
  assert.equal(eventDay(ev("floss", "2026-11-21", 3), S), "2026-11-20");
  assert.equal(eventDay(ev("floss", "2026-11-21", 4), S), "2026-11-21");
  // The late brush completes the previous day instead of starting a new one.
  const g = dayGoals(groupByDay([brush("2026-11-20", 7), brushed], S).get("2026-11-20"));
  assert.ok(g.complete);
});

test("the cutoff applies in the local clock of wherever you were", () => {
  // 12:30am in Tokyo on the 21st is 15:30 UTC on the 20th; it still belongs to the 20th there.
  const e = makeEvent([], "floss", Date.UTC(2026, 10, 20, 15, 30), { offset: 540 });
  assert.equal(eventDay(e, S), "2026-11-20");
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
  assert.equal(currentStreak(list, "2026-11-19", S), 3);
  assert.equal(currentStreak(list, "2026-11-20", S), 3); // today not finished yet
  assert.equal(currentStreak(list, "2026-11-21", S), 0);
  assert.equal(longestStreak(list, S), 3);
  assert.equal(longestStreak([], S), 0);
});

test("rangeStats: counts from the first event, ignores an unfinished today, tracks floss and mouthwash goals", () => {
  const std = (d) => [...fullDay(d), ev("floss", d, 21), ev("mouthwash", d, 7), ev("mouthwash", d, 21)];
  const events = [...std("2026-11-18"), ...fullDay("2026-11-19"), brush("2026-11-20", 7), ev("floss", "2026-11-19", 13), ev("floss", "2026-11-19", 14)];
  const r = rangeStats(events, "2026-11-20", 30, S); // the 20th has one brush, so it is still open
  assert.equal(r.days, 2); // the 18th and 19th, not 30 days
  assert.equal(r.fullDays, 2);
  assert.equal(r.brushPct, 100);
  assert.equal(r.flossDays, 2);
  assert.equal(r.mouthwashDays, 1);
  assert.equal(r.extras, 1); // the second floss on the 19th (the first one meets the goal)
  assert.equal(r.avgSeconds, 125);
  assert.equal(rangeStats(events, "2026-11-20", 1, S).days, 0);
  assert.equal(rangeStats([], "2026-11-20", 7, S).brushPct, null);
});

test("rangeStats: a missed brush lowers the brushing percentage", () => {
  const events = [...fullDay("2026-11-18"), brush("2026-11-19")];
  const r = rangeStats(events, "2026-11-20", 7, S);
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

const custom = {
  dayStartsAt: 2,
  reminders: { dentist: { everyMonths: 4, last: "2026-09-01" }, head: { everyMonths: 2, last: null } },
};

test("export then import round-trips events; merge dedupes by id", () => {
  const list = [brush("2026-11-19"), ev("floss", "2026-11-20"), ev("mouthwash", "2026-11-20", 21)];
  const { events, skipped, settings } = parseImport(JSON.stringify(buildExport(list, custom)));
  assert.deepEqual(events, list);
  assert.equal(skipped, 0);
  assert.deepEqual(settings, custom); // settings, reminders included, travel with the data
  const merged = mergeEvents(list, [...events, brush("2026-11-21")]);
  assert.equal(merged.added, 1);
  assert.equal(merged.events.length, 4);
});

test("parseImport skips bad events and rejects other files", () => {
  const good = brush("2026-11-19");
  const file = (extra) => JSON.stringify({ app: "toothup", settings: S, events: [good], ...extra });
  assert.deepEqual(parseImport(file({ events: [good, { nope: true }] })), { events: [good], skipped: 1, settings: S });
  assert.throws(() => parseImport("not json"), /valid JSON/);
  assert.throws(() => parseImport("[]"), /toothup export/);
  assert.throws(() => parseImport(file({ app: "other" })), /toothup export/);
  assert.throws(() => parseImport(file({ settings: undefined })), /Invalid settings/);
  assert.throws(() => parseImport(file({ settings: { dayStartsAt: 9 } })), /Invalid settings/);
  assert.throws(() => parseImport(file({ settings: { dayStartsAt: 4 } })), /Invalid settings/); // reminders missing
  assert.throws(() => parseImport(file({ events: undefined })), /No events/);
});

test("normalizeSettings accepts valid settings and rejects everything else", () => {
  assert.deepEqual(normalizeSettings(S), S);
  assert.deepEqual(normalizeSettings({ ...S, dayStartsAt: 0, extra: 1 }), { ...S, dayStartsAt: 0 });
  assert.deepEqual(normalizeSettings(custom), custom);
  const withHead = (head) => ({ ...S, reminders: { ...S.reminders, head } });
  for (const bad of [
    null, {}, { dayStartsAt: 4 }, { ...S, dayStartsAt: 7 }, { ...S, dayStartsAt: -1 }, { ...S, dayStartsAt: 4.5 }, { ...S, dayStartsAt: "4" },
    { ...S, reminders: undefined }, { ...S, reminders: { dentist: S.reminders.dentist } },
    withHead({ everyMonths: 0, last: null }), withHead({ everyMonths: 37, last: null }), withHead({ everyMonths: 1.5, last: null }),
    withHead({ everyMonths: 3 }), withHead({ everyMonths: 3, last: "2026-02-30" }), withHead({ everyMonths: 3, last: "11/21/2026" }),
  ]) assert.equal(normalizeSettings(bad), null);
});

test("addMonths clamps to the end of shorter months and crosses years", () => {
  assert.equal(addMonths("2026-11-21", 3), "2027-02-21");
  assert.equal(addMonths("2026-11-21", 6), "2027-05-21");
  assert.equal(addMonths("2026-08-31", 6), "2027-02-28");
  assert.equal(addMonths("2027-08-31", 6), "2028-02-29"); // leap year
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-12-15", 12), "2027-12-15");
});

test("daysBetween counts whole days, including across a DST change", () => {
  assert.equal(daysBetween("2026-11-21", "2026-11-21"), 0);
  assert.equal(daysBetween("2026-11-21", "2026-11-22"), 1);
  assert.equal(daysBetween("2026-11-21", "2026-11-20"), -1);
  assert.equal(daysBetween("2026-11-01", "2026-11-02"), 1); // US clocks change on Nov 1, 2026
  assert.equal(daysBetween("2026-03-01", "2027-03-01"), 365);
});

test("reminderStatus counts down to the due date, goes negative when overdue, and is null with no date", () => {
  const dentist = { everyMonths: 6, last: "2026-05-21" };
  assert.deepEqual(reminderStatus(dentist, "2026-11-20"), { due: "2026-11-21", days: 1 });
  assert.deepEqual(reminderStatus(dentist, "2026-11-21"), { due: "2026-11-21", days: 0 });
  assert.deepEqual(reminderStatus(dentist, "2026-11-26"), { due: "2026-11-21", days: -5 });
  assert.deepEqual(reminderStatus({ everyMonths: 3, last: "2026-11-21" }, "2026-11-21"), { due: "2027-02-21", days: 92 });
  assert.equal(reminderStatus({ everyMonths: 3, last: null }, "2026-11-21"), null);
});

test("dayStartsAt moves the cutoff: at 0 the day is midnight to midnight, at 6 a 5am routine still belongs to the night before", () => {
  const early = ev("floss", "2026-11-21", 5);
  assert.equal(eventDay(early, S), "2026-11-21");
  assert.equal(eventDay(early, { dayStartsAt: 6 }), "2026-11-20");
  const lateNight = ev("floss", "2026-11-21", 0);
  assert.equal(eventDay(lateNight, { dayStartsAt: 0 }), "2026-11-21");
  assert.equal(eventDay(lateNight, S), "2026-11-20");
  // Changing the setting regroups the same events, and streaks and stats follow.
  const events = [brush("2026-11-20", 7), brush("2026-11-21", 1)];
  assert.equal(longestStreak(events, S), 1); // both on the 20th
  assert.equal(longestStreak(events, { dayStartsAt: 0 }), 0); // one brush on each day
});

test("formatClock rounds up", () => {
  assert.equal(formatClock(29.2), "0:30");
  assert.equal(formatClock(120), "2:00");
  assert.equal(formatClock(-1), "0:00");
});
