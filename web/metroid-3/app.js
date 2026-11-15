// Metroid 3: the app. Hash-routed views over games kept in browser storage.
//
//   #/                    game picker
//   #/g/<id>              dashboard (HUD, progress bar, nav, item grid, history)
//   #/g/<id>/route        every checkpoint, with the entry form
//   #/g/<id>/journal      day-by-day journal and free-form entries
//   #/g/<id>/publish      printable scorecard and static HTML export

import {
  ALL_AREAS,
  CHECKPOINT_CHOICES,
  CATEGORIES,
  addStep,
  classify,
  cloneGame,
  dedupeId,
  deriveState,
  fmtAgo,
  fmtDate,
  fmtStamp,
  fromInputValue,
  history,
  fmtClock,
  inferSessions,
  fmtDuration,
  fmtIgt,
  parseIgt,
  isDone,
  moveStep,
  newGame,
  pace,
  parseImport,
  removeStep,
  renumber,
  setDone,
  toInputValue,
  uid,
  upcoming,
} from "./engine.js";
import { openStore, requestPersistence } from "./store.js";
import {
  areasHtml,
  bossesHtml,
  categoryBarsHtml,
  esc,
  gridHtml,
  historyHtml,
  paceHtml,
  progressBarHtml,
  statsHtml,
  timelineHtml,
  where,
} from "./widgets.js";
import { backupJson, buildJournalHtml, buildSheetHtml, download, gameFilename, paperCss } from "./export.js";

/** @typedef {import("./engine.js").Game} Game */

const $ = (sel, root = document) => /** @type {HTMLElement} */ (root.querySelector(sel));
const app = $("#app");
const dlg = /** @type {HTMLDialogElement} */ ($("#dlg"));

/** @type {import("./store.js").Store} */
let store;
/** @type {Map<string, Game>} */
const games = new Map();
/** @type {"persisted" | "denied" | "unsupported"} */
let persistence = "unsupported";
let lastBackup = /** @type {number | null} */ (null);
let changesSinceBackup = 0;
/** @type {Array<{ id: string, snapshot: Game }>} */
let undoStack = [];
let routeFilter = { q: "", show: "all" };
const printPrefs = { layout: "scoresheet", paper: "letter", orientation: "landscape", notes: false, journal: true, remaining: true };
const htmlPrefs = { notes: true, unfinished: false, subtitle: "" };
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("metroid-3") : null;

// ---------------------------------------------------------------------------------------------
// Persistence helpers

/** @param {Game} game */
async function save(game) {
  game.updatedAt = Date.now();
  games.set(game.id, game);
  await store.put(game);
  changesSinceBackup++;
  store.setMeta("changesSinceBackup", changesSinceBackup).catch(() => {});
  channel?.postMessage({ type: "changed" });
}

/**
 * Apply an edit with undo, save, and re-render.
 * @param {Game} game @param {(g: Game) => void} fn
 */
async function mutate(game, fn) {
  undoStack.push({ id: game.id, snapshot: cloneGame(game) });
  if (undoStack.length > 30) undoStack.shift();
  fn(game);
  await save(game);
  render();
}

async function undo() {
  const game = current();
  if (!game) return;
  const i = [...undoStack].reverse().findIndex((u) => u.id === game.id);
  if (i < 0) return toast("Nothing to undo");
  const [entry] = undoStack.splice(undoStack.length - 1 - i, 1);
  await save(entry.snapshot);
  render();
  toast("Undone");
}

let toastTimer = 0;
/** @param {string} msg */
function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast no-print";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el?.remove(), 3500);
}

// ---------------------------------------------------------------------------------------------
// Routing

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "g" && parts[1]) return { game: decodeURIComponent(parts[1]), view: parts[2] || "dash" };
  return { game: null, view: "games" };
}

function current() {
  const { game } = parseHash();
  return game ? (games.get(game) ?? null) : null;
}

/** @param {string} id @param {string} [view] */
const gameUrl = (id, view = "") => `#/g/${encodeURIComponent(id)}${view ? "/" + view : ""}`;

// ---------------------------------------------------------------------------------------------
// Rendering

function render() {
  const { view } = parseHash();
  const game = current();
  document.body.classList.toggle("is-publish", view === "publish" && Boolean(game));
  renderHeader(game, view);
  if (!game) {
    document.title = "Metroid 3";
    app.innerHTML = renderPicker();
    return;
  }
  document.title = `${game.name} · Metroid 3`;
  const state = deriveState(game);
  const body =
    view === "route" ? renderRoute(game, state)
    : view === "journal" ? renderJournal(game)
    : view === "publish" ? renderPublish(game, state)
    : renderDash(game, state);
  app.innerHTML = body;
  if (view === "publish") applyPaper();
}

/** @param {Game | null} game @param {string} view */
function renderHeader(game, view) {
  const tabs = game
    ? [["dash", "Dashboard"], ["route", "Route"], ["journal", "Journal"], ["publish", "Publish"]]
    : [];
  $("#tabs").innerHTML =
    (game ? `<a href="#/">Games</a>` : "") +
    tabs
      .map(([v, label]) => `<a href="${gameUrl(/** @type {Game} */ (game).id, v === "dash" ? "" : v)}"${v === view ? ' aria-current="page"' : ""}>${label}</a>`)
      .join("");
  $("#game-title").textContent = game ? game.name : "";
  $("#game-title").hidden = !game;
}

// ----- Picker

function renderPicker() {
  const list = [...games.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  const withState = list.map((g) => ({ g, s: deriveState(g) }));
  const active = withState.filter(({ s }) => !s.complete);
  const done = withState.filter(({ s }) => s.complete);
  const card = ({ g, s }) => `<article class="card game-card">
      <div><h3><a href="${gameUrl(g.id)}">${esc(g.name)}</a></h3>
      <div class="meta"><span>${s.complete ? '<span class="badge done">Complete</span>' : '<span class="badge">In progress</span>'}</span>
      <span>${s.stepsDone}/${s.steps} steps</span>
      <span>${s.last != null ? `Last played ${esc(fmtAgo(s.last, Date.now()))}` : "Not started"}</span></div></div>
      <div class="mini">${progressBarMini(s)}<b>${s.percent}%</b></div>
      <div class="meta">${s.first != null ? `<span>Started ${esc(fmtDate(s.first))}</span>` : `<span>Created ${esc(fmtDate(g.createdAt))}</span>`}
        ${s.current ? `<span>Next: ${esc(s.current.checkpoint)}</span>` : ""}</div>
      <div class="actions">
        <a class="btn primary" href="${gameUrl(g.id)}">${s.complete ? "View" : "Continue"}</a>
        <button type="button" class="small" data-action="edit-game" data-id="${esc(g.id)}">Details</button>
        <button type="button" class="small" data-action="export-game" data-id="${esc(g.id)}">Export</button>
        <button type="button" class="small" data-action="dup-game" data-id="${esc(g.id)}">Copy</button>
        <button type="button" class="small danger" data-action="delete-game" data-id="${esc(g.id)}">Delete</button>
      </div>
    </article>`;

  const backupNote =
    changesSinceBackup > 0 && games.size
      ? `<div class="notice">You have ${changesSinceBackup} change${changesSinceBackup === 1 ? "" : "s"} since your last backup${lastBackup ? ` (${esc(fmtDate(lastBackup))})` : ""}. Games live only in this browser, so export a backup now and then.
         <button type="button" class="small" data-action="export-all">Export backup</button></div>`
      : "";
  const storageLine = `Saved in this browser (${store.kind === "indexeddb" ? "IndexedDB" : store.kind === "localstorage" ? "localStorage, because IndexedDB is unavailable" : "memory only: nothing will survive a reload"}). ${
    persistence === "persisted" ? "The browser has promised not to evict it." : persistence === "denied" ? "The browser may evict it under storage pressure; export backups." : ""
  }${lastBackup ? ` Last backup ${esc(fmtDate(lastBackup))}.` : " No backup exported yet."}`;

  return `<section class="view">
    <div class="picker-head">
      <h2>Your games</h2>
      <div class="toolbar">
        <button type="button" class="primary" data-action="new-game">New game</button>
        <button type="button" data-action="import">Import…</button>
        <button type="button" data-action="export-all"${games.size ? "" : " disabled"}>Export all</button>
      </div>
    </div>
    ${backupNote}
    ${
      games.size
        ? `${active.length ? `<div class="game-grid">${active.map(card).join("")}</div>` : ""}
           ${done.length ? `<h2 style="margin:1.75rem 0 1rem;font-size:1.1rem;color:var(--support)">Completed</h2><div class="game-grid">${done.map(card).join("")}</div>` : ""}`
        : `<div class="card empty"><h3 style="font-size:1.2rem;text-transform:none;letter-spacing:0;color:var(--text)">No games yet</h3>
            <p>Start a new playthrough with the built-in 100% route, or import a game from a JSON backup or a CSV of your spreadsheet.</p>
            <div class="toolbar" style="justify-content:center"><button class="primary" type="button" data-action="new-game">Start a new game</button><button type="button" data-action="import">Import…</button></div></div>`
    }
    <p class="storage-line">${storageLine}</p>
  </section>`;
}

/** @param {import("./engine.js").State} s */
function progressBarMini(s) {
  const segs = Array.from({ length: 100 }, (_, i) => `<i${i < s.percent ? ' class="on"' : ""}></i>`).join("");
  return `<div class="m3-segs" role="img" aria-label="${s.percent}% collected">${segs}</div>`;
}

// ----- Dashboard

/** @param {Game} game @param {import("./engine.js").State} state */
function sessionBar(game, state) {
  const p = state.playing;
  return `<div class="session-bar">
    <button type="button" class="${p ? "danger" : "primary"}" data-action="session-toggle">${p ? "■ Stop session" : "▶ Start session"}</button>
    <span class="${p ? "live" : "m3-muted"}">${
      p
        ? `Playing since ${esc(fmtClock(p.start))} · ${esc(fmtDuration(p.ms))}`
        : state.sessions.length
          ? `Not playing · ${state.sessions.length} session${state.sessions.length === 1 ? "" : "s"}, ${esc(fmtDuration(state.playMs))} played`
          : "No sessions yet. Start one when you sit down to play, stop it when you put the controller down."
    }</span>
  </div>`;
}

/** @param {Game} game @param {import("./engine.js").State} state */
function sessionsCard(game, state) {
  const steps = game.steps.filter(isDone);
  const rows = [...state.sessions]
    .reverse()
    .map((x) => {
      const n = steps.filter((s) => /** @type {number} */ (s.ts) >= x.start && (x.end == null || /** @type {number} */ (s.ts) <= x.end)).length;
      return `<li><b>${esc(fmtDate(x.start))}</b><span>${esc(fmtClock(x.start))} – ${x.end ? esc(fmtClock(x.end)) : "now"}</span>
        <span>${esc(fmtDuration(x.ms))}</span><span class="m3-muted">${n} step${n === 1 ? "" : "s"}</span>
        <button type="button" class="small" data-action="edit-event" data-id="${esc(x.startId)}">Start</button>
        ${x.endId ? `<button type="button" class="small" data-action="edit-event" data-id="${esc(x.endId)}">Stop</button>` : ""}</li>`;
    })
    .join("");
  return `<div class="card"><h3>Sessions</h3>
    ${rows ? `<ul class="session-list">${rows}</ul>` : `<p class="m3-muted">Sessions record when you were actually playing, so “+n min” and play time ignore the hours you were away.</p>`}
    <div class="toolbar" style="margin-top:0.75rem">
      <button type="button" class="small" data-action="add-event">＋ Add start/stop event</button>
      <button type="button" class="small" data-action="infer-sessions"${steps.length ? "" : " disabled"}>Infer from step times…</button>
    </div></div>`;
}

/** @param {Game} game @param {import("./engine.js").State} state */
function renderDash(game, state) {
  const now = Date.now();
  const next = upcoming(game, state, 5);
  const [cur, ...rest] = next;
  const canUndo = undoStack.some((u) => u.id === game.id);

  const undoBtn = `<button type="button" data-action="undo"${canUndo ? "" : " disabled"}>↶ Undo</button>`;
  const navCard = cur
    ? `<div class="nav-now c-${classify(cur.checkpoint).cat}">
        <span class="label">Next · step ${cur.step} of ${state.steps}</span>
        <h3>${esc(cur.checkpoint)}</h3>
        ${where(cur) ? `<div class="where">${esc(where(cur))}</div>` : ""}
        ${cur.note ? `<div class="note">${esc(cur.note)}</div>` : ""}
        ${
          ["save", "end"].includes(classify(cur.checkpoint).cat)
            ? `<label class="field igt-field">In-game time (total minutes)<input id="nav-igt" type="number" min="0" step="1" inputmode="numeric" placeholder="e.g. 52" value="${cur.igt ?? ""}"></label>`
            : classify(cur.checkpoint).cat === "milestone"
              ? `<label class="field igt-field">Countdown timer reading<input id="nav-log" placeholder="e.g. 36' 59&quot;" autocomplete="off"></label>`
              : ""
        }
        <div class="actions">
          <button type="button" class="primary" data-action="done" data-id="${esc(cur.id)}">✔ Done — log it now</button>
          <button type="button" data-action="edit-step" data-id="${esc(cur.id)}">Edit &amp; log with details</button>
          ${undoBtn}
        </div>
      </div>`
    : `<div class="nav-now"><span class="label">${state.steps ? "Route complete" : "Empty route"}</span>
        <h3>${state.steps ? "Zebes is clear. 🎉" : "No steps yet"}</h3>
        <div class="where">${state.steps ? "Every checkpoint is logged. Print the scorecard or publish the journal." : "Add checkpoints on the Route tab as you play."}</div>
        <div class="actions">
          ${state.steps ? `<a class="btn primary" href="${gameUrl(game.id, "publish")}">Publish</a>` : ""}
          <button type="button" data-action="add-step">Log a pickup</button>
          ${undoBtn}
        </div></div>`;

  const nextList = rest.length
    ? `<ol class="nav-list" style="margin-top:0" aria-label="Upcoming steps">${rest
        .map(
          (s) => `<li class="c-${classify(s.checkpoint).cat}" data-action="edit-step" data-id="${esc(s.id)}">
            <span class="m3-n">${s.step}</span>
            <div><b>${esc(s.checkpoint)}</b>${where(s) ? `<small>${esc(where(s))}</small>` : ""}${s.note ? `<small class="note">${esc(s.note)}</small>` : ""}</div></li>`,
        )
        .join("")}</ol>`
    : `<p class="m3-muted">Nothing left on the route.</p>`;

  return `<section class="view stack">
    <div class="card stack">
      ${sessionBar(game, state)}
      ${progressBarHtml(state)}
      ${statsHtml(game, state)}
    </div>
    <div class="cols match">
      <div class="card"><h3>Item grid</h3>${gridHtml(state)}</div>
      <div class="card"><h3>Nav</h3>${navCard}</div>
    </div>
    <div class="cols">
      <div class="card"><h3>Next steps</h3>${nextList}</div>
      <div class="card"><h3>History</h3>${historyHtml(history(game, 5), now)}
        <p style="margin:0.75rem 0 0"><a href="${gameUrl(game.id, "journal")}">Open the full journal →</a></p></div>
    </div>
    <div class="cols">${sessionsCard(game, state)}
      <div class="card"><h3>By type</h3>${categoryBarsHtml(state)}</div>
      <div class="card"><h3>By area</h3>${areasHtml(state)}<h3 style="margin-top:1.25rem">Bosses</h3>${bossesHtml(state)}</div>
      <div class="card"><h3>Items per session</h3>${paceHtml(pace(game))}</div>
    </div>
    <p class="toolbar"><button type="button" class="small ghost" data-action="edit-game" data-id="${esc(game.id)}">Game details</button></p>
  </section>`;
}

// ----- Route

/** @param {Game} game @param {import("./engine.js").State} state */
function renderRoute(game, state) {
  const { q, show } = routeFilter;
  const needle = q.trim().toLowerCase();
  const visible = game.steps.filter((s) => {
    const { cat } = classify(s.checkpoint);
    if (show === "todo" && isDone(s)) return false;
    if (show === "done" && !isDone(s)) return false;
    if (show === "pickups" && !CATEGORIES[cat].pickup) return false;
    if (show === "bosses" && cat !== "boss") return false;
    if (show.startsWith("area:") && s.area !== show.slice(5)) return false;
    if (needle) {
      const hay = `${s.checkpoint} ${s.area ?? ""} ${s.room ?? ""} ${s.note ?? ""} ${s.log ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const opt = (v, label) => `<option value="${esc(v)}"${show === v ? " selected" : ""}>${esc(label)}</option>`;
  const rows = visible
    .map((s, i) => {
      const { cat } = classify(s.checkpoint);
      const isCur = state.current?.id === s.id;
      return `<tr class="${isDone(s) ? "done" : ""}${isCur ? " current" : ""}" data-id="${esc(s.id)}">
        <td class="cat c-${cat}"></td>
        <td class="num">${s.step}</td>
        <td><input type="checkbox" data-action="toggle" data-id="${esc(s.id)}" ${isDone(s) ? "checked" : ""} aria-label="Step ${s.step} ${esc(s.checkpoint)} done"></td>
        <td><b>${esc(s.checkpoint)}</b></td>
        <td>${esc(s.area ?? "")}${s.seq != null ? ` #${s.seq}` : ""}</td>
        <td>${esc(s.room ?? "")}</td>
        <td class="note">${esc(s.note ?? "")}${s.log ? `<br><b>Log:</b> ${esc(s.log)}` : ""}</td>
        <td class="time">${s.ts != null ? esc(fmtStamp(s.ts)) : '<span class="pending">—</span>'}</td>
        <td class="time">${s.igt != null ? esc(fmtIgt(s.igt)) : ""}</td>
        <td class="act"><button type="button" class="small" data-action="edit-step" data-id="${esc(s.id)}">Edit</button></td>
      </tr>`;
    })
    .join("");
  return `<section class="view">
    <div class="picker-head"><h2>Route</h2>
      <div class="toolbar"><button type="button" class="primary" data-action="add-step">＋ Add step</button></div></div>
    <div class="route-controls">
      <input type="search" id="route-q" placeholder="Search checkpoints, rooms, notes…" value="${esc(q)}" aria-label="Search route">
      <select id="route-show" aria-label="Filter">
        ${opt("all", "All steps")}${opt("todo", "To do")}${opt("done", "Done")}${opt("pickups", "Pickups only")}${opt("bosses", "Bosses")}
        ${ALL_AREAS.map((a) => opt("area:" + a, a)).join("")}
      </select>
      <span class="m3-muted">${visible.length} of ${game.steps.length}</span>
    </div>
    <div class="table-wrap"><table class="route">
      <thead><tr><th></th><th>#</th><th>Done</th><th>Checkpoint</th><th>Area</th><th>Room</th><th>Note</th><th>Timestamp</th><th>IGT</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="10" class="m3-muted" style="padding:1.5rem;text-align:center">${game.steps.length ? "No steps match." : "No steps yet. Add the first one."}</td></tr>`}</tbody>
    </table></div>
  </section>`;
}

// ----- Journal

/** @param {Game} game */
function renderJournal(game) {
  return `<section class="view">
    <div class="picker-head"><h2>Journal</h2>
      <div class="toolbar"><button type="button" data-action="add-event">＋ Start/stop event</button><button type="button" class="primary" data-action="add-entry">＋ Journal entry</button></div></div>
    <div class="card">${timelineHtml(game, { edit: true })}</div>
  </section>`;
}

// ----- Publish

/** @param {Game} game @param {import("./engine.js").State} state */
function renderPublish(game, state) {
  const p = printPrefs;
  const h = htmlPrefs;
  const sel = (cur, v, label) => `<option value="${v}"${cur === v ? " selected" : ""}>${label}</option>`;
  const chk = (id, label, on) => `<label class="check"><input type="checkbox" id="${id}"${on ? " checked" : ""}> ${label}</label>`;
  return `<section class="view">
    <h2>Publish</h2>
    ${state.complete ? "" : `<div class="notice">This run isn’t finished yet (${state.percent}%). You can still print or export a snapshot; run it again when you’re done for the final version.</div>`}
    <div class="publish-grid no-print">
      <div class="card"><h3>Printable scorecard</h3>
        <p class="hint">A one-sheet summary and checkpoint log, sized for pasting into a journal. Use the print dialog’s “Save as PDF”, with margins set to default and “Background graphics” on.</p>
        <div class="field-row" style="margin-top:0.75rem">
          <label class="field">Layout<select id="p-layout">${sel(p.layout, "scoresheet", "Scoresheet: one page, like the spreadsheet")}${sel(p.layout, "illustrated", "Illustrated: progress grid and log")}</select></label>
        </div>
        <div class="field-row" style="margin-top:0.75rem">
          <label class="field">Paper<select id="p-paper">${sel(p.paper, "letter", "Letter")}${sel(p.paper, "a4", "A4")}${sel(p.paper, "a5", "A5 (journal size)")}</select></label>
          <label class="field">Orientation<select id="p-orient">${sel(p.orientation, "landscape", "Landscape")}${sel(p.orientation, "portrait", "Portrait")}</select></label>
        </div>
        <div class="options"${p.layout === "scoresheet" ? " hidden" : ""}>
          ${chk("p-journal", "Include journal entries", p.journal)}
          ${chk("p-notes", "Include route notes", p.notes)}
          ${chk("p-remaining", "Include unfinished checkpoints (as a to-do checklist)", p.remaining)}
        </div>
        <button type="button" class="primary" data-action="print">Print / save as PDF</button>
      </div>
      <div class="card"><h3>Static journal page (HTML)</h3>
        <p class="hint">One self-contained, read-only file with no scripts and no external requests. Host it on your blog or anywhere. It follows the visitor’s light or dark setting, and it also re-imports into this app.</p>
        <label class="field" style="margin-top:0.75rem">Subtitle (optional)<input id="h-sub" value="${esc(h.subtitle)}" placeholder="Auto: dates · percent · system"></label>
        <div class="options">
          ${chk("h-notes", "Include route notes (item locations; spoilers)", h.notes)}
          ${chk("h-unfinished", "Include unfinished checkpoints", h.unfinished)}
        </div>
        <div class="toolbar"><button type="button" class="primary" data-action="export-html">Download HTML</button><button type="button" data-action="preview-html">Preview in new tab</button></div>
      </div>
    </div>
    <div class="paper-preview" id="sheet-wrap">${buildSheetHtml(game, p)}</div>
  </section>`;
}

function applyPaper() {
  const { page, vars } = paperCss(/** @type {any} */ (printPrefs.paper), /** @type {any} */ (printPrefs.orientation));
  $("#page-style").textContent = page;
  const sheet = document.querySelector(".sheet");
  if (sheet) {
    for (const decl of vars.split(";").filter(Boolean)) {
      const [k, v] = decl.split(":");
      /** @type {HTMLElement} */ (sheet).style.setProperty(k, v);
    }
    const w = parseFloat(vars.match(/--sheet-w:([\d.]+)in/)?.[1] ?? "11");
    sheet.classList.toggle("narrow", w < 7);
  }
}

// ---------------------------------------------------------------------------------------------
// Dialogs

/** @param {string} html @returns {Promise<FormData | null>} resolves on submit (with data) or cancel (null) */
function openDialog(html) {
  return new Promise((resolve) => {
    dlg.innerHTML = html;
    let result = null;
    const onClose = () => {
      dlg.removeEventListener("close", onClose);
      resolve(result);
    };
    dlg.addEventListener("close", onClose);
    const form = dlg.querySelector("form");
    form?.addEventListener("submit", (e) => {
      const submitter = /** @type {SubmitEvent} */ (e).submitter;
      if (submitter?.getAttribute("value") === "cancel") return;
      e.preventDefault();
      const fd = new FormData(/** @type {HTMLFormElement} */ (form));
      if (submitter?.getAttribute("name")) fd.set(submitter.getAttribute("name") ?? "", submitter.getAttribute("value") ?? "");
      result = fd;
      dlg.close();
    });
    dlg.querySelector("[data-now]")?.addEventListener("click", () => {
      const input = /** @type {HTMLInputElement} */ (dlg.querySelector('[name="ts"]'));
      input.value = toInputValue(Date.now());
    });
    dlg.querySelector("[data-clear-ts]")?.addEventListener("click", () => {
      /** @type {HTMLInputElement} */ (dlg.querySelector('[name="ts"]')).value = "";
    });
    dlg.showModal();
    /** @type {HTMLElement | null} */ (dlg.querySelector("[autofocus], input, select, textarea"))?.focus();
  });
}

const val = (fd, k) => String(fd.get(k) ?? "").trim();

/** @param {Game} game @param {string | null} id step id, or null to add */
async function stepDialog(game, id) {
  const existing = id ? game.steps.find((s) => s.id === id) : null;
  const s = existing ?? { checkpoint: "", area: null, seq: null, room: null, note: null, ts: Date.now(), igt: null, log: null };
  const areaOpts = ["", ...ALL_AREAS].map((a) => `<option value="${esc(a)}"${(s.area ?? "") === a ? " selected" : ""}>${a || "—"}</option>`).join("");
  const fd = await openDialog(`<form method="dialog">
    <h2>${existing ? `Step ${existing.step}` : "Log an unplanned pickup"}</h2>
    <label class="field">Checkpoint
      <input name="checkpoint" list="cp-list" required value="${esc(s.checkpoint)}" placeholder="Missile, Item: Spazer, Boss Clear: Kraid, Save: …" autocomplete="off">
      <datalist id="cp-list">${CHECKPOINT_CHOICES.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
    <div class="field-row">
      <label class="field">Area<select name="area">${areaOpts}</select></label>
      <label class="field">Seq in area<input name="seq" type="number" min="1" step="1" value="${s.seq ?? ""}"></label>
    </div>
    <label class="field">Room<input name="room" value="${esc(s.room ?? "")}"></label>
    <div class="field-row">
      <label class="field">Timestamp<input name="ts" type="datetime-local" step="1" value="${toInputValue(s.ts)}"></label>
      <label class="field">IGT (total minutes)<input name="igt" type="number" min="0" step="1" inputmode="numeric" value="${s.igt ?? ""}" placeholder="52"></label>
    </div>
    <div class="toolbar"><button type="button" class="small" data-now>Set to now</button><button type="button" class="small" data-clear-ts>Not done yet</button></div>
    <label class="field">Route note (where it is, how to get it)<textarea name="note">${esc(s.note ?? "")}</textarea></label>
    <label class="field">My log (what happened; Ceres Escape: countdown timer reading)<textarea name="log">${esc(s.log ?? "")}</textarea></label>
    ${
      existing
        ? ""
        : `<label class="field">Insert<select name="where"><option value="afterLast">After the last completed step</option><option value="afterCurrent">After the current step</option><option value="end">At the end</option></select></label>`
    }
    <div class="dialog-actions">
      ${existing ? `<button type="submit" name="act" value="delete" class="danger left" formnovalidate>Delete step</button><button type="submit" name="act" value="up" formnovalidate>Move up</button><button type="submit" name="act" value="down" formnovalidate>Move down</button>` : ""}
      <button type="submit" value="cancel" formnovalidate>Cancel</button>
      <button type="submit" name="act" value="save" class="primary">Save</button>
    </div>
  </form>`);
  if (!fd) return;
  const act = val(fd, "act");
  if (existing && act === "delete") {
    if (!confirm(`Delete step ${existing.step} (${existing.checkpoint})?`)) return;
    return mutate(game, (g) => removeStep(g, existing.id));
  }
  if (existing && (act === "up" || act === "down")) return mutate(game, (g) => moveStep(g, existing.id, act === "up" ? -1 : 1));
  const fields = {
    checkpoint: val(fd, "checkpoint"),
    area: val(fd, "area") || null,
    seq: val(fd, "seq") ? Number(val(fd, "seq")) : null,
    room: val(fd, "room") || null,
    ts: fromInputValue(val(fd, "ts")),
    igt: parseIgt(val(fd, "igt")),
    note: val(fd, "note") || null,
    log: val(fd, "log") || null,
  };
  if (existing) return mutate(game, (g) => Object.assign(/** @type {any} */ (g.steps.find((x) => x.id === existing.id)), fields));
  return mutate(game, (g) => void addStep(g, fields, /** @type {any} */ (val(fd, "where") || "afterLast")));
}

/** @param {Game} game @param {string | null} id */
async function entryDialog(game, id) {
  const e = id ? game.entries.find((x) => x.id === id) : null;
  const fd = await openDialog(`<form method="dialog">
    <h2>${e ? "Edit journal entry" : "New journal entry"}</h2>
    <label class="field">When<input name="ts" type="datetime-local" step="1" required value="${toInputValue(e?.ts ?? Date.now())}"></label>
    <label class="field">Title<input name="title" value="${esc(e?.title ?? "")}" placeholder="Session 3: Norfair" autocomplete="off"></label>
    <label class="field">Entry<textarea name="body" style="min-height:9rem" autofocus>${esc(e?.body ?? "")}</textarea></label>
    <div class="dialog-actions">
      ${e ? `<button type="submit" name="act" value="delete" class="danger left" formnovalidate>Delete</button>` : ""}
      <button type="submit" value="cancel" formnovalidate>Cancel</button>
      <button type="submit" name="act" value="save" class="primary">Save</button>
    </div></form>`);
  if (!fd) return;
  if (e && val(fd, "act") === "delete") {
    if (!confirm("Delete this journal entry?")) return;
    return mutate(game, (g) => void (g.entries = g.entries.filter((x) => x.id !== e.id)));
  }
  const entry = { id: e?.id ?? uid(), ts: fromInputValue(val(fd, "ts")) ?? Date.now(), title: val(fd, "title"), body: val(fd, "body") };
  if (!entry.title && !entry.body) return;
  return mutate(game, (g) => {
    g.entries = g.entries.filter((x) => x.id !== entry.id);
    g.entries.push(entry);
  });
}

/** @param {Game} game @param {string | null} id */
async function eventDialog(game, id) {
  const e = id ? (game.events ?? []).find((x) => x.id === id) : null;
  const fd = await openDialog(`<form method="dialog">
    <h2>${e ? "Edit session event" : "Add session event"}</h2>
    <p class="hint">Start and stop events can be at any time, including in the past. Stray stops and double starts are ignored.</p>
    <div class="field-row">
      <label class="field">Event<select name="kind"><option value="start"${e?.kind !== "stop" ? " selected" : ""}>▶ Start playing</option><option value="stop"${e?.kind === "stop" ? " selected" : ""}>■ Stop playing</option></select></label>
      <label class="field">When<input name="ts" type="datetime-local" step="1" required value="${toInputValue(e?.ts ?? Date.now())}"></label>
    </div>
    <div class="dialog-actions">
      ${e ? `<button type="submit" name="act" value="delete" class="danger left" formnovalidate>Delete</button>` : ""}
      <button type="submit" value="cancel" formnovalidate>Cancel</button>
      <button type="submit" name="act" value="save" class="primary">Save</button>
    </div></form>`);
  if (!fd) return;
  if (e && val(fd, "act") === "delete") return mutate(game, (g) => void (g.events = g.events.filter((x) => x.id !== e.id)));
  const ev = { id: e?.id ?? uid(), ts: fromInputValue(val(fd, "ts")) ?? Date.now(), kind: /** @type {"start" | "stop"} */ (val(fd, "kind") === "stop" ? "stop" : "start") };
  return mutate(game, (g) => {
    g.events = (g.events ?? []).filter((x) => x.id !== ev.id);
    g.events.push(ev);
    g.events.sort((a, b) => a.ts - b.ts);
  });
}

/** @param {Game | null} game existing game to edit, or null to create */
async function gameDialog(game) {
  const m = game?.meta ?? { system: "", goal: "100% item collection", bosses: "All minor, all major", bossOrder: "KPDR", glitches: "None" };
  const month = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const fd = await openDialog(`<form method="dialog">
    <h2>${game ? "Game details" : "New game"}</h2>
    <label class="field">Name<input name="name" required value="${esc(game?.name ?? `Super Metroid – ${month}`)}" autofocus></label>
    ${
      game
        ? ""
        : `<fieldset style="border:1px solid var(--line);border-radius:8px;padding:0.6rem 0.8rem;display:grid;gap:0.4rem"><legend style="font-size:0.85rem;font-weight:600;color:var(--support)">Start from</legend>
        <label class="check"><input type="radio" name="template" value="route" checked> 100% route (114 checkpoints with item notes)</label>
        <label class="check"><input type="radio" name="template" value="blank"> Blank (log pickups as you find them)</label></fieldset>`
    }
    <div class="field-row">
      <label class="field">System<input name="system" value="${esc(m.system)}" placeholder="SNES Classic, emulator, …"></label>
      <label class="field">Goal<input name="goal" value="${esc(m.goal)}"></label>
      <label class="field">Bosses<input name="bosses" value="${esc(m.bosses)}"></label>
      <label class="field">Boss order<input name="bossOrder" value="${esc(m.bossOrder)}"></label>
      <label class="field">Glitches<input name="glitches" value="${esc(m.glitches)}"></label>
    </div>
    <div class="dialog-actions"><button type="submit" value="cancel" formnovalidate>Cancel</button><button type="submit" class="primary">${game ? "Save" : "Create"}</button></div>
  </form>`);
  if (!fd) return null;
  const meta = { system: val(fd, "system"), goal: val(fd, "goal"), bosses: val(fd, "bosses"), bossOrder: val(fd, "bossOrder"), glitches: val(fd, "glitches") };
  if (game) {
    await mutate(game, (g) => {
      g.name = val(fd, "name") || g.name;
      g.meta = meta;
    });
    return game;
  }
  const g = newGame({ name: val(fd, "name"), template: /** @type {any} */ (val(fd, "template") || "route"), meta });
  await save(g);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Import / export

/**
 * Open the file picker through a permanent, attached input. A detached input created on the fly
 * can lose its change event in iOS WebKit browsers (Safari, Brave, Chrome on iOS).
 * @returns {Promise<File[]>}
 */
function pickFiles() {
  const input = /** @type {HTMLInputElement} */ ($("#file-input"));
  return new Promise((resolve) => {
    input.value = "";
    input.onchange = () => {
      const files = [...(input.files ?? [])];
      resolve(files);
    };
    input.click();
  });
}

/** @param {File} file @returns {Promise<string>} */
function readText(file) {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

/** @param {File[]} files */
async function importFiles(files) {
  const imported = [];
  const errors = [];
  for (const file of files) {
    try {
      imported.push(...parseImport(await readText(file), file.name));
    } catch (err) {
      errors.push(`${file.name}: ${/** @type {Error} */ (err).message}`);
    }
  }
  const taken = new Set(games.keys());
  let count = 0;
  for (let g of imported) {
    if (taken.has(g.id)) {
      const replace = confirm(`“${g.name}” already exists here.\n\nOK: replace it with the imported version.\nCancel: keep both (import as a copy).`);
      if (!replace) g = dedupeId(g, taken);
    }
    await save(g);
    taken.add(g.id);
    count++;
  }
  render();
  if (errors.length) alert(`Some files could not be imported:\n\n${errors.join("\n")}`);
  if (count) toast(`Imported ${count} game${count === 1 ? "" : "s"}`);
  else if (!errors.length) toast("No games found in that file");
}

async function markBackup() {
  lastBackup = Date.now();
  changesSinceBackup = 0;
  await store.setMeta("lastBackup", lastBackup).catch(() => {});
  await store.setMeta("changesSinceBackup", 0).catch(() => {});
}

async function cssText() {
  const res = await fetch(new URL("./style.css", import.meta.url));
  if (!res.ok) throw new Error("Could not load style.css");
  return res.text();
}

// ---------------------------------------------------------------------------------------------
// Events

document.addEventListener("click", async (ev) => {
  const el = /** @type {HTMLElement | null} */ ((/** @type {HTMLElement} */ (ev.target)).closest("[data-action]"));
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id ?? null;
  const game = current();
  if (el.tagName === "INPUT") return; // handled by change
  switch (action) {
    case "new-game": {
      const g = await gameDialog(null);
      if (g) location.hash = gameUrl(g.id);
      break;
    }
    case "import": {
      const files = await pickFiles();
      if (files.length) {
        try {
          await importFiles(files);
        } catch (err) {
          alert(`Import failed: ${/** @type {Error} */ (err).message}`);
        }
      }
      break;
    }
    case "export-all":
      download("metroid-3-backup.json", backupJson([...games.values()]));
      await markBackup();
      render();
      toast("Backup downloaded");
      break;
    case "export-game": {
      const g = id && games.get(id);
      if (g) {
        download(gameFilename(g, "json"), backupJson([g]));
        toast("Game exported");
      }
      break;
    }
    case "edit-game": {
      const g = id && games.get(id);
      if (g) await gameDialog(g);
      break;
    }
    case "dup-game": {
      const g = id && games.get(id);
      if (!g) break;
      const copy = cloneGame(g);
      copy.id = uid();
      copy.name = `${g.name} (copy)`;
      copy.createdAt = Date.now();
      copy.steps.forEach((s) => (s.id = uid()));
      copy.entries.forEach((e) => (e.id = uid()));
      (copy.events ?? []).forEach((e) => (e.id = uid()));
      await save(copy);
      render();
      break;
    }
    case "delete-game": {
      const g = id && games.get(id);
      if (g && confirm(`Delete “${g.name}” from this browser? Export it first if you want to keep it. This can’t be undone.`)) {
        games.delete(g.id);
        await store.remove(g.id);
        changesSinceBackup++;
        channel?.postMessage({ type: "changed" });
        render();
      }
      break;
    }
    case "done":
      if (game && id) {
        const igt = parseIgt(/** @type {HTMLInputElement | null} */ (document.getElementById("nav-igt"))?.value);
        const timer = /** @type {HTMLInputElement | null} */ (document.getElementById("nav-log"))?.value.trim();
        await mutate(game, (g) => {
          setDone(g, id, Date.now());
          const st = /** @type {any} */ (g.steps.find((x) => x.id === id));
          if (igt != null) st.igt = igt;
          if (timer) st.log = `Countdown timer: ${timer}`;
        });
        toast("Logged");
      }
      break;
    case "edit-step":
      if (game && id) await stepDialog(game, id);
      break;
    case "add-step":
      if (game) await stepDialog(game, null);
      break;
    case "edit-entry":
      if (game && id) await entryDialog(game, id);
      break;
    case "add-entry":
      if (game) await entryDialog(game, null);
      break;
    case "undo":
      await undo();
      break;
    case "session-toggle":
      if (game) {
        const playing = Boolean(deriveState(game).playing);
        await mutate(game, (g) => void (g.events = [...(g.events ?? []), { id: uid(), ts: Date.now(), kind: playing ? "stop" : "start" }]));
        toast(playing ? "Session stopped" : "Session started");
      }
      break;
    case "edit-event":
      if (game && id) await eventDialog(game, id);
      break;
    case "add-event":
      if (game) await eventDialog(game, null);
      break;
    case "infer-sessions":
      if (game) {
        const gapText = prompt("Start a new session after a gap of how many minutes between logged steps?", "30");
        const gap = Number(gapText);
        if (!gapText || !(gap > 0)) break;
        if ((game.events ?? []).length && !confirm("This replaces your existing start/stop events. Continue?")) break;
        const evs = inferSessions(game, gap * 60000);
        await mutate(game, (g) => void (g.events = evs));
        toast(`Created ${evs.length / 2} session${evs.length === 2 ? "" : "s"}`);
      }
      break;
    case "print":
      applyPaper();
      window.print();
      break;
    case "export-html":
    case "preview-html": {
      if (!game) break;
      try {
        const html = buildJournalHtml(game, await cssText(), htmlPrefs);
        if (action === "export-html") {
          download(gameFilename(game, "html"), html, "text/html");
          toast("Journal page downloaded");
        } else {
          window.open(URL.createObjectURL(new Blob([html], { type: "text/html" })), "_blank");
        }
      } catch (err) {
        alert(/** @type {Error} */ (err).message);
      }
      break;
    }
  }
});

document.addEventListener("change", async (ev) => {
  const el = /** @type {HTMLInputElement} */ (ev.target);
  const game = current();
  if (el.matches('input[data-action="toggle"]') && game) {
    const id = /** @type {string} */ (el.dataset.id);
    await mutate(game, (g) => setDone(g, id, el.checked ? Date.now() : null));
    return;
  }
  if (el.id === "route-show") {
    routeFilter.show = el.value;
    return render();
  }
  const prefs = {
    "p-layout": () => (printPrefs.layout = el.value),
    "p-paper": () => (printPrefs.paper = el.value),
    "p-orient": () => (printPrefs.orientation = el.value),
    "p-journal": () => (printPrefs.journal = el.checked),
    "p-notes": () => (printPrefs.notes = el.checked),
    "p-remaining": () => (printPrefs.remaining = el.checked),
    "h-notes": () => (htmlPrefs.notes = el.checked),
    "h-unfinished": () => (htmlPrefs.unfinished = el.checked),
    "h-sub": () => (htmlPrefs.subtitle = el.value),
  };
  if (prefs[el.id]) {
    prefs[el.id]();
    if (el.id === "p-layout") return render();
    if (el.id.startsWith("p-") && game) {
      $("#sheet-wrap").innerHTML = buildSheetHtml(game, printPrefs);
      applyPaper();
    }
  }
});

document.addEventListener("input", (ev) => {
  const el = /** @type {HTMLInputElement} */ (ev.target);
  if (el.id === "route-q") {
    routeFilter.q = el.value;
    const pos = el.selectionStart;
    render();
    const again = /** @type {HTMLInputElement} */ (document.getElementById("route-q"));
    again.focus();
    again.setSelectionRange(pos, pos);
  }
});

window.addEventListener("hashchange", () => {
  window.scrollTo(0, 0);
  render();
});
window.addEventListener("beforeprint", () => {
  if (document.body.classList.contains("is-publish")) applyPaper();
});

channel?.addEventListener("message", async () => {
  if (dlg.open) return;
  for (const g of await store.all()) games.set(g.id, g);
  const ids = new Set((await store.all()).map((g) => g.id));
  for (const id of [...games.keys()]) if (!ids.has(id)) games.delete(id);
  render();
});

// Keep "x min ago" fresh.
setInterval(() => {
  if (!dlg.open && !document.hidden && parseHash().view === "dash" && current()) render();
}, 60000);

// ---------------------------------------------------------------------------------------------
// Boot

async function boot() {
  store = await openStore();
  for (const g of await store.all()) {
    // Repair anything odd (older exports, hand edits) without losing data.
    if (!Array.isArray(g.steps)) continue;
    renumber(g);
    g.events ??= [];
    for (const st of g.steps) {
      st.igt = classify(st.checkpoint).cat === "milestone" ? null : parseIgt(st.igt);
    }
    games.set(g.id, g);
  }
  lastBackup = (await store.getMeta("lastBackup")) ?? null;
  changesSinceBackup = (await store.getMeta("changesSinceBackup")) ?? 0;
  render();
  persistence = await requestPersistence();
  if (!parseHash().game) render();
}

boot().catch((err) => {
  app.innerHTML = `<div class="notice"><b>Metroid 3 could not start.</b> ${esc(err?.message ?? err)}</div>`;
});
