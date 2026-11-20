import {
  QUADRANTS, buildExport, currentStreak, dayKey, formatClock, groupByDay, longestStreak,
  mergeSessions, monthGrid, normalizeSession, parseDay, parseImport, summarize,
} from "./logic.js";

const STORE = "toothup:v1";
const $ = (id) => document.getElementById(id);

/** @type {{ sessions: import("./logic.js").Session[], perQuadrant: number }} */
let state = { sessions: [], perQuadrant: 30 };
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || "null");
  if (saved) {
    state.sessions = (saved.sessions || []).map(normalizeSession).filter(Boolean);
    state.perQuadrant = [15, 20, 30, 45, 60].includes(saved.perQuadrant) ? saved.perQuadrant : 30;
  }
} catch {}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    toast("Could not save to this browser's storage");
  }
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.textContent = ""), 4000);
}

// ---------- tabs ----------
const tabs = ["brush", "calendar", "stats", "data"];
function showTab(name) {
  for (const t of tabs) {
    $(`tab-${t}`).setAttribute("aria-selected", String(t === name));
    $(`view-${t}`).hidden = t !== name;
  }
  if (name === "stats" || name === "calendar") renderStats();
  if (name === "data") renderData();
}
for (const t of tabs) $(`tab-${t}`).addEventListener("click", () => showTab(t));

// ---------- timer ----------
/** idle | running | paused | done */
const run = { phase: "idle", step: 0, endAt: 0, left: 0, begun: 0, elapsed: 0, savedId: null, timer: 0, wake: null };

function audio() {
  try {
    return (audio.ctx ||= new AudioContext());
  } catch {
    return null;
  }
}
function beep(freq = 880, ms = 180) {
  const ctx = audio();
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = freq;
  g.gain.value = 0.15;
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + ms / 1000);
}
function cue(long) {
  beep(long ? 660 : 880, long ? 400 : 180);
  navigator.vibrate?.(long ? [200, 100, 200] : 120);
}

async function keepAwake(on) {
  try {
    if (on && "wakeLock" in navigator) run.wake = await navigator.wakeLock.request("screen");
    else if (run.wake) {
      await run.wake.release();
      run.wake = null;
    }
  } catch {}
}

function startStep(i) {
  run.step = i;
  run.left = state.perQuadrant;
  run.endAt = Date.now() + run.left * 1000;
}

function begin() {
  audio()?.resume?.();
  if (run.phase === "idle" || run.phase === "done") {
    if (run.phase === "done") {
      flossed = false;
      $("floss").setAttribute("aria-pressed", "false");
    }
    run.begun = Date.now();
    run.elapsed = 0;
    run.savedId = null;
    startStep(0);
  } else {
    run.endAt = Date.now() + run.left * 1000; // resume from paused
  }
  run.phase = "running";
  cue(false);
  clearInterval(run.timer);
  run.timer = setInterval(tick, 200);
  keepAwake(true);
  renderBrush();
}

function tick() {
  if (run.phase !== "running") return;
  run.left = Math.max(0, (run.endAt - Date.now()) / 1000);
  if (run.left <= 0) {
    run.elapsed += state.perQuadrant;
    if (run.step + 1 < QUADRANTS.length) {
      startStep(run.step + 1);
      cue(false);
    } else return finish(4);
  }
  renderBrush();
}

function pause() {
  tick();
  if (run.phase !== "running") return;
  run.phase = "paused";
  clearInterval(run.timer);
  keepAwake(false);
  renderBrush();
}

function skip() {
  if (run.phase === "idle" || run.phase === "done") return;
  run.elapsed += state.perQuadrant - Math.ceil(run.left);
  if (run.step + 1 < QUADRANTS.length) {
    startStep(run.step + 1);
    cue(false);
    renderBrush();
  } else finish(4);
}

function finish(quadrants) {
  clearInterval(run.timer);
  keepAwake(false);
  if (quadrants < 4) run.elapsed += state.perQuadrant - Math.ceil(run.left);
  run.phase = "done";
  run.left = 0;
  const s = normalizeSession({
    id: `s${run.begun}`, start: run.begun, seconds: run.elapsed,
    flossed: flossed, quadrants,
  });
  state.sessions = mergeSessions(state.sessions, [s]).sessions;
  run.savedId = s.id;
  save();
  cue(true);
  renderBrush();
}

function stopEarly() {
  if (run.phase === "running" || run.phase === "paused") {
    const done = run.step;
    finish(done);
  }
}

function reset() {
  clearInterval(run.timer);
  keepAwake(false);
  run.phase = "idle";
  run.step = 0;
  run.left = state.perQuadrant;
  renderBrush();
}

const RING = 2 * Math.PI * 46;
const SVGNS = "http://www.w3.org/2000/svg";

/** Draw both arches. Screen left is the user's left; quadrant order is UR, UL, LL, LR. */
function buildMouth() {
  const svg = $("mouth");
  const radii = [10.5, 10, 11.5, 10, 10.5, 13.5, 14]; // incisors to molars
  const arch = (cy, ry, up, qLeft, qRight) => {
    for (const [side, q] of [[-1, qLeft], [1, qRight]]) {
      const g = document.createElementNS(SVGNS, "g");
      g.dataset.q = String(q);
      radii.forEach((r, i) => {
        const a = ((i + 0.55) / 7) * (Math.PI / 2) * 0.97;
        const c = document.createElementNS(SVGNS, "circle");
        c.setAttribute("cx", String(100 + side * 82 * Math.sin(a)));
        c.setAttribute("cy", String(cy + (up ? -1 : 1) * ry * Math.cos(a)));
        c.setAttribute("r", String(r));
        g.append(c);
      });
      svg.append(g);
    }
  };
  arch(112, 100, true, 1, 0);
  arch(158, 94, false, 2, 3);
  for (const [x, t] of [[12, "L"], [188, "R"]]) {
    const el = document.createElementNS(SVGNS, "text");
    el.setAttribute("x", String(x));
    el.setAttribute("y", "139");
    el.setAttribute("text-anchor", "middle");
    el.setAttribute("class", "lr");
    el.textContent = t;
    svg.append(el);
  }
}
buildMouth();

function renderBrush() {
  const idle = run.phase === "idle";
  const done = run.phase === "done";
  const live = run.phase === "running" || run.phase === "paused";
  const per = state.perQuadrant;
  const total = per * QUADRANTS.length;
  const remaining = idle ? total : done ? 0 : run.left + (QUADRANTS.length - 1 - run.step) * per;
  $("total").textContent = formatClock(remaining);
  $("clock").textContent = done ? "Done" : formatClock(idle ? per : run.left);
  $("quad-name").textContent = done ? "Nice work" : idle ? "Ready" : QUADRANTS[run.step];
  $("progress").textContent = done
    ? `${formatClock(run.elapsed)} brushed`
    : idle ? `${QUADRANTS.length} × ${per}s`
    : `${run.step + 1} of 4${run.phase === "paused" ? " · paused" : ""}`;
  const mouth = $("mouth");
  mouth.classList.toggle("live", live);
  mouth.classList.toggle("finished", done);
  mouth.querySelectorAll("g[data-q]").forEach((el) => {
    const i = Number(el.dataset.q);
    el.classList.toggle("active", live && i === run.step);
    el.classList.toggle("done", live && i < run.step);
  });
  const arc = document.querySelector("#go .arc");
  arc.style.strokeDasharray = String(RING);
  arc.style.strokeDashoffset = String(RING * (1 - remaining / total));
  const label = run.phase === "running" ? "Pause" : live ? "Resume" : done ? "Brush again" : "Start";
  $("go").setAttribute("aria-label", label);
  document.querySelector("#go .glyph").textContent = run.phase === "running" ? "❚❚" : "▶";
  $("go").onclick = run.phase === "running" ? pause : begin;
  $("skip").hidden = !live;
  $("stop").hidden = !live;
  $("reset").hidden = idle;
  $("per-quad").disabled = live;
}
$("skip").onclick = skip;
$("stop").onclick = stopEarly;
$("reset").onclick = reset;
$("per-quad").value = String(state.perQuadrant);
$("per-quad").onchange = (e) => {
  state.perQuadrant = Number(e.target.value);
  save();
  if (run.phase === "idle") renderBrush();
};
let flossed = false;
$("floss").addEventListener("click", () => {
  flossed = !flossed;
  $("floss").setAttribute("aria-pressed", String(flossed));
  if (run.phase === "done" && run.savedId) {
    const s = state.sessions.find((x) => x.id === run.savedId);
    if (s) {
      s.flossed = flossed;
      save();
    }
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && run.phase === "running") {
    keepAwake(true);
    tick();
  }
});

// ---------- stats ----------
const today = () => dayKey(Date.now());
let view = (() => {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth(), selected: today() };
})();

function renderStats() {
  const t = today();
  const w = summarize(state.sessions, t, 7);
  const m = summarize(state.sessions, t, 30);
  const tiles = [
    ["Streak", currentStreak(state.sessions, t), "days"],
    ["Best streak", longestStreak(state.sessions), "days"],
    ["7 days", `${w.daysBrushed}/7`, "days brushed"],
    ["30 days", `${m.daysBrushed}/30`, "days brushed"],
    ["Flossed", `${m.flossDays}/30`, "days, last 30"],
    ["Average", m.sessions ? formatClock(m.avgSeconds) : "–", "per brush"],
  ];
  $("tiles").innerHTML = tiles
    .map(([k, v, u]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="u">${u}</div></div>`)
    .join("");
  renderCalendar();
  renderDay();
}

function renderCalendar() {
  const byDay = groupByDay(state.sessions);
  const t = today();
  $("month-label").textContent = new Date(view.y, view.m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  $("cal-body").innerHTML = monthGrid(view.y, view.m)
    .map((week) => `<tr>${week.map((k) => {
      if (!k) return "<td></td>";
      const list = byDay.get(k) || [];
      const floss = list.some((s) => s.flossed);
      const level = Math.min(list.length, 2);
      const label = `${parseDay(k).toLocaleDateString(undefined, { dateStyle: "full" })}: ${list.length} brush${list.length === 1 ? "" : "es"}${floss ? ", flossed" : ""}`;
      return `<td><button class="day l${level}${k === t ? " today" : ""}${k === view.selected ? " sel" : ""}" data-day="${k}" aria-label="${label}">` +
        `${Number(k.slice(8))}<span class="mark">${floss ? "✦" : ""}</span></button></td>`;
    }).join("")}</tr>`)
    .join("");
}

function renderDay() {
  const list = (groupByDay(state.sessions).get(view.selected) || []).slice().sort((a, b) => a.start - b.start);
  $("day-title").textContent = parseDay(view.selected).toLocaleDateString(undefined, { dateStyle: "full" });
  const ul = $("day-list");
  ul.innerHTML = "";
  if (!list.length) ul.innerHTML = '<li class="muted">No brushing logged.</li>';
  for (const s of list) {
    const li = document.createElement("li");
    const time = new Date(s.start).toLocaleTimeString(undefined, { timeStyle: "short" });
    li.append(`${time} · ${formatClock(s.seconds)} · ${s.quadrants}/4 quadrants${s.flossed ? " · flossed" : ""} `);
    const del = document.createElement("button");
    del.className = "link";
    del.textContent = "delete";
    del.onclick = () => {
      if (!confirm("Delete this brushing?")) return;
      state.sessions = state.sessions.filter((x) => x.id !== s.id);
      save();
      renderStats();
    };
    li.append(del);
    ul.append(li);
  }
}

$("cal-body").addEventListener("click", (e) => {
  const b = e.target.closest("[data-day]");
  if (!b) return;
  view.selected = b.dataset.day;
  renderCalendar();
  renderDay();
});
function shiftMonth(n) {
  const d = new Date(view.y, view.m + n, 1);
  view.y = d.getFullYear();
  view.m = d.getMonth();
  renderCalendar();
}
$("prev").onclick = () => shiftMonth(-1);
$("next").onclick = () => shiftMonth(1);
$("this-month").onclick = () => {
  const d = new Date();
  view = { y: d.getFullYear(), m: d.getMonth(), selected: today() };
  renderStats();
};

$("log-manual").onclick = () => {
  // Log a brushing on the selected day without the timer, at noon unless it's today.
  const base = parseDay(view.selected);
  base.setHours(view.selected === today() ? new Date().getHours() : 12, view.selected === today() ? new Date().getMinutes() : 0, 0, 0);
  let start = base.getTime();
  while (state.sessions.some((s) => s.start === start)) start += 1000;
  const s = normalizeSession({ id: `s${start}`, start, seconds: state.perQuadrant * 4, flossed: false, quadrants: 4 });
  state.sessions = mergeSessions(state.sessions, [s]).sessions;
  save();
  renderStats();
};

// ---------- data ----------
function renderData() {
  $("count").textContent = `${state.sessions.length} brushing${state.sessions.length === 1 ? "" : "s"} stored on this device.`;
}

$("export").onclick = () => {
  const blob = new Blob([JSON.stringify(buildExport(state.sessions), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `toothup-${dayKey(Date.now())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

$("import-btn").onclick = () => $("import").click();
$("import").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const { sessions, skipped } = parseImport(await file.text());
    const merged = mergeSessions(state.sessions, sessions);
    state.sessions = merged.sessions;
    save();
    renderData();
    toast(`Imported ${merged.added} new, ${sessions.length - merged.added} already present${skipped ? `, ${skipped} skipped` : ""}.`);
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  }
};

$("clear").onclick = () => {
  if (!confirm("Delete all brushing history on this device? Export first if you want a copy.")) return;
  state.sessions = [];
  save();
  renderData();
  toast("History cleared.");
};

renderBrush();
