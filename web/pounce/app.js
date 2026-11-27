// pounce UI: sessions, roster, game timer, result entry and reports. State lives in localStorage.
import {
  cumulative, DEFAULT_BONUS, DEFAULT_PILE, formatDuration, gameTotals, gameWinners, headToHeadAll, pounceStats, paceStats,
  SCORE_MAX, SCORE_MIN, sessionExport, sessionReportHtml, standings, validateResults, venueStats,
} from './engine.js';

const KEY = 'pounce:v1';
const app = /** @type {HTMLElement} */ (document.getElementById('app'));

/** @typedef {{ id: string, name: string }} Player */
/** @typedef {{ startedAt: number, endedAt: number | null, lat?: number, lon?: number, acc?: number | null, scores: Record<string, string>, pouncer: string | null, notes?: string }} Current */
/** @typedef {{ id: string, venue: string, bonus: number, pile?: number, handicaps?: Record<string, number>, createdAt: number, present: string[], games: any[], current: Current | null }} Session */

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

/** Session's standard pounce pile. @param {Session} s */
const pileOf = (s) => s.pile ?? DEFAULT_PILE;
/** Cards a player starts with: the session pile unless handicapped. @param {Session} s @param {string} id */
const startPile = (s, id) => Math.min(pileOf(s), s.handicaps?.[id] ?? pileOf(s));

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
    ${backupBanner()}
    <section>
      <h2>New session</h2>
      <form data-form="new-session" class="row">
        <input name="venue" placeholder="Venue" list="venues" value="${esc(last?.venue ?? '')}" autocomplete="off">
        <datalist id="venues">${venues.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>
        <label class="inline">Pile <input name="pile" type="number" inputmode="numeric" min="1" max="52" value="${last?.pile ?? DEFAULT_PILE}" class="narrow"></label>
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
      <p class="muted">Last backup: ${backupLabel()}</p>
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
        <label class="inline">Pile size <input data-field="pile" type="number" inputmode="numeric" min="1" max="52" value="${pileOf(s)}" class="narrow"></label>
        <label class="inline">Pounce bonus <input data-field="bonus" type="number" inputmode="numeric" min="0" max="60" value="${s.bonus}" class="narrow"></label>
      </div>
      <p class="muted">Changing the bonus or pile affects future games; saved games keep the rules they were played with.</p>
    </details>
    ${rosterView(s)}
    ${gamePanel(s, cur)}
    ${games.length ? reportsView(games) : '<p class="muted">Reports appear after the first saved game.</p>'}
    ${games.length ? gamesListView(games) : ''}
    <section>
      <h2>Export this session</h2>
      <div class="row">
        <button data-act="export-session-json">JSON</button>
        <button data-act="export-session-html">HTML report</button>
      </div>
    </section>
    ${db.sessions.length > 1 ? `<section><h2>All-time</h2>${allTimeInner()}</section>` : ''}`;
}

/** Every saved game with edit and delete. @param {any[]} games */
function gamesListView(games) {
  return `<section><h2>Games</h2><ul class="list">${games.map((g, i) => `
    <li><b>Game ${i + 1}</b>
      <span>${gameTotals(g).sort((a, b) => b.total - a.total).map((t) => `<span class="${gameWinners(g).includes(t.playerId) ? 'win' : ''}">${esc(nameOf(t.playerId))} ${t.total}${t.pounced ? ' ⚡' : ''}</span>`).join(' · ')}</span>
      ${g.updatedAt ? `<span class="muted" title="${esc(new Date(g.updatedAt).toLocaleString())}">edited ${esc(new Date(g.updatedAt).toLocaleString())}</span>` : ''}
      <button class="link" data-act="edit-game" data-id="${g.id}">edit</button>
      <button class="link" data-act="del-game" data-id="${g.id}">delete</button></li>`).join('')}</ul></section>`;
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
      <button type="button" class="who namebtn" data-act="edit-player" data-id="${id}" title="Edit name or handicap">${esc(nameOf(id))}${startPile(s, id) < pileOf(s) ? ` <span class="badge">${startPile(s, id)} cards</span>` : ''}</button>
      <input data-score="${id}" type="number" inputmode="numeric" min="${SCORE_MIN}" max="${SCORE_MAX}" step="1" placeholder="0" aria-label="${esc(nameOf(id))} score">
      <button type="button" class="sign" data-act="neg" data-id="${id}" title="Flip sign">&plusmn;</button>
      <label class="pounce"><input type="radio" name="pouncer" value="${id}"> Pounced</label>
      <button type="button" class="link" data-act="drop" data-id="${id}">out</button>
    </div>`).join('');
  return `<section><h2>Game ${s.games.length + 1} results <span class="muted">${formatDuration(cur.endedAt - cur.startedAt)}</span></h2>
    <form data-form="results">
      ${rows}
      <p class="muted">Scores ${SCORE_MIN} to ${SCORE_MAX}. The pouncer gets +${s.bonus}.</p>
      <label class="notes">Game notes <span class="muted">(optional)</span>
        <textarea data-notes rows="2" placeholder="Anything worth remembering about this game"></textarea></label>
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
  const notes = /** @type {HTMLTextAreaElement | null} */ (app.querySelector('[data-notes]'));
  if (notes) notes.value = cur.notes ?? '';
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
      <p>${gameTotals(last).sort((a, b) => b.total - a.total).map((t) => `<span class="${gameWinners(last).includes(t.playerId) ? 'win' : ''}">${esc(nameOf(t.playerId))}${t.pile ? ` <small>(${t.pile} cards)</small>` : ''} ${t.total}${t.pounced ? ' ⚡' : ''}</span>`).join(' · ')}
      <span class="muted">(${formatDuration(last.durationMs)})</span>
      <button class="link" data-act="del-game" data-id="${last.id}">delete</button></p>
      ${last.notes ? `<p class="note">${esc(last.notes)}</p>` : ''}
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
    ${h2hView(games)}
    ${notesView(games)}`;
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
function notesView(games) {
  const noted = games.map((g, i) => ({ g, n: i + 1 })).filter((x) => x.g.notes);
  if (!noted.length) return '';
  return `<section><h2>Game notes</h2><ul class="list">${noted.map(({ g, n }) => `<li><b>Game ${n}</b> <span class="note">${esc(g.notes)}</span></li>`).join('')}</ul></section>`;
}

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
  if (act === 'export') return void exportData();
  if (act === 'snooze') { setLS(REMIND_AFTER, new Date(Date.now() + 864e5).toISOString()); return render(); }
  if (act === 'export-session-json' && s) return exportSession(s, 'json');
  if (act === 'export-session-html' && s) return exportSession(s, 'html');
  if (act === 'edit-game' && s) return openGameModal(s, id);
  if (act === 'edit-player') { const cs = currentSession(); if (cs) openPlayerModal(cs, /** @type {HTMLElement} */ (t).dataset.id ?? ''); return; }
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
    captureLocation(s.current);
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
  if ('notes' in el.dataset && s.current) {
    s.current.notes = el.value;
  } else if (el.dataset.score && s.current) {
    s.current.scores[el.dataset.score] = el.value;
  } else if (el.name === 'pouncer' && s.current) {
    s.current.pouncer = el.value;
  } else if (el.dataset.field === 'venue') {
    s.venue = el.value;
  } else if (el.dataset.field === 'pile') {
    const n = Number(el.value);
    if (Number.isInteger(n) && n >= 1 && n <= 52) s.pile = n;
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
    const pile = Number(data.get('pile'));
    /** @type {Session} */
    const ns = {
      id: uid(), venue: String(data.get('venue') ?? '').trim(), bonus: Number.isInteger(bonus) && bonus >= 0 ? bonus : DEFAULT_BONUS,
      pile: Number.isInteger(pile) && pile >= 1 ? pile : DEFAULT_PILE, handicaps: {},
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
    const notes = (s.current.notes ?? '').trim();
    s.games.push({
      id: uid(), startedAt: s.current.startedAt, offset: -new Date(s.current.startedAt).getTimezoneOffset(),
      ...place(s.current), durationMs: s.current.endedAt - s.current.startedAt, bonus: s.bonus, pile: pileOf(s),
      results: results.map((r) => ({ ...r, ...(startPile(s, r.playerId) < pileOf(s) ? { pile: startPile(s, r.playerId) } : {}) })),
      ...(notes ? { notes } : {}),
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

/** Edit a player's name (all sessions) and their starting pile for this session. @param {Session} s @param {string} id */
function openPlayerModal(s, id) {
  const player = db.players.find((p) => p.id === id);
  if (!player) return;
  const pile = pileOf(s);
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<form method="dialog" class="modal">
    <h2>Edit player</h2>
    <label>Name <input name="name" value="${esc(player.name)}" autocomplete="off" required></label>
    <label>Starts with <input name="cards" type="number" inputmode="numeric" min="1" max="${pile - 1}" step="1" placeholder="${pile}" value="${s.handicaps?.[id] ?? ''}" class="narrow"> cards in pounce pile</label>
    <p class="muted">Standard pile is ${pile}. A smaller pile is a handicap for this player in this game and the rest of the session. Leave empty for no handicap.</p>
    <p class="error" data-modal-error></p>
    <div class="row"><button class="primary" value="save">Save</button>
      <button type="button" data-clear>Remove handicap</button>
      <button type="button" data-cancel class="link">Cancel</button></div>
    <p class="muted">Renaming changes this player in every session.</p></form>`;
  document.body.append(dlg);
  const form = /** @type {HTMLFormElement} */ (dlg.querySelector('form'));
  const cards = /** @type {HTMLInputElement} */ (form.elements.namedItem('cards'));
  form.querySelector('[data-cancel]')?.addEventListener('click', () => dlg.close());
  form.querySelector('[data-clear]')?.addEventListener('click', () => { cards.value = ''; });
  dlg.addEventListener('close', () => dlg.remove());
  form.addEventListener('input', () => { const e = form.querySelector('[data-modal-error]'); if (e) e.textContent = ''; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = String(new FormData(form).get('name') ?? '').trim().replace(/\s+/g, ' ');
    const err = /** @type {HTMLElement} */ (form.querySelector('[data-modal-error]'));
    const n = cards.value === '' ? null : Number(cards.value);
    if (!name) { err.textContent = 'Name is required.'; return; }
    if (db.players.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) { err.textContent = 'Another player already has that name.'; return; }
    if (n !== null && (!Number.isInteger(n) || n < 1)) { err.textContent = 'Cards must be a whole number of 1 or more.'; return; }
    player.name = name;
    s.handicaps ??= {};
    if (n === null || n >= pile) delete s.handicaps[id];
    else s.handicaps[id] = n;
    save();
    dlg.close();
    render();
  });
  dlg.showModal();
  /** @type {HTMLInputElement | null} */ (form.querySelector('[name=name]'))?.select();
}

/** Download one session as JSON or a standalone HTML report. @param {Session} s @param {'json' | 'html'} kind */
function exportSession(s, kind) {
  const exp = sessionExport(s, db.players);
  const body = kind === 'json' ? JSON.stringify(exp, null, 2) : sessionReportHtml(exp);
  const slug = (s.venue || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: kind === 'json' ? 'application/json' : 'text/html' }));
  a.download = `pounce-${slug}-${new Date(s.createdAt).toISOString().slice(0, 10)}.${kind}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Fix scores, the pouncer or notes of a saved game. @param {Session} s @param {string} gameId */
function openGameModal(s, gameId) {
  const game = s.games.find((g) => g.id === gameId);
  if (!game) return;
  const n = s.games.indexOf(game) + 1;
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<form method="dialog" class="modal">
    <h2>Edit game ${n}</h2>
    ${game.results.map((/** @type {any} */ r) => `
      <div class="entry">
        <span class="who">${esc(nameOf(r.playerId))}</span>
        <input data-edit-score="${r.playerId}" type="number" inputmode="numeric" min="${SCORE_MIN}" max="${SCORE_MAX}" step="1" value="${r.score}" aria-label="${esc(nameOf(r.playerId))} score">
        <button type="button" class="sign" data-edit-neg="${r.playerId}" title="Flip sign">&plusmn;</button>
        <label class="pounce"><input type="radio" name="pouncer" value="${r.playerId}" ${r.pounced ? 'checked' : ''}> Pounced</label>
      </div>`).join('')}
    <p class="muted">The pouncer gets +${game.bonus} (the bonus this game was played with).</p>
    <label class="notes">Game notes <textarea name="notes" rows="2"></textarea></label>
    <p class="error" data-modal-error></p>
    <div class="row"><button class="primary" value="save">Save</button>
      <button type="button" data-cancel class="link">Cancel</button></div></form>`;
  document.body.append(dlg);
  const form = /** @type {HTMLFormElement} */ (dlg.querySelector('form'));
  /** @type {HTMLTextAreaElement} */ (form.elements.namedItem('notes')).value = game.notes ?? '';
  const err = /** @type {HTMLElement} */ (form.querySelector('[data-modal-error]'));
  const read = () => game.results.map((/** @type {any} */ r) => {
    const el = /** @type {HTMLInputElement} */ (form.querySelector(`[data-edit-score="${r.playerId}"]`));
    return { ...r, score: el.value === '' ? NaN : Number(el.value), pounced: form.querySelector(`input[name=pouncer][value="${r.playerId}"]`)?.matches(':checked') ?? false };
  });
  form.querySelector('[data-cancel]')?.addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  form.addEventListener('click', (e) => {
    const id = /** @type {HTMLElement} */ (e.target).closest('[data-edit-neg]')?.getAttribute('data-edit-neg');
    const el = id && /** @type {HTMLInputElement | null} */ (form.querySelector(`[data-edit-score="${id}"]`));
    if (el && el.value) el.value = el.value.startsWith('-') ? el.value.slice(1) : `-${el.value}`;
  });
  form.addEventListener('input', () => { err.textContent = ''; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const results = read();
    const errors = validateResults(results);
    if (errors.length) { err.textContent = errors.join(' '); return; }
    const notes = String(new FormData(form).get('notes') ?? '').trim();
    const changed = JSON.stringify(results) !== JSON.stringify(game.results) || notes !== (game.notes ?? '');
    game.results = results;
    if (notes) game.notes = notes; else delete game.notes;
    if (changed) game.updatedAt = Date.now();
    save();
    dlg.close();
    render();
  });
  dlg.showModal();
}

// ---------- location: looked up when a game starts if the device already allows it, saved only if available ----------

/** Look up the position for a new game, only if the browser already allows location for this site. Never prompts, never blocks play, and leaves the fields unset otherwise. @param {Current} cur */
async function captureLocation(cur) {
  try {
    if (!navigator.geolocation || !navigator.permissions) return;
    if ((await navigator.permissions.query({ name: 'geolocation' })).state !== 'granted') return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      if (!(Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180)) return;
      cur.lat = +latitude.toFixed(6);
      cur.lon = +longitude.toFixed(6);
      cur.acc = Number.isFinite(accuracy) && accuracy >= 0 ? Math.round(accuracy) : null;
      save();
    }, () => {}, { timeout: 8000, maximumAge: 0 });
  } catch {}
}

/** lat, lon and acc for a saved game, or nothing when no position was found. @param {Current} cur */
function place(cur) {
  if (typeof cur.lat !== 'number' || typeof cur.lon !== 'number') return {};
  return { lat: cur.lat, lon: cur.lon, ...(typeof cur.acc === 'number' ? { acc: cur.acc } : {}) };
}

/** Keep a game's location only if valid; otherwise drop the fields. @param {any} g */
function cleanGame(g) {
  const { lat, lon, acc, ...rest } = g;
  const ok = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  return ok ? { ...rest, lat, lon, ...(Number.isFinite(acc) && acc >= 0 ? { acc: Math.round(acc) } : {}) } : rest;
}

// ---------- backup (ADR 0011) ----------

const SCHEMA = 1;
const LAST_BACKUP = 'pounce:lastBackupAt';
const REMIND_AFTER = 'pounce:remindAfter';
const WEEK = 7 * 864e5;
const getLS = (/** @type {string} */ k) => { try { return localStorage.getItem(k); } catch { return null; } };
const setLS = (/** @type {string} */ k, /** @type {string} */ v) => { try { localStorage.setItem(k, v); } catch {} };
const hasData = () => db.players.length > 0 || db.sessions.length > 0;

/** @param {number} ms */
function ago(ms) {
  const d = Math.floor(ms / 864e5);
  return d < 1 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`;
}
function backupLabel() {
  const last = getLS(LAST_BACKUP);
  const t = last ? Date.parse(last) : NaN;
  return Number.isNaN(t) ? 'never' : `${new Date(t).toLocaleString()} (${ago(Date.now() - t)})`;
}
function backupBanner() {
  if (!hasData()) return '';
  const t = Date.parse(getLS(LAST_BACKUP) ?? '');
  const stale = Number.isNaN(t) || Date.now() - t > WEEK;
  const snoozed = Date.now() < Date.parse(getLS(REMIND_AFTER) ?? '');
  if (!stale || snoozed) return '';
  return `<section role="status"><p>Last backup: ${Number.isNaN(t) ? 'never' : ago(Date.now() - t)}. Export now.</p>
    <div class="row"><button class="primary" data-act="export">Export</button><button data-act="snooze">Remind me tomorrow</button></div></section>`;
}

function backupJson() {
  return JSON.stringify({ app: 'pounce', schema: SCHEMA, exportedAt: new Date().toISOString(), settings: {}, players: db.players, sessions: db.sessions }, null, 2);
}

async function exportData() {
  const name = `pounce-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([backupJson()], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      setLS(LAST_BACKUP, new Date().toISOString());
      return render();
    } catch (err) {
      if (/** @type {any} */ (err)?.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setLS(LAST_BACKUP, new Date().toISOString());
  render();
}

/** Upgrade an older file to the current shape; throws on a file we cannot read. @param {any} raw */
function upgradeBackup(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('shape');
  // Files exported before ADR 0011 have no app or schema field.
  if (raw.app === undefined && raw.schema === undefined) { /* legacy: players + sessions only */ }
  else if (raw.app !== 'pounce') throw new Error('app');
  else if (!Number.isInteger(raw.schema) || raw.schema > SCHEMA) throw new Error('schema');
  if (!Array.isArray(raw.players) || !Array.isArray(raw.sessions)) throw new Error('shape');
  const ok = (/** @type {any} */ x) => x && typeof x.id === 'string';
  return {
    players: raw.players.filter((p) => ok(p) && typeof p.name === 'string'),
    sessions: raw.sessions.filter((x) => ok(x) && Array.isArray(x.games)).map((x) => ({ ...x, games: x.games.filter(ok).map(cleanGame) })),
  };
}

/** Merge by id; importing the same file twice adds nothing. @param {{ players: Player[], sessions: Session[] }} inc */
function mergeData(inc) {
  const pids = new Set(db.players.map((p) => p.id));
  for (const p of inc.players) if (!pids.has(p.id)) db.players.push(p);
  for (const s of inc.sessions) {
    const mine = db.sessions.find((x) => x.id === s.id);
    if (!mine) { db.sessions.push(s); continue; }
    // Same game id: keep the more recently edited copy (games can be edited after saving).
    for (const g of s.games) {
      const i = mine.games.findIndex((x) => x.id === g.id);
      if (i < 0) mine.games.push(g);
      else if ((g.updatedAt ?? 0) > (mine.games[i].updatedAt ?? 0)) mine.games[i] = g;
    }
    mine.games.sort((a, b) => a.startedAt - b.startedAt);
  }
}

/** @param {File} file */
async function importData(file) {
  let inc;
  try {
    inc = upgradeBackup(JSON.parse(await file.text()));
  } catch (err) {
    const m = /** @type {Error} */ (err).message;
    alert(m === 'schema' ? 'That backup is from a newer version of pounce. Reload the page and try again.' : 'That file is not a pounce export.');
    return;
  }
  if (!hasData()) mergeData(inc);
  else if (confirm('Merge the file into this device? (OK = merge, Cancel = more options)')) mergeData(inc);
  else if (confirm('Replace ALL pounce data on this device with the file? Export first if you need the current data.')) {
    db = { players: inc.players, sessions: inc.sessions };
    setLS(LAST_BACKUP, new Date().toISOString());
  } else return;
  save();
  render();
}

render();
