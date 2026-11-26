// The computer players. They aim at whichever hands on the card are closest and play simply:
// keep tiles those hands use, discard the rest, call only when it clearly helps, and never gamble on a hand they
// have locked themselves out of. No reading of opponents' discards or exposures.

import { VARIANTS } from "./card.js";
import { bestNeed, deficiency, winningVariant } from "./match.js";

/** @typedef {import("./tiles.js").Tile} Tile */
/** @typedef {import("./match.js").Exposure} Exposure */

/** @param {Tile[]} rack */
const codes = (rack) => rack.map((t) => t.t);

/** @param {Tile[]} rack @param {Exposure[]} exposed @param {() => number} rng the tile the bot throws away */
export function chooseDiscard(rack, exposed, rng = Math.random) {
  /** @type {{ tile: Tile, need: number, ties: number, r: number } | null} */
  let pick = null;
  const seen = new Set();
  for (const tile of rack) {
    if (tile.t === "J" || seen.has(tile.t)) continue;
    seen.add(tile.t);
    const rest = codes(rack);
    rest.splice(rest.indexOf(tile.t), 1);
    const { need, ties } = bestNeed(rest, exposed);
    const cand = { tile, need, ties, r: rng() };
    if (!pick || cand.need < pick.need || (cand.need === pick.need && (cand.ties > pick.ties || (cand.ties === pick.ties && cand.r > pick.r)))) {
      pick = cand;
    }
  }
  // Only jokers left (extremely rare): throw one rather than stall.
  return pick ? pick.tile : rack[0];
}

/** Three tiles to pass in the Charleston: the ones the closest hands use least. @param {Tile[]} rack @param {() => number} rng */
export function charlestonPick(rack, rng = Math.random) {
  const rc = codes(rack);
  const { need } = bestNeed(rc);
  const close = VARIANTS.filter((v) => deficiency(v, rc) <= need + 3);
  const value = (/** @type {string} */ t) => close.filter((v) => v.groups.some((g) => g.tile === t)).length;
  return rack
    .filter((t) => t.t !== "J")
    .map((t) => ({ t, v: value(t.t) + rng() * 0.5 }))
    .sort((a, b) => a.v - b.v)
    .slice(0, 3)
    .map((x) => x.t);
}

/** Whether a bot wants a second Charleston: yes while its hand is far from done. @param {Tile[]} rack */
export function wantsSecondCharleston(rack) {
  return bestNeed(codes(rack)).need >= 6;
}

/**
 * Whether a bot calls a discard, and for how many tiles (3 pung, 4 kong, 5 quint).
 * @param {Tile[]} rack @param {Exposure[]} exposed @param {string} discard
 * @returns {number | null}
 */
export function wantsCall(rack, exposed, discard) {
  if (discard === "J") return null;
  const sizes = callSizes(rack, discard);
  if (!sizes.length) return null;
  const before = bestNeed(codes(rack), exposed).need;
  let bestSize = null;
  let bestAfter = before;
  for (const size of sizes) {
    const { rest, meld } = takeForCall(rack, discard, size);
    const after = bestNeed(rest, [...exposed, meld]).need;
    // After a call the bot still holds one tile too many to discard, so a perfect call lands one below.
    if (after < bestAfter) {
      bestAfter = after;
      bestSize = size;
    }
  }
  return bestSize;
}

/** Sizes of set a rack can make with a called discard. @param {Tile[]} rack @param {string} discard */
export function callSizes(rack, discard) {
  if (discard === "J") return [];
  const real = rack.filter((t) => t.t === discard).length;
  const jokers = rack.filter((t) => t.t === "J").length;
  const sizes = [];
  for (let size = 3; size <= 5; size++) {
    const useReal = Math.min(real, size - 1);
    if (useReal >= 1 && size - 1 - useReal <= jokers) sizes.push(size);
  }
  return sizes;
}

/**
 * Split a rack into what stays and the set made with a called discard (real tiles first, then jokers).
 * @param {Tile[]} rack @param {string} discard @param {number} size
 */
export function takeForCall(rack, discard, size) {
  const real = Math.min(rack.filter((t) => t.t === discard).length, size - 1);
  const need = size - 1 - real;
  const rest = codes(rack);
  for (let i = 0; i < real; i++) rest.splice(rest.indexOf(discard), 1);
  for (let i = 0; i < need; i++) rest.splice(rest.indexOf("J"), 1);
  return { rest, meld: { tile: discard, size }, realCount: real, jokerCount: need };
}

/** Whether a bot's rack plus a discard (or a draw) wins. @param {Tile[]} rack @param {Exposure[]} exposed @param {string} [extra] */
export function canWin(rack, exposed, extra) {
  const c = codes(rack);
  if (extra) c.push(extra);
  return !!winningVariant(c, exposed);
}
