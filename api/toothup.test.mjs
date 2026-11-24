// Tests for the pure logic of web/toothup/logic.js (routine steps, daily goals, streaks, stats, calendar, import/export).
// Times are built as UTC with offset 0 so results do not depend on the machine's time zone.
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS, GOALS, STEPS, TOTAL_SECONDS, addDays, addMonths, backupDue, buildExport, currentStreak, daysBetween, dayGoals, eventDay,
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

// ---------- Apple Health import ----------
import { deflateRawSync } from "node:zlib";
import { brushFromRecord, parseHealthDate, readHealthExport, scanBrushes } from "../web/toothup/health.js";

const rec = (start, end, type = "HKCategoryTypeIdentifierToothbrushingEvent") =>
  `<Record type="${type}" sourceName="Tom's Apple Watch" startDate="${start}" endDate="${end}" value="HKCategoryValueNotApplicable"><MetadataEntry key="HKTimeZone" value="America/New_York"/></Record>`;
const xml = (...records) => `<?xml version="1.0"?><HealthData locale="en_US">${records.join("\n")}</HealthData>`;
const R1 = rec("2024-03-05 07:31:02 -0500", "2024-03-05 07:33:12 -0500");
const R2 = rec("2024-03-05 21:00:00 -0500", "2024-03-05 21:00:30 -0500");

test("parseHealthDate: keeps the UTC offset where the brush happened", () => {
  assert.deepEqual(parseHealthDate("2024-03-05 07:31:02 -0500"), { ms: Date.UTC(2024, 2, 5, 12, 31, 2), offset: -300 });
  assert.deepEqual(parseHealthDate("2024-03-05 07:31:02 +0530"), { ms: Date.UTC(2024, 2, 5, 2, 1, 2), offset: 330 });
  assert.equal(parseHealthDate("March 5"), null);
});

test("brushFromRecord: 60s or more is a full brush, shorter is a partial one, bad dates are rejected", () => {
  assert.deepEqual(brushFromRecord(R1), { id: `s${Date.UTC(2024, 2, 5, 12, 31, 2)}`, type: "brush", start: Date.UTC(2024, 2, 5, 12, 31, 2), offset: -300, seconds: 130, steps: 9 });
  assert.equal(brushFromRecord(R2).steps, 4);
  assert.equal(brushFromRecord(rec("2024-03-05 07:31:02 -0500", "2024-03-05 07:30:00 -0500")), null);
  assert.equal(normalizeEvent(brushFromRecord(R1))?.id, brushFromRecord(R1).id);
});

test("scanBrushes: ignores other record types and carries a split tag into the next chunk", () => {
  const text = xml(rec("2024-03-05 08:00:00 -0500", "2024-03-05 08:01:00 -0500", "HKQuantityTypeIdentifierStepCount"), R1);
  assert.equal(scanBrushes(text).events.length, 1);
  const cut = text.indexOf("<Record", text.indexOf("<Record") + 1) + 20;
  const a = scanBrushes(text.slice(0, cut));
  assert.equal(a.events.length, 0);
  assert.equal(scanBrushes(a.rest + text.slice(cut)).events.length, 1);
});

/** A one-file zip like Health's export.zip: apple_health_export/export.xml, deflated, with a data descriptor-free layout. */
function makeZip(name, content) {
  const data = deflateRawSync(Buffer.from(content));
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(0, 42);
  const dirOffset = local.length + n.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + n.length, 12); end.writeUInt32LE(dirOffset, 16);
  return new Blob([local, n, data, central, n, end]);
}

test("readHealthExport: reads export.xml from a zip or directly, deduplicating repeats", async () => {
  const text = xml(R1, R1, R2);
  for (const file of [makeZip("apple_health_export/export.xml", text), new Blob([text])]) {
    const { events } = await readHealthExport(file);
    assert.deepEqual(events.map((e) => e.steps), [9, 4]);
  }
  const merged = mergeEvents(brushOnly(), (await readHealthExport(new Blob([xml(R1)]))).events);
  assert.equal(merged.added, 0);
  await assert.rejects(readHealthExport(makeZip("apple_health_export/export_cda.xml", text)), /No export.xml/);
  await assert.rejects(readHealthExport(new Blob(["PK nope"])), /Not a zip/);
});
function brushOnly() {
  return [brushFromRecord(R1)];
}

// ---------- Nomie import ----------
import { parseNomie } from "../web/toothup/nomie.js";

const nomie = (...notes) =>
  JSON.stringify({ nomie: { number: "5.6.4" }, events: notes.map((note, i) => ({ _id: `e${i}`, note, start: 1700000000000 + i * 1000, end: 1700000001000 + i * 1000, offset: 480 })) });

test("parseNomie: tags become floss and mouthwash events, with the offset flipped to east positive", () => {
  const { events, skipped } = parseNomie(nomie("#floss_teeth", "#mouthwash ", "#sneeze"));
  assert.equal(skipped, 0);
  assert.deepEqual(events, [
    { id: "f1700000000000", type: "floss", start: 1700000000000, offset: -480 },
    { id: "m1700000001000", type: "mouthwash", start: 1700000001000, offset: -480 },
  ]);
  assert.ok(events.every((e) => normalizeEvent(e)));
});

test("parseNomie: one note can hold both, a (0) value is not done, other tags and look-alike tags are ignored", () => {
  const both = parseNomie(nomie("#floss_and_mouthwash #floss_teeth(1) #mouthwash(1)"));
  assert.deepEqual(both.events.map((e) => e.type).sort(), ["floss", "mouthwash"]);
  assert.deepEqual(parseNomie(nomie("#floss_and_mouthwash #floss_teeth(0) #mouthwash(1)")).events.map((e) => e.type), ["mouthwash"]);
  assert.deepEqual(parseNomie(nomie("#peed #floss_teeth")).events.map((e) => e.type), ["floss"]);
  assert.equal(parseNomie(nomie("#floss_teeth_maybe", "#mouthwashes", "note #floss")).events.length, 0);
});

test("parseNomie: merges idempotently and rejects other files", () => {
  const { events } = parseNomie(nomie("#floss_teeth", "#mouthwash"));
  assert.equal(mergeEvents(events, parseNomie(nomie("#floss_teeth", "#mouthwash")).events).added, 0);
  assert.throws(() => parseNomie("{}"), /Not a Nomie export/);
  assert.throws(() => parseNomie("nope"), /Not valid JSON/);
});

test("backupDue is true once a month has passed since the last backup", () => {
  assert.equal(backupDue("2026-10-22", "2026-11-21", true), false);
  assert.equal(backupDue("2026-10-22", "2026-11-22", true), true);
  assert.equal(backupDue("2026-01-31", "2026-02-28", true), true); // clamped to the end of the shorter month
  assert.equal(backupDue(null, "2026-11-22", true), true); // data but never backed up
  assert.equal(backupDue(null, "2026-11-22", false), false); // nothing to back up
});

// ---------- monthly and annual reports ----------
import { addMonthKey, firstMonth, firstYear, monthRange, monthReport, periodStats, yearReport } from "../web/toothup/logic.js";
import { annualReportHtml, heatmapSvg } from "../web/toothup/report.js";

test("monthRange and addMonthKey handle year boundaries and leap years", () => {
  assert.deepEqual(monthRange("2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  assert.equal(addMonthKey("2026-01", -1), "2025-12");
  assert.equal(addMonthKey("2026-12", 1), "2027-01");
});

test("monthReport: stats for the month, a comparison with the month before, and short days", () => {
  const events = [
    ...fullDay("2026-10-30"), ...fullDay("2026-10-31"),
    ...fullDay("2026-11-01"), brush("2026-11-02"), // the 2nd has one brush
    ...fullDay("2026-11-04"), // the 3rd has none
  ];
  const r = monthReport(events, "2026-11", "2026-11-10", S);
  assert.equal(r.fullDays, 2);
  assert.equal(r.bestStreak.length, 1);
  assert.deepEqual(r.short.map((d) => [d.day, d.level]), [["2026-11-02", 1], ["2026-11-03", 0], ...["05", "06", "07", "08", "09"].map((d) => [`2026-11-${d}`, 0])]);
  assert.equal(r.prev.brushPct, 100);
  assert.equal(r.brushCount, 5);
  assert.equal(firstMonth(events, S), "2026-10");
  assert.equal(firstYear(events, S), 2026);
  assert.equal(firstMonth([], S), null);
});

test("periodStats: stops at today, ignores an unfinished today, and finds the best streak", () => {
  const events = [...fullDay("2026-11-01"), ...fullDay("2026-11-02"), ...fullDay("2026-11-03"), brush("2026-11-05"), ...fullDay("2026-11-06"), brush("2026-11-07")];
  const r = periodStats(events, "2026-11-01", "2026-11-30", "2026-11-07", S);
  assert.equal(r.days, 6); // today (the 7th) has one brush, so it is not counted yet
  assert.deepEqual(r.bestStreak, { length: 3, start: "2026-11-01", end: "2026-11-03" });
  assert.equal(r.levels.get("2026-11-07"), 1);
  assert.equal(r.levels.has("2026-11-08"), false);
  assert.equal(r.weekdays.reduce((t, w) => t + w.days, 0), 6);
});

test("yearReport: months, best and worst month; empty years are empty", () => {
  const events = [...fullDay("2026-02-10"), ...fullDay("2026-02-11"), brush("2026-03-01"), brush("2026-03-02", 21)];
  const r = yearReport(events, 2026, "2026-04-01", S);
  assert.equal(r.months.length, 12);
  assert.equal(r.months[1].brushPct, 11); // 2 full days of the 19 counted from Feb 10
  assert.equal(r.months[0].brushPct, null); // before the first event
  assert.equal(r.bestMonth.ym, "2026-02");
  assert.equal(r.worstMonth.ym, "2026-03");
  assert.equal(yearReport(events, 2025, "2026-04-01", S).days, 0);
});

test("annualReportHtml: standalone page with no scripts or external files, and an empty-year fallback", () => {
  const events = [...fullDay("2026-02-10"), ...fullDay("2026-02-11"), ev("floss", "2026-02-10")];
  const html = annualReportHtml(yearReport(events, 2026, "2026-02-12", S), { generated: "2026-02-12" });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /My 2026 in teeth/);
  assert.match(html, /100<small>%/);
  assert.doesNotMatch(html, /<script|<link|src=|https?:\/\//);
  assert.equal((heatmapSvg(yearReport(events, 2026, "2026-04-01", S)).match(/<rect/g) || []).length, 365);
  assert.match(annualReportHtml(yearReport(events, 2024, "2026-04-01", S)), /Nothing to show for 2024/);
});
