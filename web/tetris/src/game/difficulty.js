// Play modes. All are practice (no garbage): unlimited, or a time limit after which the round ends when the piece in
// play is set. The game engine still supports a garbage rate (garbagePerSecond), but no mode uses it for now.
// Mode ids are stored with saved scores, so an id is never reused for something else.

/** @typedef {{ id: string, label: string, grade: string | null, garbagePerSecond: number, timeLimitSeconds?: number }} Difficulty */
// timeLimitSeconds: the round is over once the piece in play when that much game time has passed is set.

/** @type {readonly Difficulty[]} */
export const DIFFICULTIES = [
  { id: "practice", label: "Practice", grade: null, garbagePerSecond: 0 },
  { id: "practice-3", label: "Practice 3:00", grade: null, garbagePerSecond: 0, timeLimitSeconds: 180 },
  { id: "practice-5", label: "Practice 5:00", grade: null, garbagePerSecond: 0, timeLimitSeconds: 300 },
];

/** @param {string} id @returns {Difficulty} the mode with that id, or Practice */
export function difficultyById(id) {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[0];
}
