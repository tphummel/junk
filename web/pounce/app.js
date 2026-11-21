// pounce UI: sessions, roster, game timer, result entry and reports. State lives in localStorage.
import {
  cumulative, DEFAULT_BONUS, formatDuration, gameTotals, gameWinners, headToHeadAll, pounceStats, paceStats,
  SCORE_MAX, SCORE_MIN, standings, validateResults, venueStats,
} from './engine.js';

const KEY = 'pounce:v1';
const app = /** @type {HTMLElement} */ (document.getElementById('app'));

/** @typedef {{ id: string, name: string }} Player */
/** @typedef {{ startedAt: number, endedAt: number | null, scores: Record<string, string>, pouncer: string | null }} Current */
/** @typedef {{ id: string, venue: string, bonus: number, createdAt: number, present: string[], games: any[], current: Current | null }} Session */

/** @type {{ players: Player[], sessions: Session[] }} */
let db = load();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && Array.isArray(raw.players) && Array.isArray(raw.sessions)) return raw;
  } catch {}
  return { players: [], sessions: [] };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {}
}
const uid = () => Math.random().toString(36).slice(2, 10);
/** @param {string} s */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
/** @param {string} id */
const nameOf = (id) => db.players.find((p) => p.id === id)?.name ?? '?';
/** @param {Session} s */
const flat = (s) => s.games.map((g) => ({ ...g, sessionId: s.id, venue: s.venue }));
const allGames = () => db.sessions.flatMap(flat).sort((a, b) => a.startedAt - b.startedAt);

/** Find a player by name (case-insensitive) or create one. @param {string} raw */
function playerByName(raw) {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return null;
  let p = db.players.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!p) db.players.push((p = { id: uid(), name }));
  return p;
}

const route = () => location.hash.match(/^#\/s\/(\w+)/)?.[1] ?? null;
/** @returns {Session | undefined} */
const currentSession = () => db.sessions.find((s) => s.id === route());

// ---------- rendering ----------

function render() {
  const s = currentSession();
  app.innerHTML = s ? sessionView(s) : homeView();
  if (s?.current?.endedAt) restoreDraft(s);
}

function homeView() {
  const sessions = [...db.sessions].sort((a, b) => b.createdAt - a.createdAt);
  const venues = [...new Set(db.sessions.map((s) => s.venue).filter(Boolean))];
  const last = sessions[0];
  return `
    <h1>pounce</h1>
    <section>
      <h2>New session</h2>
      <form data-form="new-session" class="row">
        <input name="venue" placeholder="Venue" list="venues" value="${esc(last?.venue ?? '')}" autocomplete="off">
        <datalist id="venues">${venues.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
        <label class="inline">Pounce bonus <input name="bonus" type="number" inputmode="numeric" min="0" max="60" value="${last?.bonus ?? DEFAULT_BONUS}" class="narrow"></label>
        <button class="primary">Start session</button>
      </form>
    </section>
    <section>
      <h2>Sessions</h2>
      ${sessions.length ? `<ul class="list">${sessions.map((s) => `
        <li><a href="#/s/${s.id}">${esc(s.venue || 'No venue')}</a>
          <span class="muted">${new Date(s.createdAt).toLocaleDateString()} · ${s.games.length} games</span>
          <button class="link" data-act="del-session" data-id="${s.id}">delete</button></li>`).join('')}</ul>` : '<p class="muted">No sessions yet.</p>'}
    </section>
    ${allTimeView()}
    <section>
      <h2>Data</h2>
      <div class="row">
        <button data-act="export">Export JSON</button>
        <label class="btn">Import JSON<input type="file" accept="application/json" data-act="import" hidden></label>
      </div>
    </section>`;
}

/** @param {Session} s */
function sessionView(s) {
  const games = flat(s);
  const cur = s.current;
  return `
    <p><a href="#/">&larr; sessions</a></p>
    <h1>${esc(s.venue || 'No venue')}</h1>
    <details class="settings"><summary>Session settings</summary>
      <div class="row">
        <label class="inline">Venue <input data-field="venue" value="${esc(s.venue)}"></label>
        <label class="inline">Pounce bonus <input data-field="bonus" type="number" inputmode="numeric" min="0" max="60" value="${s.bonus}" class="narrow"></label>
      </div>
      <p class="muted">Changing the bonus affects future games; saved games keep the bonus they were played with.</p>
    </details>
    ${rosterView(s)}
    ${gamePanel(s, cur)}
    ${games.length ? reportsView(games) : '<p class="muted">Reports appear after the first saved game.</p>'}
    ${db.sessions.length > 1 ? `<section><h2>All-time</h2>${allTimeInner()}</section>` : ''}`;
}

/** @param {Session} s */
function rosterView(s) {
  const bench = db.players.filter((p) => !s.present.includes(p.id));
  return `
    <section>
      <h2>Players <span class="muted">${s.present.length} in</span></h2>
      <div class="chips">${s.present.map((id) => `<button class="chip in" data-act="drop" data-id="${id}" title="Drop from session">${esc(nameOf(id))} <b>&times;</b></button>`).join('') || '<span class="muted">Add players to begin.</span>'}</div>
      ${bench.length ? `<div class="chips bench"><span class="muted">Add:</span>${bench.map((p) => `<button class="chip" data-act="add" data-id="${p.id}">+ ${esc(p.name)}</button>`).join('')}</div>` : ''}
      <form data-form="add-player" class="row">
        <input name="name" placeholder="New player name" autocomplete="off" enterkeyhint="done">
        <button>Add</button>
      </form>
    </section>`;
}

/** @param {Session} s @param {Current | null} cur */
function gamePanel(s, cur) {
  if (!cur) {
    return `<section><h2>Game ${s.games.length + 1}</h2>
      <button class="primary big" data-act="start" ${s.present.length < 2 ? 'disabled' : ''}>Start game</button>
      ${s.present.length < 2 ? '<p class="muted">Add at least two players.</p>' : ''}</section>`;
  }
  if (!cur.endedAt) {
    return `<section><h2>Game ${s.games.length + 1} in progress</h2>
      <div class="timer" id="timer">${formatDuration(Date.now() - cur.startedAt)}</div>
      <button class="primary big" data-act="end">End game</button>
      <button class="link" data-act="cancel">cancel game</button></section>`;
  }
  const rows = s.present.map((id) => `
    <div class="entry">
      <span class="who">${esc(nameOf(id))}</span>
      <input data-score="${id}" type="number" inputmode="numeric" min="${SCORE_MIN}" max="${SCORE_MAX}" step="1" placeholder="0" aria-label="${esc(nameOf(id))} score">
      <button type="button" class="sign" data-act="neg" data-id="${id}" title="Flip sign">&plusmn;</button>
      <label class="pounce"><input type="radio" name="pouncer" value="${id}"> Pounced</label>
      <button type="button" class="link" data-act="drop" data-id="${id}">out</button>
    </div>`).join('');
  return `<section><h2>Game ${s.games.length + 1} results <span class="muted">${formatDuration(cur.endedAt - cur.startedAt)}</span></h2>
    <form data-form="results">
      ${rows}
      <p class="muted">Scores ${SCORE_MIN} to ${SCORE_MAX}. The pouncer gets +${s.bonus}.</p>
      <p class="error" id="errors"></p>
      <button class="primary big" id="save-game">Save game</button>
      <button type="button" class="link" data-act="cancel">discard game</button>
    </form></section>`;
}

/** @param {Session} s */
function restoreDraft(s) {
  const cur = s.current;
  if (!cur) return;
  for (const el of app.querySelectorAll('[data-score]')) {
    const input = /** @type {HTMLInputElement} */ (el);
    input.value = cur.scores[input.dataset.score ?? ''] ?? '';
  }
  const r = cur.pouncer && app.querySelector(`input[name=pouncer][value="${cur.pouncer}"]`);
  if (r) /** @type {HTMLInputElement} */ (r).checked = true;
  updateSaveState(s);
}

/** @param {Session} s */
function draftResults(s) {
  const cur = s.current;
  return s.present.map((id) => ({
    playerId: id,
    score: cur?.scores[id] === undefined || cur.scores[id] === '' ? NaN : Number(cur.scores[id]),
    pounced: cur?.pouncer === id,
  }));
}

/** @param {Session} s */
function updateSaveState(s) {
  const errors = validateResults(draftResults(s));
  const el = document.getElementById('errors');
  const btn = /** @type {HTMLButtonElement | null} */ (document.getElementById('save-game'));
  if (el) el.textContent = errors.join(' ');
  if (btn) btn.disabled = errors.length > 0;
}

// ---------- reports ----------

/** @param {any[]} games */
function reportsView(games) {
  const st = standings(games);
  const last = games[games.length - 1];
  return `
    <section>
      <h2>Last game</h2>
      <p>${gameTotals(last).sort((a, b) => b.total - a.total).map((t) => `<span class="${gameWinners(last).includes(t.playerId) ? 'win' : ''}">${esc(nameOf(t.playerId))} ${t.total}${t.pounced ? ' ⚡' : ''}</span>`).join(' · ')}
      <span class="muted">(${formatDuration(last.durationMs)})</span>
      <button class="link" data-act="del-game" data-id="${last.id}">delete</button></p>
    </section>
    <section>
      <h2>Leaderboard</h2>
      ${leaderboardTable(st)}
      ${games.length > 1 ? chart(games) : ''}
    </section>
    <section>
      <h2>Pounce stats</h2>
      <table><thead><tr><th>Player</th><th>Pounces</th><th>Rate</th><th>Avg score pouncing</th><th>Otherwise</th></tr></thead><tbody>
      ${pounceStats(games).map((r) => `<tr><td>${esc(nameOf(r.playerId))}</td><td>${r.pounces}/${r.played}</td><td>${Math.round(r.rate * 100)}%</td><td>${fmt(r.avgScorePounced)}</td><td>${fmt(r.avgScoreOther)}</td></tr>`).join('')}
      </tbody></table>
    </section>
    ${paceView(games)}
    ${h2hView(games)}`;
}

/** Rank, name, average score (total / games played), wins. @param {ReturnType<typeof standings>} st */
function leaderboardTable(st) {
  return `<table><thead><tr><th>Rank</th><th>Name</th><th>Score Avg &darr;</th><th>Wins</th></tr></thead><tbody>
    ${st.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(nameOf(r.playerId))}</td><td>${r.avg.toFixed(3)} <span class="muted">(${r.total} / ${r.played})</span></td><td>${r.wins}</td></tr>`).join('')}
    </tbody></table>`;
}

/** @param {number | null} n */
const fmt = (n) => (n === null ? '–' : n.toFixed(1));

/** @param {any[]} games */
function paceView(games) {
  const p = paceStats(games);
  if (!p.count) return '';
  return `<section><h2>Game pace</h2>
    <p>${p.count} timed games · average <b>${formatDuration(p.avgMs)}</b> · fastest <b>${formatDuration(p.fastest.durationMs)}</b> · longest <b>${formatDuration(p.longest.durationMs)}</b></p>
    <div class="bars">${games.map((g, i) => `<div class="bar" title="Game ${i + 1}: ${formatDuration(g.durationMs)}" style="height:${Math.max(4, (g.durationMs / p.longest.durationMs) * 100)}%"></div>`).join('')}</div></section>`;
}

/** @param {any[]} games */
function h2hView(games) {
  const rows = headToHeadAll(games);
  if (!rows.length) return '';
  return `<section><h2>Head to head</h2>
    <p class="muted">Only games both players were in.</p>
    <table><thead><tr><th>Matchup</th><th>Shared</th><th>Record</th><th>Avg margin</th></tr></thead><tbody>
    ${rows.map((r) => {
      const lead = r.avgDiff >= 0 ? r.a : r.b;
      return `<tr><td>${esc(nameOf(r.a))} vs ${esc(nameOf(r.b))}</td><td>${r.shared}</td><td>${r.aWins}–${r.bWins}${r.ties ? `–${r.ties}` : ''}</td><td>${r.avgDiff === 0 ? 'even' : `${esc(nameOf(lead))} +${Math.abs(r.avgDiff).toFixed(1)}`}</td></tr>`;
    }).join('')}</tbody></table></section>`;
}

function allTimeView() {
  if (!allGames().length) return '';
  return `<section><h2>All-time</h2>${allTimeInner()}</section>`;
}

function allTimeInner() {
  const games = allGames();
  const st = standings(games);
  return `<p>${games.length} games across ${db.sessions.length} sessions</p>
    ${leaderboardTable(st)}
    <table><thead><tr><th>Venue</th><th>Games</th><th>Avg length</th></tr></thead><tbody>
    ${venueStats(games).map((v) => `<tr><td>${esc(v.venue)}</td><td>${v.games}</td><td>${formatDuration(v.avgMs)}</td></tr>`).join('')}</tbody></table>
    ${h2hView(games)}`;
}

/** Cumulative score lines, one per player. @param {any[]} games */
function chart(games) {
  const series = cumulative(games);
  const all = series.flatMap((s) => s.points);
  const lo = Math.min(0, ...all), hi = Math.max(1, ...all);
  const W = 320, H = 140, pad = 6;
  const x = (/** @type {number} */ i) => pad + (i / (games.length - 1)) * (W - 2 * pad);
  const y = (/** @type {number} */ v) => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
  const color = (/** @type {number} */ i) => `hsl(${(i * 137.5 + 170) % 360} 65% var(--series-l))`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Cumulative score by game">
    ${series.map((s, i) => `<polyline fill="none" style="stroke:${color(i)}" stroke-width="2" points="${s.points.map((v, j) => `${x(j).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`).join('')}</svg>
    <div class="chips">${series.map((s, i) => `<span class="key"><i style="background:${color(i)}"></i>${esc(nameOf(s.playerId))}</span>`).join('')}</div>`;
}

// ---------- events ----------

app.addEventListener('click', (e) => {
  const t = /** @type {HTMLElement} */ (e.target).closest('[data-act]');
  if (!t || t.tagName === 'INPUT') return;
  const act = /** @type {HTMLElement} */ (t).dataset.act;
  const id = /** @type {HTMLElement} */ (t).dataset.id ?? '';
  const s = currentSession();
  if (act === 'export') return exportData();
  if (act === 'del-session') {
    if (confirm('Delete this session and its games?')) db.sessions = db.sessions.filter((x) => x.id !== id);
  } else if (!s) {
    return;
  } else if (act === 'add') {
    if (!s.present.includes(id)) s.present.push(id);
  } else if (act === 'drop') {
    s.present = s.present.filter((x) => x !== id);
    if (s.current) {
      delete s.current.scores[id];
      if (s.current.pouncer === id) s.current.pouncer = null;
    }
  } else if (act === 'start') {
    s.current = { startedAt: Date.now(), endedAt: null, scores: {}, pouncer: null };
  } else if (act === 'end' && s.current) {
    s.current.endedAt = Date.now();
  } else if (act === 'cancel') {
    if (!confirm('Throw this game away?')) return;
    s.current = null;
  } else if (act === 'neg' && s.current) {
    const v = s.current.scores[id];
    if (v) s.current.scores[id] = v.startsWith('-') ? v.slice(1) : `-${v}`;
  } else if (act === 'del-game') {
    if (!confirm('Delete this game?')) return;
    s.games = s.games.filter((g) => g.id !== id);
  } else return;
  save();
  render();
});

app.addEventListener('input', (e) => {
  const el = /** @type {HTMLInputElement} */ (e.target);
  const s = currentSession();
  if (!s) return;
  if (el.dataset.score && s.current) {
    s.current.scores[el.dataset.score] = el.value;
  } else if (el.name === 'pouncer' && s.current) {
    s.current.pouncer = el.value;
  } else if (el.dataset.field === 'venue') {
    s.venue = el.value;
  } else if (el.dataset.field === 'bonus') {
    const n = Number(el.value);
    if (Number.isInteger(n) && n >= 0) s.bonus = n;
  } else return;
  save();
  if (s.current?.endedAt) updateSaveState(s);
});

app.addEventListener('change', (e) => {
  const el = /** @type {HTMLInputElement} */ (e.target);
  if (el.dataset.act === 'import' && el.files?.[0]) importData(el.files[0]);
  if (el.dataset.field === 'venue') render();
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = /** @type {HTMLFormElement} */ (e.target);
  const data = new FormData(form);
  const kind = form.dataset.form;
  const s = currentSession();
  if (kind === 'new-session') {
    const bonus = Number(data.get('bonus'));
    /** @type {Session} */
    const ns = {
      id: uid(), venue: String(data.get('venue') ?? '').trim(), bonus: Number.isInteger(bonus) && bonus >= 0 ? bonus : DEFAULT_BONUS,
      createdAt: Date.now(), present: [], games: [], current: null,
    };
    // Start with whoever played last time; drop anyone who is not here today.
    const prev = [...db.sessions].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (prev) ns.present = [...prev.present];
    db.sessions.push(ns);
    save();
    location.hash = `#/s/${ns.id}`;
    return;
  }
  if (!s) return;
  if (kind === 'add-player') {
    const p = playerByName(String(data.get('name') ?? ''));
    if (p && !s.present.includes(p.id)) s.present.push(p.id);
  } else if (kind === 'results' && s.current?.endedAt) {
    const results = draftResults(s);
    if (validateResults(results).length) return;
    s.games.push({
      id: uid(), startedAt: s.current.startedAt, durationMs: s.current.endedAt - s.current.startedAt, bonus: s.bonus, results,
    });
    s.current = null;
  }
  save();
  render();
  if (kind === 'add-player') /** @type {HTMLInputElement | null} */ (app.querySelector('[name=name]'))?.focus();
});

addEventListener('hashchange', render);

setInterval(() => {
  const s = currentSession();
  const t = document.getElementById('timer');
  if (s?.current && !s.current.endedAt && t) t.textContent = formatDuration(Date.now() - s.current.startedAt);
}, 500);

function exportData() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }));
  a.download = `pounce-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** @param {File} file */
async function importData(file) {
  try {
    const raw = JSON.parse(await file.text());
    if (!Array.isArray(raw.players) || !Array.isArray(raw.sessions)) throw new Error('shape');
    if (!confirm('Replace all pounce data on this device with the file?')) return;
    db = raw;
    save();
    render();
  } catch {
    alert('That file is not a pounce export.');
  }
}

render();
