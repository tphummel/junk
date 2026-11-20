import {
  STEPS, TOTAL_SECONDS, buildExport, currentStreak, dayKey, formatClock, freshStart, groupByDay, longestStreak,
  mergeEvents, monthGrid, normalizeAll, normalizeEvent, normalizeSettings, parseDay, parseImport, routineStats, dayRoutine, summarize,
} from "./logic.js";

const STORE = "toothup:v2";
const OLD_STORE = "toothup:v1"; // sessions with a flossed flag; migrated on first load
const $ = (id) => document.getElementById(id);

/** @type {{ events: import("./logic.js").Event[], settings: { morningEnd: number, eveningStart: number } }} */
let state = { events: [], settings: normalizeSettings(null) };
try {
  const raw = localStorage.getItem(STORE) ?? localStorage.getItem(OLD_STORE);
  const saved = JSON.parse(raw || "null");
  if (saved) {
    state.events = normalizeAll(saved.events || saved.sessions || []).events;
    state.settings = normalizeSettings(saved.settings);
  }
} catch {}

function save() {
  queueMicrotask(() => typeof renderToday === "function" && renderToday());
  try {
    localStorage.setItem(STORE, JSON.stringify({ events: state.events, settings: state.settings }));
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
const run = { phase: "idle", step: 0, endAt: 0, left: 0, begun: 0, elapsed: 0, timer: 0, wake: null };

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
  run.left = STEPS[i].seconds;
  run.endAt = Date.now() + run.left * 1000;
}

function begin() {
  audio()?.resume?.();
  if (run.phase === "idle" || run.phase === "done") {
    if (run.phase === "done") clearLogged();
    run.begun = Date.now();
    run.elapsed = 0;
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
    run.elapsed += STEPS[run.step].seconds;
    if (run.step + 1 < STEPS.length) {
      startStep(run.step + 1);
      cue(false);
    } else return finish(STEPS.length);
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
  run.elapsed += STEPS[run.step].seconds - Math.ceil(run.left);
  if (run.step + 1 < STEPS.length) {
    startStep(run.step + 1);
    cue(false);
    renderBrush();
  } else finish(STEPS.length);
}

function finish(steps) {
  clearInterval(run.timer);
  keepAwake(false);
  if (steps < STEPS.length) run.elapsed += STEPS[run.step].seconds - Math.ceil(run.left);
  run.phase = "done";
  run.left = 0;
  const s = normalizeEvent({ type: "brush", id: `s${run.begun}`, start: run.begun, seconds: run.elapsed, steps });
  state.events = mergeEvents(state.events, [s]).events;
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
  run.left = STEPS[0].seconds;
  renderBrush();
}

const RING = 2 * Math.PI * 46;
const SVGNS = "http://www.w3.org/2000/svg";

/** Draw both arches with a facial (outer) and lingual (inner) guide line per quadrant. Screen left is the user's left. */
function buildMouth() {
  const svg = $("mouth");
  const radii = [10.5, 10, 11.5, 10, 10.5, 13.5, 14]; // incisors to molars
  const SPAN = (Math.PI / 2) * 0.97;
  const mk = (name, attrs, parent = svg) => {
    const el = document.createElementNS(SVGNS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    parent.append(el);
    return el;
  };
  const arch = (cy, ry, up, qLeft, qRight) => {
    for (const [side, q] of [[-1, qLeft], [1, qRight]]) {
      const g = mk("g", { "data-q": q });
      radii.forEach((r, i) => {
        const a = ((i + 0.55) / 7) * SPAN;
        mk("circle", { cx: 100 + side * 82 * Math.sin(a), cy: cy + (up ? -1 : 1) * ry * Math.cos(a), r }, g);
      });
      // Guide lines follow the same ellipse, pushed out (facial) or in (lingual) past the teeth.
      for (const [surface, d] of [["facial", 19], ["lingual", -19]]) {
        const pts = [];
        for (let k = 0; k <= 16; k++) {
          const a = (k / 16) * SPAN;
          pts.push(`${(100 + side * (82 + d) * Math.sin(a)).toFixed(1)},${(cy + (up ? -1 : 1) * (ry + d) * Math.cos(a)).toFixed(1)}`);
        }
        mk("polyline", { points: pts.join(" "), class: "guide", "data-q": q, "data-surface": surface, fill: "none" });
      }
    }
  };
  arch(112, 100, true, 1, 0);
  arch(158, 94, false, 2, 3);
  for (const [x, t] of [[10, "L"], [190, "R"]]) {
    mk("text", { x, y: 139, "text-anchor": "middle", class: "lr" }).textContent = t;
  }
}
buildMouth();

function renderBrush() {
  const idle = run.phase === "idle";
  const done = run.phase === "done";
  const live = run.phase === "running" || run.phase === "paused";
  const step = STEPS[idle || done ? 0 : run.step];
  const remaining = idle ? TOTAL_SECONDS
    : done ? 0
    : run.left + STEPS.slice(run.step + 1).reduce((t, st) => t + st.seconds, 0);
  $("total").textContent = formatClock(remaining);
  $("clock").textContent = done ? "Done" : formatClock(idle ? step.seconds : run.left);
  $("quad-name").textContent = done ? "Nice work" : idle ? "Ready" : step.surface === "tongue" ? "Tongue 👅" : step.label;
  $("progress").textContent = done
    ? `${formatClock(run.elapsed)} brushed`
    : idle ? `${STEPS.length} steps · ${formatClock(TOTAL_SECONDS)}`
    : `${run.step + 1} of ${STEPS.length}${run.phase === "paused" ? " · paused" : ""}`;
  const mouth = $("mouth");
  mouth.classList.toggle("live", live);
  mouth.classList.toggle("finished", done);
  const cur = live ? run.step : -1;
  // A step's index is 2*quadrant (facial) or 2*quadrant+1 (lingual).
  const idx = (q, surface) => q * 2 + (surface === "lingual" ? 1 : 0);
  mouth.querySelectorAll("g[data-q]").forEach((el) => {
    const q = Number(el.dataset.q);
    el.classList.toggle("active", live && STEPS[cur]?.quadrant === q);
    el.classList.toggle("done", live && cur >= idx(q, "lingual") + 1);
  });
  mouth.querySelectorAll(".guide").forEach((el) => {
    const i = idx(Number(el.dataset.q), el.dataset.surface);
    el.classList.toggle("active", live && i === cur);
    el.classList.toggle("done", done || (live && i < cur));
  });
  const arc = document.querySelector("#go .arc");
  arc.style.strokeDasharray = String(RING);
  arc.style.strokeDashoffset = String(RING * (1 - remaining / TOTAL_SECONDS));
  const label = run.phase === "running" ? "Pause" : live ? "Resume" : done ? "Brush again" : "Start";
  $("go").setAttribute("aria-label", label);
  document.querySelector("#go .glyph").textContent = run.phase === "running" ? "❚❚" : "▶";
  $("go").onclick = run.phase === "running" ? pause : begin;
  $("skip").hidden = !live;
  $("stop").hidden = !live;
  $("reset").hidden = idle;
}
$("skip").onclick = skip;
$("stop").onclick = stopEarly;
$("reset").onclick = reset;
// Floss and mouthwash are separate events stamped when tapped. Tapping again undoes that tap.
/** Ids logged from this screen for the current routine. @type {{ floss: string | null, mouthwash: string | null }} */
const logged = { floss: null, mouthwash: null };
function clearLogged() {
  for (const type of ["floss", "mouthwash"]) {
    logged[type] = null;
    $(type).setAttribute("aria-pressed", "false");
  }
}
for (const type of ["floss", "mouthwash"]) {
  $(type).addEventListener("click", () => {
    if (logged[type]) {
      state.events = state.events.filter((e) => e.id !== logged[type]);
      logged[type] = null;
    } else {
      const start = freshStart(state.events, type, Date.now());
      const e = normalizeEvent({ type, start });
      state.events = mergeEvents(state.events, [e]).events;
      logged[type] = e.id;
      cue(false);
    }
    $(type).setAttribute("aria-pressed", String(!!logged[type]));
    save();
  });
}
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

const SLOT_ICON = { brush: "🪥", floss: "🧵", mouthwash: "💧" };

/** "Morning ✓💧 ✓🪥" style summary of a day's routine windows. */
function routineText(r) {
  return r.windows
    .map((w) => `${w.name === "morning" ? "Morning" : "Evening"} ${w.slots.map((x) => `${x.done ? "✓" : x.due ? "✗" : "○"}${SLOT_ICON[x.type]}`).join(" ")}`)
    .join(" · ");
}

function renderToday() {
  const r = dayRoutine(state.events, today(), state.settings);
  $("today").textContent = `${routineText(r)}${r.extras.length ? ` · +${r.extras.length}` : ""}`;
}

function renderStats() {
  const t = today();
  const m = summarize(state.events, t, 30);
  const w7 = routineStats(state.events, t, 7, state.settings);
  const w30 = routineStats(state.events, t, 30, state.settings);
  const pct = (r) => (r.pct === null ? "–" : `${r.pct}%`);
  const tiles = [
    ["Streak", currentStreak(state.events, t), "days brushed"],
    ["Best streak", longestStreak(state.events), "days brushed"],
    ["Routine", pct(w7), "last 7 days"],
    ["Routine", pct(w30), "last 30 days"],
    ["Full days", w30.completeDays, `of ${w30.days}, last 30`],
    ["Extras", w30.extras, "last 30 days"],
    ["Flossed", `${m.flossDays}/30`, "days, last 30"],
    ["Mouthwash", `${m.mouthwashDays}/30`, "days, last 30"],
    ["Average", m.brushes ? formatClock(m.avgSeconds) : "–", "per brush"],
  ];
  $("tiles").innerHTML = tiles
    .map(([k, v, u]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="u">${u}</div></div>`)
    .join("");
  renderCalendar();
  renderDay();
  renderToday();
}

function renderCalendar() {
  const t = today();
  $("month-label").textContent = new Date(view.y, view.m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  $("cal-body").innerHTML = monthGrid(view.y, view.m)
    .map((week) => `<tr>${week.map((k) => {
      if (!k) return "<td></td>";
      const r = dayRoutine(state.events, k, state.settings);
      const level = r.complete ? 2 : r.done > 0 ? 1 : 0;
      const extra = r.extras.length;
      const label = `${parseDay(k).toLocaleDateString(undefined, { dateStyle: "full" })}: ${r.done} of ${r.total} routine steps${extra ? `, ${extra} extra` : ""}`;
      return `<td><button class="day l${level}${k === t ? " today" : ""}${k === view.selected ? " sel" : ""}" data-day="${k}" aria-label="${label}">` +
        `${Number(k.slice(8))}<span class="mark">${extra ? "+" + extra : ""}</span></button></td>`;
    }).join("")}</tr>`)
    .join("");
}

const TYPE_LABEL = { brush: "Brush", floss: "Floss", mouthwash: "Mouthwash" };

function renderDay() {
  const r = dayRoutine(state.events, view.selected, state.settings);
  const list = state.events.filter((e) => dayKey(e.start) === view.selected).sort((a, b) => a.start - b.start);
  $("day-title").textContent = parseDay(view.selected).toLocaleDateString(undefined, { dateStyle: "full" });
  $("day-routine").textContent = `${routineText(r)}${r.extras.length ? ` · ${r.extras.length} extra` : ""}`;
  const ul = $("day-list");
  ul.innerHTML = "";
  if (!list.length) ul.innerHTML = '<li class="muted">Nothing logged.</li>';
  for (const s of list) {
    const li = document.createElement("li");
    const time = new Date(s.start).toLocaleTimeString(undefined, { timeStyle: "short" });
    const detail = s.type === "brush" ? ` · ${formatClock(s.seconds)} · ${s.steps}/${STEPS.length} steps` : "";
    const role = r.roles.get(s.id);
    li.append(`${time} · ${TYPE_LABEL[s.type]}${detail} · ${role === "extra" ? "extra" : role} `);
    const del = document.createElement("button");
    del.className = "link";
    del.textContent = "delete";
    del.onclick = () => {
      if (!confirm(`Delete this ${s.type} entry?`)) return;
      state.events = state.events.filter((x) => x.id !== s.id);
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

document.querySelectorAll("[data-log]").forEach((btn) => {
  btn.onclick = () => {
    // Log an event on the selected day without the timer: now if it's today, otherwise noon.
    const type = btn.dataset.log;
    const base = parseDay(view.selected);
    const now = new Date();
    const isToday = view.selected === today();
    base.setHours(isToday ? now.getHours() : 12, isToday ? now.getMinutes() : 0, 0, 0);
    const start = freshStart(state.events, type, base.getTime());
    const e = normalizeEvent({ type, start, seconds: TOTAL_SECONDS, steps: STEPS.length });
    state.events = mergeEvents(state.events, [e]).events;
    save();
    renderStats();
  };
});

// ---------- settings ----------
$("morning-end").value = String(state.settings.morningEnd);
$("evening-start").value = String(state.settings.eveningStart);
for (const id of ["morning-end", "evening-start"]) {
  $(id).onchange = () => {
    state.settings = normalizeSettings({ morningEnd: Number($("morning-end").value), eveningStart: Number($("evening-start").value) });
    save();
    renderStats();
  };
}

// ---------- data ----------
function renderData() {
  $("count").textContent = `${state.events.length} event${state.events.length === 1 ? "" : "s"} stored on this device.`;
}

$("export").onclick = () => {
  const blob = new Blob([JSON.stringify(buildExport(state.events), null, 2)], { type: "application/json" });
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
    const { events, skipped } = parseImport(await file.text());
    const merged = mergeEvents(state.events, events);
    state.events = merged.events;
    save();
    renderData();
    toast(`Imported ${merged.added} new, ${events.length - merged.added} already present${skipped ? `, ${skipped} skipped` : ""}.`);
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  }
};

$("clear").onclick = () => {
  if (!confirm("Delete all brushing history on this device? Export first if you want a copy.")) return;
  state.events = [];
  save();
  renderData();
  toast("History cleared.");
};

renderBrush();
renderToday();
