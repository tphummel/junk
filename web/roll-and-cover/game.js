// Pure logic for roll and cover: modes, storage shape, validation and statistics. No DOM.

/** @typedef {'d6' | '2d6'} Mode */
/** @typedef {{ id: string, mode: Mode, startedAt: number, endedAt: number, rolls: (number | number[])[] }} Game */
/** @typedef {{ startedAt: number | null, rolls: (number | number[])[] }} Current */
/** @typedef {{ v: 1, mode: Mode, games: Game[], current: Record<Mode, Current> }} State */

export const MODES = /** @type {const} */ (['d6', '2d6']);

/** @param {Mode} mode */
export const targets = (mode) =>
  mode === 'd6' ? [1, 2, 3, 4, 5, 6] : [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Probability of one roll producing `n`. @param {Mode} mode @param {number} n */
export const prob = (mode, n) => (mode === 'd6' ? 1 / 6 : (6 - Math.abs(7 - n)) / 36);

/** Value of one stored roll. @param {number | number[]} r */
export const value = (r) => (Array.isArray(r) ? r[0] + r[1] : r);

/** @param {Mode} mode @param {number} n */
export const rollOne = (mode, n = 6) => {
  const pick = () => {
    const buf = new Uint32Array(1);
    const limit = Math.floor(2 ** 32 / n) * n;
    do crypto.getRandomValues(buf); while (buf[0] >= limit);
    return (buf[0] % n) + 1;
  };
  return mode === 'd6' ? pick() : [pick(), pick()];
};

/** Expected rolls to see every target, by inclusion-exclusion over subsets. @param {Mode} mode */
export function expectedRolls(mode) {
  const ps = targets(mode).map((n) => prob(mode, n));
  let e = 0;
  for (let mask = 1; mask < 1 << ps.length; mask++) {
    let p = 0, bits = 0;
    for (let i = 0; i < ps.length; i++) if (mask & (1 << i)) { p += ps[i]; bits++; }
    e += (bits % 2 ? 1 : -1) / p;
  }
  return e;
}

/** @param {Mode} mode @param {(number | number[])[]} rolls */
export function covered(mode, rolls) {
  const first = new Map();
  rolls.forEach((r, i) => { const v = value(r); if (!first.has(v)) first.set(v, i + 1); });
  return first; // number -> roll index (1-based) where it was first rolled
}

/** @param {Mode} mode @param {(number | number[])[]} rolls */
export const isComplete = (mode, rolls) => covered(mode, rolls).size === targets(mode).length;

export const emptyState = () => /** @type {State} */ ({
  v: 1, mode: 'd6', games: [],
  current: { d6: { startedAt: null, rolls: [] }, '2d6': { startedAt: null, rolls: [] } },
});

/** @param {unknown} r @param {Mode} mode */
function validRoll(r, mode) {
  const die = (x) => Number.isInteger(x) && x >= 1 && x <= 6;
  return mode === 'd6' ? die(r) : Array.isArray(r) && r.length === 2 && die(r[0]) && die(r[1]);
}

/**
 * Validate parsed JSON as an export. Returns clean games and in-progress games, or throws.
 * @param {any} data
 */
export function parseImport(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.games)) throw new Error('Not a roll and cover export (no games list).');
  /** @type {Game[]} */ const games = [];
  data.games.forEach((g, i) => {
    if (!g || !MODES.includes(g.mode)) throw new Error(`Game ${i + 1}: unknown mode.`);
    if (!Array.isArray(g.rolls) || !g.rolls.every((r) => validRoll(r, g.mode))) throw new Error(`Game ${i + 1}: invalid rolls.`);
    if (!isComplete(g.mode, g.rolls)) throw new Error(`Game ${i + 1}: not every number was covered.`);
    const endedAt = Number.isFinite(g.endedAt) ? g.endedAt : Date.now();
    const startedAt = Number.isFinite(g.startedAt) ? g.startedAt : endedAt;
    games.push({ id: typeof g.id === 'string' && g.id ? g.id : `${endedAt}-${i}`, mode: g.mode, startedAt, endedAt, rolls: g.rolls });
  });
  const current = emptyState().current;
  if (data.current && typeof data.current === 'object') {
    for (const m of MODES) {
      const c = data.current[m];
      if (c && Array.isArray(c.rolls) && c.rolls.every((r) => validRoll(r, m)) && !isComplete(m, c.rolls)) {
        current[m] = { startedAt: Number.isFinite(c.startedAt) ? c.startedAt : Date.now(), rolls: c.rolls };
      }
    }
  }
  return { games, current };
}

/** @param {number[]} xs sorted ascending @param {number} q 0-1 */
const quantile = (xs, q) => {
  if (!xs.length) return NaN;
  const pos = (xs.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
};

/**
 * All statistics for one mode.
 * @param {Mode} mode @param {Game[]} games finished games @param {Current} cur game in progress
 */
export function computeStats(mode, games, cur) {
  const mine = games.filter((g) => g.mode === mode).sort((a, b) => a.endedAt - b.endedAt);
  const nums = targets(mode);
  const lens = mine.map((g) => g.rolls.length);
  const sorted = [...lens].sort((a, b) => a - b);
  const n = lens.length;
  const sum = lens.reduce((a, b) => a + b, 0);
  const mean = n ? sum / n : NaN;
  const sd = n > 1 ? Math.sqrt(lens.reduce((a, l) => a + (l - mean) ** 2, 0) / (n - 1)) : NaN;
  const expected = expectedRolls(mode);

  const freq = new Map(nums.map((x) => [x, 0]));
  const lastCovered = new Map(nums.map((x) => [x, 0]));
  const firstSum = new Map(nums.map((x) => [x, 0]));
  let allRolls = 0, doubles = 0, repeats = 0, longestRepeat = 0;
  const countRoll = (r) => { freq.set(value(r), freq.get(value(r)) + 1); allRolls++; if (Array.isArray(r) && r[0] === r[1]) doubles++; };
  for (const g of mine) {
    const first = covered(mode, g.rolls);
    let lastNum = 0, lastIdx = 0;
    for (const [num, idx] of first) { firstSum.set(num, firstSum.get(num) + idx); if (idx > lastIdx) { lastIdx = idx; lastNum = num; } }
    lastCovered.set(lastNum, lastCovered.get(lastNum) + 1);
    let run = 1;
    g.rolls.forEach((r, i) => {
      countRoll(r);
      if (i && value(r) === value(g.rolls[i - 1])) { repeats++; run++; longestRepeat = Math.max(longestRepeat, run); } else run = 1;
    });
  }
  const curFreq = new Map(nums.map((x) => [x, 0]));
  cur.rolls.forEach((r) => curFreq.set(value(r), curFreq.get(value(r)) + 1));

  // histogram of game length, bucketed to keep it short
  const maxLen = n ? sorted[n - 1] : 0;
  const step = maxLen > 60 ? 10 : maxLen > 30 ? 5 : maxLen > 15 ? 2 : 1;
  /** @type {{ from: number, to: number, count: number }[]} */ const hist = [];
  if (n) {
    const lo = sorted[0] - ((sorted[0] - nums.length) % step || 0);
    for (let from = Math.max(nums.length, lo); from <= maxLen; from += step) {
      hist.push({ from, to: from + step - 1, count: lens.filter((l) => l >= from && l < from + step).length });
    }
  }

  // modal game length
  const lenCount = new Map();
  lens.forEach((l) => lenCount.set(l, (lenCount.get(l) || 0) + 1));
  let modeLen = NaN, best = 0;
  for (const [l, c] of [...lenCount].sort((a, b) => a[0] - b[0])) if (c > best) { best = c; modeLen = l; }

  // streaks of games at or under expected, and best/worst
  let streak = 0, bestStreak = 0;
  for (const l of lens) { streak = l <= expected ? streak + 1 : 0; bestStreak = Math.max(bestStreak, streak); }
  let curStreak = 0;
  for (let i = lens.length - 1; i >= 0 && lens[i] <= expected; i--) curStreak++;

  const days = new Set(mine.map((g) => new Date(g.endedAt).toDateString()));
  const today = mine.filter((g) => new Date(g.endedAt).toDateString() === new Date().toDateString()).length;
  const last10 = lens.slice(-10);

  return {
    games: n, today, daysPlayed: days.size, totalRolls: sum, expected,
    mean, median: quantile(sorted, 0.5), min: n ? sorted[0] : NaN, max: n ? sorted[n - 1] : NaN,
    sd, p25: quantile(sorted, 0.25), p75: quantile(sorted, 0.75), p90: quantile(sorted, 0.9),
    modeLen, vsExpected: n ? mean - expected : NaN,
    beatExpected: lens.filter((l) => l < expected).length,
    perfect: lens.filter((l) => l === nums.length).length,
    wasted: n ? sum - n * nums.length : 0,
    last10Mean: last10.length ? last10.reduce((a, b) => a + b, 0) / last10.length : NaN,
    streak: curStreak, bestStreak,
    allRolls, freq, curFreq, lastCovered, avgFirst: new Map(nums.map((x) => [x, n ? firstSum.get(x) / n : NaN])),
    doubles, repeats, longestRepeat, hist, nums,
  };
}

/** CSV with one row per roll. @param {Game[]} games */
export function toCsv(games) {
  const rows = ['game_id,mode,started_at,ended_at,roll_number,die1,die2,total,newly_covered'];
  for (const g of games) {
    const seen = new Set();
    g.rolls.forEach((r, i) => {
      const v = value(r), isNew = !seen.has(v);
      seen.add(v);
      rows.push([g.id, g.mode, new Date(g.startedAt).toISOString(), new Date(g.endedAt).toISOString(), i + 1,
        Array.isArray(r) ? r[0] : r, Array.isArray(r) ? r[1] : '', v, isNew ? 1 : 0].join(','));
    });
  }
  return rows.join('\n') + '\n';
}
