// Small yes/no preferences kept on the device. Storage can be missing, blocked or full, so every access is guarded: a
// failure just means the choice is not remembered. The storage object is passed in, which keeps this testable.

/** @typedef {Pick<Storage, "getItem" | "setItem">} StorageLike */

export const LETTERS_KEY = "tetris-piece-letters";

/** @param {StorageLike | null} storage @param {string} key @param {boolean} [fallback] @returns {boolean} */
export function loadFlag(storage, key, fallback = false) {
  try {
    const v = storage?.getItem(key);
    return v === "1" ? true : v === "0" ? false : fallback;
  } catch {
    return fallback;
  }
}

/** @param {StorageLike | null} storage @param {string} key @param {boolean} on @returns {boolean} whether it was saved */
export function saveFlag(storage, key, on) {
  if (!storage) return false;
  try {
    storage.setItem(key, on ? "1" : "0");
    return true;
  } catch {
    return false;
  }
}

/** localStorage if the browser lets us touch it, else null (reading the property itself can throw). @returns {StorageLike | null} */
export function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
