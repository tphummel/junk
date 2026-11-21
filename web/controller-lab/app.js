// The page: polls every frame, feeds the registry, and draws one card per registered controller plus the log.
// The rules about who is who live in registry.js; this file only reads pads and touches the DOM.

import { buttonName } from "./names.js";
import { createRegistry, exportJson } from "./registry.js";

/** @typedef {import("./registry.js").LogEvent} LogEvent */
/** @typedef {import("./registry.js").Slot} Slot */

const MAX_LOG_ROWS = 400;

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const padsEl = $("pads");
const waitingEl = $("waiting");
const statusEl = $("status");
const logEl = $("log");
const noteEl = $("note");

const registry = createRegistry();
const startedAt = new Date();
const t0 = performance.now();
let frame = 0;

/** @returns {ArrayLike<Gamepad | null>} */
const readPads = () => (navigator.getGamepads ? navigator.getGamepads() : []);

/** A short name for a pad: its id without the parenthesised vendor details. @param {string} id */
const shortName = (id) => id.replace(/\s*\(.*\)\s*$/, "") || id;

/** @param {number} slot @returns {string} the CSS color variables for a player slot, cycling past 8 */
const slotVars = (slot) => `--c: var(--slot-${((slot - 1) % 8) + 1}); --ink: var(--slot-${((slot - 1) % 8) + 1}-ink);`;

/** @typedef {{ root: HTMLElement, buttons: HTMLElement[], axisBars: HTMLElement[], axisText: HTMLElement[], meta: HTMLElement, state: HTMLElement, last: HTMLElement, counts: HTMLElement, built: string }} Card */
/** @type {Map<number, Card>} */
const cards = new Map();

/** The pieces of a controller card. @param {Slot} s @returns {Card} */
function buildCard(s) {
  const root = document.createElement("article");
  root.className = "pad";
  root.setAttribute("style", slotVars(s.slot));
  root.innerHTML = `
    <header><span class="badge">P${s.slot}</span><strong class="name"></strong><span class="state"></span></header>
    <p class="meta muted"></p>
    <div class="buttons"></div>
    <div class="axes"></div>
    <p class="last"></p>
    <p class="counts muted"></p>
    <div class="tools"><button class="tool" type="button" data-act="identify">Identify</button><button class="tool quiet" type="button" data-act="forget">Forget</button></div>`;
  const q = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (root.querySelector(sel));
  const name = q(".name");
  name.textContent = shortName(s.id);
  name.title = s.id;
  const buttons = Array.from({ length: s.nButtons }, (_, i) => {
    const b = document.createElement("div");
    b.className = "b";
    b.textContent = buttonName(s.mapping, i).replace("button ", "");
    b.title = buttonName(s.mapping, i);
    q(".buttons").appendChild(b);
    return b;
  });
  const axisBars = [];
  const axisText = [];
  for (let i = 0; i < s.nAxes; i++) {
    const row = document.createElement("div");
    row.className = "axis";
    row.innerHTML = `<span></span><span class="track"><i></i></span><span></span>`;
    const [label, , value] = /** @type {HTMLElement[]} */ (Array.from(row.children));
    label.textContent = s.mapping === "standard" && i < 4 ? ["LX", "LY", "RX", "RY"][i] : `axis ${i}`;
    axisBars.push(/** @type {HTMLElement} */ (row.querySelector("i")));
    axisText.push(value);
    q(".axes").appendChild(row);
  }
  root.addEventListener("click", (e) => {
    const act = /** @type {HTMLElement} */ (e.target).dataset?.act;
    if (act === "identify") identify(s.slot);
    if (act === "forget") forget(s.slot);
  });
  return { root, buttons, axisBars, axisText, meta: q(".meta"), state: q(".state"), last: q(".last"), counts: q(".counts"), built: `${s.nButtons}x${s.nAxes}:${s.mapping}` };
}

/** Rumble the controller (where the browser supports it) and flash its card, to see which one is which. @param {number} slot */
function identify(slot) {
  const s = registry.slots.find((x) => x.slot === slot);
  const card = cards.get(slot);
  if (!s || !card) return;
  card.root.classList.add("flash");
  setTimeout(() => card.root.classList.remove("flash"), 700);
  const pad = s.index === null ? null : readPads()[s.index];
  /** @type {any} */
  const actuator = pad && /** @type {any} */ (pad).vibrationActuator;
  if (actuator?.playEffect) {
    actuator.playEffect("dual-rumble", { startDelay: 0, duration: 400, weakMagnitude: 1, strongMagnitude: 1 }).catch(() => {});
  } else {
    note(`P${slot}: this browser cannot rumble the controller; its card flashed instead.`);
  }
}

/** @param {number} slot */
function forget(slot) {
  registry.forget(slot);
  cards.get(slot)?.root.remove();
  cards.delete(slot);
  note(`P${slot} is free: the next controller to press a button takes it.`);
}

/** @param {string} text */
function note(text) {
  noteEl.textContent = text;
}

/** A log row. @param {LogEvent} e */
function logRow(e) {
  const li = document.createElement("li");
  li.setAttribute("style", slotVars(e.slot));
  const time = document.createElement("time");
  time.textContent = `${(e.t / 1000).toFixed(3)}s`;
  const who = document.createElement("b");
  who.textContent = `P${e.slot}`;
  const what = document.createElement("span");
  what.textContent =
    e.type === "register" ? `registered: ${shortName(e.id)} (index ${e.index}, ${e.mapping || "no"} mapping)`
    : e.type === "disconnect" ? "disconnected"
    : e.type === "reconnect" ? `reconnected (index ${e.index})`
    : e.type === "button" ? `${e.name} ${e.state}${e.value > 0 && e.value < 1 ? ` (${e.value.toFixed(2)})` : ""}`
    : `${e.name} ${e.value.toFixed(2)}`;
  li.appendChild(time);
  li.appendChild(who);
  li.appendChild(what);
  return li;
}

/** Put new log entries at the top, keeping the list short. @param {readonly LogEvent[]} events */
function appendLog(events) {
  for (const e of events) logEl.insertBefore(logRow(e), logEl.firstChild);
  while (logEl.children.length > MAX_LOG_ROWS) logEl.lastElementChild?.remove();
}

/** Create, update and remove cards to match the registered controllers. */
function syncCards() {
  const live = new Set(registry.slots.map((s) => s.slot));
  for (const [slot, card] of cards) if (!live.has(slot)) {
    card.root.remove();
    cards.delete(slot);
  }
  for (const s of registry.slots) {
    let card = cards.get(s.slot);
    if (card && card.built !== `${s.nButtons}x${s.nAxes}:${s.mapping}`) {
      card.root.remove();
      card = undefined;
    }
    if (!card) {
      card = buildCard(s);
      cards.set(s.slot, card);
      padsEl.appendChild(card.root);
      // Keep cards in player order.
      [...cards.entries()].sort((a, b) => a[0] - b[0]).forEach(([, c]) => padsEl.appendChild(c.root));
    }
    card.root.classList.toggle("gone", !s.connected);
    s.buttons.forEach((b, i) => {
      const el = card.buttons[i];
      if (!el) return;
      el.classList.toggle("on", b.pressed);
      el.style.setProperty("--v", b.pressed ? "1" : String(b.value));
    });
    s.axes.forEach((v, i) => {
      const bar = card.axisBars[i];
      if (!bar) return;
      bar.style.left = `${50 + Math.min(0, v) * 50}%`;
      bar.style.width = `${Math.abs(v) * 50}%`;
      card.axisText[i].textContent = v.toFixed(2);
    });
  }
}

/** Text that changes slowly (status line, card details): updated a few times a second, not every frame. @param {number} hz */
function refreshText(hz) {
  const pads = readPads();
  const connected = registry.slots.filter((s) => s.connected).length;
  const total = registry.slots.length;
  const secure = window.isSecureContext;
  statusEl.textContent = !navigator.getGamepads
    ? "This browser has no Gamepad API."
    : !secure
      ? "The Gamepad API needs a secure page (https or localhost)."
      : `${connected} of ${total} registered controller${total === 1 ? "" : "s"} connected · polling at ${hz} Hz · ${registry.events.length} log entries${registry.dropped ? ` (${registry.dropped} older dropped)` : ""}`;
  const waiting = registry.unregistered(pads);
  waitingEl.replaceChildren(
    ...waiting.map((w) => {
      const p = document.createElement("p");
      p.textContent = `Detected ${shortName(w.id)} (index ${w.index}): press a button on it to register.`;
      return p;
    }),
  );
  if (total === 0 && waiting.length === 0) {
    if (!padsEl.querySelector(".empty")) {
      const d = document.createElement("div");
      d.className = "empty";
      d.textContent = "No controllers yet. Press any button on a controller (wake Bluetooth pads first) and it will appear here.";
      padsEl.appendChild(d);
    }
  } else padsEl.querySelector(".empty")?.remove();
  for (const s of registry.slots) {
    const card = cards.get(s.slot);
    if (!card) continue;
    card.state.textContent = s.connected ? "connected" : "disconnected";
    card.meta.textContent = `${s.index === null ? "no index" : `index ${s.index}`} · ${s.mapping || "no"} mapping · ${s.nButtons} buttons · ${s.nAxes} axes`;
    card.last.textContent = s.last ? `Last: ${s.last.what} at ${(s.last.t / 1000).toFixed(3)}s` : "No input yet";
    card.counts.textContent = `Presses ${s.stats.presses} · releases ${s.stats.releases} · axis moves ${s.stats.axisEvents}`;
  }
}

// --- the log toolbar -------------------------------------------------------------------------------

const pauseBtn = $("pause");
pauseBtn.addEventListener("click", () => {
  registry.recording = !registry.recording;
  pauseBtn.textContent = registry.recording ? "Pause log" : "Resume log";
  note(registry.recording ? "Logging." : "Log paused: controllers still show live, but nothing is added to the log.");
});
$("clear").addEventListener("click", () => {
  registry.clearLog();
  logEl.replaceChildren();
  note("Log cleared. Registered controllers stay.");
});

/** The whole session as JSON text. */
const exportText = () => exportJson(registry.toExport({ startedAt: startedAt.toISOString(), exportedAt: new Date().toISOString() }));

$("download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([exportText()], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  const d = new Date();
  const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
  a.download = `controller-lab-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  note("Downloaded the log as JSON.");
});

$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(exportText());
    note("Copied the log as JSON.");
  } catch {
    note("Could not copy: use Download JSON instead.");
  }
});

// --- the loop --------------------------------------------------------------------------------------

let framesThisSecond = 0;
let hz = 0;
let lastHzAt = performance.now();
let lastTextAt = 0;

function loop() {
  const now = performance.now();
  appendLog(registry.update(readPads(), now - t0, ++frame));
  syncCards();
  framesThisSecond++;
  if (now - lastHzAt >= 1000) {
    hz = Math.round((framesThisSecond * 1000) / (now - lastHzAt));
    framesThisSecond = 0;
    lastHzAt = now;
  }
  if (now - lastTextAt > 250) {
    refreshText(hz);
    lastTextAt = now;
  }
  requestAnimationFrame(loop);
}

refreshText(0);
requestAnimationFrame(loop);
