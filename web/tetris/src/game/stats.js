// Game time, lines per second and the letter grade for it. Time is counted in game ticks (60 per second), so it
// does not run while paused, and a replay of the same inputs reports the same numbers.

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

/** Lines cleared per second of game time; 0 before any time has passed. @param {number} seconds @param {number} lines */
export function lineRate(seconds, lines) {
  return seconds > 0 ? lines / seconds : 0;
}

/**
 * The letter grade for clearing `lines` lines in `seconds` seconds.
 * @param {number} seconds
 * @param {number} lines
 * @returns {string} "F" up to "5S+", then "XS"; "NA" if the rate is not a number
 */
export function gradePerf(seconds, lines) {
  const rate = lineRate(seconds, lines);
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
