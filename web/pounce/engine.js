// Pure scoring and reporting logic for pounce. No DOM, no storage: the page and api/pounce.test.mjs both import it.
// A "game" here is the flattened record used by every report:
//   { id, sessionId, venue, startedAt, durationMs, bonus, results: [{ playerId, score, pounced }] }

export const SCORE_MIN = -26;
export const SCORE_MAX = 60;
export const DEFAULT_BONUS = 5;
export const DEFAULT_PILE = 13; // cards in each player's starting pounce pile

/** @typedef {{ playerId: string, score: number, pounced: boolean, pile?: number }} Result pile is set only for a handicapped start (fewer cards than the game's pile) */
/** @typedef {{ id: string, sessionId: string, venue: string, startedAt: number, durationMs: number, bonus: number, pile?: number, results: Result[] }} Game */
/** @typedef {Result & { total: number }} Total */

/** @param {unknown} n */
export function isValidScore(n) {
  return typeof n === 'number' && Number.isInteger(n) && n >= SCORE_MIN && n <= SCORE_MAX;
}

/**
 * Why a set of results cannot be saved yet, or an empty list when it can.
 * @param {Result[]} results
 * @returns {string[]}
 */
export function validateResults(results) {
  const errors = [];
  if (results.length < 2) errors.push('Need at least two players.');
  if (results.some((r) => !isValidScore(r.score))) errors.push(`Every score must be a whole number from ${SCORE_MIN} to ${SCORE_MAX}.`);
  const pouncers = results.filter((r) => r.pounced).length;
  if (pouncers !== 1) errors.push('Pick exactly one player who pounced.');
  return errors;
}

/** Score plus the pounce bonus for the pouncer. @param {Game} game @returns {Total[]} */
export function gameTotals(game) {
  return game.results.map((r) => ({ ...r, total: r.score + (r.pounced ? game.bonus : 0) }));
}

/** Players tied for the highest total. @param {Game} game @returns {string[]} */
export function gameWinners(game) {
  const totals = gameTotals(game);
  if (!totals.length) return [];
  const best = Math.max(...totals.map((t) => t.total));
  return totals.filter((t) => t.total === best).map((t) => t.playerId);
}

/** @param {Game[]} games @returns {string[]} */
function playersIn(games) {
  return [...new Set(games.flatMap((g) => g.results.map((r) => r.playerId)))];
}

/**
 * Per-player results over the games they played, ranked by average score per game.
 * Players come and go, so the average is fair to anyone who joined late; total and wins are shown too.
 * @param {Game[]} games
 */
export function standings(games) {
  return playersIn(games)
    .map((playerId) => {
      let played = 0, total = 0, wins = 0, pounces = 0, best = -Infinity;
      for (const g of games) {
        const t = gameTotals(g).find((x) => x.playerId === playerId);
        if (!t) continue;
        played++;
        total += t.total;
        if (t.pounced) pounces++;
        if (gameWinners(g).includes(playerId)) wins++;
        best = Math.max(best, t.total);
      }
      return { playerId, played, total, avg: played ? total / played : 0, wins, pounces, best };
    })
    .sort((a, b) => b.avg - a.avg || b.total - a.total);
}

/**
 * Running total after each game, one series per player; games a player sat out repeat their last total.
 * @param {Game[]} games oldest first
 * @returns {{ playerId: string, points: number[] }[]}
 */
export function cumulative(games) {
  return playersIn(games).map((playerId) => {
    let sum = 0;
    const points = games.map((g) => {
      const t = gameTotals(g).find((x) => x.playerId === playerId);
      if (t) sum += t.total;
      return sum;
    });
    return { playerId, points };
  });
}

/**
 * How often each player pounces, and what their games look like with and without it.
 * @param {Game[]} games
 */
export function pounceStats(games) {
  return playersIn(games)
    .map((playerId) => {
      const mine = games.flatMap((g) => gameTotals(g).filter((t) => t.playerId === playerId));
      const pounced = mine.filter((t) => t.pounced);
      const other = mine.filter((t) => !t.pounced);
      const avg = (/** @type {Total[]} */ xs) => (xs.length ? xs.reduce((s, t) => s + t.score, 0) / xs.length : null);
      return {
        playerId,
        played: mine.length,
        pounces: pounced.length,
        rate: mine.length ? pounced.length / mine.length : 0,
        avgScorePounced: avg(pounced),
        avgScoreOther: avg(other),
      };
    })
    .sort((a, b) => b.pounces - a.pounces || b.rate - a.rate);
}

/**
 * Game length from the timer. Games with no recorded duration are ignored.
 * @param {Game[]} games
 */
export function paceStats(games) {
  const timed = games.filter((g) => g.durationMs > 0);
  if (!timed.length) return { count: 0, avgMs: 0, fastest: null, longest: null };
  const avgMs = timed.reduce((s, g) => s + g.durationMs, 0) / timed.length;
  const sorted = [...timed].sort((a, b) => a.durationMs - b.durationMs);
  return { count: timed.length, avgMs, fastest: sorted[0], longest: sorted[sorted.length - 1] };
}

/**
 * Pairwise record, counting only games both players were in.
 * @param {Game[]} games
 * @param {string} a
 * @param {string} b
 */
export function headToHead(games, a, b) {
  let shared = 0, aWins = 0, bWins = 0, ties = 0, diff = 0;
  for (const g of games) {
    const t = gameTotals(g);
    const ta = t.find((x) => x.playerId === a);
    const tb = t.find((x) => x.playerId === b);
    if (!ta || !tb) continue;
    shared++;
    diff += ta.total - tb.total;
    if (ta.total > tb.total) aWins++;
    else if (tb.total > ta.total) bWins++;
    else ties++;
  }
  return { shared, aWins, bWins, ties, avgDiff: shared ? diff / shared : 0 };
}

/**
 * Every ordered pair of players who shared at least one game.
 * @param {Game[]} games
 * @returns {{ a: string, b: string, shared: number, aWins: number, bWins: number, ties: number, avgDiff: number }[]}
 */
export function headToHeadAll(games) {
  const ids = playersIn(games);
  const rows = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const h = headToHead(games, ids[i], ids[j]);
      if (h.shared) rows.push({ a: ids[i], b: ids[j], ...h });
    }
  }
  return rows.sort((x, y) => y.shared - x.shared);
}

/** Games and average length per venue. @param {Game[]} games */
export function venueStats(games) {
  const by = new Map();
  for (const g of games) {
    const key = g.venue.trim() || 'No venue';
    const v = by.get(key) ?? { venue: key, games: 0, totalMs: 0 };
    v.games++;
    v.totalMs += g.durationMs;
    by.set(key, v);
  }
  return [...by.values()].map((v) => ({ venue: v.venue, games: v.games, avgMs: v.games ? v.totalMs / v.games : 0 })).sort((a, b) => b.games - a.games);
}

/** @param {number} ms */
export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Local time of day a game ended, like "7:42 PM". Uses the offset (minutes east of UTC) saved with the game so the
 * time is where it was played; without one it falls back to the viewer's own time zone.
 * @param {{ startedAt: number, durationMs?: number, offset?: number }} game
 */
export function endTimeLabel(game) {
  const end = game.startedAt + (game.durationMs > 0 ? game.durationMs : 0);
  const opts = /** @type {Intl.DateTimeFormatOptions} */ ({ hour: 'numeric', minute: '2-digit' });
  if (typeof game.offset !== 'number') return new Date(end).toLocaleTimeString('en-US', opts);
  return new Date(end + game.offset * 60000).toLocaleTimeString('en-US', { ...opts, timeZone: 'UTC' });
}

/** @param {unknown} s */
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/**
 * One session as a standalone JSON-able object, with player names resolved. The unsaved in-progress game is left out.
 * @param {{ id: string, venue: string, bonus: number, pile?: number, handicaps?: Record<string, number>, createdAt: number, present: string[], games: any[] }} session
 * @param {{ id: string, name: string }[]} players
 */
export function sessionExport(session, players) {
  const ids = new Set([...session.present, ...session.games.flatMap((g) => g.results.map((r) => r.playerId))]);
  const { present, games, id, venue, bonus, pile, handicaps, createdAt } = session;
  return {
    format: 'pounce-session',
    version: 1,
    session: { id, venue, bonus, pile: pile ?? DEFAULT_PILE, handicaps: handicaps ?? {}, createdAt, present, games },
    players: players.filter((p) => ids.has(p.id)),
  };
}

/**
 * A self-contained HTML report (no scripts, inline styles) for one session.
 * @param {ReturnType<typeof sessionExport>} exp
 */
export function sessionReportHtml(exp) {
  const name = (/** @type {string} */ id) => exp.players.find((p) => p.id === id)?.name ?? '?';
  const s = exp.session;
  const games = s.games.map((g) => ({ ...g, sessionId: s.id, venue: s.venue }));
  const title = `${s.venue || 'No venue'} — ${new Date(s.createdAt).toLocaleDateString('en-US')}`;
  const pace = paceStats(games);
  const winners = (/** @type {Game} */ g) => gameWinners(g);
  const st = standings(games);
  const ps = pounceStats(games);
  const h2h = headToHeadAll(games);
  const f1 = (/** @type {number | null} */ n) => (n === null ? '–' : n.toFixed(1));
  const players = [...new Set([...s.present, ...games.flatMap((g) => g.results.map((r) => r.playerId))])];
  const rows = games.map((g) => {
    const totals = gameTotals(g);
    return `<tr><td>${endTimeLabel(g)}</td>${players.map((id) => {
      const t = totals.find((x) => x.playerId === id);
      if (!t) return '<td>–</td>';
      return `<td class="${winners(g).includes(id) ? 'win' : ''}">${t.total}${t.pounced ? ' ⚡' : ''}</td>`;
    }).join('')}<td>${g.durationMs > 0 ? formatDuration(g.durationMs) : '–'}</td></tr>`;
  }).join('');
  const edited = games.map((g, i) => (g.updatedAt ? `<li>Game ${i + 1} edited ${escHtml(new Date(g.updatedAt).toISOString())}</li>` : '')).join('');
  const notes = games.map((g, i) => (g.notes ? `<li><b>Game ${i + 1}</b> ${escHtml(g.notes)}</li>` : '')).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>pounce — ${escHtml(title)}</title>
<style>
:root{color-scheme:light dark;--primary:#1D856F;--support:#4B8074;--accent:#CB2CC0;--bg:#FFFFFF;--text:#111111}
@media (prefers-color-scheme:dark){:root{--primary:#2DD2AE;--support:#5FA192;--accent:#D330C7;--bg:#111111;--text:#EEEEEE}}
body{font:16px/1.4 system-ui,sans-serif;background:var(--bg);color:var(--text);margin:0 auto;max-width:48rem;padding:1rem 16px 3rem}
h1,h2{color:var(--primary)}h2{font-size:1.15rem;margin-top:1.5rem}
table{border-collapse:collapse;width:100%;font-size:.9rem;display:block;overflow-x:auto}
th,td{text-align:left;padding:.3rem .5rem;border-bottom:1px solid var(--support);white-space:nowrap}th{color:var(--support)}
.win{font-weight:bold;color:var(--accent)}.muted{color:var(--support)}
</style></head><body>
<h1>${escHtml(title)}</h1>
<p class="muted">${games.length} games · pounce bonus ${s.bonus} · pile ${s.pile}${pace.count ? ` · average game ${formatDuration(pace.avgMs)}` : ''}</p>
<h2>Leaderboard</h2>
<table><thead><tr><th>Rank</th><th>Name</th><th>Score avg</th><th>Total</th><th>Games</th><th>Wins</th><th>Best</th></tr></thead><tbody>
${st.map((r, i) => `<tr><td>${i + 1}</td><td>${escHtml(name(r.playerId))}</td><td>${r.avg.toFixed(3)}</td><td>${r.total}</td><td>${r.played}</td><td>${r.wins}</td><td>${r.best}</td></tr>`).join('')}
</tbody></table>
<h2>Pounce stats</h2>
<table><thead><tr><th>Player</th><th>Pounces</th><th>Rate</th><th>Avg score pouncing</th><th>Otherwise</th></tr></thead><tbody>
${ps.map((r) => `<tr><td>${escHtml(name(r.playerId))}</td><td>${r.pounces}/${r.played}</td><td>${Math.round(r.rate * 100)}%</td><td>${f1(r.avgScorePounced)}</td><td>${f1(r.avgScoreOther)}</td></tr>`).join('')}
</tbody></table>
${h2h.length ? `<h2>Head to head</h2>
<p class="muted">Only games both players were in.</p>
<table><thead><tr><th>Matchup</th><th>Shared</th><th>Record</th><th>Avg margin</th></tr></thead><tbody>
${h2h.map((r) => {
  const lead = r.avgDiff >= 0 ? r.a : r.b;
  return `<tr><td>${escHtml(name(r.a))} vs ${escHtml(name(r.b))}</td><td>${r.shared}</td><td>${r.aWins}–${r.bWins}${r.ties ? `–${r.ties}` : ''}</td><td>${r.avgDiff === 0 ? 'even' : `${escHtml(name(lead))} +${Math.abs(r.avgDiff).toFixed(1)}`}</td></tr>`;
}).join('')}
</tbody></table>` : ''}
<h2>Games</h2>
<p class="muted">Totals include the pounce bonus. ⚡ pounced, bold won.</p>
<table><thead><tr><th>Ended</th>${players.map((id) => `<th>${escHtml(name(id))}</th>`).join('')}<th>Length</th></tr></thead><tbody>${rows}</tbody></table>
${notes ? `<h2>Game notes</h2><ul>${notes}</ul>` : ''}
${edited ? `<h2>Edits</h2><ul class="muted">${edited}</ul>` : ''}
</body></html>
`;
}
