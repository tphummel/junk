// Seeded 7-bag. The PRNG and the shuffle are pinned (mulberry32 + Fisher-Yates) so a seed produces the
// same piece sequence in every browser and in Node; replays and server validation depend on that.
// Never use Math.random or Date in game/.
import { PIECE_TYPES } from "./pieces.js";

/** @typedef {import("./pieces.js").PieceType} PieceType */

/**
 * mulberry32: a small 32-bit PRNG. Returns a function giving floats in [0, 1).
 * @param {number} seed any integer; it is reduced to an unsigned 32-bit value
 * @returns {() => number}
 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A bag that hands out every piece type once, in shuffled order, then reshuffles.
 * @param {number} seed
 * @returns {{ take(): PieceType }}
 */
export function createBag(seed) {
  const rng = makeRng(seed);
  /** @type {PieceType[]} */
  let bag = [];
  return {
    take() {
      if (bag.length === 0) {
        bag = [...PIECE_TYPES];
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [bag[i], bag[j]] = [bag[j], bag[i]];
        }
      }
      return /** @type {PieceType} */ (bag.pop());
    },
  };
}
