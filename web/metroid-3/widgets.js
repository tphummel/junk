// Metroid 3: HTML-string widgets shared by the app, the print sheet and the exported journal page.
//
// Every function returns a string of markup styled by style.css. All text from a game goes
// through esc().

import {
  CATEGORIES,
  FIXED_ITEMS,
  TOTALS,
  classify,
  fmtAgo,
  fmtClock,
  fmtDate,
  fmtDuration,
  fmtIgt,
  fmtPlay,
  fmtSpan,
  journalDays,
} from "./engine.js";

/** @param {unknown} s */
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** @param {number} n @param {number} total */
const pct = (n, total) => (total ? Math.min(100, Math.round((n / total) * 100)) : 0);

/** One line describing where a step happened. @param {import("./engine.js").Step} s */
export function where(s) {
  const bits = [];
  if (s.area) bits.push(s.seq != null ? `${s.area} #${s.seq}` : s.area);
  if (s.room) bits.push(s.room);
  return bits.join(" · ");
}

/** Short tooltip for a step. @param {import("./engine.js").Step} s */
export function stepTitle(s) {
  const w = where(s);
  return `#${s.step} ${s.checkpoint}${w ? " — " + w : ""}`;
}

/** The 100-segment progress bar. @param {import("./engine.js").State} state */
export function progressBarHtml(state) {
  const n = Math.min(100, state.percent);
  const segs = Array.from({ length: 100 }, (_, i) => `<i${i < n ? ' class="on"' : ""}></i>`).join("");
  return `<div class="m3-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${n}" aria-label="Item collection">
    <div class="m3-segs">${segs}</div>
    <div class="m3-progress-label">${state.percent}%</div>
  </div>`;
}

/**
 * The colour-coded item grid: one compact band like the spreadsheet's, cells touching, every
 * section on a shared five-row baseline (ammo and items sit low, tanks, suits and beams high).
 * @param {import("./engine.js").State} state
 */
export function gridHtml(state) {
  /** @param {string} cat @param {number} total @param {number} rows @param {string} label */
  const counted = (cat, total, rows, label) => {
    const done = state.byCat[cat];
    const cells = Array.from({ length: total }, (_, i) => {
      const s = done[i];
      return s
        ? `<i class="m3-cell on" title="${esc(stepTitle(s))}"></i>`
        : `<i class="m3-cell" title="${esc(label)} ${i + 1}"></i>`;
    }).join("");
    return { cells: `<div class="m3-cells c-${cat}" style="--rows:${rows}">${cells}</div>`, count: `${Math.min(done.length, total)}/${total}` };
  };
  /** @param {"beam" | "suit" | "item"} cat @param {number} rows */
  const fixed = (cat, rows) => {
    const list = FIXED_ITEMS[cat];
    const known = new Set(list.map((i) => i.key));
    const extras = Object.entries(state.fixed).filter(([k, s]) => !known.has(k) && s && classify(s.checkpoint).cat === cat);
    const cells = [
      ...list.map((it) => {
        const s = state.fixed[it.key];
        return s
          ? `<i class="m3-cell on fx" title="${esc(stepTitle(s))}">${it.abbr}</i>`
          : `<i class="m3-cell fx" title="${esc(it.name)}">${it.abbr}</i>`;
      }),
      ...extras.map(([, s]) => `<i class="m3-cell on fx" title="${esc(stepTitle(/** @type {any} */ (s)))}">+</i>`),
    ].join("");
    const have = list.filter((it) => state.fixed[it.key]).length + extras.length;
    return { cells: `<div class="m3-cells c-${cat}" style="--rows:${rows}">${cells}</div>`, count: `${have}/${list.length}` };
  };
  /** @param {string} label @param {string} count @param {string} cells @param {"top" | "bottom"} at */
  const section = (label, count, cells, at) =>
    `<section class="m3-sec"><div class="m3-cellwrap ${at}">${cells}</div><h4>${label} <b>${count}</b></h4></section>`;

  const missile = counted("missile", TOTALS.missile, 5, "Missile");
  const sup = counted("super", TOTALS.super, 2, "Super Missile");
  const pb = counted("pb", TOTALS.pb, 2, "Power Bomb");
  const et = counted("etank", TOTALS.etank, 3, "Energy Tank");
  const rt = counted("rtank", TOTALS.rtank, 1, "Reserve Tank");
  const suit = fixed("suit", 1);
  const beam = fixed("beam", 3);
  const item = fixed("item", 2);
  return `<div class="m3-grid" role="img" aria-label="Item grid, ${state.percent} of 100 collected">
    ${section("Missile", missile.count, missile.cells, "bottom")}
    ${section("Super", sup.count, sup.cells, "bottom")}
    ${section("Power Bomb", pb.count, pb.cells, "bottom")}
    ${section("Tanks", `${et.count} · ${rt.count}`, `<div class="m3-stack">${et.cells}${rt.cells}</div>`, "top")}
    ${section("Suits", suit.count, suit.cells, "top")}
    ${section("Beams", beam.count, beam.cells, "top")}
    ${section("Items", item.count, item.cells, "bottom")}
  </div>`;
}

/** Category count bars (the "overall progress" tracker). @param {import("./engine.js").State} state */
export function categoryBarsHtml(state) {
  const rows = [
    ["missile", "Missiles", state.counts.missile, TOTALS.missile],
    ["super", "Super Missiles", state.counts.super, TOTALS.super],
    ["pb", "Power Bombs", state.counts.pb, TOTALS.pb],
    ["etank", "Energy Tanks", state.counts.etank, TOTALS.etank],
    ["rtank", "Reserve Tanks", state.counts.rtank, TOTALS.rtank],
    ["beam", "Beams", state.counts.beam, TOTALS.beam],
    ["suit", "Suits", state.counts.suit, TOTALS.suit],
    ["item", "Items", state.counts.item, TOTALS.item],
    ["boss", "Bosses", state.counts.boss, TOTALS.boss],
  ];
  return `<ul class="m3-bars">${rows
    .map(
      ([cat, label, n, total]) =>
        `<li class="c-${cat}"><span>${label}</span><div class="m3-bar" role="img" aria-label="${label} ${n} of ${total}"><i style="width:${pct(+n, +total)}%"></i></div><b>${n}<small>/${total}</small></b></li>`,
    )
    .join("")}</ul>`;
}

/** Item% by area. @param {import("./engine.js").State} state */
export function areasHtml(state) {
  return `<ul class="m3-bars m3-areas">${state.areas
    .map(
      (a) =>
        `<li><span>${esc(a.area)}</span><div class="m3-bar" role="img" aria-label="${esc(a.area)} ${a.count} of ${a.total}"><i style="width:${pct(a.count, a.total)}%"></i></div><b>${a.count}<small>/${a.total}</small></b></li>`,
    )
    .join("")}</ul>`;
}

/** Boss checklist. @param {import("./engine.js").State} state */
export function bossesHtml(state) {
  return `<ul class="m3-bosses">${state.bosses
    .map(
      (b) =>
        `<li class="${b.done ? "on" : ""}" title="${b.step ? esc(stepTitle(b.step)) : ""}"><span aria-hidden="true">${b.done ? "✔" : "○"}</span>${esc(b.name)}</li>`,
    )
    .join("")}</ul>`;
}

/** Headline numbers. @param {import("./engine.js").Game} game @param {import("./engine.js").State} state */
export function statsHtml(game, state) {
  const days = new Set(journalDays(game).filter((d) => d.pickups || d.bosses).map((d) => d.day)).size;
  const cells = [
    ["Item %", `${state.percent}%`],
    ["Steps", `${state.stepsDone}/${state.steps}`],
    ["Play time", fmtPlay(state)],
    ["Sessions", state.sessions.length ? String(state.sessions.length) : "—"],
    ["Clock span", fmtSpan(state)],
    ["Game time", fmtIgt(state.igt)],
    ["Play days", String(days || "—")],
    ["Started", state.first != null ? fmtDate(state.first) : "—"],
    ["Finished", state.complete && state.last != null ? fmtDate(state.last) : "—"],
  ];
  return `<dl class="m3-stats">${cells.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>`;
}

/** Items collected per day, as small columns. @param {Array<{ day: string, pickups: number }>} days */
export function paceHtml(days) {
  const max = Math.max(1, ...days.map((d) => d.pickups));
  if (!days.length) return `<p class="m3-muted">No sessions yet.</p>`;
  return `<ol class="m3-pace">${days
    .map(
      (d) =>
        `<li title="${esc(d.day)}: ${d.pickups} pickups"><i style="height:${Math.round((d.pickups / max) * 100)}%"></i><b>${d.pickups}</b><span>${esc(d.day.slice(5))}</span></li>`,
    )
    .join("")}</ol>`;
}

/**
 * The "journal history" view: latest steps with relative time and the gap since the one before.
 * @param {Array<{ step: import("./engine.js").Step, gapMs: number | null, fresh?: boolean }>} items
 * @param {number} now
 */
export function historyHtml(items, now) {
  if (!items.length) return `<p class="m3-muted">Nothing logged yet. Complete the first step to start the journal.</p>`;
  return `<ol class="m3-history">${items
    .map(({ step: s, gapMs, fresh }) => {
      const { cat } = classify(s.checkpoint);
      return `<li class="c-${cat}"><span class="m3-n">${s.step}</span>
        <div><b>${esc(s.checkpoint)}</b>${where(s) ? `<small>${esc(where(s))}</small>` : ""}</div>
        <time datetime="${new Date(/** @type {number} */ (s.ts)).toISOString()}">${esc(fmtAgo(/** @type {number} */ (s.ts), now))}${gapMs != null ? `<small>+${esc(fmtDuration(gapMs))}</small>` : fresh ? `<small>new session</small>` : ""}</time></li>`;
    })
    .join("")}</ol>`;
}

/**
 * The day-by-day journal timeline. With `edit`, rows carry data-action buttons for the app.
 * @param {import("./engine.js").Game} game
 * @param {{ notes?: boolean, edit?: boolean }} [opts]
 */
export function timelineHtml(game, opts = {}) {
  const { notes = true, edit = false } = opts;
  const days = journalDays(game);
  if (!days.length) return `<p class="m3-muted">The journal is empty.</p>`;
  return days
    .map((d) => {
      const rows = d.items
        .map((it) => {
          if (it.kind === "event") {
            const e = it.event;
            return `<li class="m3-session-row" data-event="${esc(e.id)}"><time>${esc(fmtClock(e.ts))}</time>
              <span class="m3-chip" aria-hidden="true">${e.kind === "start" ? "▶" : "■"}</span>
              <div><b>${e.kind === "start" ? "Session started" : "Session stopped"}</b>
              ${edit ? `<div class="m3-row-actions"><button type="button" data-action="edit-event" data-id="${esc(e.id)}">Edit</button></div>` : ""}</div></li>`;
          }
          if (it.kind === "entry") {
            const e = it.entry;
            return `<li class="m3-note-card" data-entry="${esc(e.id)}">
              <time>${esc(fmtClock(e.ts))}</time>
              <div>${e.title ? `<h4>${esc(e.title)}</h4>` : ""}<p>${esc(e.body)}</p>
              ${edit ? `<div class="m3-row-actions"><button type="button" data-action="edit-entry" data-id="${esc(e.id)}">Edit</button></div>` : ""}</div></li>`;
          }
          const s = it.step;
          const { cat } = classify(s.checkpoint);
          const note = notes ? s.note : null;
          const w = where(s);
          return `<li class="m3-ev c-${cat}" data-step="${esc(s.id)}">
            <time>${esc(fmtClock(/** @type {number} */ (s.ts)))}</time>
            <span class="m3-chip" aria-hidden="true">${esc(CATEGORIES[cat].short)}</span>
            <div><b>${esc(s.checkpoint)}</b>${w ? `<small>${esc(w)}</small>` : ""}${s.igt != null ? `<small>IGT ${esc(fmtIgt(s.igt))}</small>` : ""}
              ${note ? `<em>${esc(note)}</em>` : ""}${s.log ? `<p>${esc(s.log)}</p>` : ""}
              ${edit ? `<div class="m3-row-actions"><button type="button" data-action="edit-step" data-id="${esc(s.id)}">Edit</button></div>` : ""}</div></li>`;
        })
        .join("");
      const span = d.end > d.start ? `${fmtClock(d.start)} – ${fmtClock(d.end)}` : fmtClock(d.start);
      const bits = [`${d.pickups} pickup${d.pickups === 1 ? "" : "s"}`];
      if (d.playMs) bits.unshift(`${fmtDuration(d.playMs)} played`);
      if (d.bosses) bits.push(`${d.bosses} boss${d.bosses === 1 ? "" : "es"}`);
      return `<section class="m3-day"><h3>${esc(fmtDate(d.start))}<small>${esc(span)} · ${bits.join(", ")}</small></h3><ol class="m3-events">${rows}</ol></section>`;
    })
    .join("");
}
