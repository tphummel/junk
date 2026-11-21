// Difficulty levels. A level is a garbage rate: grey rows rise from the bottom at the pace of a letter grade, so
// "Easy plays at D" means you must clear rows as fast as a D-rated player to hold even. Practice has none.
// The rate is rows per second and sits in the middle of the grade's band (see stats.js).

/** @typedef {{ id: string, label: string, grade: string | null, garbagePerSecond: number }} Difficulty */

/** @type {readonly Difficulty[]} */
export const DIFFICULTIES = [
  { id: "practice", label: "Practice", grade: null, garbagePerSecond: 0 },
  { id: "easy", label: "Easy", grade: "D", garbagePerSecond: 0.65 },
  { id: "medium", label: "Medium", grade: "B", garbagePerSecond: 0.85 },
  { id: "hard", label: "Hard", grade: "S", garbagePerSecond: 1.1 },
];

/** @param {string} id @returns {Difficulty} the level with that id, or Practice */
export function difficultyById(id) {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[0];
}
