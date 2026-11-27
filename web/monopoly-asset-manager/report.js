// A standalone HTML report of one game: totals, what you own, what you traded away, and every property's history.
// Pure functions, no DOM; tested by api/monopoly-asset-manager.test.mjs. The file has its own inline styles and no
// scripts, so it opens anywhere and prints cleanly.

import { exportFileName, gameCreated, gameStats, levelName, pricePaid, stats, ymd } from "./tracker.js";

/** @typedef {import("./tracker.js").Game} Game */
/** @typedef {import("./tracker.js").Property} Property */

/** Escape text for HTML. @param {unknown} text */
export function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** @param {number} n */
const money = (n) => (n < 0 ? "-" : "") + "$" + Math.abs(Math.round(n * 100) / 100).toLocaleString("en-US");
/** @param {number} r */
const pct = (r) => (r * 100).toFixed(0) + "%";
/** @param {number} n */
const tone = (n) => (n > 0 ? "good" : n < 0 ? "bad" : "");

/** Color chip for a property's group, matching the page (the first group is brown in Mega, purple in the original). */
const GROUP_COLOR = { lightblue: "#A9D8F0", pink: "#E252B3", orange: "#F28C28", red: "#D81F1A", yellow: "#FCE62A", green: "#2FA05A", darkblue: "#1E5FBF" };
/** @param {Game} g @param {Property} p */
function groupColor(g, p) {
  if (p.group === "brown") return g.edition === "mega" ? "#8B5A2B" : "#7B3FA0";
  return /** @type {Record<string, string>} */ (GROUP_COLOR)[p.group] || "#4A5A4E";
}

/** @param {number} ms */
function when(ms) {
  const d = new Date(ms);
  return `${ymd(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** File name for the report: the game's export name, as .html. @param {Game} g */
export function reportFileName(g) {
  return exportFileName(g).replace(/\.json$/, "-report.html");
}

/** @param {Game} g @param {Property} p @param {string} [status] */
function historyBlock(g, p, status = "") {
  const rows = p.entries.map((e) =>
    `<tr><td>${esc(e.at ? when(e.at) : "")}</td><td>${esc(e.type)}</td><td>${esc(e.note || "")}</td><td class="num ${tone(e.amount)}">${money(e.amount)}</td></tr>`).join("");
  return `<section class="prop"><h3><span class="chip" style="background:${groupColor(g, p)}"></span>${esc(p.name)}${status ? ` <small>${esc(status)}</small>` : ""}</h3>
<table><thead><tr><th scope="col">When</th><th scope="col">Entry</th><th scope="col">Note</th><th scope="col" class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

/**
 * The report as a complete HTML document.
 * @param {Game} g
 * @param {Date} [now]
 */
export function reportHtml(g, now = new Date()) {
  const t = gameStats(g);
  const made = gameCreated(g);
  const owned = g.properties.map((p) => ({ p, s: stats(p, g) }));
  const gone = (g.archived || []).map((p) => ({ p, s: stats(p, g) }));
  const tile = (label, value, k = "") => `<div class="tile"><b class="${k}">${esc(value)}</b><span>${esc(label)}</span></div>`;
  const tiles = [
    tile("Invested", money(t.invested)), tile("Rent collected", money(t.rent)),
    tile("Net profit", money(t.profit), tone(t.profit)), tile("ROI", t.invested ? pct(t.roi) : "–", tone(t.profit)),
    tile("Game left to break even", money(t.gameRemaining)), tile("Owed by unpaid properties", money(t.remaining)),
    tile("Properties broken even", `${t.broken} of ${t.count}`), tile("Mortgage loans out", money(t.loan), t.loan ? "bad" : ""),
  ].join("");
  const note = !t.offset ? "" : t.offset > 0
    ? `<p class="muted">Game left to break even is ${money(t.offset)} less than what unpaid properties owe: properties that have paid off are ahead (net of any loss on traded-away ones).</p>`
    : `<p class="muted">Game left to break even is ${money(-t.offset)} more than what the properties still owned owe: traded-away properties lost money, which the game total still carries.</p>`;

  const ownedRows = owned.map(({ p, s }) => {
    const status = [p.mortgaged ? "mortgaged" : "", s.broken ? "broke even" : ""].filter(Boolean).join(", ");
    const basisNote = p.entries[0]?.carried != null ? " (traded)" : pricePaid(p) !== p.price ? ` (list ${money(p.price)})` : "";
    return `<tr><th scope="row"><span class="chip" style="background:${groupColor(g, p)}"></span>${esc(p.name)}</th><td>${esc(p.houseCost > 0 ? levelName(p) : "–")}</td>`
      + `<td class="num">${money(pricePaid(p))}${esc(basisNote)}</td><td class="num">${money(s.invested)}</td><td class="num">${money(s.rent)}${s.rentCount ? ` (${s.rentCount}×)` : ""}</td>`
      + `<td class="num ${tone(s.profit)}">${money(s.profit)}</td><td class="num ${tone(s.profit)}">${s.invested ? pct(s.roi) : "–"}</td><td class="num">${money(s.remaining)}</td><td>${esc(status)}</td></tr>`;
  }).join("");
  const owns = owned.length
    ? `<table><caption>Properties owned</caption><thead><tr><th scope="col">Property</th><th scope="col">Built</th><th scope="col" class="num">Paid</th><th scope="col" class="num">Invested</th><th scope="col" class="num">Rent</th><th scope="col" class="num">Profit</th><th scope="col" class="num">ROI</th><th scope="col" class="num">To break even</th><th scope="col">Status</th></tr></thead><tbody>${ownedRows}</tbody></table>`
    : `<p class="muted">No properties owned.</p>`;

  const goneRows = gone.map(({ p, s }) =>
    `<tr><th scope="row"><span class="chip" style="background:${groupColor(g, p)}"></span>${esc(p.name)}</th><td class="num">${money(s.invested)}</td><td class="num">${money(s.rent)}</td><td class="num ${tone(s.profit)}">${money(s.profit)}</td></tr>`).join("");
  const traded = gone.length
    ? `<h2>Traded away</h2><table><thead><tr><th scope="col">Property</th><th scope="col" class="num">Invested</th><th scope="col" class="num">Rent</th><th scope="col" class="num">Profit</th></tr></thead><tbody>${goneRows}</tbody></table>`
    : "";
  const histories = [...owned.map(({ p }) => historyBlock(g, p)), ...gone.map(({ p }) => historyBlock(g, p, "traded away"))].join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${esc(g.name)}: Monopoly asset manager report</title>
<style>
  body { margin: 0 auto; max-width: 62rem; padding: 1.25rem 16px 3rem; background: #FFFDF2; color: #121712; font: 1rem/1.5 system-ui, sans-serif; }
  h1, h2, h3 { font-family: Futura, "Century Gothic", "Trebuchet MS", system-ui, sans-serif; text-transform: uppercase; letter-spacing: .06em; line-height: 1.15; margin: 1.5rem 0 .5rem; }
  h1 { font-size: 1.8rem; margin-top: 0; } h2 { font-size: 1.15rem; } h3 { font-size: .95rem; }
  small { font-weight: 400; color: #4A5A4E; text-transform: none; letter-spacing: 0; }
  .muted { color: #4A5A4E; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: .5rem; margin: 1rem 0; }
  .tile { border: 1px solid #121712; padding: .5rem .7rem; }
  .tile b { display: block; font-size: 1.25rem; font-variant-numeric: tabular-nums; }
  .tile span { font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .1em; color: #4A5A4E; }
  table { width: 100%; border-collapse: collapse; margin: .5rem 0; font-size: .9rem; font-variant-numeric: tabular-nums; }
  caption { text-align: left; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; font-size: .8rem; padding-bottom: .25rem; }
  th, td { border-bottom: 1px solid #12171233; padding: .3rem .5rem; text-align: left; vertical-align: top; }
  thead th { background: #121712; color: #FFFDF2; font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; }
  tbody th { font-weight: 700; }
  .num { text-align: right; }
  .chip { display: inline-block; width: .8rem; height: .8rem; margin-right: .5rem; border: 1px solid #121712; vertical-align: -.05rem; }
  .good { color: #0B6B33; } .bad { color: #A8120E; }
  .prop { break-inside: avoid; }
  .prop table { table-layout: fixed; }
  .prop th:nth-child(1) { width: 9.5rem; } .prop th:nth-child(2) { width: 6.5rem; } .prop th:nth-child(4) { width: 6rem; }
  footer { margin-top: 2rem; font-size: .8rem; color: #4A5A4E; }
  @media print { body { padding: 0; } .tile { break-inside: avoid; } tr { break-inside: avoid; } }
</style>
</head>
<body>
<h1>${esc(g.name)}</h1>
<p class="muted">Monopoly ${g.edition === "mega" ? "Mega" : "(original)"}${made ? ` · created ${esc(ymd(made))}` : ""} · report made ${esc(ymd(now))}</p>
<div class="tiles">${tiles}</div>
${note}
<h2>Properties</h2>
${owns}
${traded}
<h2>History</h2>
${histories || '<p class="muted">Nothing yet.</p>'}
<footer>Made by the Monopoly asset manager. Mortgage loans are not income: only their interest counts as a cost. Cost basis carried over in a trade is not counted twice in the totals.</footer>
</body>
</html>
`;
}
