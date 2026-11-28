// Metroid 3: file exports (JSON backup, single-journal HTML) and the printable sheet.

import {
  classify,
  deriveState,
  fmtClock,
  fmtDate,
  fmtHms,
  fmtIgt,
  fmtPlay,
  fmtSpan,
  fmtSheetStamp,
  fmtStamp,
  isDone,
  notesReport,
  journalDays,
  pace,
  runningPercent,
  slug,
  toExportJson,
} from "./engine.js";
import {
  areasHtml,
  bossesHtml,
  categoryBarsHtml,
  esc,
  gridHtml,
  paceHtml,
  progressBarHtml,
  statsHtml,
  timelineHtml,
  where,
} from "./widgets.js";

/** @typedef {import("./engine.js").Game} Game */

/**
 * Trigger a browser download.
 * @param {string} filename @param {string} text @param {string} [type]
 */
export function download(filename, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** @param {Game[]} games @param {number} [now] */
export function backupJson(games, now = Date.now()) {
  return JSON.stringify(toExportJson(games, now), null, 2);
}

/** @param {Game} game */
export function gameFilename(game, ext) {
  return `metroid-3-${slug(game.name)}.${ext}`;
}

/**
 * The editorial summary line shown under the title of the exported page.
 * @param {Game} game @param {import("./engine.js").State} state
 */
function dek(game, state) {
  const bits = [];
  if (state.first != null) bits.push(`${fmtDate(state.first)}${state.complete && state.last != null ? ` to ${fmtDate(state.last)}` : ""}`);
  bits.push(`${state.percent}% item collection`);
  if (game.meta.system) bits.push(game.meta.system);
  return bits.join(" · ");
}

/**
 * A complete, self-contained, read-only HTML page for one game. No scripts run; the game's data
 * is embedded as inert JSON so the page can be imported back into the app.
 * @param {Game} game
 * @param {string} css contents of style.css
 * @param {{ notes?: boolean, unfinished?: boolean, subtitle?: string, now?: number }} [opts]
 */
export function buildJournalHtml(game, css, opts = {}) {
  const { notes = true, unfinished = false, subtitle = "", now = Date.now() } = opts;
  const state = deriveState(game);
  const view = unfinished
    ? game
    : { ...game, steps: game.steps.filter(isDone) };
  const title = game.name;
  const description = `${title}: Super Metroid ${state.percent}% item run journal.`;
  const meta = game.meta;
  const facts = [
    ["Goal", meta.goal],
    ["Bosses", meta.bosses],
    ["Boss order", meta.bossOrder],
    ["Glitches", meta.glitches],
    ["System", meta.system],
  ].filter(([, v]) => v);
  const data = JSON.stringify(toExportJson([game], now)).replace(/<\//g, "<\\/");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="generator" content="Metroid 3">
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<title>${esc(title)}</title>
<style>
${css}
</style>
</head>
<body>
<div class="pub m3">
  <header class="pub-hero">
    <div class="kicker">Super Metroid · ${state.complete ? "Journal" : "Journal in progress"}</div>
    <h1>${esc(title)}</h1>
    <p>${esc(subtitle || dek(game, state))}</p>
  </header>

  <section class="block" aria-label="Summary">
    <h2>Run summary</h2>
    ${statsHtml(game, state)}
    <div style="margin-top:1.25rem">${progressBarHtml(state)}</div>
    ${
      facts.length
        ? `<p class="m3-muted" style="margin:1rem 0 0">${facts.map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`).join(" &nbsp;·&nbsp; ")}</p>`
        : ""
    }
  </section>

  <section class="block" aria-label="Item grid">
    <h2>Item grid</h2>
    ${gridHtml(state)}
  </section>

  <div class="pub-cols">
    <section class="block" aria-label="Collection by type"><h2>By type</h2>${categoryBarsHtml(state)}</section>
    <section class="block" aria-label="Collection by area"><h2>By area</h2>${areasHtml(state)}<h2 style="margin-top:1.5rem">Bosses</h2>${bossesHtml(state)}</section>
  </div>

  <section class="block" aria-label="Pace">
    <h2>Items per session</h2>
    ${paceHtml(pace(game))}
  </section>

  <section class="block" aria-label="Journal">
    <h2>The journal</h2>
    ${timelineHtml(view, { notes })}
  </section>
  <footer class="pub-foot">
    Exported ${esc(fmtStamp(now))} from Metroid 3. ${state.stepsDone} of ${state.steps} steps logged${state.first != null && state.last != null ? ` over ${esc(fmtSpan(state))} of clock time` : ""}.
  </footer>
</div>
<script type="application/json" id="metroid3-data">${data}</script>
</body>
</html>
`;
}

/**
 * The printable scorecard markup (also shown as the on-screen preview).
 * @param {Game} game
 * @param {{ notes?: boolean, journal?: boolean, remaining?: boolean }} [opts]
 */
export function buildSheetHtml(game, opts = {}) {
  if (opts.layout === "notes") return buildNotesReportHtml(game);
  if (opts.layout === "scoresheet" || !opts.layout) return buildScoresheetHtml(game);
  const card = opts.layout === "card";
  const { notes = false, journal = true, remaining = true } = opts;
  const state = deriveState(game);
  const meta = game.meta;
  const rows = game.steps.filter((s) => remaining || isDone(s));
  const facts = [
    ["Start", state.first != null ? fmtStamp(state.first) : ""],
    ["Finish", state.complete && state.last != null ? fmtStamp(state.last) : ""],
    ["Play time", state.sessions.length ? fmtPlay(state) : ""],
    ["Clock span", state.first != null ? fmtSpan(state) : ""],
    ["Game time", state.igt != null ? fmtIgt(state.igt) : ""],
    ["System", meta.system],
    ["Item %", `${state.percent}%`],
    ["Bosses", meta.bosses],
    ["Boss order", meta.bossOrder],
    ["Glitches", meta.glitches],
    ["Goal", meta.goal],
  ].filter(([, v]) => v !== "");
  const log = rows
    .map((s) => {
      const { cat } = classify(s.checkpoint);
      const tip = (notes && s.note ? `<span class="tip">${esc(s.note)}</span>` : "") + (s.log ? `<span class="tip">${esc(s.log)}</span>` : "");
      const w = where(s);
      return `<div class="log-row c-${cat} ${isDone(s) ? "is-done" : "todo"}">
        <span class="n">${s.step}</span>
        <span><b>${esc(s.checkpoint)}</b>${w ? `<small>${esc(w)}</small>` : ""}${tip}</span>
        <span class="t">${s.ts != null ? esc(fmtStamp(s.ts).slice(5, 16)) : ""}${s.igt != null ? ` · ${esc(fmtIgt(s.igt))}` : ""}</span>
      </div>`;
    })
    .join("");
  const entries = journal
    ? journalDays({ ...game, steps: [] })
        .flatMap((d) => d.items)
        .map((it) =>
          it.kind === "entry"
            ? `<div class="entry"><time>${esc(fmtDate(it.ts))} ${esc(fmtClock(it.ts))}</time>${it.entry.title ? `<b>${esc(it.entry.title)}</b>` : ""}<p>${esc(it.entry.body)}</p></div>`
            : "",
        )
        .join("")
    : "";
  return `<article class="sheet m3${card ? " card-only" : ""}">
    <header class="sheet-head">
      <h1>${esc(game.name)}</h1>
      <div class="sub">Super Metroid · ${state.stepsDone}/${state.steps} checkpoints</div>
    </header>
    <dl class="sheet-meta">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    <div class="sheet-top">
      <div>${progressBarHtml(state)}<h2>Item grid</h2>${gridHtml(state)}</div>
      <div style="min-width:15rem">
        <h2 style="margin-top:0">By area</h2>${areasHtml(state)}
        <h2>Bosses</h2>${bossesHtml(state)}
      </div>
    </div>
    ${card ? "" : `<h2>Checkpoints</h2><div class="sheet-log">${log}</div>`}
    ${!card && entries ? `<div class="sheet-journal"><h2>Journal</h2>${entries}</div>` : ""}
    <footer class="sheet-foot"><span>Metroid 3</span><span>${esc(game.name)} · printed ${esc(fmtStamp(Date.now()).slice(0, 10))}</span></footer>
  </article>`;
}

/**
 * Printable notes report: every route note, log note and route feedback, step by step in route
 * order, then every journal entry. Feedback is marked so it can be applied to the route later.
 * @param {Game} game
 */
export function buildNotesReportHtml(game) {
  const report = notesReport(game);
  const c = report.counts;
  const when = (iso) => (iso ? fmtStamp(Date.parse(iso)).slice(0, 16) : "not done");
  const steps = report.steps
    .map((s) => {
      const cat = classify(s.checkpoint).cat;
      const place = [s.area ? (s.seq != null ? `${s.area} #${s.seq}` : s.area) : "", s.room ?? ""].filter(Boolean).join(" · ");
      return `<div class="nr c-${cat}${s.feedback ? " has-fb" : ""}">
        <div class="nr-h"><span class="n">${s.step}</span><b>${esc(s.checkpoint)}</b><span class="w">${esc(place)}</span><span class="t">${esc(when(s.done))}</span></div>
        ${s.routeNote ? `<p class="rn"><i>Route</i>${esc(s.routeNote)}</p>` : ""}
        ${s.log ? `<p class="lg"><i>Log</i>${esc(s.log)}</p>` : ""}
        ${s.feedback ? `<p class="fb"><i>⚑ Feedback</i>${esc(s.feedback)}</p>` : ""}
      </div>`;
    })
    .join("");
  const entries = report.entries
    .map(
      (e) =>
        `<div class="nr entry"><div class="nr-h"><b>${esc(e.title || "Journal entry")}</b><span class="t">${esc(when(e.ts))}</span></div><p class="lg">${esc(e.body)}</p></div>`,
    )
    .join("");
  return `<article class="sheet notes-report m3" aria-label="Notes report for ${esc(game.name)}">
    <header class="sheet-head"><h1>${esc(game.name)}</h1><div class="sub">Notes report · printed ${esc(fmtStamp(Date.now()).slice(0, 10))}</div></header>
    <p class="nr-sum">${c.stepsWithNotes} step${c.stepsWithNotes === 1 ? "" : "s"} with notes · ${c.feedback} route feedback · ${c.routeNotes} route notes · ${c.logNotes} log notes · ${c.journalEntries} journal entr${c.journalEntries === 1 ? "y" : "ies"}</p>
    <h2>Steps</h2>
    ${steps || '<p class="nr-none">No step notes yet.</p>'}
    ${entries ? `<h2>Journal entries</h2>${entries}` : ""}
  </article>`;
}

/** The notes report as a JSON string, for feeding back into the route. @param {Game} game */
export function notesReportJson(game) {
  return JSON.stringify(notesReport(game), null, 2);
}

/**
 * The spreadsheet's "Printable Scorecard": run facts on top, then every checkpoint in two
 * columns (item %, checkpoint, timestamp, IGT), sized to fill exactly one page.
 * @param {Game} game
 */
export function buildScoresheetHtml(game) {
  const state = deriveState(game);
  const meta = game.meta;
  const pct = runningPercent(game);
  const half = Math.ceil(game.steps.length / 2) || 1;
  const row = (s, i) => {
    const cat = classify(s.checkpoint).cat;
    // Ceres Escape's reading is the countdown timer, kept in the log; it sits in the IGT column.
    const igt = s.igt != null ? fmtIgt(s.igt) : cat === "milestone" && s.log ? s.log.replace(/^Countdown timer:\s*/i, "") : "";
    return `<div class="sc-row c-${cat}"><span class="p">${pct[i]}</span><span class="c" title="${esc(s.checkpoint)}">${esc(s.checkpoint)}</span><span class="t">${s.ts != null ? esc(fmtSheetStamp(s.ts)) : ""}</span><span class="g">${esc(igt)}</span></div>`;
  };
  const head = `<div class="sc-row sc-th"><span class="p">%</span><span class="c">Checkpoint</span><span class="t">Timestamp</span><span class="g">IGT</span></div>`;
  const rows = game.steps.map(row);
  const left = [
    ["Start", state.first != null ? fmtSheetStamp(state.first) : ""],
    ["Finish", state.last != null ? fmtSheetStamp(state.last) : ""],
    ["Clock Time", state.first != null && state.last != null ? fmtHms(state.last - state.first) : ""],
    ["Game Time", state.igt != null ? fmtIgt(state.igt) : ""],
    ["System", meta.system],
  ];
  const right = [
    ["Item %", String(state.percent)],
    ["Bosses", meta.bosses],
    ["Major Boss Order", meta.bossOrder],
    ["Glitches Used", meta.glitches],
    ["Play Time", state.sessions.length ? fmtPlay(state) : ""],
  ];
  const block = (list) => list.map(([k, v]) => `<div class="sc-k">${v ? esc(k) : ""}</div><div class="sc-v">${esc(v)}</div>`).join("");
  return `<article class="sheet sc m3" style="--rows:${half}" aria-label="Printable scorecard for ${esc(game.name)}">
    <div class="sc-title">${esc(game.name)}</div>
    <div class="sc-head"><div class="sc-block">${block(left)}</div><div class="sc-block">${block(right)}</div></div>
    <div class="sc-body">
      <div class="sc-half">${head}${rows.slice(0, half).join("")}</div>
      <div class="sc-half">${head}${rows.slice(half).join("")}</div>
    </div>
  </article>`;
}

/** @param {"letter" | "a4" | "a5"} paper @param {"landscape" | "portrait"} orientation */
export function paperCss(paper, orientation) {
  const sizes = { letter: [8.5, 11], a4: [8.27, 11.69], a5: [5.83, 8.27] };
  const [w, h] = sizes[paper] ?? sizes.letter;
  const [pw, ph] = orientation === "landscape" ? [Math.max(w, h), Math.min(w, h)] : [Math.min(w, h), Math.max(w, h)];
  const name = paper === "letter" ? "letter" : paper.toUpperCase();
  return {
    page: `@page { size: ${name} ${orientation}; margin: 0.4in; }`,
    vars: `--sheet-w:${pw}in;--sheet-h:${ph}in;`,
  };
}
