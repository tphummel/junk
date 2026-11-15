import assert from "node:assert/strict";
import test from "node:test";
import {
  AREA_TOTALS,
  TOTALS,
  addStep,
  classify,
  dayKey,
  deriveState,
  history,
  hud,
  journalDays,
  newGame,
  parseImport,
  parseTime,
  removeStep,
  setDone,
  toExportJson,
  upcoming,
} from "../web/metroid-3/engine.js";

const T0 = new Date(2026, 10, 1, 16, 0, 0).getTime();
const MIN = 60000;

/** Complete the first n steps, one minute apart. */
function play(game, n) {
  game.steps.slice(0, n).forEach((s, i) => setDone(game, s.id, T0 + i * MIN));
  return game;
}

test("the default route is a full 100% route", () => {
  const game = newGame();
  assert.equal(game.steps.length, 114);
  assert.deepEqual(
    game.steps.map((s) => s.step),
    game.steps.map((_, i) => i + 1),
  );
  const all = play(newGame(), 114);
  const state = deriveState(all);
  assert.equal(state.percent, TOTALS.all);
  for (const key of ["missile", "super", "pb", "etank", "rtank", "beam", "suit", "item", "boss"]) {
    assert.equal(state.counts[key], TOTALS[key], key);
  }
  for (const a of state.areas) assert.equal(a.count, AREA_TOTALS[a.area], a.area);
  assert.ok(state.bosses.every((b) => b.done));
  assert.ok(state.complete);
  assert.equal(state.currentIndex, -1);
});

test("classify handles every checkpoint form", () => {
  assert.deepEqual(classify("Item: Spazer"), { cat: "beam", name: "Spazer" });
  assert.deepEqual(classify("Item: Varia Suit"), { cat: "suit", name: "Varia Suit" });
  assert.deepEqual(classify("Item: X Ray Scope"), { cat: "item", name: "X Ray Scope" });
  assert.deepEqual(classify("Item: Grappling Beam").cat, "beam");
  assert.deepEqual(classify("Boss Clear: Torizo"), { cat: "boss", name: "Torizo" });
  assert.equal(classify("Save: at ship").cat, "save");
  assert.equal(classify("Super Missile").cat, "super");
  assert.equal(classify("Zebes Escape").cat, "end");
  assert.equal(classify("Something else").cat, "custom");
});

test("progress, hud and nav follow completed steps", () => {
  const game = play(newGame(), 12);
  const state = deriveState(game);
  assert.equal(state.stepsDone, 12);
  assert.equal(state.current.step, 13);
  // Steps 1-12: Start, Ceres, Morph, M, Bomb, Boss, M, ET, Boss, SM, M, Charge.
  assert.equal(state.counts.missile, 3);
  assert.equal(state.counts.etank, 1);
  assert.equal(state.percent, 8);
  assert.equal(hud(state).energy, 199);
  assert.equal(hud(state).missiles, 15);
  assert.equal(state.fixed.morphingball.step, 3);
  assert.equal(state.fixed.chargebeam.step, 12);
  assert.deepEqual(
    upcoming(game, state).map((s) => s.step),
    [13, 14, 15, 16, 17, 18],
  );
  const h = history(game, 3);
  assert.deepEqual(
    h.map((x) => x.step.step),
    [12, 11, 10],
  );
  assert.equal(h[0].gapMs, MIN);
});

test("steps can be added, removed and renumbered", () => {
  const game = play(newGame(), 3);
  const extra = addStep(game, { checkpoint: "Missile", area: "Brinstar", ts: T0 + 10 * MIN });
  assert.equal(extra.step, 4);
  assert.equal(game.steps.length, 115);
  assert.equal(deriveState(game).current.step, 5);
  removeStep(game, extra.id);
  assert.equal(game.steps.length, 114);
  assert.equal(game.steps[3].step, 4);
  const blank = newGame({ template: "blank" });
  assert.equal(blank.steps.length, 0);
  assert.equal(deriveState(blank).percent, 0);
  assert.equal(deriveState(blank).complete, false);
});

test("journal groups by local day with free-form entries", () => {
  const game = newGame();
  setDone(game, game.steps[0].id, T0);
  setDone(game, game.steps[3].id, T0 + MIN);
  setDone(game, game.steps[4].id, T0 + 25 * 60 * 60000);
  game.entries.push({ id: "e1", ts: T0 + 2 * MIN, title: "Session 1", body: "Good start." });
  const days = journalDays(game);
  assert.equal(days.length, 2);
  assert.equal(days[0].day, dayKey(T0));
  assert.equal(days[0].items.length, 3);
  assert.equal(days[0].items[2].kind, "entry");
  assert.equal(days[0].pickups, 1);
});

test("parseTime accepts spreadsheet and ISO forms", () => {
  assert.equal(parseTime("2026-11-01 16:48:40.028"), new Date(2026, 10, 1, 16, 48, 40, 28).getTime());
  assert.equal(parseTime("11/1/2026 4:48:40 PM"), new Date(2026, 10, 1, 16, 48, 40).getTime());
  assert.equal(parseTime("2026-11-01T16:48:40Z"), Date.UTC(2026, 10, 1, 16, 48, 40));
  assert.equal(parseTime(""), null);
  assert.equal(parseTime("nope"), null);
});

test("JSON export round-trips through import", () => {
  const game = play(newGame({ name: "Run A" }), 20);
  game.entries.push({ id: "e1", ts: T0, title: "Note", body: "hello" });
  const text = JSON.stringify(toExportJson([game]));
  const [back] = parseImport(text, "x.json");
  assert.equal(back.id, game.id);
  assert.equal(back.name, "Run A");
  assert.equal(back.steps.length, 114);
  assert.equal(back.steps[5].ts, game.steps[5].ts);
  assert.equal(back.steps[50].ts, null);
  assert.equal(back.entries[0].body, "hello");
  assert.equal(deriveState(back).percent, deriveState(game).percent);
});

test("CSV import reads the spreadsheet Entry columns", () => {
  const csv = [
    ",,,,,,,,,,,,",
    "Status,Timestamp,IGT,Step,%,Checkpoint,Note,Area,Seq,Room",
    'complete,2026-11-01 16:48:40.028,,1,0,Game Start,,,,',
    'complete,2026-11-01 16:52:48.911,,2,1,Item: Morphing Ball,,Brinstar,,Morph Ball Room',
    'complete,2026-11-01 16:53:27.946,,3,2,Missile,"right of morph, ""up""",Brinstar,1,First Missile Room',
    "incomplete,,,4,,Item: Bomb,,Crateria,,Bomb Torizo Room",
  ].join("\r\n");
  const [game] = parseImport(csv, "Super Metroid.csv");
  assert.equal(game.name, "Super Metroid");
  assert.equal(game.steps.length, 4);
  assert.equal(game.steps[2].note, 'right of morph, "up"');
  assert.equal(game.steps[2].seq, 1);
  assert.equal(game.steps[3].ts, null);
  assert.equal(deriveState(game).percent, 2);
});

test("import rejects things that are not games", () => {
  assert.throws(() => parseImport("{not json"), /valid JSON/);
  assert.throws(() => parseImport('{"hello": 1}'), /not a Metroid 3 export/);
  assert.throws(() => parseImport("a,b\n1,2"), /Checkpoint/);
});

test("session events give play time and session-aware history gaps", async () => {
  const { sessions, inferSessions, fmtPlay } = await import("../web/metroid-3/engine.js");
  const game = newGame();
  // Day 1: two steps 2 min apart. Day 2: two steps 3 min apart.
  const D2 = T0 + 24 * 60 * MIN;
  [T0, T0 + 2 * MIN, D2, D2 + 3 * MIN].forEach((t, i) => setDone(game, game.steps[i].id, t));
  // No events: legacy behaviour, raw gap.
  assert.equal(history(game, 4)[1].gapMs, D2 - (T0 + 2 * MIN));
  game.events = inferSessions(game, 30 * MIN);
  assert.equal(game.events.length, 4);
  const list = sessions(game);
  assert.deepEqual(list.map((x) => x.ms), [2 * MIN, 3 * MIN]);
  const state = deriveState(game);
  assert.equal(state.playMs, 5 * MIN);
  assert.equal(state.playing, null);
  assert.equal(fmtPlay(state), "5 min");
  const h = history(game, 4);
  assert.equal(h[0].gapMs, 3 * MIN); // same session
  assert.equal(h[1].fresh, true); // crossed sessions
  assert.equal(h[1].gapMs, null);
  const days = journalDays(game);
  assert.equal(days[0].playMs, 2 * MIN);
  assert.equal(days[0].items.filter((i) => i.kind === "event").length, 2);
});

test("open sessions run to now; stray events are ignored; events round-trip", async () => {
  const { sessions } = await import("../web/metroid-3/engine.js");
  const game = newGame();
  game.events = [
    { id: "a", ts: T0 - MIN, kind: "stop" }, // stray stop
    { id: "b", ts: T0, kind: "start" },
    { id: "c", ts: T0 + MIN, kind: "start" }, // double start
  ];
  const list = sessions(game, T0 + 10 * MIN);
  assert.equal(list.length, 1);
  assert.equal(list[0].end, null);
  assert.equal(list[0].ms, 10 * MIN);
  assert.ok(deriveState(game, T0 + 10 * MIN).playing);
  const [back] = parseImport(JSON.stringify(toExportJson([game])));
  assert.equal(back.events.length, 3);
  assert.equal(back.events[1].ts, T0);
});

test("in-game time is total minutes", async () => {
  const { parseIgt, fmtIgt } = await import("../web/metroid-3/engine.js");
  assert.equal(parseIgt("00:52:00"), 52);
  assert.equal(parseIgt("0:52"), 52);
  assert.equal(parseIgt("1:05"), 65);
  assert.equal(parseIgt("36' 59\""), 36);
  assert.equal(parseIgt("52"), 52);
  assert.equal(parseIgt("52 min"), 52);
  assert.equal(parseIgt(52.4), 52);
  assert.equal(parseIgt(""), null);
  assert.equal(parseIgt("abc"), null);
  assert.equal(fmtIgt(125), "125 min");
  const game = newGame();
  const save = game.steps.find((s) => s.checkpoint.startsWith("Save"));
  setDone(game, save.id, T0);
  save.igt = parseIgt("0:52");
  const [back] = parseImport(JSON.stringify(toExportJson([game])));
  assert.equal(back.steps.find((s) => s.checkpoint.startsWith("Save")).igt, 52);
  assert.equal(deriveState(back).igt, 52);
});

test("Ceres Escape's countdown reading goes to the log, not IGT", () => {
  const csv = [
    "Timestamp,IGT,Checkpoint",
    `2026-11-01 16:50:58,"36' 59""",Ceres Escape`,
    "2026-11-13 16:16:50,00:52:00,Save: at ship",
  ].join("\n");
  const [game] = parseImport(csv, "x.csv");
  assert.equal(game.steps[0].igt, null);
  assert.equal(game.steps[0].log, `Countdown timer: 36' 59"`);
  assert.equal(game.steps[1].igt, 52);
});
