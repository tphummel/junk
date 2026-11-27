// Tiles for American mahjong: 152 in all. Tile codes are short strings:
//   B1-B9 bams, C1-C9 craks, O1-O9 dots, N E W S winds, DR DG DW dragons (red, green, white),
//   F flowers, J jokers. A physical tile is { id, t } so identical tiles stay distinguishable.

/** @typedef {{ id: number, t: string }} Tile */

export const SUITS = ["B", "C", "O"];
/** @type {Record<string, string>} */
export const SUIT_NAMES = { B: "Bam", C: "Crak", O: "Dot" };
/** @type {Record<string, string>} */
export const WIND_NAMES = { N: "North", E: "East", W: "West", S: "South" };
/** @type {Record<string, string>} */
export const DRAGON_NAMES = { DR: "Red", DG: "Green", DW: "White" };

/** Fisher-Yates shuffle in place. @template T @param {T[]} a @param {() => number} rng @returns {T[]} */
export function shuffle(a, rng = Math.random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A shuffled wall of all 152 tiles. @param {() => number} rng @returns {Tile[]} */
export function buildWall(rng = Math.random) {
  /** @type {string[]} */
  const codes = [];
  for (const s of SUITS) for (let n = 1; n <= 9; n++) for (let i = 0; i < 4; i++) codes.push(s + n);
  for (const w of ["N", "E", "W", "S"]) for (let i = 0; i < 4; i++) codes.push(w);
  for (const d of ["DR", "DG", "DW"]) for (let i = 0; i < 4; i++) codes.push(d);
  for (let i = 0; i < 8; i++) codes.push("F", "J");
  return shuffle(codes.map((t, id) => ({ id, t })), rng);
}

const ORDER = [..."BCO"].flatMap((s) => Array.from({ length: 9 }, (_, i) => s + (i + 1))).concat(
  ["N", "E", "W", "S", "DR", "DG", "DW", "F", "J"],
);

/** Sort position of a tile code (suits, then honors, flowers, jokers). @param {string} t */
export function sortKey(t) {
  return ORDER.indexOf(t);
}

/** @param {Tile[]} tiles @returns {Tile[]} a sorted copy */
export function sortTiles(tiles) {
  return [...tiles].sort((a, b) => sortKey(a.t) - sortKey(b.t) || a.id - b.id);
}

/** Human-readable name, e.g. "3 Bam", "Red dragon". @param {string} t */
export function tileName(t) {
  if (t === "F") return "flower";
  if (t === "J") return "joker";
  if (WIND_NAMES[t]) return `${WIND_NAMES[t]} wind`;
  if (DRAGON_NAMES[t]) return `${DRAGON_NAMES[t]} dragon`;
  return `${t[1]} ${SUIT_NAMES[t[0]]}`;
}
