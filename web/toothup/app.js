import {
  DEFAULT_SETTINGS, backupDue, GOAL_TYPES, MAX_DAY_STARTS_AT, MAX_GOAL, MAX_REMINDER_MONTHS, REMINDER_TYPES, ROUTINE_STEPS, STEPS, stepsBefore, TOTAL_SECONDS, buildExport, addMonthKey, currentStreak, dayGoals, dayKey, firstMonth, firstYear, formatClock, groupByDay, longestStreak,
  makeEvent, mergeEvents, normalizePlace, monthGrid, monthReport, yearReport, normalizeEvents, normalizeSettings, parseDay, parseImport, rangeStats, reminderStatus, todayKey, versionOf,
} from "./logic.js";
import { CHART_CSS, annualReportHtml, esc, heatmapSvg, hoursMinutes, monthBarsSvg, shortDate, weekdayBarsSvg } from "./report.js";
import { readHealthExport } from "./health.js";
import { parseNomie } from "./nomie.js";

const STORE = "toothup:v2";
const $ = (id) => document.getElementById(id);

/** @type {{ events: import("./logic.js").Event[], settings: import("./logic.js").Settings }} */
let state = { events: [], settings: DEFAULT_SETTINGS, lastBackup: /** @type {string | null} */ (null) };
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || "null");
  if (saved) {
    state.events = normalizeEvents(saved.events).events;
    state.settings = normalizeSettings(saved.settings) ?? DEFAULT_SETTINGS;
    state.lastBackup = /^\d{4}-\d{2}-\d{2}$/.test(saved.lastBackup) ? saved.lastBackup : null;
  }
} catch {}

/** Where you are now as { lat, lon, acc }, or all null if location is off, denied or slow. */
function locate() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(normalizePlace(null));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(normalizePlace({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy })),
      () => resolve(normalizePlace(null)),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}
/** Fill in an event's location once it is known; no-op if the event was deleted meanwhile. */
function setPlace(id, placePromise) {
  placePromise.then((place) => {
    const i = state.events.findIndex((e) => e.id === id);
    if (i < 0 || place.lat === null) return;
    state.events[i] = { ...state.events[i], ...place };
    save();
  });
}

function save() {
  renderToday();
  renderReminders();
  try {
    localStorage.setItem(STORE, JSON.stringify({ events: state.events, settings: state.settings, lastBackup: state.lastBackup }));
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
  if (name === "brush") renderReminders();
}
for (const t of tabs) $(`tab-${t}`).addEventListener("click", () => showTab(t));

// ---------- timer ----------
/** idle | running | paused | done */
const run = { phase: "idle", step: 0, endAt: 0, left: 0, begun: 0, elapsed: 0, timer: 0, wake: null, place: null };

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
    run.place = locate(); // where the routine started
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
    } else return finish(ROUTINE_STEPS);
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
  } else finish(ROUTINE_STEPS);
}

function finish(steps) {
  clearInterval(run.timer);
  keepAwake(false);
  if (steps < ROUTINE_STEPS) run.elapsed += STEPS[run.step].seconds - Math.ceil(run.left);
  run.phase = "done";
  run.left = 0;
  const s = makeEvent(state.events, "brush", run.begun, { seconds: run.elapsed, steps });
  state.events = mergeEvents(state.events, [s]).events;
  save();
  setPlace(s.id, run.place ?? locate());
  cue(true);
  renderBrush();
}

function stopEarly() {
  if (run.phase === "running" || run.phase === "paused") {
    finish(stepsBefore(run.step));
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
      const e = makeEvent(state.events, type, Date.now());
      state.events = mergeEvents(state.events, [e]).events;
      logged[type] = e.id;
      setPlace(e.id, locate());
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
const today = () => todayKey(state.settings);
/** The calendar shows the month of the given day and selects it. */
const viewOf = (day) => {
  const d = parseDay(day);
  return { y: d.getFullYear(), m: d.getMonth(), selected: day };
};
let view = viewOf(today());

const ICON = { brush: "🪥", floss: "🧵", mouthwash: "🌊" };
// The floss and mouthwash buttons show the same emojis as the goals, with the word underneath.
const BUTTON_LABEL = { floss: "Floss", mouthwash: "Rinse" };
for (const type of ["floss", "mouthwash"]) $(type).innerHTML = `<span class="b-icon">${ICON[type]}</span><span>${BUTTON_LABEL[type]}</span>`;

/** ["🪥 1/2", "🧵 1/1", "🌊 0/2", "+1 extra"] for one day's goals. */
function goalsParts(g) {
  const goals = state.settings.goals;
  const parts = ["brush", "mouthwash", "floss"].map((type) => `${ICON[type]} ${g.done[type]}/${goals[type]}`);
  if (g.extras) parts.push(`+${g.extras} extra`);
  return parts;
}

const goalsText = (g) => goalsParts(g).join(" · ");

const eventsOn = (day) => groupByDay(state.events, state.settings).get(day) || [];

function renderToday() {
  // One line per goal, stacked above the total time.
  $("today").replaceChildren(...goalsParts(dayGoals(eventsOn(today()), state.settings.goals)).map((text) => Object.assign(document.createElement("div"), { textContent: text })));
}

/** The brush goal in words: "both brushes" for two, otherwise "3 brushes". */
const brushGoalText = () => (state.settings.goals.brush === 2 ? "both brushes" : `${state.settings.goals.brush} brush${state.settings.goals.brush === 1 ? "" : "es"}`);

function renderStats() {
  const t = today();
  const w7 = rangeStats(state.events, t, 7, state.settings);
  const w30 = rangeStats(state.events, t, 30, state.settings);
  const pct = (r) => (r.brushPct === null ? "–" : `${r.brushPct}%`);
  const tiles = [
    ["Streak", currentStreak(state.events, t, state.settings), `days, ${brushGoalText()}`],
    ["Best streak", longestStreak(state.events, state.settings), `days, ${brushGoalText()}`],
    ["Brushing", pct(w7), "last 7 days"],
    ["Brushing", pct(w30), "last 30 days"],
    ["Full days", w30.fullDays, `of ${w30.days}, last 30`],
    ["Extras", w30.extras, "last 30 days"],
    ["Floss goal", `${w30.flossDays}/${w30.days}`, "days, last 30"],
    ["Mouthwash goal", `${w30.mouthwashDays}/${w30.days}`, "days, last 30"],
    ["Average", w30.avgSeconds ? formatClock(w30.avgSeconds) : "–", "per brush"],
  ];
  $("tiles").innerHTML = tiles
    .map(([k, v, u]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="u">${u}</div></div>`)
    .join("");
  renderCalendar();
  renderDay();
  renderToday();
  renderReports();
}

function renderCalendar() {
  const t = today();
  const byDay = groupByDay(state.events, state.settings);
  $("month-label").textContent = new Date(view.y, view.m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  $("cal-body").innerHTML = monthGrid(view.y, view.m)
    .map((week) => `<tr>${week.map((k) => {
      if (!k) return "<td></td>";
      const g = dayGoals(byDay.get(k) || [], state.settings.goals);
      const level = g.complete ? 2 : g.done.brush > 0 ? 1 : 0;
      const label = `${parseDay(k).toLocaleDateString(undefined, { dateStyle: "full" })}: ${goalsText(g)}`;
      return `<td><button class="day l${level}${k === t ? " today" : ""}${k === view.selected ? " sel" : ""}" data-day="${k}" aria-label="${label}">` +
        `${Number(k.slice(8))}<span class="mark">${g.extras ? "+" + g.extras : ""}</span></button></td>`;
    }).join("")}</tr>`)
    .join("");
}

// ---------- monthly and annual reports ----------
document.head.append(Object.assign(document.createElement("style"), { textContent: CHART_CSS }));

const panes = ["recent", "month", "year"];
let pane = "recent";
let reportMonth = today().slice(0, 7);
let reportYear = Number(today().slice(0, 4));
function showPane(name) {
  pane = name;
  for (const p of panes) {
    $(`seg-${p}`).setAttribute("aria-selected", String(p === name));
    $(`pane-${p}`).hidden = p !== name;
  }
  renderReports();
}
for (const p of panes) $(`seg-${p}`).onclick = () => showPane(p);

const tile = (k, v, u) => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="u">${esc(u)}</div></div>`;
const pctText = (n) => (n === null ? "–" : `${n}%`);

function renderReports() {
  if (pane === "month") renderMonthReport();
  if (pane === "year") renderYearReport();
}

function renderMonthReport() {
  const t = today();
  const first = firstMonth(state.events, state.settings) ?? t.slice(0, 7);
  reportMonth = reportMonth < first ? first : reportMonth > t.slice(0, 7) ? t.slice(0, 7) : reportMonth;
  $("m-label").textContent = new Date(Number(reportMonth.slice(0, 4)), Number(reportMonth.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  $("m-prev").disabled = reportMonth <= first;
  $("m-next").disabled = reportMonth >= t.slice(0, 7);
  $("m-now").hidden = reportMonth === t.slice(0, 7);
  const r = monthReport(state.events, reportMonth, t, state.settings);
  if (!r.levels.size) {
    $("m-body").innerHTML = '<p class="muted">Nothing logged this month.</p>';
    return;
  }
  const delta = r.brushPct !== null && r.prev.brushPct !== null ? r.brushPct - r.prev.brushPct : null;
  const vs = delta === null ? "" : delta === 0 ? "same as last month" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} pts vs last month`;
  const [y, m] = reportMonth.split("-").map(Number);
  const grid = monthGrid(y, m - 1).map((week) => `<tr>${week.map((k) => {
    if (!k) return '<td class="empty"></td>';
    const level = r.levels.get(k);
    return `<td class="${level === undefined ? "" : `l${level}`}" title="${esc(shortDate(k))}">${Number(k.slice(8))}</td>`;
  }).join("")}</tr>`).join("");
  const short = r.short.length
    ? `<p class="muted">${r.short.length} day${r.short.length === 1 ? "" : "s"} short of ${brushGoalText()}: ${r.short.map((d) => Number(d.day.slice(8)) + (d.level === 1 ? "*" : "")).join(", ")}${r.short.some((d) => d.level === 1) ? "<br>* some brushing" : ""}</p>`
    : '<p class="muted">Brush goal met every counted day. 🎉</p>';
  $("m-body").innerHTML = `
    <div id="m-tiles" class="tiles">${[
      tile("Brushing", pctText(r.brushPct), vs || "of brushes"),
      tile("Full days", r.fullDays, `of ${r.days} counted`),
      tile("Best streak", r.bestStreak.length, r.bestStreak.length ? `${shortDate(r.bestStreak.start)} – ${shortDate(r.bestStreak.end)}` : "days"),
      tile("Floss goal", pctText(r.days ? Math.round((r.flossDays / r.days) * 100) : null), `${r.flossDays} days`),
      tile("Mouthwash goal", pctText(r.days ? Math.round((r.mouthwashDays / r.days) * 100) : null), `${r.mouthwashDays} days`),
      tile("Time brushing", hoursMinutes(r.brushSeconds), r.brushCount ? `${formatClock(r.avgSeconds)} per brush` : ""),
    ].join("")}</div>
    <div class="panel"><h3>Days</h3><table class="mini"><thead><tr><th>Su</th><th>Mo</th><th>Tu</th><th>We</th><th>Th</th><th>Fr</th><th>Sa</th></tr></thead><tbody>${grid}</tbody></table>
    <p class="legend">Solid: brush goal met · Muted: some · Outline: none</p>${short}</div>
    <div class="panel"><h3>Days of the week</h3>${weekdayBarsSvg(r)}</div>`;
}

function renderYearReport() {
  const t = today();
  const thisYear = Number(t.slice(0, 4));
  const first = firstYear(state.events, state.settings) ?? thisYear;
  reportYear = Math.min(Math.max(reportYear, first), thisYear);
  $("y-label").textContent = String(reportYear);
  $("y-prev").disabled = reportYear <= first;
  $("y-next").disabled = reportYear >= thisYear;
  $("y-now").hidden = reportYear === thisYear;
  const r = yearReport(state.events, reportYear, t, state.settings);
  $("y-export").disabled = r.days === 0;
  if (!r.levels.size) {
    $("y-body").innerHTML = '<p class="muted">Nothing logged this year.</p>';
    return;
  }
  $("y-body").innerHTML = `
    <div class="tiles">${[
      tile("Brushing", pctText(r.brushPct), "of brushes"),
      tile("Full days", r.fullDays, `of ${r.days} counted`),
      tile("Best streak", r.bestStreak.length, "days"),
      tile("Floss goal", pctText(r.days ? Math.round((r.flossDays / r.days) * 100) : null), `${r.flossDays} days`),
      tile("Mouthwash goal", pctText(r.days ? Math.round((r.mouthwashDays / r.days) * 100) : null), `${r.mouthwashDays} days`),
      tile("Time brushing", hoursMinutes(r.brushSeconds), `${r.brushCount} brushes`),
    ].join("")}</div>
    <div class="panel"><h3>Every day</h3>${heatmapSvg(r)}</div>
    <div class="panel"><h3>Brushing % by month</h3>${monthBarsSvg(r)}</div>
    <div class="panel"><h3>Days of the week</h3>${weekdayBarsSvg(r)}</div>`;
}

$("m-prev").onclick = () => ((reportMonth = addMonthKey(reportMonth, -1)), renderReports());
$("m-next").onclick = () => ((reportMonth = addMonthKey(reportMonth, 1)), renderReports());
$("m-now").onclick = () => ((reportMonth = today().slice(0, 7)), renderReports());
$("y-prev").onclick = () => (reportYear--, renderReports());
$("y-next").onclick = () => (reportYear++, renderReports());
$("y-now").onclick = () => ((reportYear = Number(today().slice(0, 4))), renderReports());

/** Download the year as a standalone HTML page. */
$("y-export").onclick = () => {
  const html = annualReportHtml(yearReport(state.events, reportYear, today(), state.settings), { generated: today() });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  a.download = `toothup-${reportYear}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

const TYPE_LABEL = { brush: "Brush", floss: "Floss", mouthwash: "Mouthwash" };

function renderDay() {
  const list = eventsOn(view.selected).sort((a, b) => a.start - b.start);
  const g = dayGoals(list, state.settings.goals);
  $("day-title").textContent = parseDay(view.selected).toLocaleDateString(undefined, { dateStyle: "full" });
  $("day-routine").textContent = goalsText(g);
  const ul = $("day-list");
  ul.innerHTML = "";
  if (!list.length) ul.innerHTML = '<li class="muted">Nothing logged.</li>';
  for (const s of list) {
    const li = document.createElement("li");
    // Show the time where you were when it happened, not in the current zone.
    const time = new Date(s.start + s.offset * 60000).toLocaleTimeString(undefined, { timeStyle: "short", timeZone: "UTC" });
    const detail = s.type === "brush" ? ` · ${formatClock(s.seconds)} · ${s.steps}/${ROUTINE_STEPS} steps` : "";
    li.append(`${time} · ${TYPE_LABEL[s.type]}${detail}${g.roles.get(s.id) === "extra" ? " · extra" : ""} `);
    if (s.lat !== null) {
      // A quiet pin that the place was captured; the coordinates stay out of sight.
      const pin = document.createElement("span");
      pin.className = "muted";
      pin.textContent = "📍 ";
      pin.setAttribute("aria-label", "Location captured");
      pin.title = "Location captured";
      li.append(pin);
    }
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
  view = viewOf(today());
  renderStats();
};

document.querySelectorAll("[data-log]").forEach((btn) => {
  btn.onclick = () => {
    // Log an event on the selected day without the timer: now if it's today, otherwise noon.
    const noon = parseDay(view.selected);
    noon.setHours(12);
    const when = view.selected === today() ? Date.now() : noon.getTime();
    const e = makeEvent(state.events, btn.dataset.log, when, { seconds: TOTAL_SECONDS, steps: ROUTINE_STEPS });
    state.events = mergeEvents(state.events, [e]).events;
    save();
    if (view.selected === today()) setPlace(e.id, locate()); // a backdated entry has no known place
    renderStats();
  };
});

// ---------- reminders (dentist, brush head) ----------
const REMINDER_INFO = {
  dentist: { label: "Dentist", title: "Dentist visit", icon: "🏥", done: "Visited", confirm: "Mark your dentist visit as done today?" },
  head: { label: "Brush head", title: "Toothbrush head change", icon: "🔄", done: "Changed", confirm: "Mark your brush head as changed today?" },
};

const plural = (n) => `${n} day${n === 1 ? "" : "s"}`;
const countdownText = (days) => (days < 0 ? `${plural(-days)} late` : days === 0 ? "due today" : `in ${plural(days)}`);

/** Update one reminder and refresh everything that shows it. @param {"dentist" | "head"} type @param {Partial<import("./logic.js").Reminder>} patch */
function setReminder(type, patch) {
  const reminders = { ...state.settings.reminders, [type]: { ...state.settings.reminders[type], ...patch } };
  state.settings = { ...state.settings, reminders };
  save();
  syncSettingsForm();
}

/** The countdown cards in the corners of the main screen; a reminder with no date is hidden. */
function renderReminders() {
  for (const type of REMINDER_TYPES) {
    const card = document.querySelector(`.reminder[data-reminder="${type}"]`);
    const status = reminderStatus(state.settings.reminders[type], today());
    card.hidden = !status;
    if (!status) continue;
    card.classList.toggle("overdue", status.days < 0);
    const count = countdownText(status.days);
    card.querySelector(".r-count").textContent = count;
    card.querySelector(".r-done").setAttribute("aria-label", `${REMINDER_INFO[type].label}: ${count}. Mark as ${REMINDER_INFO[type].done.toLowerCase()} today`);
    card.title = `Due ${parseDay(status.due).toLocaleDateString(undefined, { dateStyle: "medium" })}`;
  }
}

for (const type of REMINDER_TYPES) {
  const info = REMINDER_INFO[type];
  const card = document.querySelector(`.reminder[data-reminder="${type}"]`);
  const button = card.querySelector(".r-done");
  button.textContent = info.icon;
  button.onclick = () => confirm(info.confirm) && setReminder(type, { last: today() });
}

// ---------- settings ----------
for (let h = 0; h <= MAX_DAY_STARTS_AT; h++) $("day-starts-at").add(new Option(`${h}:00`, String(h)));
$("day-starts-at").onchange = () => {
  state.settings = { ...state.settings, dayStartsAt: Number($("day-starts-at").value) };
  save();
  view = viewOf(today());
  renderStats();
};

// Daily goals: one number input per thing, each saved on change.
const GOAL_LABEL = { brush: "Brushes", floss: "Flosses", mouthwash: "Mouthwashes" };
$("goal-settings").innerHTML = GOAL_TYPES.map((type) => `
  <div class="row goal-row">
    <label for="goal-${type}">${ICON[type]} ${GOAL_LABEL[type]} per day</label>
    <input id="goal-${type}" type="number" min="1" max="${MAX_GOAL}" inputmode="numeric" style="width:4.5rem">
  </div>`).join("");
for (const type of GOAL_TYPES) {
  $(`goal-${type}`).onchange = (e) => {
    const n = Number(e.target.value);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_GOAL) {
      state.settings = { ...state.settings, goals: { ...state.settings.goals, [type]: n } };
      save();
      renderStats();
    } else {
      syncSettingsForm();
      toast(`Enter a whole number from 1 to ${MAX_GOAL}.`);
    }
  };
}

$("reminder-settings").innerHTML = REMINDER_TYPES.map((type) => `
  <div class="reminder-setting">
    <h3>${REMINDER_INFO[type].title}</h3>
    <div class="row">
      <label for="rem-${type}-every">Every</label>
      <input id="rem-${type}-every" type="number" min="1" max="${MAX_REMINDER_MONTHS}" inputmode="numeric" style="width:4.5rem">
      <span>months</span>
    </div>
    <div class="row">
      <label for="rem-${type}-last">Last done</label>
      <input id="rem-${type}-last" type="date">
      <button class="link" id="rem-${type}-clear">clear</button>
    </div>
  </div>`).join("");
for (const type of REMINDER_TYPES) {
  $(`rem-${type}-every`).onchange = (e) => {
    const n = Number(e.target.value);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_REMINDER_MONTHS) setReminder(type, { everyMonths: n });
    else {
      syncSettingsForm();
      toast(`Enter a whole number of months from 1 to ${MAX_REMINDER_MONTHS}.`);
    }
  };
  $(`rem-${type}-last`).onchange = (e) => setReminder(type, { last: e.target.value || null });
  $(`rem-${type}-clear`).onclick = () => setReminder(type, { last: null });
}

/** Show the saved settings in the form fields. */
function syncSettingsForm() {
  $("day-starts-at").value = String(state.settings.dayStartsAt);
  for (const type of GOAL_TYPES) $(`goal-${type}`).value = String(state.settings.goals[type]);
  for (const type of REMINDER_TYPES) {
    const r = state.settings.reminders[type];
    $(`rem-${type}-every`).value = String(r.everyMonths);
    $(`rem-${type}-last`).value = r.last ?? "";
  }
}
syncSettingsForm();

// ---------- data ----------
function renderData() {
  $("count").textContent = `${state.events.length} event${state.events.length === 1 ? "" : "s"} stored on this device.`;
  renderBackupInfo();
}

/** Download a JSON backup and record today as the last backup day. */
function exportBackup() {
  const blob = new Blob([JSON.stringify(buildExport(state.events, state.settings), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `toothup-${dayKey(Date.now())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  state.lastBackup = todayKey(state.settings);
  save();
  renderBackupInfo();
  renderBackupReminder();
}

$("export").onclick = exportBackup;

function renderBackupInfo() {
  $("last-backup").textContent = state.lastBackup ? `Last backup: ${state.lastBackup}.` : "No backup made yet.";
}

// A month after the last backup (or at once if none was ever made), show a toast; clicking it exports immediately.
let backupSnoozed = false;
function renderBackupReminder() {
  const due = !backupSnoozed && backupDue(state.lastBackup, todayKey(state.settings), state.events.length > 0);
  $("backup-toast").hidden = !due;
}
$("backup-toast-go").onclick = exportBackup;
$("backup-toast-dismiss").onclick = () => {
  backupSnoozed = true;
  renderBackupReminder();
};
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && renderBackupReminder());

// An installed app keeps running its old code when you bring it to the front. Compare the deployed page's version string
// with the one on screen, and offer a reload if they differ. Offline or failing, it stays quiet.
async function checkForUpdate() {
  try {
    const res = await fetch("/toothup/", { cache: "no-store" });
    const deployed = res.ok ? versionOf(await res.text()) : null;
    const running = $("version").textContent.trim();
    $("update-toast").hidden = !deployed || deployed === running;
  } catch {}
}
$("update-toast").onclick = () => location.reload();
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && checkForUpdate());
checkForUpdate();

$("import-btn").onclick = () => $("import").click();
$("import").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const { events, skipped, settings } = parseImport(await file.text());
    const merged = mergeEvents(state.events, events);
    state.events = merged.events;
    state.settings = settings;
    view = viewOf(today());
    save();
    syncSettingsForm();
    renderData();
    toast(`Imported ${merged.added} new, ${events.length - merged.added} already present${skipped ? `, ${skipped} skipped` : ""}.`);
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  }
};

$("health-btn").onclick = () => $("health").click();
$("health").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  $("health-btn").disabled = true;
  try {
    const { events, skipped } = await readHealthExport(file, (f, n) => toast(`Reading Apple Health export: ${Math.round(f * 100)}%, ${n} brushes found`));
    if (!events.length) throw new Error("no toothbrushing records found (they need an Apple Watch or a smart toothbrush)");
    const merged = mergeEvents(state.events, events);
    state.events = merged.events;
    save();
    renderData();
    toast(`Imported ${merged.added} new brush${merged.added === 1 ? "" : "es"} from Apple Health, ${events.length - merged.added} already present${skipped ? `, ${skipped} skipped` : ""}.`);
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  } finally {
    $("health-btn").disabled = false;
  }
};

$("nomie-btn").onclick = () => $("nomie").click();
$("nomie").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const { events, skipped } = parseNomie(await file.text());
    if (!events.length) throw new Error("no #floss_teeth or #mouthwash events found");
    const merged = mergeEvents(state.events, events);
    state.events = merged.events;
    save();
    renderData();
    toast(`Imported ${merged.added} new floss and mouthwash events from Nomie, ${events.length - merged.added} already present${skipped ? `, ${skipped} skipped` : ""}.`);
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
renderReminders();
renderBackupReminder();
