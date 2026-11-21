// Game time, the scoring rate and the letter grade for it. What the rating table calls "lines" is the game's score
// (a cleared line is 1 point, plus the square bonuses), so the rate is score per second, shown as lines per second;
// the number of rows actually cleared is "lines raw". Time is counted in game ticks (60 per second), so it does not
// run while paused, and a replay of the same inputs reports the same numbers.

import { TICKS_PER_SECOND } from "./rules.js";

/**
 * Letter grades by lines per second: the first row whose bound the rate is under wins; 2 and above is "XS".
 * @type {readonly (readonly [number, string])[]}
 */
const GRADES = [
  [0.6, "F"], [0.63, "D-"], [0.67, "D"], [0.7, "D+"],
  [0.73, "C-"], [0.77, "C"], [0.8, "C+"],
  [0.83, "B-"], [0.87, "B"], [0.9, "B+"],
  [0.93, "A-"], [0.97, "A"], [1.0, "A+"],
  [1.05, "1S-"], [1.15, "1S"], [1.2, "1S+"],
  [1.25, "2S-"], [1.35, "2S"], [1.4, "2S+"],
  [1.45, "3S-"], [1.55, "3S"], [1.6, "3S+"],
  [1.65, "4S-"], [1.75, "4S"], [1.8, "4S+"],
  [1.85, "5S-"], [1.95, "5S"], [2, "5S+"],
];

/** Score ("lines") per second of game time; 0 before any time has passed. @param {number} seconds @param {number} score */
export function lineRate(seconds, score) {
  return seconds > 0 ? score / seconds : 0;
}

/**
 * The letter grade for scoring `score` in `seconds` seconds.
 * @param {number} seconds
 * @param {number} score
 * @returns {string} "F" up to "5S+", then "XS"; "NA" if the rate is not a number
 */
export function gradePerf(seconds, score) {
  const rate = lineRate(seconds, score);
  for (const [bound, grade] of GRADES) if (rate < bound) return grade;
  return rate >= 2 ? "XS" : "NA";
}

/** @param {number} ticks game ticks */
export function gameSeconds(ticks) {
  return ticks / TICKS_PER_SECOND;
}

/** Game time as m:ss.t (tenths). @param {number} ticks game ticks */
export function formatTime(ticks) {
  const tenths = Math.floor((ticks * 10) / TICKS_PER_SECOND);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${tenths % 10}`;
}

/**
 * What the HUD and the game-over card show: game time, score per second, and the grade (a dash until something
 * has scored, since a rate of 0 says nothing yet).
 * @param {number} ticks game ticks so far
 * @param {number} score
 * @returns {{ time: string, rate: string, grade: string, natural: boolean }}
 */
export function summarize(ticks, score) {
  const seconds = gameSeconds(ticks);
  return {
    time: formatTime(ticks),
    rate: lineRate(seconds, score).toFixed(2),
    grade: score > 0 ? gradePerf(seconds, score) : "-",
    natural: isNatural(ticks, score),
  };
}

/**
 * The time as a number made by running minutes and seconds together without the colon: 0:30 is 30, 1:12 is 112,
 * 2:05 is 205. Whole seconds only.
 * @param {number} ticks game ticks
 */
export function naturalNumber(ticks) {
  const total = Math.floor(ticks / TICKS_PER_SECOND);
  return Math.floor(total / 60) * 100 + (total % 60);
}

/**
 * A "natural": the score ("lines") is greater than the time with its colon removed. 40 in 0:30, 70 in 0:59,
 * 120 in 1:12 and 220 in 2:05 are naturals. Nothing is natural before something has scored.
 * @param {number} ticks game ticks
 * @param {number} score
 */
export function isNatural(ticks, score) {
  return score > 0 && score > naturalNumber(ticks);
}
