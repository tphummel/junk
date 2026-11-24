// Charts and the standalone annual report for toothup. Pure string builders, no DOM, so the API test suite can import them.
// The SVG helpers are used by the Stats tab and by the exported page, which share CHART_CSS.

import { addDays, parseDay } from "./logic.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** @param {any} s */
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** "Mar 4" for a day key. @param {string} day */
export const shortDate = (day) => parseDay(day).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** "Mar 4, 2026" for a day key. @param {string} day */
export const longDate = (day) => parseDay(day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** "14h 22m" or "37m" from seconds. @param {number} s */
export function hoursMinutes(s) {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);

/** Styles for the chart classes below. Colors come from the page's --primary, --support, --accent and --text variables. */
export const CHART_CSS = `
.hm0 { fill: var(--text); opacity: .12; }
.hm1 { fill: var(--support); }
.hm2 { fill: var(--primary); }
.hmx { fill: none; stroke: var(--text); stroke-opacity: .12; stroke-width: 1; }
.ch-text { fill: var(--support); font: 10px system-ui, sans-serif; }
.ch-val { fill: var(--text); font: 600 10px system-ui, sans-serif; }
.ch-bar { fill: var(--primary); }
.ch-bar.best { fill: var(--accent); }
.ch-stub { fill: var(--text); opacity: .12; }
.ch-track { fill: var(--text); opacity: .1; }
`;

/**
 * GitHub-style grid of the year: a column per week (Sunday first), a row per weekday.
 * @param {{ year: number, levels: Map<string, 0 | 1 | 2> }} r
 */
export function heatmapSvg(r) {
  const jan1 = `${r.year}-01-01`;
  const start = addDays(jan1, -parseDay(jan1).getDay());
  const STEP = 15, TOP = 14;
  const weeks = Math.ceil((parseDay(`${r.year}-12-31`).getTime() - parseDay(start).getTime()) / 86400000 / 7 + 1 / 7);
  let cells = "";
  let labels = "";
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      if (!day.startsWith(String(r.year))) continue;
      const level = r.levels.get(day);
      const x = w * STEP, y = TOP + d * STEP;
      const label = level === undefined ? "" : level === 2 ? "both brushes" : level === 1 ? "one brush" : "no brushing";
      cells += `<rect class="${level === undefined ? "hmx" : `hm${level}`}" x="${x}" y="${y}" width="12" height="12" rx="3"><title>${esc(longDate(day))}${label ? `: ${label}` : ""}</title></rect>`;
      if (d === 0 || (w === 0 && lastMonth < 0)) {
        const m = parseDay(day).getMonth();
        if (m !== lastMonth && Number(day.slice(8)) <= 7) {
          labels += `<text class="ch-text" x="${x}" y="9">${MONTHS[m]}</text>`;
          lastMonth = m;
        }
      }
    }
  }
  return `<svg viewBox="0 0 ${weeks * STEP - 3} ${TOP + 7 * STEP - 3}" role="img" aria-label="Every day of ${r.year}: solid for two brushes, muted for one, faint for none" width="100%">${labels}${cells}</svg>`;
}

/** Twelve bars of brushing percentage, the best month highlighted. @param {{ months: any[], bestMonth: any }} r */
export function monthBarsSvg(r) {
  const H = 90, BASE = 14 + H;
  const bars = r.months.map((m, i) => {
    const x = i * 30 + 5;
    const label = `<text class="ch-text" x="${x + 10}" y="${BASE + 13}" text-anchor="middle">${MONTHS[i][0]}</text>`;
    if (m.brushPct === null) return `<rect class="ch-stub" x="${x}" y="${BASE - 2}" width="20" height="2" rx="1"/>${label}`;
    const h = Math.max(2, (Math.min(m.brushPct, 100) / 100) * H);
    return `<rect class="ch-bar${m === r.bestMonth ? " best" : ""}" x="${x}" y="${BASE - h}" width="20" height="${h}" rx="3"><title>${MONTHS[i]}: ${m.brushPct}% brushing, ${m.fullDays}/${m.days} full days</title></rect>` +
      `<text class="ch-val" x="${x + 10}" y="${BASE - h - 4}" text-anchor="middle">${m.brushPct}</text>${label}`;
  });
  return `<svg viewBox="0 0 360 ${BASE + 18}" role="img" aria-label="Brushing percentage for each month of ${r.year}" width="100%">${bars.join("")}</svg>`;
}

/** Share of full days by weekday, as horizontal bars. @param {{ weekdays: { days: number, fullDays: number }[] }} r */
export function weekdayBarsSvg(r) {
  const rows = r.weekdays.map((w, i) => {
    const y = i * 22;
    const p = pct(w.fullDays, w.days);
    return `<text class="ch-text" x="0" y="${y + 13}">${WEEKDAYS[i]}</text><rect class="ch-track" x="32" y="${y + 3}" width="220" height="14" rx="4"/>` +
      (p ? `<rect class="ch-bar" x="32" y="${y + 3}" width="${Math.max(4, p * 2.2)}" height="14" rx="4"/>` : "") +
      `<text class="ch-val" x="260" y="${y + 13}">${p === null ? "–" : `${p}%`}</text>`;
  });
  return `<svg viewBox="0 0 295 ${7 * 22}" role="img" aria-label="Share of days with both brushes, by weekday" width="100%">${rows.join("")}</svg>`;
}

/** Highest and lowest full-day rate by weekday, or null if there is no data. @param {{ weekdays: { days: number, fullDays: number }[] }} r */
export function weekdayExtremes(r) {
  const rated = r.weekdays.map((w, i) => ({ i, p: pct(w.fullDays, w.days) })).filter((w) => w.p !== null);
  if (!rated.length) return null;
  const best = rated.reduce((a, w) => (w.p > a.p ? w : a));
  const worst = rated.reduce((a, w) => (w.p < a.p ? w : a));
  return { best: { name: WEEKDAYS[best.i], pct: best.p }, worst: best.p === worst.p ? null : { name: WEEKDAYS[worst.i], pct: worst.p } };
}

/** @param {number} n @param {string} unit */
const count = (n, unit) => `${n.toLocaleString("en-US")} ${unit}${n === 1 ? "" : "s"}`;

/**
 * A complete, self-contained HTML page for a year report. No scripts, no external files: it works offline and can be emailed.
 * @param {ReturnType<import("./logic.js").yearReport>} r
 * @param {{ generated?: string }} [opts] generated: day key shown in the footer
 */
export function annualReportHtml(r, opts = {}) {
  const none = r.days === 0;
  const wd = weekdayExtremes(r);
  const flossPct = pct(r.flossDays, r.days);
  const rinsePct = pct(r.mouthwashDays, r.days);
  const highlights = [
    r.bestStreak.length ? ["Longest streak", count(r.bestStreak.length, "day"), `${shortDate(r.bestStreak.start)} to ${shortDate(r.bestStreak.end)}`] : null,
    r.bestMonth ? ["Best month", `${MONTHS[r.bestMonth.month]}`, `${r.bestMonth.brushPct}% of brushes`] : null,
    r.worstMonth ? ["Room to grow", `${MONTHS[r.worstMonth.month]}`, `${r.worstMonth.brushPct}% of brushes`] : null,
    wd ? ["Strongest day", wd.best.name, `${wd.best.pct}% full days`] : null,
    wd?.worst ? ["Weakest day", wd.worst.name, `${wd.worst.pct}% full days`] : null,
  ].filter(Boolean);
  const stats = [
    ["Full days", `${r.fullDays}`, `of ${r.days} tracked`],
    ["Brushes", r.brushCount.toLocaleString("en-US"), "logged"],
    ["Time brushing", hoursMinutes(r.brushSeconds), r.brushCount ? `${hoursMinutes(r.avgSeconds)} on average` : ""],
    ["Floss days", flossPct === null ? "–" : `${flossPct}%`, `${r.flossDays} days`],
    ["Mouthwash days", rinsePct === null ? "–" : `${rinsePct}%`, `${r.mouthwashDays} days`],
    ["Extras", `${r.extras}`, "beyond the goals"],
  ];
  const title = `My ${r.year} in teeth`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<style>
:root {
  color-scheme: light dark;
  --primary: #722DD2; --support: #7A5FA1; --accent: #937120;
  --bg: #FFFFFF; --text: #111111; --on-primary: #FFFFFF; --card: #F6F2FC; --hero2: #4A1C95;
}
@media (prefers-color-scheme: dark) {
  :root {
    --primary: #9561DD; --support: #8971AB; --accent: #D2A22D;
    --bg: #111111; --text: #EEEEEE; --on-primary: #111111; --card: #1C1826; --hero2: #5B3A98;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 1rem/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 52rem; margin: 0 auto; padding: 0 1rem 3rem; }
.hero { margin: 0 -1rem 2rem; padding: 3.5rem 1.5rem 3rem; text-align: center; color: #fff;
  background: radial-gradient(circle at 20% 0%, var(--primary), transparent 60%), linear-gradient(160deg, var(--hero2), var(--primary)); }
@media (min-width: 56rem) { .hero { margin: 0 0 2rem; border-radius: 0 0 2rem 2rem; } }
.hero .eyebrow { letter-spacing: .2em; text-transform: uppercase; font-size: .8rem; opacity: .85; }
.hero h1 { margin: .25rem 0 0; font-size: clamp(2rem, 8vw, 3.25rem); line-height: 1.1; }
.big { font-size: clamp(4.5rem, 24vw, 8rem); font-weight: 800; line-height: 1; margin: 1.25rem 0 .25rem; font-variant-numeric: tabular-nums; }
.big small { font-size: .4em; font-weight: 600; opacity: .85; }
.hero p { margin: 0; opacity: .9; }
h2 { color: var(--primary); font-size: 1.15rem; margin: 2.25rem 0 .75rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: .75rem; }
.card { background: var(--card); border-radius: 1rem; padding: .9rem 1rem; }
.card .k { font-size: .75rem; letter-spacing: .06em; text-transform: uppercase; color: var(--support); }
.card .v { font-size: 1.9rem; font-weight: 750; line-height: 1.15; color: var(--primary); font-variant-numeric: tabular-nums; }
.card .u { font-size: .85rem; color: var(--support); }
.panel { background: var(--card); border-radius: 1rem; padding: 1rem; }
.legend { display: flex; gap: 1rem; flex-wrap: wrap; font-size: .8rem; color: var(--support); margin-top: .5rem; }
.legend i { display: inline-block; width: .8rem; height: .8rem; border-radius: 3px; vertical-align: -1px; margin-right: .3rem; }
.two { display: grid; gap: 1.5rem; grid-template-columns: 1fr; }
@media (min-width: 40rem) { .two { grid-template-columns: 1fr 1fr; } }
footer { margin-top: 3rem; text-align: center; font-size: .85rem; color: var(--support); }
.empty { text-align: center; color: var(--support); padding: 3rem 0; }
${CHART_CSS}
@media print { body { background: #fff; } .hero { border-radius: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; } .card, .panel { break-inside: avoid; } }
</style>
</head>
<body>
<main>
<header class="hero">
  <div class="eyebrow">toothup · year in review</div>
  <h1>${esc(title)}</h1>
  ${none ? `<p style="margin-top:1.5rem">No brushing tracked this year yet.</p>` : `
  <div class="big">${r.brushPct}<small>%</small></div>
  <p>of your brushes done, across ${count(r.days, "tracked day")}</p>`}
</header>
${none ? `<p class="empty">Nothing to show for ${r.year}.</p>` : `
<section aria-labelledby="h-nums">
  <h2 id="h-nums">The numbers</h2>
  <div class="grid">
    ${stats.map(([k, v, u]) => `<div class="card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="u">${u}</div></div>`).join("\n    ")}
  </div>
</section>
${highlights.length ? `<section aria-labelledby="h-hi">
  <h2 id="h-hi">Highlights</h2>
  <div class="grid">
    ${highlights.map(([k, v, u]) => `<div class="card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="u">${esc(u)}</div></div>`).join("\n    ")}
  </div>
</section>` : ""}
<section aria-labelledby="h-year">
  <h2 id="h-year">Every day of ${r.year}</h2>
  <div class="panel">
    ${heatmapSvg(r)}
    <div class="legend"><span><i class="hm2" style="background:var(--primary)"></i>Both brushes</span><span><i style="background:var(--support)"></i>One</span><span><i style="background:var(--text);opacity:.12"></i>None</span></div>
  </div>
</section>
<div class="two">
  <section aria-labelledby="h-months">
    <h2 id="h-months">Month by month</h2>
    <div class="panel">${monthBarsSvg(r)}<div class="legend"><span>Brushing percentage</span></div></div>
  </section>
  <section aria-labelledby="h-week">
    <h2 id="h-week">Days of the week</h2>
    <div class="panel">${weekdayBarsSvg(r)}<div class="legend"><span>Days with both brushes</span></div></div>
  </section>
</div>`}
<footer>Made with toothup${opts.generated ? ` on ${esc(longDate(opts.generated))}` : ""}. Everything stays on the device it was recorded on.</footer>
</main>
</body>
</html>
`;
}
