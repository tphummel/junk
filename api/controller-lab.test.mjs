// Tests for web/controller-lab/: registering controllers and attributing their inputs. Fake pads stand in for
// navigator.getGamepads(); no browser needed. Run with `npm test`.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { classifyResult, clamp01, describeHaptics, effectParams, EFFECT_TYPES, MAX_DELAY_MS, MAX_DURATION_MS, playSteps, PRESETS, stopHaptics } from "../web/controller-lab/haptics.js";
import { approxBits, clock, describeEnvironment, parsePadId, unavailable } from "../web/controller-lab/deviceinfo.js";
import { axisName, buttonName } from "../web/controller-lab/names.js";
import { createRegistry, exportJson, summarize } from "../web/controller-lab/registry.js";
import { controllerReport, duration, formatEvent, seconds, summaryText, transcriptText } from "../web/controller-lab/transcript.js";

/** A fake pad. `down` lists pressed button indexes (value 1); `axes` its axis values. */
function pad(index, { down = [], axes = [0, 0, 0, 0], id = `Pad ${index} (STANDARD GAMEPAD)`, mapping = "standard", connected = true, buttons = 17, values = {}, timestamp, extras = {}, touched = [] } = {}) {
  return {
    index, id, mapping, connected, axes, timestamp, ...extras,
    buttons: Array.from({ length: buttons }, (_, i) => ({ pressed: down.includes(i), value: values[i] ?? (down.includes(i) ? 1 : 0), touched: touched.includes(i) })),
  };
}

/** Run one frame. */
let frame = 0;
const tick = (reg, pads, now) => reg.update(pads, now, ++frame);

test("names: standard controls are named, other mappings fall back to numbers", () => {
  assert.equal(buttonName("standard", 0), "A");
  assert.equal(buttonName("standard", 9), "Start");
  assert.equal(buttonName("standard", 12), "Up");
  assert.equal(buttonName("standard", 40), "button 40");
  assert.equal(buttonName("", 0), "button 0");
  assert.equal(axisName("standard", 1), "LY");
  assert.equal(axisName("", 1), "axis 1");
});

test("a controller registers on its first button press, not when it appears", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0)], 16);
  assert.equal(reg.slots.length, 0, "seen but not pressed: not registered");
  assert.deepEqual(reg.unregistered([pad(0)]).map((p) => p.index), [0]);
  const out = tick(reg, [pad(0, { down: [0] })], 32);
  assert.equal(reg.slots.length, 1);
  assert.equal(reg.slots[0].slot, 1);
  assert.equal(reg.slots[0].index, 0);
  assert.deepEqual(out.map((e) => e.type), ["register", "button"], "the registering press is also the first input");
  assert.deepEqual(reg.unregistered([pad(0, { down: [0] })]), []);
});

test("a button already held when the controller was first seen does not register it", () => {
  const reg = createRegistry();
  tick(reg, [pad(0, { down: [0] })], 0);
  tick(reg, [pad(0, { down: [0] })], 16);
  assert.equal(reg.slots.length, 0);
  tick(reg, [pad(0)], 32); // released
  tick(reg, [pad(0, { down: [1] })], 48);
  assert.equal(reg.slots.length, 1);
});

test("slots go in the order controllers are pressed, not the order they are numbered", () => {
  const reg = createRegistry();
  const pads = (down1, down3) => [pad(0), pad(1, { down: down1 }), pad(2), pad(3, { down: down3 })];
  tick(reg, pads([], []), 0);
  tick(reg, pads([], [0]), 16); // pad index 3 presses first
  tick(reg, pads([0], [0]), 32);
  tick(reg, pads([0], []), 48);
  assert.deepEqual(reg.slots.map((s) => [s.slot, s.index]), [[1, 3], [2, 1]]);
});

test("two controllers pressed in the same frame each get a slot, and their inputs are attributed separately", () => {
  const reg = createRegistry();
  tick(reg, [pad(0), pad(1)], 0);
  const reg2 = tick(reg, [pad(0, { down: [0] }), pad(1, { down: [1] })], 16);
  assert.deepEqual(reg.slots.map((s) => s.slot), [1, 2]);
  const buttons = reg2.filter((e) => e.type === "button");
  assert.deepEqual(buttons.map((e) => [e.slot, e.name, e.state]), [[1, "A", "down"], [2, "B", "down"]]);
  const later = tick(reg, [pad(0, { down: [0, 5] }), pad(1)], 32);
  assert.deepEqual(later.map((e) => [e.slot, e.type, e.name, e.state]), [[1, "button", "RB", "down"], [2, "button", "B", "up"]]);
  assert.equal(reg.slots[0].stats.presses, 2);
  assert.equal(reg.slots[1].stats.releases, 1);
});

test("button events carry the time, frame and analog value; axes log moves, not noise", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 10);
  const ev = tick(reg, [pad(0, { down: [0, 7], values: { 7: 0.8 } })], 25.55);
  const lt = ev.find((e) => e.name === "RT");
  assert.equal(lt.value, 0.8);
  assert.equal(lt.t, 25.6, "time rounded to 0.1 ms");
  assert.equal(typeof lt.frame, "number");
  // Axis noise under the step is ignored; a real move is logged; coming back to center is logged.
  assert.deepEqual(tick(reg, [pad(0, { down: [0, 7], axes: [0.04, 0, 0, 0] })], 40), []);
  assert.deepEqual(tick(reg, [pad(0, { down: [0, 7], axes: [0.08, 0, 0, 0] })], 50), []);
  const moved = tick(reg, [pad(0, { down: [0, 7], axes: [0.9, 0, 0, 0] })], 60);
  assert.deepEqual(moved.map((e) => [e.type, e.name, e.value]), [["axis", "LX", 0.9]]);
  assert.deepEqual(tick(reg, [pad(0, { down: [0, 7], axes: [0.95, 0, 0, 0] })], 70), [], "a small further move is not logged");
  const back = tick(reg, [pad(0, { down: [0, 7], axes: [0.02, 0, 0, 0] })], 80);
  assert.deepEqual(back.map((e) => [e.name, e.value]), [["LX", 0.02]]);
});

test("a disconnected controller keeps its slot, and the same controller gets it back even at a new index", () => {
  const reg = createRegistry();
  tick(reg, [pad(0), pad(1)], 0);
  tick(reg, [pad(0, { down: [0] }), pad(1, { down: [0] })], 16);
  tick(reg, [pad(0), pad(1)], 32);
  const gone = tick(reg, [pad(0), null], 48);
  assert.deepEqual(gone.map((e) => [e.slot, e.type]), [[2, "disconnect"]]);
  assert.equal(reg.slots[1].connected, false);
  assert.equal(reg.slots[1].index, null);
  // A different controller arrives meanwhile at index 1: it does not take slot 2.
  tick(reg, [pad(0), pad(1, { id: "Other pad" })], 64);
  assert.equal(reg.slots.length, 2, "an unregistered newcomer does not steal a slot");
  // The original comes back at index 2.
  tick(reg, [pad(0), pad(1, { id: "Other pad" }), pad(2, { id: "Pad 1 (STANDARD GAMEPAD)" })], 80);
  assert.equal(reg.slots[1].connected, true);
  assert.equal(reg.slots[1].index, 2);
  const events = reg.events.filter((e) => e.slot === 2).map((e) => e.type);
  assert.deepEqual(events.slice(-2), ["disconnect", "reconnect"]);
  // And its inputs are attributed to slot 2 again.
  const out = tick(reg, [pad(0), pad(1, { id: "Other pad" }), pad(2, { id: "Pad 1 (STANDARD GAMEPAD)", down: [3] })], 96);
  assert.deepEqual(out.map((e) => [e.slot, e.name]), [[2, "Y"]]);
});

test("a controller that stays connected but reports connected=false counts as gone", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 16);
  const out = tick(reg, [pad(0, { connected: false })], 32);
  assert.deepEqual(out.map((e) => e.type), ["disconnect"]);
});

test("forgetting a slot frees its number for the next controller", () => {
  const reg = createRegistry();
  tick(reg, [pad(0), pad(1)], 0);
  tick(reg, [pad(0, { down: [0] }), pad(1, { down: [0] })], 16);
  reg.forget(1);
  assert.deepEqual(reg.slots.map((s) => s.slot), [2]);
  tick(reg, [pad(0), pad(1), pad(2)], 32);
  tick(reg, [pad(0), pad(1), pad(2, { down: [4] })], 48);
  assert.deepEqual(reg.slots.map((s) => [s.slot, s.index]), [[1, 2], [2, 1]].sort((a, b) => a[0] - b[0]));
});

test("eight controllers register and a ninth waits", () => {
  const reg = createRegistry({ maxSlots: 8 });
  const idle = Array.from({ length: 9 }, (_, i) => pad(i));
  tick(reg, idle, 0);
  tick(reg, Array.from({ length: 9 }, (_, i) => pad(i, { down: i < 8 ? [0] : [] })), 16);
  assert.equal(reg.slots.length, 8);
  tick(reg, Array.from({ length: 9 }, (_, i) => pad(i, { down: i < 8 ? [0] : [1] })), 32);
  assert.equal(reg.slots.length, 8, "no room for a ninth");
  assert.deepEqual(reg.unregistered(Array.from({ length: 9 }, (_, i) => pad(i))).map((p) => p.index), [8]);
});

test("two controllers with the same name are told apart by index", () => {
  const reg = createRegistry();
  const same = (i, down = []) => pad(i, { down, id: "Xbox Controller (STANDARD GAMEPAD)" });
  tick(reg, [same(0), same(1)], 0);
  tick(reg, [same(0), same(1, [0])], 16);
  tick(reg, [same(0, [0]), same(1, [0])], 32);
  assert.deepEqual(reg.slots.map((s) => [s.slot, s.index]), [[1, 1], [2, 0]]);
  const out = tick(reg, [same(0, [0, 1]), same(1, [0])], 48);
  assert.deepEqual(out.map((e) => [e.slot, e.name]), [[2, "B"]], "the right one of two identical pads");
});

test("pausing the log stops recording but not the live state or counts; clearing keeps the controllers", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 16);
  reg.recording = false;
  const out = tick(reg, [pad(0, { down: [0, 1] })], 32);
  assert.deepEqual(out, []);
  assert.equal(reg.slots[0].buttons[1].pressed, true, "live state still follows");
  assert.equal(reg.slots[0].stats.presses, 2, "and it is still counted");
  const before = reg.events.length;
  reg.recording = true;
  tick(reg, [pad(0, { down: [0] })], 48);
  assert.equal(reg.events.length, before + 1);
  reg.clearLog();
  assert.equal(reg.events.length, 0);
  assert.equal(reg.slots.length, 1);
});

test("the log keeps the newest entries and counts the ones it dropped", () => {
  const reg = createRegistry({ maxEvents: 5 });
  tick(reg, [pad(0)], 0);
  for (let i = 0; i < 6; i++) tick(reg, [pad(0, { down: [i % 2 ? 1 : 0] })], 16 + i * 16);
  assert.equal(reg.events.length, 5);
  assert.ok(reg.dropped > 0);
  assert.ok(reg.events.at(-1).t > reg.events[0].t);
});

test("the export parses back to the registered pads, their transcripts and the combined log", () => {
  const reg = createRegistry();
  tick(reg, [pad(0), pad(1)], 0);
  tick(reg, [pad(0, { down: [0] }), pad(1, { down: [1] })], 16);
  tick(reg, [pad(0), pad(1, { down: [1], axes: [0.9, 0, 0, 0] })], 32);
  const text = exportJson(reg.toExport({ startedAt: "2026-11-21T00:00:00.000Z", exportedAt: "2026-11-21T00:01:00.000Z", now: 100 }));
  const back = JSON.parse(text);
  assert.equal(back.app, "controller-lab");
  assert.equal(back.format, 3);
  assert.deepEqual(back.pads.map((p) => p.slot), [1, 2]);
  assert.equal(back.pads[0].inputs.presses, 1);
  assert.equal(back.pads[1].inputs.axisEvents, 1);
  assert.equal(back.events.length, reg.events.length);
  assert.equal(back.pads[0].transcript.length + back.pads[1].transcript.length, reg.events.length, "every entry is in exactly one transcript");
  assert.ok(text.includes('{"t":'), "log entries one per line");
  assert.ok(back.events.every((e) => typeof e.slot === "number" && typeof e.t === "number"));
  // One player's export has just that player.
  const one = JSON.parse(exportJson(reg.toExport({ startedAt: "a", exportedAt: "b", now: 100 }, 2)));
  assert.deepEqual(one.pads.map((p) => p.slot), [2]);
  assert.equal(one.events, undefined, "no combined log in a single-player export");
  assert.ok(one.pads[0].transcript.every((e) => e.slot === 2));
});

test("non-standard pads are logged by number", () => {
  const reg = createRegistry();
  const odd = (down = []) => pad(0, { down, mapping: "", id: "Mystery Pad", buttons: 10, axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1.29] });
  tick(reg, [odd()], 0);
  tick(reg, [odd([4])], 16);
  const hat = tick(reg, [pad(0, { mapping: "", id: "Mystery Pad", buttons: 10, axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, -1] })], 32);
  assert.deepEqual(hat.filter((e) => e.type === "axis").map((e) => [e.name, e.value]), [["axis 9", -1]]);
  assert.ok(reg.events.some((e) => e.type === "button" && e.name === "button 4"));
});

test("service worker PRECACHE lists exactly the page's files, and they all exist", () => {
  const dir = new URL("../web/controller-lab/", import.meta.url).pathname;
  const sw = readFileSync(join(dir, "sw.js"), "utf8");
  const block = sw.match(/const PRECACHE = \[([\s\S]*?)\];/)?.[1] ?? "";
  const listed = [...block.matchAll(/'(\/controller-lab\/[^']*)'/g)].map((m) => m[1]);
  for (const path of listed) {
    const file = path === "/controller-lab/" ? "index.html" : path.slice("/controller-lab/".length);
    assert.ok(existsSync(join(dir, file)), `${path} is listed but missing`);
  }
  const onDisk = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name !== "sw.js")
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .map((p) => (p === "index.html" ? "/controller-lab/" : `/controller-lab/${p}`));
  assert.deepEqual([...listed].sort(), [...onDisk].sort());
});

test("the page lists every module it loads, and its slot colors read on the background in both modes", async () => {
  const dir = new URL("../web/controller-lab/", import.meta.url).pathname;
  const html = readFileSync(join(dir, "index.html"), "utf8");
  const { contrastRatio } = await import("../web/golden-angle-palette/palette.js");
  const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  const [light, dark] = css.split("@media (prefers-color-scheme: dark) {");
  /** The slot colors, their inks, and the background of one mode. */
  const read = (text, bg) => {
    const slots = [...text.matchAll(/--slot-(\d): (#[0-9A-Fa-f]{6}); --slot-\d-ink: (#[0-9A-Fa-f]{6});/g)].map((m) => ({ n: m[1], color: m[2], ink: m[3] }));
    return { slots, bg };
  };
  for (const [mode, text, bg] of [["light", light, "#FFFFFF"], ["dark", dark, "#111111"]]) {
    const { slots } = read(text, bg);
    assert.equal(slots.length, 8, `${mode}: eight slots`);
    for (const s of slots) {
      assert.ok(contrastRatio(s.color.slice(1), bg.slice(1)) >= 3, `${mode} slot ${s.n} border on the background`);
      assert.ok(contrastRatio(s.ink.slice(1), s.color.slice(1)) >= 4.5, `${mode} slot ${s.n} ink on its color`);
    }
  }
  for (const m of ["app.js", "names.js", "registry.js"]) assert.ok(existsSync(join(dir, m)), m);
  assert.match(html, /src="\/controller-lab\/app\.js"/);
});

// --- detail: transcripts, statistics and performance -----------------------------------------------

test("button entries carry a press count, the time since the last press, and how long it was held", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 100); // registers and presses A at 100
  tick(reg, [pad(0)], 350); // released after 250 ms
  const second = tick(reg, [pad(0, { down: [0] })], 600); // pressed again 500 ms after the first press
  tick(reg, [pad(0)], 640);
  const log = reg.slots[0].log.filter((e) => e.type === "button");
  assert.deepEqual(log.map((e) => [e.state, e.count, e.sinceLast, e.heldMs]), [
    ["down", 1, null, undefined],
    ["up", undefined, undefined, 250],
    ["down", 2, 500, undefined],
    ["up", undefined, undefined, 40],
  ]);
  assert.equal(second[0].count, 2);
});

test("each controller's transcript holds only its own entries, with the gap since its own previous entry", () => {
  const reg = createRegistry();
  tick(reg, [pad(0), pad(1)], 0);
  tick(reg, [pad(0, { down: [0] }), pad(1, { down: [0] })], 100);
  tick(reg, [pad(0, { down: [0] }), pad(1)], 250); // only P2 acts
  tick(reg, [pad(0), pad(1)], 400); // only P1 acts
  const [p1, p2] = reg.slots;
  assert.ok(p1.log.every((e) => e.slot === 1) && p2.log.every((e) => e.slot === 2));
  const gaps = (s) => s.log.map((e) => e.gap);
  assert.deepEqual(gaps(p1), [null, 0, 300], "register, press, then release 300 ms after the press");
  assert.deepEqual(gaps(p2), [null, 0, 150], "P2's gap ignores P1's activity in between");
  assert.equal(reg.events.length, p1.log.length + p2.log.length);
});

test("axis entries say how far the stick moved", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 16);
  tick(reg, [pad(0, { down: [0], axes: [0.6, 0, 0, 0] })], 32);
  tick(reg, [pad(0, { down: [0], axes: [0.1, 0, 0, 0] })], 48);
  const axes = reg.slots[0].log.filter((e) => e.type === "axis");
  assert.deepEqual(axes.map((e) => [e.value, e.change]), [[0.6, 0.6], [0.1, -0.5]]);
});

test("button statistics: presses, hold times and the fastest repeat", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  // A held 100, 300 and 200 ms, pressed at 100, 500 and 800 (gaps 400 and 300).
  tick(reg, [pad(0, { down: [0] })], 100);
  tick(reg, [pad(0)], 200);
  tick(reg, [pad(0, { down: [0] })], 500);
  tick(reg, [pad(0)], 800);
  tick(reg, [pad(0, { down: [0] })], 800 + 0.0); // same instant as the release: next frame
  tick(reg, [pad(0, { down: [0] })], 801);
  tick(reg, [pad(0)], 1000);
  const a = summarize(reg.slots[0], 1000).buttons.find((b) => b.name === "A");
  assert.equal(a.presses, 3);
  assert.equal(a.releases, 3);
  assert.equal(a.holdMinMs, 100);
  assert.equal(a.holdMaxMs, 300);
  assert.equal(a.holdAvgMs, Math.round(((100 + 300 + 200) / 3) * 10) / 10);
  assert.ok(a.fastestRepeatMs <= 301);
});

test("axis statistics: the range seen, and drift and noise while the stick rests", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  // The stick rests slightly off center and wobbles a little (a reading every 16 ms), then is pushed left.
  [0.03, 0.05, 0.04, 0.03, 0.05, 0.04, 0.03, 0.05, 0.04, 0.03, -0.8].forEach((v, i) => tick(reg, [pad(0, { down: [0], axes: [v, 0, 0, 0] })], 16 + i * 16));
  const lx = summarize(reg.slots[0], 300).axes.find((a) => a.name === "LX");
  assert.equal(lx.min, -0.8);
  assert.equal(lx.max, 0.05);
  assert.equal(lx.restSamples, 5, "counted once the stick had been steady for 80 ms: the 6th to 10th readings");
  assert.equal(lx.restAvg, 0.038, "average of 0.04, 0.03, 0.05, 0.04 and 0.03");
  assert.equal(lx.restNoise, 0.02, "peak to peak at rest");
  assert.equal(lx.events, 1);
});

test("a stick moving slowly through the middle is not counted as resting", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  // 0 to 0.2 in steps of 0.02 every 10 ms: always inside the rest zone, but never steady.
  for (let i = 0; i <= 10; i++) tick(reg, [pad(0, { down: [0], axes: [i * 0.02, 0, 0, 0] })], 10 + i * 10);
  const lx = summarize(reg.slots[0], 200).axes.find((a) => a.name === "LX");
  assert.equal(lx.restSamples, 0);
  assert.equal(lx.restAvg, null);
  assert.equal(lx.restNoise, null);
});

test("polling faster than the device reports does not make a moving stick look steady", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  // The device reports every 8 ms and we poll every 4 ms, so every value is seen twice.
  for (let i = 0; i < 40; i++) tick(reg, [pad(0, { down: [0], axes: [Math.floor(i / 2) * 0.01, 0, 0, 0] })], 4 + i * 4);
  const lx = summarize(reg.slots[0], 300).axes.find((a) => a.name === "LX");
  assert.equal(lx.restSamples, 0, "0.01 every 8 ms is still moving");
});

test("a stick resting well off center is measured as drift", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  for (let i = 0; i < 8; i++) tick(reg, [pad(0, { down: [0], axes: [0.12, -0.1, 0, 0] })], 16 + i * 16);
  const s = summarize(reg.slots[0], 200);
  assert.equal(s.axes.find((a) => a.name === "LX").restAvg, 0.12);
  assert.equal(s.axes.find((a) => a.name === "LY").restAvg, -0.1);
  assert.equal(s.axes.find((a) => a.name === "LX").restNoise, 0);
  assert.equal(s.axes.find((a) => a.name === "LX").restSamples, 3, "the 6th to 8th readings");
});

test("resetting statistics zeroes the measurements but keeps the transcript and the slot", () => {
  const reg = createRegistry();
  tick(reg, [pad(0, { timestamp: 1 })], 0);
  tick(reg, [pad(0, { down: [0], timestamp: 10 })], 10);
  tick(reg, [pad(0, { timestamp: 120 })], 120);
  assert.equal(summarize(reg.slots[0], 130).inputs.total, 2);
  assert.equal(reg.resetStats(1), true);
  const s = summarize(reg.slots[0], 130);
  assert.equal(s.inputs.total, 0);
  assert.equal(s.polls, 0);
  assert.deepEqual(s.buttons, []);
  assert.equal(reg.slots[0].log.length, 3, "register, press and release are still in the transcript");
  assert.equal(reg.slots[0].slot, 1);
  assert.equal(reg.resetStats(9), false);
  // And it measures afresh from here.
  tick(reg, [pad(0, { down: [0], timestamp: 200 })], 200);
  assert.equal(summarize(reg.slots[0], 210).buttons[0].presses, 1);
});

test("performance: a device reporting every 8 ms is measured as 125 Hz when the page polls fast enough", () => {
  const reg = createRegistry();
  const at = (now, down = []) => pad(0, { down, timestamp: Math.floor((now - 3) / 8) * 8 + 3 }); // reports at 3, 11, 19...
  tick(reg, [at(2)], 0);
  for (let now = 4; now <= 400; now += 4) tick(reg, [at(now, now > 8 ? [0] : [])], now);
  const s = summarize(reg.slots[0], 400);
  assert.equal(s.deviceTimestamps, true);
  assert.equal(s.report.avgMs, 8);
  assert.equal(s.report.approxHz, 125);
  assert.equal(s.report.p95Ms, 8);
  assert.equal(s.report.jitterMs, 0);
  assert.equal(s.poll.avgMs, 4);
  assert.equal(s.poll.approxHz, 250);
  assert.equal(s.age.avgMs, 1, "each report was seen 1 ms after the device made it");
});

test("performance: polling slower than the device hides its real rate, and the summary says how fast we polled", () => {
  const reg = createRegistry();
  const at = (now) => pad(0, { down: [0], timestamp: Math.floor((now - 3) / 8) * 8 + 3 });
  tick(reg, [pad(0, { timestamp: 3 })], 0);
  for (let now = 16; now <= 400; now += 16) tick(reg, [at(now)], now);
  const s = summarize(reg.slots[0], 400);
  assert.ok(s.report.avgMs >= 16, "reports are only seen as often as we poll");
  assert.equal(s.poll.avgMs, 16);
});

test("performance: pauses and button presses are not counted as the device's report rate", () => {
  const reg = createRegistry();
  const at = (ts) => pad(0, { down: [0], timestamp: ts });
  tick(reg, [pad(0, { timestamp: 1 })], 0);
  tick(reg, [at(10)], 10);
  tick(reg, [at(18)], 18);
  tick(reg, [at(26)], 26);
  tick(reg, [at(1026)], 1026); // a second of nothing, then movement
  tick(reg, [at(1034)], 1034);
  const s = summarize(reg.slots[0], 1100);
  assert.equal(s.report.samples, 3, "10 to 18, 18 to 26 and 1026 to 1034; the 1000 ms pause is left out");
  tick(reg, [at(1134)], 1134); // a press 100 ms later: too far apart to be a stream of readings
  assert.equal(summarize(reg.slots[0], 1200).report.samples, 3, "100 ms between changes is not streaming");
  assert.equal(s.report.maxMs, 8);
  assert.equal(summarize(reg.slots[0], 1200).stateChanges, 5, "but each change after the pause is still a state change");
});

test("performance: a browser with no device timestamps is reported as such, not as zero", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 16);
  tick(reg, [pad(0)], 32);
  const s = summarize(reg.slots[0], 40);
  assert.equal(s.deviceTimestamps, false);
  assert.equal(s.age, null);
  assert.equal(s.report.samples, 0);
  assert.equal(s.report.approxHz, null);
  assert.match(summaryText(s), /no device timestamps/);
  assert.equal(reg.slots[0].log.find((e) => e.type === "button").ts, undefined, "entries carry no timestamp either");
});

test("performance: inputs per second now and at the peak, and idle time", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  // Five inputs inside one second, then quiet.
  for (let i = 0; i < 5; i++) {
    tick(reg, [pad(0, { down: Array.from({ length: i + 1 }, (_, k) => k) })], 100 + i * 100); // each frame adds one more button
  }
  const busy = summarize(reg.slots[0], 700);
  assert.equal(busy.inputs.perSecondNow, 5);
  assert.equal(busy.inputs.perSecondPeak, 5);
  assert.equal(busy.inputs.idleMs, 200);
  const later = summarize(reg.slots[0], 3000);
  assert.equal(later.inputs.perSecondNow, 0);
  assert.equal(later.inputs.perSecondPeak, 5, "the peak is remembered");
  assert.equal(later.inputs.idleMs, 2500);
});

test("input entries carry the device timestamp and how old it was when seen", () => {
  const reg = createRegistry({ origin: 1000 });
  reg.update([pad(0, { timestamp: 1000 })], 1000, 1);
  reg.update([pad(0, { down: [0], timestamp: 1040 })], 1046, 2);
  const e = reg.slots[0].log.find((x) => x.type === "button");
  assert.equal(e.t, 46, "time is counted from the origin");
  assert.equal(e.ts, 40, "so is the device's timestamp");
  assert.equal(e.age, 6, "seen 6 ms after the device reported it");
});

test("forgetting drops a controller's transcript and statistics; clearing the log keeps statistics", () => {
  const reg = createRegistry();
  tick(reg, [pad(0), pad(1)], 0);
  tick(reg, [pad(0, { down: [0] }), pad(1, { down: [0] })], 16);
  reg.clearLog();
  assert.equal(reg.slots[0].log.length, 0);
  assert.equal(reg.slots[0].stats.presses, 1, "the counts survive clearing the log");
  assert.equal(summarize(reg.slots[0], 40).buttons[0].presses, 1);
  reg.forget(1);
  assert.deepEqual(reg.slots.map((s) => s.slot), [2]);
  assert.equal(reg.summary(1, 40), null);
  assert.equal(reg.summary(2, 40).slot, 2);
});

test("each transcript is limited on its own, and says how many entries it lost", () => {
  const reg = createRegistry({ maxSlotEvents: 4 });
  tick(reg, [pad(0), pad(1)], 0);
  tick(reg, [pad(0, { down: [0] }), pad(1, { down: [0] })], 10);
  for (let i = 0; i < 6; i++) tick(reg, [pad(0, { down: [i % 2 ? 0 : 1] }), pad(1, { down: [0] })], 20 + i * 10);
  assert.equal(reg.slots[0].log.length, 4);
  assert.ok(reg.slots[0].logDropped > 0);
  assert.equal(reg.slots[1].log.length, 2, "the quiet controller keeps everything");
  assert.equal(reg.slots[1].logDropped, 0);
});

// --- text ------------------------------------------------------------------------------------------

test("transcript lines read clearly: time, gap, control, and what happened", () => {
  const reg = createRegistry();
  tick(reg, [pad(0, { timestamp: 5 })], 0);
  tick(reg, [pad(0, { down: [0], timestamp: 100 })], 102);
  tick(reg, [pad(0, { timestamp: 300 })], 305);
  tick(reg, [pad(0, { axes: [0.9, 0, 0, 0], timestamp: 400 })], 402);
  const [reg1, down, up, axis] = reg.slots[0].log;
  assert.match(formatEvent(reg1), /REGISTERED +Pad 0 \(STANDARD GAMEPAD\) +\(index 0, standard mapping, 17 buttons, 4 axes\)/);
  assert.match(formatEvent(down), /^ +0\.102s +\+0\.000s +A +down +#1 +first press +\[device 0\.100s, seen 2\.0 ms later\]$/);
  assert.match(formatEvent(up), /A +up +held 203 ms/);
  assert.match(formatEvent(axis), /LX +0\.90 +\(change \+0\.90\)/);
  assert.match(formatEvent(down, { player: true }), /P1 +A/);
  assert.doesNotMatch(formatEvent(down), /P1/);
  assert.equal(transcriptText(reg.slots[0].log).split("\n").length, 4);
  assert.equal(seconds(12345.6), "12.346s");
});

test("durations are shown in ms under a second and seconds above", () => {
  assert.equal(duration(null), "-");
  assert.equal(duration(250), "250 ms");
  assert.equal(duration(8.25), "8.3 ms");
  assert.equal(duration(1500), "1.50 s");
});

test("the controller report holds the statistics and the whole transcript, ready to save", () => {
  const reg = createRegistry();
  tick(reg, [pad(0, { timestamp: 1 })], 0);
  tick(reg, [pad(0, { down: [0], timestamp: 20 })], 20);
  tick(reg, [pad(0, { timestamp: 120 })], 120);
  const report = controllerReport(summarize(reg.slots[0], 150), reg.slots[0].log, { startedAt: "S", exportedAt: "E" });
  assert.match(report, /transcript for P1/);
  assert.match(report, /session started S, exported E/);
  assert.match(report, /PERFORMANCE/);
  assert.match(report, /BUTTONS\n +A +1 presses/);
  assert.match(report, /STICKS AND AXES/);
  assert.match(report, /TRANSCRIPT {2}\(3 entries\)/);
  assert.match(report, /held 100 ms/);
});

test("a controller used only for button presses is not given a report rate", () => {
  const reg = createRegistry();
  tick(reg, [pad(0, { timestamp: 1 })], 0);
  for (let i = 0; i < 6; i++) {
    tick(reg, [pad(0, { down: [0], timestamp: 100 + i * 300 })], 100 + i * 300);
    tick(reg, [pad(0, { timestamp: 200 + i * 300 })], 200 + i * 300);
  }
  const s = summarize(reg.slots[0], 2000);
  assert.equal(s.report.samples, 0);
  assert.equal(s.report.approxHz, null);
  assert.ok(s.stateChanges >= 10, "the presses are still state changes");
  assert.match(summaryText(s), /not measured yet: move a stick or trigger/);
});

// --- device identity, environment and connection ---------------------------------------------------

test("ids are taken apart in the styles Chrome, Safari and Firefox use", () => {
  const pro = parsePadId("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)");
  assert.deepEqual([pro.name, pro.vendorId, pro.productId, pro.vendorName, pro.productName, pro.format], ["Pro Controller", "057e", "2009", "Nintendo", "Switch Pro Controller", "chromium"]);
  const ff = parsePadId("2dc8-6101-8BitDo SN30 Pro");
  assert.deepEqual([ff.name, ff.vendorId, ff.productId, ff.vendorName, ff.productName, ff.format], ["8BitDo SN30 Pro", "2dc8", "6101", "8BitDo", null, "firefox"]);
  const short = parsePadId("Xbox Wireless Controller (Vendor: 45e Product: b13)");
  assert.deepEqual([short.vendorId, short.productId, short.productName], ["045e", "0b13", "Xbox Series X|S Controller (Bluetooth)"], "short hex is padded");
  const none = parsePadId("Wireless Controller");
  assert.deepEqual([none.name, none.vendorId, none.productId, none.vendorName, none.format], ["Wireless Controller", null, null, null, "unknown"]);
  const std = parsePadId("Mystery Pad (STANDARD GAMEPAD)");
  assert.deepEqual([std.name, std.vendorId, std.format], ["Mystery Pad", null, "chromium"]);
  assert.equal(parsePadId("Joy-Con (L) (STANDARD GAMEPAD Vendor: 057e Product: 2006)").name, "Joy-Con (L)", "a name that has brackets in it keeps them");
  assert.equal(parsePadId("Unknown (STANDARD GAMEPAD Vendor: ffff Product: 0001)").vendorName, null, "an unfamiliar maker is left unnamed, not guessed");
  assert.equal(parsePadId("").name, "controller");
});

test("the environment is read from the user agent, with an iPad that calls itself a Mac recognised by its touch screen", () => {
  const safariIpad = describeEnvironment({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15", maxTouchPoints: 5, getGamepads() {} }, { isSecureContext: true });
  assert.deepEqual([safariIpad.os, safariIpad.browser, safariIpad.webKitOnly, safariIpad.gamepadApi, safariIpad.secureContext, safariIpad.webBluetooth, safariIpad.webHid], ["iPadOS", "Safari 17", true, true, true, false, false]);
  const mac = describeEnvironment({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15", maxTouchPoints: 0 });
  assert.deepEqual([mac.os, mac.webKitOnly], ["macOS", false]);
  const chromeOnIpad = describeEnvironment({ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1", maxTouchPoints: 5 });
  assert.deepEqual([chromeOnIpad.os, chromeOnIpad.browser, chromeOnIpad.webKitOnly], ["iPadOS", "Chrome 123", true], "Chrome on an iPad is still Safari's engine");
  const chrome = describeEnvironment({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", bluetooth: {}, hid: {}, getGamepads() {} });
  assert.deepEqual([chrome.os, chrome.browser, chrome.webBluetooth, chrome.webHid], ["Windows", "Chrome 124", true, true]);
  const edge = describeEnvironment({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.51" });
  assert.equal(edge.browser, "Edge 124");
  const firefox = describeEnvironment({ userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0" });
  assert.deepEqual([firefox.os, firefox.browser], ["Linux", "Firefox 125"]);
  assert.equal(describeEnvironment({}).browser, "unknown");
});

test("what a browser cannot report is stated, with a reason that fits that browser", () => {
  const ipad = describeEnvironment({ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1", maxTouchPoints: 5 });
  const na = unavailable(ipad);
  assert.deepEqual(na.map((n) => n.short), ["Protocol", "Signal strength", "Motion", "Battery"]);
  const radio = na.filter((n) => n.short !== "Motion");
  assert.ok(radio.every((n) => /Safari's engine/.test(n.why) && /neither Web Bluetooth nor WebHID/.test(n.why)), "the iPad reason");
  const motion = na.find((n) => n.short === "Motion");
  assert.match(motion.why, /no motion fields/);
  assert.match(motion.why, /no WebHID/, "an iPad has no WebHID to read raw reports");
  assert.match(motion.why, /GameController framework/);
  const chrome = describeEnvironment({ userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/124.0.0.0 Safari/537.36", bluetooth: {} });
  assert.ok(unavailable(chrome).filter((n) => n.short !== "Motion").every((n) => /has Web Bluetooth/.test(n.why) && /does not use it/.test(n.why)), "a browser that could, but this lab does not");
  const chromeHid = describeEnvironment({ userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/124.0.0.0 Safari/537.36", hid: {} });
  assert.match(unavailable(chromeHid).find((n) => n.short === "Motion").why, /has WebHID.*does not use it/, "WebHID could read motion, but the lab does not use it");
  const firefox = describeEnvironment({ userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0" });
  assert.ok(unavailable(firefox).filter((n) => n.short !== "Motion").every((n) => /no Web Bluetooth or WebHID/.test(n.why)));
});

test("clock and approxBits", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(65000), "1:05");
  assert.equal(clock(3725000), "1:02:05");
  assert.equal(clock(null), "-");
  assert.equal(approxBits(2 / 255), 8);
  assert.equal(approxBits(2 / 4095), 12);
  assert.equal(approxBits(2 / 65535), 16);
  assert.equal(approxBits(null), null);
  assert.equal(approxBits(0), null);
});

test("the registry notes the device's identity, haptics, touch points, pose and hand", () => {
  const reg = createRegistry();
  const extras = { hand: "right", displayId: 0, vibrationActuator: { type: "dual-rumble", playEffect() {} }, touches: [{}, {}], pose: {} };
  tick(reg, [pad(0, { id: "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)", extras })], 0);
  tick(reg, [pad(0, { id: "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)", down: [0], extras })], 16);
  const d = summarize(reg.slots[0], 20).device;
  assert.equal(d.identity.productName, "Switch Pro Controller");
  assert.equal(d.hand, "right");
  assert.deepEqual(d.vibration, { type: "dual-rumble", playEffect: true, reset: false, effects: null });
  assert.equal(d.touchesMax, 2);
  assert.equal(d.pose, true);
  assert.equal(summarize(reg.slots[0], 20).controls.buttons, 17);
  // A browser that gives none of these leaves them empty rather than inventing them.
  const bare = createRegistry();
  tick(bare, [pad(0)], 0);
  tick(bare, [pad(0, { down: [0] })], 16);
  const b = summarize(bare.slots[0], 20).device;
  assert.deepEqual([b.hand, b.vibration, b.touchesMax, b.pose, b.displayId, b.hapticActuators], [null, null, 0, false, null, 0]);
});

test("analog and touch-sensitive buttons are found by watching what they report", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 16);
  tick(reg, [pad(0, { values: { 6: 0.4, 7: 1 }, touched: [3, 12] })], 32);
  tick(reg, [pad(0, { values: { 6: 0.8 } })], 48);
  const d = summarize(reg.slots[0], 60).device;
  assert.deepEqual(d.analogButtons, ["LT"], "LT reported values between 0 and 1; RT only 0 or 1");
  assert.deepEqual(d.touchSensitiveButtons, ["Y", "Up"]);
});

test("stick resolution is the smallest step seen, and says about how many bits that is", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 16);
  // An 8-bit stick moves in steps of 2/255.
  const step = 2 / 255;
  [0, 1, 2, 3, 5, 6, 9, 10, 11, 14, 15].forEach((n, i) => tick(reg, [pad(0, { down: [0], axes: [-1 + n * step, 0, 0, 0] })], 32 + i * 16));
  const res = summarize(reg.slots[0], 300).device.axisResolution;
  assert.deepEqual(res.map((a) => a.name), ["LX"], "only axes that moved are listed");
  assert.equal(res[0].approxBits, 8);
  assert.equal(res[0].smallestStep, Math.round(step * 1e6) / 1e6);
  assert.ok(res[0].steps >= 8);
});

test("a few coarse stick moves are not turned into a bit depth", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 16);
  tick(reg, [pad(0, { down: [0], axes: [0.5, 0, 0, 0] })], 32);
  tick(reg, [pad(0, { down: [0], axes: [0, 0, 0, 0] })], 48);
  const res = summarize(reg.slots[0], 100).device.axisResolution;
  assert.equal(res[0].smallestStep, 0.5);
  assert.equal(res[0].approxBits, null, "two steps tell nothing about the resolution");
  assert.match(summaryText(summarize(reg.slots[0], 100)), /too few small steps to tell the bit depth/);
});

test("connection history: connects, drops, time connected and the current stretch", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 1000); // registers at 1000
  let c = summarize(reg.slots[0], 6000).connection;
  assert.deepEqual([c.connected, c.connects, c.disconnects, c.uptimeMs, c.totalConnectedMs, c.sinceRegistrationMs], [true, 1, 0, 5000, 5000, 5000]);
  tick(reg, [null], 7000); // drops after 6 s connected
  c = summarize(reg.slots[0], 9000).connection;
  assert.deepEqual([c.connected, c.disconnects, c.uptimeMs, c.totalConnectedMs, c.sinceRegistrationMs], [false, 1, 0, 6000, 8000]);
  tick(reg, [pad(3, { id: "Pad 0 (STANDARD GAMEPAD)" })], 10000); // the same controller, back at another index
  c = summarize(reg.slots[0], 14000).connection;
  assert.deepEqual([c.connected, c.connects, c.disconnects, c.uptimeMs, c.totalConnectedMs], [true, 2, 1, 4000, 10000]);
});

test("the summary text lists the device, the connection, and what cannot be read, with the reason", () => {
  const reg = createRegistry();
  const id = "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)";
  tick(reg, [pad(0, { id, timestamp: 1, extras: { vibrationActuator: { type: "dual-rumble", playEffect() {} } } })], 0);
  tick(reg, [pad(0, { id, down: [0], timestamp: 20, values: { 6: 0.5 }, extras: { vibrationActuator: { type: "dual-rumble", playEffect() {} } } })], 20);
  const ipad = describeEnvironment({ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1", maxTouchPoints: 5 });
  const text = summaryText(summarize(reg.slots[0], 3000), ipad);
  assert.match(text, /^P1 {2}Pro Controller/);
  assert.match(text, /Maker\s+Nintendo \(057e\)/);
  assert.match(text, /Product\s+Switch Pro Controller \(2009\)/);
  assert.match(text, /Id as reported\s+Pro Controller \(STANDARD GAMEPAD Vendor: 057e Product: 2009\)/);
  assert.match(text, /Mapping\s+standard/);
  assert.match(text, /Analog buttons\s+LT/);
  assert.match(text, /Actuator\s+dual-rumble; playEffect yes; reset no; effects not listed by this browser/);
  assert.match(text, /Tests run\s+none yet/);
  assert.match(text, /connected for 0:02 this time/);
  assert.match(text, /Protocol\s+NOT AVAILABLE: iPadOS gives web pages only the Gamepad API/);
  assert.match(text, /Signal strength\s+NOT AVAILABLE/);
  assert.match(text, /Battery\s+NOT AVAILABLE/);
  const report = controllerReport(summarize(reg.slots[0], 3000), reg.slots[0].log, { startedAt: "S", exportedAt: "E", environment: ipad });
  assert.match(report, /browser Safari 17 on iPadOS \(every browser here uses Safari's engine\)/);
});

test("the export carries the browser and the list of what it could not report", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 16);
  const env = describeEnvironment({ userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0" });
  const data = JSON.parse(exportJson(reg.toExport({ startedAt: "S", exportedAt: "E", now: 50, environment: env })));
  assert.equal(data.environment.browser, "Firefox 125");
  assert.equal(data.notAvailableInThisBrowser.length, 4);
  assert.ok(data.pads[0].device.identity.raw);
  assert.equal(data.pads[0].connection.connects, 1);
  assert.equal(data.pads[0].controls.axes, 4);
  const without = JSON.parse(exportJson(reg.toExport({ startedAt: "S", exportedAt: "E", now: 50 })));
  assert.equal(without.environment, undefined, "left out when none was given");
});

test("the card CSS keeps a long name or many axes from stretching the card", () => {
  const dir = new URL("../web/controller-lab/", import.meta.url).pathname;
  const css = readFileSync(join(dir, "index.html"), "utf8");
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = (sel) => css.match(new RegExp(`${escape(sel)}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  // A grid column with no limit grows to its widest child's minimum width, which is how a long name once pushed a card 500px wide.
  assert.match(rule(".pad"), /grid-template-columns:\s*minmax\(0,\s*1fr\)/, "the card has one column that can shrink");
  assert.match(rule(".pad"), /min-width:\s*0/);
  assert.match(rule(".pad > *"), /min-width:\s*0/, "and so can everything in it");
  assert.match(rule(".name"), /text-overflow:\s*ellipsis/);
  assert.match(rule(".name"), /white-space:\s*nowrap/);
  assert.match(rule(".pads"), /minmax\(min\(100%,\s*\d+px\),\s*1fr\)/, "cards never ask for more width than their container");
  assert.match(rule(".axis[hidden]"), /display:\s*none/, "idle extra axes are hidden");
});

test("only the first four axes show at first; the page reveals the others once they move", () => {
  const app = readFileSync(new URL("../web/controller-lab/app.js", import.meta.url), "utf8");
  assert.match(app, /row\.hidden = i >= 4/);
  assert.match(app, /i >= 4 && card\.axisRows\[i\]\.hidden/);
});

// --- iPad Safari: names, and timestamps that are not on the page's clock ---------------------------

test("iPad and iPhone ids, which end in Apple's GameController profile, are taken apart", () => {
  const sn30 = parsePadId("8BitDo SN30 gamepad Extended Gamepad");
  assert.deepEqual([sn30.name, sn30.profile, sn30.format, sn30.vendorId], ["8BitDo SN30 gamepad", "Extended Gamepad", "webkit", null]);
  const joycon = parsePadId("Joy-Con (L) Gamepad");
  assert.deepEqual([joycon.name, joycon.profile, joycon.format], ["Joy-Con (L)", "Gamepad", "webkit"]);
  assert.equal(parsePadId("8Bitdo SN30 GamePad Extended Gamepad").profile, "Extended Gamepad", "case from the browser is tidied");
  assert.equal(parsePadId("Xbox Wireless Controller Micro Gamepad").profile, "Micro Gamepad");
  const other = parsePadId("Totally Unknown Thing");
  assert.deepEqual([other.profile, other.format], [null, "unknown"], "an id without a profile is left alone");
  assert.equal(parsePadId("Gamepad").profile, null, "a bare word is a name, not a name and a profile");
  assert.equal(parsePadId("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)").profile, null);
});

/** A pad whose timestamps are on another clock from the page's and run at another rate, as iPad Safari's do. */
const offClock = (down, axes, ts) => pad(0, { down, axes, timestamp: ts, id: "8BitDo SN30 gamepad Extended Gamepad" });

test("timestamps from another clock are ignored: no age, and the report rate comes from our own polls", () => {
  const reg = createRegistry();
  reg.update([offClock([], [0, 0, 0, 0], 100)], 1_000_000, 1);
  reg.update([offClock([0], [0, 0, 0, 0], 100.4)], 1_000_004, 2);
  for (let i = 0; i < 200; i++) reg.update([offClock([0], [Math.sin(i / 10), 0, 0, 0], 100.8 + i * 0.42)], 1_000_008 + i * 4, 3 + i);
  const s = summarize(reg.slots[0], 900);
  assert.equal(s.deviceTimestamps, false);
  assert.equal(s.timestampsUnusable, true);
  assert.equal(s.age, null, "an age of a million milliseconds is not reported");
  assert.equal(s.report.basis, "our polls");
  assert.equal(s.report.approxHz, 250, "polled every 4 ms, so the most that can be seen is 250 Hz");
  assert.equal(s.report.avgMs, 4);
  assert.ok(s.report.samples > 150);
  // Entries carry no device timestamp either.
  assert.ok(reg.slots[0].log.every((e) => e.ts === undefined && e.age === undefined));
  const text = summaryText(s);
  assert.match(text, /not on the page's clock/);
  assert.match(text, /measured from this page's own polls/);
  assert.doesNotMatch(text, /Seen after/);
});

test("timestamps on the page's clock are still used and still give an age", () => {
  const reg = createRegistry();
  const at = (now, down = []) => pad(0, { down, timestamp: now - 2 });
  tick(reg, [at(0)], 0);
  for (let now = 8; now <= 200; now += 8) tick(reg, [at(now, now > 8 ? [0] : [])], now);
  const s = summarize(reg.slots[0], 200);
  assert.equal(s.deviceTimestamps, true);
  assert.equal(s.timestampsUnusable, false);
  assert.equal(s.report.basis, "device timestamps");
  assert.equal(s.age.avgMs, 2);
  assert.ok(reg.slots[0].log.some((e) => e.age === 2));
});

test("a browser with no timestamps at all measures the report rate from our polls", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 4);
  for (let i = 0; i < 100; i++) tick(reg, [pad(0, { down: [0], axes: [Math.sin(i / 7), 0, 0, 0] })], 8 + i * 4);
  const s = summarize(reg.slots[0], 500);
  assert.equal(s.deviceTimestamps, false);
  assert.equal(s.timestampsUnusable, false, "there are none to distrust");
  assert.equal(s.report.basis, "our polls");
  assert.equal(s.report.approxHz, 250);
  assert.equal(s.age, null);
});

test("polls that see nothing change are not counted as reports", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 4);
  // The stick moves every 8 ms but we poll every 4 ms: half the polls see no change.
  for (let i = 0; i < 100; i++) tick(reg, [pad(0, { down: [0], axes: [Math.floor(i / 2) * 0.02, 0, 0, 0] })], 8 + i * 4);
  const s = summarize(reg.slots[0], 500);
  assert.equal(s.report.avgMs, 8, "changes arrive every 8 ms");
  assert.equal(s.report.approxHz, 125);
});

// --- haptics ---------------------------------------------------------------------------------------

/** A fake vibration actuator that records what it was asked to play. `results` is what each call resolves with. */
function fakeActuator({ results = [], throws = null, withReset = true, effects } = {}) {
  const calls = [];
  const a = {
    type: "dual-rumble",
    calls,
    async playEffect(type, params) {
      calls.push({ type, params });
      if (throws) throw throws;
      return results.shift() ?? "complete";
    },
  };
  if (withReset) a.reset = async () => { calls.push({ reset: true }); return "complete"; };
  if (effects) a.effects = effects;
  return a;
}

test("effect parameters are in the spec's shape, with out-of-range numbers brought into range", () => {
  assert.deepEqual(effectParams({ effect: "dual-rumble", duration: 300, strong: 0.8, weak: 0.4 }), { startDelay: 0, duration: 300, strongMagnitude: 0.8, weakMagnitude: 0.4 });
  assert.deepEqual(effectParams({ effect: "dual-rumble", duration: 99999, strong: 7, weak: -2, startDelay: 5000 }), { startDelay: MAX_DELAY_MS, duration: MAX_DURATION_MS, strongMagnitude: 1, weakMagnitude: 0 });
  assert.deepEqual(effectParams({ effect: "dual-rumble", duration: Number.NaN, strong: Number.NaN }), { startDelay: 0, duration: 0, strongMagnitude: 0, weakMagnitude: 0 }, "unusable numbers become zero");
  const trig = effectParams({ effect: "trigger-rumble", duration: 400, left: 1, right: 0.25 });
  assert.deepEqual([trig.leftTrigger, trig.rightTrigger, trig.strongMagnitude], [1, 0.25, 0]);
  assert.equal(effectParams({ effect: "dual-rumble", duration: 1, left: 1 }).leftTrigger, undefined, "dual-rumble carries no trigger fields");
  assert.equal(clamp01(0.5), 0.5);
  assert.deepEqual(EFFECT_TYPES.slice(), ["dual-rumble", "trigger-rumble"]);
});

test("the presets are valid and each does what its name says", () => {
  assert.deepEqual(PRESETS.map((p) => p.id), ["tap", "strong", "weak", "pulses", "ramp", "triggers"]);
  for (const p of PRESETS) {
    assert.ok(p.steps.length >= 1, p.id);
    for (const st of p.steps) {
      const params = effectParams(st);
      assert.ok(params.duration > 0 && params.duration <= MAX_DURATION_MS, `${p.id} duration`);
      assert.ok(EFFECT_TYPES.includes(st.effect), `${p.id} effect`);
    }
  }
  const by = (id) => PRESETS.find((p) => p.id === id);
  assert.deepEqual([by("strong").steps[0].strong, by("strong").steps[0].weak], [1, 0], "only the strong motor");
  assert.deepEqual([by("weak").steps[0].strong, by("weak").steps[0].weak], [0, 1], "only the weak motor");
  assert.equal(by("pulses").steps.length, 3);
  assert.ok(by("pulses").steps.every((st) => st.gapAfter > 0));
  const ramp = by("ramp").steps.map((st) => st.strong);
  assert.deepEqual(ramp, [...ramp].sort((a, b) => a - b), "the ramp only goes up");
  assert.equal(ramp.at(-1), 1);
  assert.deepEqual(by("triggers").steps.map((st) => [st.left, st.right]), [[1, 0], [0, 1]]);
});

test("steps play in order, one after another, with the gaps between them", async () => {
  const actuator = fakeActuator();
  const sleeps = [];
  let now = 0;
  const seen = [];
  const results = await playSteps(actuator, PRESETS.find((p) => p.id === "pulses").steps, {
    sleep: async (ms) => { sleeps.push(ms); now += ms; },
    clock: () => (now += 10),
    onResult: (r) => seen.push(r.result),
  });
  assert.equal(actuator.calls.length, 3);
  assert.ok(actuator.calls.every((c) => c.type === "dual-rumble" && c.params.strongMagnitude === 1));
  assert.deepEqual(results.map((r) => r.result), ["complete", "complete", "complete"]);
  assert.deepEqual(seen, ["complete", "complete", "complete"], "each result is reported as it arrives");
  assert.deepEqual(sleeps, [150, 150, 150], "a gap after each pulse");
  assert.ok(results.every((r) => r.tookMs === 10), "each took what the clock said");
});

test("a newer effect replacing the old one is reported, not hidden", async () => {
  const actuator = fakeActuator({ results: ["preempted", "complete"] });
  const r = await playSteps(actuator, [{ effect: "dual-rumble", duration: 100, strong: 1 }, { effect: "dual-rumble", duration: 100, strong: 1 }]);
  assert.deepEqual(r.map((x) => x.result), ["preempted", "complete"]);
  assert.deepEqual(["complete", "preempted", "invalid-parameter", "not-ready", "unsupported", "error: NotSupportedError"].map(classifyResult), ["complete", "preempted", "failed", "failed", "failed", "failed"]);
});

test("an actuator that throws, or no actuator, gives a result instead of breaking the run", async () => {
  const err = Object.assign(new Error("not allowed"), { name: "NotAllowedError" });
  const r = await playSteps(fakeActuator({ throws: err }), [{ effect: "dual-rumble", duration: 50, strong: 1 }]);
  assert.equal(r[0].result, "error: NotAllowedError (not allowed)");
  assert.equal((await playSteps(null, [{ effect: "dual-rumble", duration: 50, strong: 1 }]))[0].result, "unsupported");
  assert.equal((await playSteps({}, [{ effect: "dual-rumble", duration: 50, strong: 1 }]))[0].result, "unsupported", "an actuator with no playEffect");
});

test("stopping calls reset, and says so when it cannot", async () => {
  const a = fakeActuator();
  assert.equal(await stopHaptics(a), "complete");
  assert.deepEqual(a.calls, [{ reset: true }]);
  assert.equal(await stopHaptics(fakeActuator({ withReset: false })), "unsupported");
  assert.equal(await stopHaptics(null), "unsupported");
  assert.equal(await stopHaptics({ reset: async () => { throw Object.assign(new Error("x"), { name: "InvalidStateError" }); } }), "error: InvalidStateError");
});

test("what the browser offers is described in plain terms", () => {
  const none = describeHaptics(null);
  assert.deepEqual([none.present, none.canPlay, none.effects], [false, false, null]);
  assert.match(none.summary, /No vibration actuator is exposed/);
  assert.match(describeHaptics(null, 2).summary, /older hapticActuators list \(2\)/);
  const some = describeHaptics(fakeActuator({ effects: ["dual-rumble", "trigger-rumble"] }));
  assert.deepEqual([some.present, some.type, some.canPlay, some.canReset, some.effects], [true, "dual-rumble", true, true, ["dual-rumble", "trigger-rumble"]]);
  assert.match(some.summary, /effects listed: dual-rumble, trigger-rumble/);
  assert.match(describeHaptics(fakeActuator()).summary, /effects not listed by this browser/);
  assert.match(describeHaptics(fakeActuator({ withReset: false })).summary, /reset no/);
});

test("a vibration test is recorded in the controller's transcript, as something done to it and not an input", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 100);
  tick(reg, [pad(0)], 150);
  const before = summarize(reg.slots[0], 400).inputs;
  assert.equal(reg.logHaptic(1, 400, 9, { effect: "dual-rumble", strong: 1, weak: 0.5, duration: 300, startDelay: 0, result: "complete", tookMs: 305.2, label: "Tap" }), true);
  const ev = reg.slots[0].log.at(-1);
  assert.deepEqual([ev.type, ev.effect, ev.strong, ev.weak, ev.duration, ev.result, ev.tookMs, ev.label, ev.t], ["haptic", "dual-rumble", 1, 0.5, 300, "complete", 305.2, "Tap", 400]);
  assert.equal(ev.gap, 250, "since the controller's last input");
  assert.equal(reg.events.at(-1), ev, "also in the combined log");
  const after = summarize(reg.slots[0], 400);
  assert.deepEqual(after.inputs, before, "not counted as an input");
  assert.equal(after.inputs.idleMs, 250, "and idle time is not reset by it");
  assert.equal(reg.logHaptic(7, 400, 9, { effect: "dual-rumble", duration: 1, result: "complete", tookMs: 1 }), false, "an unknown controller");
});

test("haptic tests are counted by how they went, and the last one is remembered", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 10);
  const log = (result, extra = {}) => reg.logHaptic(1, 20, 1, { effect: "dual-rumble", strong: 1, weak: 1, duration: 100, result, tookMs: 100, ...extra });
  log("complete"); log("complete"); log("preempted"); log("error: NotSupportedError"); log("unsupported");
  log("complete", { effect: "trigger-rumble", left: 1, right: 0.5, duration: 400 });
  const h = summarize(reg.slots[0], 30).device.haptics;
  assert.deepEqual([h.tests, h.complete, h.preempted, h.failed], [6, 3, 1, 2]);
  assert.equal(h.last.text, "trigger-rumble L 1.00 R 0.50 for 400 ms: complete");
  // Clearing the log keeps the counts (they are statistics), like the input counts do.
  reg.clearLog();
  assert.equal(summarize(reg.slots[0], 40).device.haptics.tests, 6);
});

test("pausing the log stops haptic tests being recorded in the transcript but they are still counted", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 10);
  reg.recording = false;
  const n = reg.slots[0].log.length;
  reg.logHaptic(1, 20, 1, { effect: "dual-rumble", strong: 1, weak: 1, duration: 100, result: "complete", tookMs: 100 });
  assert.equal(reg.slots[0].log.length, n);
  assert.equal(summarize(reg.slots[0], 30).device.haptics.tests, 1);
});

test("transcript lines and the text report show haptic tests", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 10);
  reg.logHaptic(1, 500, 5, { effect: "dual-rumble", strong: 1, weak: 0.25, duration: 300, startDelay: 100, result: "complete", tookMs: 412.5, label: "Strong motor" });
  reg.logHaptic(1, 900, 6, { effect: "trigger-rumble", left: 1, right: 0, duration: 400, result: "preempted", tookMs: 50 });
  const [, , one, two] = reg.slots[0].log;
  assert.match(formatEvent(one), /HAPTIC\s+\[Strong motor\] dual-rumble\s+strong 1\.00 weak 0\.25\s+for 300 ms, after 100 ms\s+->\s+complete\s+\(took 412\.5 ms\)/);
  assert.match(formatEvent(two), /HAPTIC\s+trigger-rumble\s+triggers L 1\.00 R 0\.00\s+for 400 ms\s+->\s+preempted/);
  const text = summaryText(summarize(reg.slots[0], 1000));
  assert.match(text, /HAPTICS/);
  assert.match(text, /Actuator\s+none exposed by this browser/);
  assert.match(text, /Tests run\s+2: 1 played to the end, 1 replaced by a newer effect, 0 failed/);
  assert.match(text, /Last test\s+trigger-rumble L 1\.00 R 0\.00 for 400 ms: preempted/);
});

test("the export carries the haptic counts, and Motion is among what cannot be read", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 10);
  reg.logHaptic(1, 20, 1, { effect: "dual-rumble", strong: 1, weak: 1, duration: 100, result: "complete", tookMs: 100 });
  const env = describeEnvironment({ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1", maxTouchPoints: 5 });
  const data = JSON.parse(exportJson(reg.toExport({ startedAt: "S", exportedAt: "E", now: 50, environment: env })));
  assert.equal(data.pads[0].device.haptics.tests, 1);
  assert.ok(data.pads[0].transcript.some((e) => e.type === "haptic" && e.result === "complete"));
  assert.ok(data.notAvailableInThisBrowser.some((n) => /Motion sensors/.test(n.field)));
});

test("stopping is written in the transcript but is not counted as a test of the motors", () => {
  const reg = createRegistry();
  tick(reg, [pad(0)], 0);
  tick(reg, [pad(0, { down: [0] })], 10);
  reg.logHaptic(1, 20, 1, { effect: "dual-rumble", strong: 1, weak: 1, duration: 100, result: "complete", tookMs: 100 });
  reg.logHaptic(1, 30, 2, { effect: "reset", strong: 0, weak: 0, duration: 0, result: "complete", tookMs: 0, label: "Stop" });
  const h = summarize(reg.slots[0], 40).device.haptics;
  assert.equal(h.tests, 1, "only the real test counts");
  assert.equal(h.last.effect, "dual-rumble", "and it is still the last test");
  const stop = reg.slots[0].log.at(-1);
  assert.equal(stop.effect, "reset");
  assert.match(formatEvent(stop), /HAPTIC\s+\[Stop\] reset/);
});
