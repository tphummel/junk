// Pure scoring and reporting logic for pounce. No DOM, no storage: the page and api/pounce.test.mjs both import it.
// A "game" here is the flattened record used by every report:
//   { id, sessionId, venue, startedAt, durationMs, bonus, results: [{ playerId, score, pounced }] }

export const SCORE_MIN = -26;
export const SCORE_MAX = 60;
export const DEFAULT_BONUS = 5;

/** @typedef {{ playerId: string, score: number, pounced: boolean }} Result */
/** @typedef {{ id: string, sessionId: string, venue: string, startedAt: number, durationMs: number, bonus: number, results: Result[] }} Game */
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
 * Per-player totals over the games they played, best total first.
 * Players come and go, so average per game is shown beside the raw total.
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
    .sort((a, b) => b.total - a.total || b.avg - a.avg);
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
