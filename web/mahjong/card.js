// The card: an original set of hands in the style of the National Mah Jongg League card (the real card is
// copyrighted and changes every year, so this is NOT the NMJL card). Each hand is 14 tiles made of groups.
// Groups of 3 or more may use jokers; singles and pairs may not. "Concealed" hands allow no exposures.
//
// Pattern syntax, one group per word: <tile>*<count>
//   1a*3  the number 1 in suit slot "a" (slots a, b and c are always three different suits when different)
//   N E W S  winds, DR DG DW dragons, D? any one dragon, F flowers
//   shift: "run" slides all numbers up (1234 -> 2345 ...), "even" moves them in steps of 2, "none" fixes them.

import { SUITS } from "./tiles.js";

/** @typedef {{ id: string, cat: string, value: number, pattern: string, shift: "run" | "even" | "none", concealed?: boolean }} Hand */
/** @typedef {{ tile: string, count: number }} Group */
/** @typedef {{ hand: Hand, groups: Group[], key: string }} Variant */

/** @type {Hand[]} */
export const HANDS = [
  // Runs
  { id: "run1", cat: "Runs", value: 25, shift: "run", pattern: "F*2 1a*3 2a*3 3a*3 4a*3" },
  { id: "run2", cat: "Runs", value: 25, shift: "run", pattern: "1a*2 2a*3 3a*4 4a*3 5a*2" },
  { id: "run3", cat: "Runs", value: 25, shift: "run", pattern: "F*2 1a*3 2b*3 3a*3 4b*3" },
  // Evens and odds
  { id: "even1", cat: "Evens and odds", value: 25, shift: "even", pattern: "F*2 2a*4 4a*4 6a*4" },
  { id: "even2", cat: "Evens and odds", value: 25, shift: "none", pattern: "F*2 2a*3 4a*3 6b*3 8b*3" },
  { id: "even3", cat: "Evens and odds", value: 25, shift: "none", pattern: "F*2 2a*2 4a*3 6a*4 8a*3" },
  { id: "odd1", cat: "Evens and odds", value: 25, shift: "even", pattern: "F*2 1a*3 3a*3 5a*3 7a*3" },
  { id: "odd2", cat: "Evens and odds", value: 30, shift: "even", pattern: "1a*4 3b*3 5a*4 7b*3" },
  // Like numbers
  { id: "like1", cat: "Like numbers", value: 30, shift: "run", pattern: "F*2 1a*4 1b*4 1c*4" },
  { id: "like2", cat: "Like numbers", value: 30, shift: "run", pattern: "F*2 1a*3 1b*3 2a*3 2b*3" },
  { id: "like3", cat: "Like numbers", value: 35, shift: "run", pattern: "1a*3 1b*3 1c*3 2a*3 F*2" },
  // Winds and dragons
  { id: "wd1", cat: "Winds and dragons", value: 35, shift: "none", pattern: "N*4 E*3 W*3 S*4" },
  { id: "wd2", cat: "Winds and dragons", value: 30, shift: "none", pattern: "N*3 E*3 W*3 S*3 D?*2" },
  { id: "wd3", cat: "Winds and dragons", value: 30, shift: "run", pattern: "DR*3 DG*3 DW*3 1a*3 F*2" },
  { id: "wd4", cat: "Winds and dragons", value: 30, shift: "none", pattern: "F*2 N*3 S*3 DR*3 DG*3" },
  { id: "wd5", cat: "Winds and dragons", value: 30, shift: "none", pattern: "F*2 E*3 W*3 DW*3 DG*3" },
  // Quints (five of a kind needs jokers)
  { id: "quint1", cat: "Quints", value: 40, shift: "run", pattern: "1a*5 2a*4 3a*5" },
  { id: "quint2", cat: "Quints", value: 40, shift: "even", pattern: "2a*5 4a*4 6a*5" },
  { id: "quint3", cat: "Quints", value: 45, shift: "run", pattern: "1a*5 1b*5 F*4" },
  // Threes, sixes and nines
  { id: "369a", cat: "3 6 9", value: 30, shift: "none", pattern: "F*2 3a*4 6a*4 9a*4" },
  { id: "369b", cat: "3 6 9", value: 35, shift: "none", pattern: "F*2 3a*4 6b*4 9c*4" },
  { id: "369c", cat: "3 6 9", value: 35, shift: "none", pattern: "F*2 3a*3 6a*3 9a*3 3b*3" },
  // Singles and pairs (concealed)
  { id: "sp1", cat: "Singles and pairs", value: 50, shift: "run", concealed: true, pattern: "1a*2 2a*2 3a*2 4a*2 5a*2 6a*2 7a*2" },
  { id: "sp2", cat: "Singles and pairs", value: 50, shift: "none", concealed: true, pattern: "N*2 E*2 W*2 S*2 DR*2 DG*2 DW*2" },
  { id: "sp3", cat: "Singles and pairs", value: 50, shift: "run", concealed: true, pattern: "1a*2 1b*2 1c*2 2a*2 2b*2 2c*2 F*2" },
];

/** @param {string} spec @returns {{ digit: number, slot: string } | null} */
function numberSpec(spec) {
  const m = /^([1-9])([abc])$/.exec(spec);
  return m ? { digit: Number(m[1]), slot: m[2] } : null;
}

/** All injective assignments of the given slots to suits. @param {string[]} slots @returns {Record<string, string>[]} */
function suitAssignments(slots) {
  if (!slots.length) return [{}];
  const [first, ...rest] = slots;
  return suitAssignments(rest).flatMap((r) =>
    SUITS.filter((s) => !Object.values(r).includes(s)).map((s) => ({ ...r, [first]: s })));
}

/** Concrete versions of a hand: every suit assignment, number shift and dragon choice. @param {Hand} hand @returns {Variant[]} */
export function expand(hand) {
  const words = hand.pattern.split(" ").map((w) => {
    const [spec, n] = w.split("*");
    return { spec, count: Number(n) };
  });
  const digits = words.map((w) => numberSpec(w.spec)?.digit ?? 0);
  const maxDigit = Math.max(...digits);
  const slots = [...new Set(words.map((w) => numberSpec(w.spec)?.slot).filter(Boolean))];
  /** @type {number[]} */
  const offsets = [];
  const step = hand.shift === "even" ? 2 : 1;
  if (hand.shift === "none") offsets.push(0);
  else for (let o = 0; maxDigit + o <= 9; o += step) offsets.push(o);
  const dragons = hand.pattern.includes("D?") ? ["DR", "DG", "DW"] : [null];

  /** @type {Map<string, Variant>} */
  const out = new Map();
  for (const assign of suitAssignments(/** @type {string[]} */ (slots))) {
    for (const off of offsets) {
      for (const dragon of dragons) {
        const groups = words.map((w) => {
          const ns = numberSpec(w.spec);
          const tile = ns ? assign[ns.slot] + (ns.digit + off) : w.spec === "D?" ? /** @type {string} */ (dragon) : w.spec;
          return { tile, count: w.count };
        });
        const key = `${hand.id}:${groups.map((g) => `${g.tile}*${g.count}`).sort().join(",")}`;
        out.set(key, { hand, groups, key });
      }
    }
  }
  return [...out.values()];
}

/** Every concrete hand on the card. */
export const VARIANTS = HANDS.flatMap(expand);
