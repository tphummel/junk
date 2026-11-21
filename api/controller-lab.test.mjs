// Tests for web/controller-lab/: registering controllers and attributing their inputs. Fake pads stand in for
// navigator.getGamepads(); no browser needed. Run with `npm test`.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { axisName, buttonName } from "../web/controller-lab/names.js";
import { createRegistry, exportJson } from "../web/controller-lab/registry.js";

/** A fake pad. `down` lists pressed button indexes (value 1); `axes` its axis values. */
function pad(index, { down = [], axes = [0, 0, 0, 0], id = `Pad ${index} (STANDARD GAMEPAD)`, mapping = "standard", connected = true, buttons = 17, values = {} } = {}) {
  return {
    index, id, mapping, connected, axes,
    buttons: Array.from({ length: buttons }, (_, i) => ({ pressed: down.includes(i), value: values[i] ?? (down.includes(i) ? 1 : 0) })),
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

test("the export parses back to the registered pads and the log", () => {
  const reg = createRegistry();
  tick(reg, [pad(0), pad(1)], 0);
  tick(reg, [pad(0, { down: [0] }), pad(1, { down: [1] })], 16);
  tick(reg, [pad(0), pad(1, { down: [1], axes: [0.9, 0, 0, 0] })], 32);
  const text = exportJson(reg.toExport({ startedAt: "2026-11-21T00:00:00.000Z", exportedAt: "2026-11-21T00:01:00.000Z" }));
  const back = JSON.parse(text);
  assert.equal(back.app, "controller-lab");
  assert.equal(back.format, 1);
  assert.deepEqual(back.pads.map((p) => p.slot), [1, 2]);
  assert.equal(back.pads[0].presses, 1);
  assert.equal(back.pads[1].axisEvents, 1);
  assert.equal(back.events.length, reg.events.length);
  assert.ok(text.includes('{"t":'), "log entries one per line");
  assert.ok(back.events.every((e) => typeof e.slot === "number" && typeof e.t === "number"));
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
