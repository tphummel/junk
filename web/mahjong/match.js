// Matching a player's tiles against the card. Tiles are plain codes (see tiles.js); an exposure is
// { tile, size }: the real tile its set is made of, and how many tiles are in it (jokers included).

import { VARIANTS } from "./card.js";

/** @typedef {{ tile: string, size: number }} Exposure */
/** @typedef {import("./card.js").Variant} Variant */

/**
 * How many more tiles a concrete hand still needs, counting only the player's concealed tiles
 * (`rack`) against the groups that are not already exposed. Jokers fill any group of 3 or more
 * but never a single or a pair. Infinity when the exposures cannot belong to this hand.
 * @param {Variant} variant @param {string[]} rack @param {Exposure[]} exposed
 */
export function deficiency(variant, rack, exposed = []) {
  if (exposed.length && variant.hand.concealed) return Infinity;
  const open = [...variant.groups];
  for (const m of exposed) {
    const i = open.findIndex((g) => g.tile === m.tile && g.count === m.size);
    if (i < 0) return Infinity;
    open.splice(i, 1);
  }
  /** @type {Record<string, number>} */
  const have = {};
  let jokers = 0;
  for (const t of rack) {
    if (t === "J") jokers++;
    else have[t] = (have[t] || 0) + 1;
  }
  let hard = 0;
  let soft = 0;
  for (const g of open) {
    const short = Math.max(0, g.count - (have[g.tile] || 0));
    if (g.count >= 3) soft += short;
    else hard += short;
  }
  return hard + Math.max(0, soft - jokers);
}

/** Tiles still needed for the whole hand, to compare with `rack.length`. @param {Variant} variant @param {Exposure[]} exposed */
export function openSlots(variant, exposed = []) {
  return variant.groups.reduce((n, g) => n + g.count, 0) - exposed.reduce((n, m) => n + m.size, 0);
}

/**
 * The best card hand these tiles make, or null. Needs exactly 14 tiles in all.
 * @param {string[]} rack @param {Exposure[]} exposed @returns {Variant | null}
 */
export function winningVariant(rack, exposed = []) {
  if (rack.length + exposed.reduce((n, m) => n + m.size, 0) !== 14) return null;
  /** @type {Variant | null} */
  let best = null;
  for (const v of VARIANTS) {
    if (deficiency(v, rack, exposed) === 0 && (!best || v.hand.value > best.hand.value)) best = v;
  }
  return best;
}

/**
 * The closest hands for a rack, one entry per card hand, nearest first.
 * @param {string[]} rack concealed tiles @param {Exposure[]} exposed
 * @returns {{ hand: import("./card.js").Hand, need: number, variant: Variant }[]}
 */
export function closestHands(rack, exposed = []) {
  /** @type {Map<string, { hand: import("./card.js").Hand, need: number, variant: Variant }>} */
  const best = new Map();
  for (const v of VARIANTS) {
    const need = deficiency(v, rack, exposed);
    if (need === Infinity) continue;
    const cur = best.get(v.hand.id);
    if (!cur || need < cur.need) best.set(v.hand.id, { hand: v.hand, need, variant: v });
  }
  return [...best.values()].sort((a, b) => a.need - b.need || b.hand.value - a.hand.value);
}

/** Lowest `deficiency` over every hand, and how many hands tie for it. @param {string[]} rack @param {Exposure[]} exposed */
export function bestNeed(rack, exposed = []) {
  let need = Infinity;
  let ties = 0;
  for (const v of VARIANTS) {
    const d = deficiency(v, rack, exposed);
    if (d < need) {
      need = d;
      ties = 1;
    } else if (d === need) ties++;
  }
  return { need, ties };
}
