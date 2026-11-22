// The page: polls the controllers, feeds the registry, and shows what it recorded: one card per controller with live
// state and performance, and a transcript viewer with a tab per controller. The rules about who is who, and all the
// measuring, live in registry.js; the text is made in transcript.js. This file only reads pads and touches the DOM.

import { clock, describeEnvironment, unavailable } from "./deviceinfo.js";
import { buttonName } from "./names.js";
import { createRegistry, exportJson, summarize } from "./registry.js";
import { controllerReport, duration, summaryText, transcriptText } from "./transcript.js";

/** @typedef {import("./registry.js").Slot} Slot */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const padsEl = $("pads");
const waitingEl = $("waiting");
const statusEl = $("status");
const noteEl = $("note");
const transcriptEl = $("transcript");
const tabsEl = $("tabs");
const viewsEl = $("views");

const env = describeEnvironment(navigator, window);
const t0 = performance.now();
const registry = createRegistry({ origin: t0 });
const startedAt = new Date();
let frame = 0;

/** @returns {ArrayLike<Gamepad | null>} */
const readPads = () => (navigator.getGamepads ? navigator.getGamepads() : []);

/** Read every pad once and let the registry record what changed. */
function poll() {
  registry.update(readPads(), performance.now(), ++frame);
}

/** A short name for a pad: its id without the parenthesised vendor details. @param {string} id */
const shortName = (id) => id.replace(/\s*\(.*\)\s*$/, "") || id;

/** @param {number} slot @returns {string} the CSS color variables for a player slot, cycling past 8 */
const slotVars = (slot) => `--c: var(--slot-${((slot - 1) % 8) + 1}); --ink: var(--slot-${((slot - 1) % 8) + 1}-ink);`;

/** @param {string} text */
function note(text) {
  noteEl.textContent = text;
}

// --- cards -----------------------------------------------------------------------------------------

/** @typedef {{ root: HTMLElement, buttons: HTMLElement[], axisRows: HTMLElement[], axisBars: HTMLElement[], axisText: HTMLElement[], meta: HTMLElement, devinfo: HTMLElement, state: HTMLElement, last: HTMLElement, perf: HTMLElement, perfSummary: HTMLElement, built: string }} Card */
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
    <div class="devinfo"></div>
    <div class="buttons"></div>
    <div class="axes"></div>
    <p class="last"></p>
    <details class="perfbox"><summary class="perfsum">Performance</summary><div class="perf muted"></div></details>
    <div class="tools">
      <button class="tool" type="button" data-act="transcript" title="Show this controller's transcript">Log</button>
      <button class="tool quiet" type="button" data-act="stats">Stats</button>
      <button class="tool quiet" type="button" data-act="identify">Identify</button>
      <button class="tool quiet" type="button" data-act="forget">Forget</button>
    </div>`;
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
  const axisRows = [];
  const axisBars = [];
  const axisText = [];
  for (let i = 0; i < s.nAxes; i++) {
    const row = document.createElement("div");
    row.className = "axis";
    row.hidden = i >= 4; // the first four always show; the rest appear once they move
    axisRows.push(row);
    row.innerHTML = `<span></span><span class="track"><i></i></span><span></span>`;
    const [label, , value] = /** @type {HTMLElement[]} */ (Array.from(row.children));
    label.textContent = s.mapping === "standard" && i < 4 ? ["LX", "LY", "RX", "RY"][i] : `a${i}`;
    label.title = s.mapping === "standard" && i < 4 ? ["Left stick, horizontal", "Left stick, vertical", "Right stick, horizontal", "Right stick, vertical"][i] : `axis ${i}`;
    axisBars.push(/** @type {HTMLElement} */ (row.querySelector("i")));
    axisText.push(value);
    q(".axes").appendChild(row);
  }
  root.addEventListener("click", (e) => {
    const act = /** @type {HTMLElement} */ (e.target).dataset?.act;
    if (act === "identify") identify(s.slot);
    else if (act === "forget") forget(s.slot);
    else if (act === "transcript") show(s.slot, "transcript");
    else if (act === "stats") show(s.slot, "stats");
  });
  return { root, buttons, axisRows, axisBars, axisText, meta: q(".meta"), devinfo: q(".devinfo"), state: q(".state"), last: q(".last"), perf: q(".perf"), perfSummary: q(".perfsum"), built: `${s.nButtons}x${s.nAxes}:${s.mapping}` };
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
  if (tab === slot) tab = 0;
  note(`P${slot} is free: the next controller to press a button takes it. Its transcript and statistics were dropped (the All log keeps its entries).`);
  renderTabs();
  renderMain(true);
}

/** Create, update and remove cards to match the registered controllers. */
function syncCards() {
  const live = new Set(registry.slots.map((s) => s.slot));
  let changed = false;
  for (const [slot, card] of cards) if (!live.has(slot)) {
    card.root.remove();
    cards.delete(slot);
    changed = true;
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
      changed = true;
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
      if (i >= 4 && card.axisRows[i].hidden && (Math.abs(v) > 0.05 || (s.axisStats[i]?.events ?? 0) > 0)) card.axisRows[i].hidden = false;
      bar.style.left = `${50 + Math.min(0, v) * 50}%`;
      bar.style.width = `${Math.abs(v) * 50}%`;
      card.axisText[i].textContent = v.toFixed(2);
    });
  }
  if (changed) renderTabs();
}

/** A card's performance lines, in words. @param {ReturnType<typeof summarize>} s */
function perfLines(s) {
  const rep = s.report.samples
    ? `Reports about ${s.report.approxHz} Hz while a stick or trigger moves (avg ${s.report.avgMs} ms, 95th ${s.report.p95Ms}, max ${s.report.maxMs}${s.report.jitterMs === null ? "" : `; jitter ${s.report.jitterMs} ms`})`
    : s.deviceTimestamps ? "Reports: move a stick or trigger to measure its rate" : "Reports: this browser gives no device timestamps";
  const seen = s.age ? `Seen ${s.age.avgMs} ms after the device made it (worst ${s.age.maxMs})` : "Seen after: no device timestamps";
  return [
    rep,
    `${seen} · page polls about ${s.poll.approxHz ?? "-"} Hz`,
    `Inputs ${s.inputs.total}: ${s.inputs.perSecondNow}/s now, peak ${s.inputs.perSecondPeak}/s, idle ${duration(s.inputs.idleMs)}`,
  ];
}

// --- text that changes slowly ----------------------------------------------------------------------

/** Status line, waiting list and card details: updated a few times a second, not every frame. @param {number} hz */
function refreshText(hz) {
  const pads = readPads();
  const now = performance.now();
  const connected = registry.slots.filter((s) => s.connected).length;
  const total = registry.slots.length;
  statusEl.textContent = !navigator.getGamepads
    ? "This browser has no Gamepad API."
    : !window.isSecureContext
      ? "The Gamepad API needs a secure page (https or localhost)."
      : `${connected} of ${total} registered controller${total === 1 ? "" : "s"} connected · screen refresh ${hz} Hz · ${registry.events.length} log entries${registry.dropped ? ` (${registry.dropped} older dropped)` : ""}`;
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
    const summary = registry.summary(s.slot, now);
    if (!card || !summary) continue;
    card.state.textContent = s.connected ? "connected" : "disconnected";
    card.meta.textContent = `${s.index === null ? "no index" : `index ${s.index}`} · ${s.mapping || "non-standard"} · ${s.nButtons} buttons · ${s.nAxes} axes`;
    const id = summary.device.identity;
    // Short on purpose: the full identity, ids and the rest are in Stats. A known product needs no ids beside it.
    const who = id.productName
      ? `${id.vendorName ? `${id.vendorName} ` : ""}${id.productName}`
      : [id.vendorName ?? (id.vendorId ? `vendor ${id.vendorId}` : null), id.vendorId && id.productId ? `${id.vendorId}:${id.productId}` : null].filter(Boolean).join(" · ") || "maker and product not given";
    const lines = [
      who,
      s.connected
        ? `Connected ${clock(summary.connection.uptimeMs)}${summary.connection.disconnects ? ` · dropped ${summary.connection.disconnects}×` : ""}${summary.device.vibration ? " · rumble" : ""}`
        : `Disconnected · connected ${clock(summary.connection.totalConnectedMs)} in all`,
    ];
    card.devinfo.title = `${id.raw}\nBattery, signal strength and connection protocol are not available in this browser; see Stats for why.`;
    card.devinfo.replaceChildren(
      ...lines.map((text) => {
        const span = document.createElement("span");
        span.textContent = text;
        return span;
      }),
      (() => {
        const span = document.createElement("span");
        span.className = "na";
        span.textContent = "Battery · signal · protocol: n/a here (see Stats)";
        return span;
      })(),
    );
    card.last.textContent = s.last ? `Last: ${s.last.what} at ${(s.last.t / 1000).toFixed(3)}s` : "No input yet";
    card.perfSummary.textContent = `Performance · ${summary.report.samples ? `${summary.report.approxHz} Hz reports` : "move a stick to measure"} · ${summary.inputs.perSecondNow}/s`;
    card.perf.replaceChildren(
      ...perfLines(summary).map((line) => {
        const span = document.createElement("span");
        span.textContent = line;
        return span;
      }),
    );
  }
}

// --- what this browser can tell us ----------------------------------------------------------------

/** The "This browser" panel: what we are running in, which APIs exist, and what no page can learn here, and why. */
function renderEnvironment() {
  $("env-summary").textContent = `This browser: ${env.browser} on ${env.os}. What it can and cannot tell the lab about a controller`;
  const yes = (/** @type {boolean} */ b) => (b ? "yes" : "no");
  const rows = [
    ["Gamepad API", yes(env.gamepadApi)],
    ["Secure page", yes(env.secureContext)],
    ["Web Bluetooth", yes(env.webBluetooth)],
    ["WebHID", yes(env.webHid)],
    ["Engine", env.webKitOnly ? `Safari's (every browser on ${env.os} uses it)` : env.browser],
  ];
  const dl = document.createElement("dl");
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  const na = document.createElement("dl");
  na.className = "na";
  for (const n of unavailable(env)) {
    const dt = document.createElement("dt");
    dt.textContent = `${n.field}: not available`;
    const dd = document.createElement("dd");
    dd.textContent = n.why;
    na.appendChild(dt);
    na.appendChild(dd);
  }
  const intro = document.createElement("p");
  intro.textContent = "What every controller card does show: its name, maker and product ids, mapping, every button and stick, how often it reports, vibration support, and its connection history.";
  $("env-body").replaceChildren(dl, na, intro);
}

// --- the transcript viewer -------------------------------------------------------------------------

/** Which transcript is showing: 0 is everyone, otherwise a player number. */
let tab = 0;
/** @type {"transcript" | "stats"} */
let view = "transcript";
let lastRenderKey = "";
let lastRenderAt = 0;

/** @param {number} slot @param {"transcript" | "stats"} v */
function show(slot, v) {
  tab = slot;
  view = v;
  renderTabs();
  renderMain(true);
  transcriptEl.scrollIntoView({ block: "nearest" });
}

/** The tab buttons: All, then one per registered controller. */
function renderTabs() {
  const all = document.createElement("button");
  all.className = "tab";
  all.type = "button";
  all.textContent = "All";
  all.setAttribute("role", "tab");
  all.setAttribute("aria-selected", String(tab === 0));
  all.addEventListener("click", () => show(0, "transcript"));
  const rest = registry.slots.map((s) => {
    const b = document.createElement("button");
    b.className = "tab";
    b.type = "button";
    b.setAttribute("style", slotVars(s.slot));
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(tab === s.slot));
    b.textContent = `P${s.slot}`;
    b.addEventListener("click", () => show(s.slot, view));
    return b;
  });
  tabsEl.replaceChildren(all, ...rest);
  viewsEl.hidden = tab === 0;
  $("reset-stats").hidden = view !== "stats" || tab === 0;
  $("view-transcript").setAttribute("aria-selected", String(view === "transcript" || tab === 0));
  $("view-stats").setAttribute("aria-selected", String(view === "stats" && tab !== 0));
}
$("reset-stats").addEventListener("click", () => {
  if (tab && registry.resetStats(tab)) {
    note(`P${tab}'s statistics were reset. Its transcript is kept.`);
    renderMain(true);
  }
});
$("view-transcript").addEventListener("click", () => show(tab, "transcript"));
$("view-stats").addEventListener("click", () => show(tab, "stats"));

/** How many transcript lines to show, 0 for all. */
const limit = () => Number(/** @type {{ value: string }} */ (/** @type {unknown} */ (document.getElementById("limit"))).value);
const follow = () => /** @type {HTMLInputElement} */ (document.getElementById("follow")).checked;

/** @returns {Slot | undefined} the controller whose tab is showing */
const currentSlot = () => registry.slots.find((s) => s.slot === tab);

/** The text for the tab being shown. @param {number} now */
function mainText(now) {
  const s = currentSlot();
  if (tab !== 0 && !s) return "";
  if (tab !== 0 && s && view === "stats") return summaryText(summarize(s, now - t0), env);
  const n = limit();
  const events = s ? s.log : registry.events;
  const shown = n ? events.slice(-n) : events;
  const hidden = events.length - shown.length;
  const text = transcriptText(shown, { player: !s });
  return hidden > 0 ? `... ${hidden} earlier entries not shown (change "Show" to see all)\n${text}` : text;
}

/** Redraw the transcript pane if anything it shows has changed. @param {boolean} [force] */
function renderMain(force = false) {
  const now = performance.now();
  const s = currentSlot();
  const count = s ? s.log.length : registry.events.length;
  const key = `${tab}|${view}|${limit()}|${count}|${registry.dropped}|${s ? s.logDropped : 0}`;
  const stats = tab !== 0 && view === "stats";
  if (!force && !stats && key === lastRenderKey) return;
  if (!force && now - lastRenderAt < 120) return;
  lastRenderKey = key;
  lastRenderAt = now;
  const atEnd = transcriptEl.scrollTop + transcriptEl.clientHeight >= transcriptEl.scrollHeight - 8;
  transcriptEl.textContent = mainText(now) || (tab !== 0 ? "" : "Nothing recorded yet. Press a button on a controller.");
  transcriptEl.classList.toggle("stats", stats);
  $("thead").hidden = stats;
  $("thead").textContent = s ? "     time        gap  event" : "     time        gap  player  event";
  if (!stats && follow() && (atEnd || force)) transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

// --- log toolbar and exports -----------------------------------------------------------------------

const pauseBtn = $("pause");
pauseBtn.addEventListener("click", () => {
  registry.recording = !registry.recording;
  pauseBtn.textContent = registry.recording ? "Pause log" : "Resume log";
  note(registry.recording ? "Logging." : "Log paused: controllers still show live and their statistics keep counting, but transcripts get nothing new.");
});
$("clear").addEventListener("click", () => {
  registry.clearLog();
  renderMain(true);
  note("Transcripts cleared. Registered controllers and their statistics stay.");
});
$("limit").addEventListener("change", () => renderMain(true));

const meta = () => ({ startedAt: startedAt.toISOString(), exportedAt: new Date().toISOString(), now: performance.now(), environment: env });

/** A time stamp for file names, like 20261121-143005. */
function stamp() {
  const d = new Date();
  const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

/** The whole transcript text for the tab: the controller's report, or the combined log. */
function fullText() {
  const m = meta();
  const s = currentSlot();
  if (s) return controllerReport(summarize(s, m.now - t0), s.log, { startedAt: m.startedAt, exportedAt: m.exportedAt, dropped: s.logDropped, environment: env });
  return [`controller lab - all controllers`, `session started ${m.startedAt}, exported ${m.exportedAt}`, "", "     time        gap  player  event", transcriptText(registry.events, { player: true }), ""].join("\n");
}

/** @param {string} filename @param {string} text @param {string} type */
function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const scopeName = () => (tab === 0 ? "all" : `p${tab}`);

$("download-txt").addEventListener("click", () => {
  download(`controller-lab-${scopeName()}-${stamp()}.txt`, fullText(), "text/plain");
  note(`Downloaded ${tab === 0 ? "the combined" : `P${tab}'s`} transcript as text.`);
});
$("download-json").addEventListener("click", () => {
  download(`controller-lab-${scopeName()}-${stamp()}.json`, exportJson(registry.toExport(meta(), tab === 0 ? undefined : tab)), "application/json");
  note(`Downloaded ${tab === 0 ? "everything" : `P${tab}`} as JSON, with statistics.`);
});
$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(fullText());
    note(`Copied ${tab === 0 ? "the combined" : `P${tab}'s`} transcript.`);
  } catch {
    note("Could not copy: use Download text instead.");
  }
});

// --- the loops -------------------------------------------------------------------------------------

/**
 * A second, faster polling loop. A page that only polls once per screen refresh (60 times a second) cannot see a
 * controller report more often than that, so by default this adds a poll about every 4 ms (browsers clamp timers to
 * that), enough to resolve a 125 Hz or 250 Hz device. The transcript and statistics count every poll.
 */
const fastBox = /** @type {HTMLInputElement} */ (document.getElementById("fast"));
function fastLoop() {
  if (fastBox.checked && !document.hidden) poll();
  setTimeout(fastLoop, 1);
}

let framesThisSecond = 0;
let hz = 0;
let lastHzAt = performance.now();
let lastTextAt = 0;

function loop() {
  const now = performance.now();
  poll();
  syncCards();
  renderMain();
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

renderEnvironment();
renderTabs();
refreshText(0);
renderMain(true);
setTimeout(fastLoop, 1);
requestAnimationFrame(loop);
