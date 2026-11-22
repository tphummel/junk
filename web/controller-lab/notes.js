// Your own notes, kept on this device. Storage can be missing, blocked (private windows) or full, so every access is
// guarded and a failure just means the notes are not saved. The storage object is passed in, which keeps this testable.

export const NOTES_KEY = "controller-lab-notes";
/** The most text kept, so a runaway paste cannot fill storage. */
export const MAX_NOTES_LENGTH = 100_000;

/** @typedef {Pick<Storage, "getItem" | "setItem">} StorageLike */

/** @param {StorageLike | null} storage @returns {string} the saved notes, or "" if none or unreadable */
export function loadNotes(storage) {
  try {
    const v = storage?.getItem(NOTES_KEY);
    return typeof v === "string" ? v.slice(0, MAX_NOTES_LENGTH) : "";
  } catch {
    return "";
  }
}

/**
 * Save the notes. Returns false if they could not be saved; the page keeps what was typed either way.
 * @param {StorageLike | null} storage
 * @param {string} text
 */
export function saveNotes(storage, text) {
  if (!storage) return false;
  try {
    storage.setItem(NOTES_KEY, String(text).slice(0, MAX_NOTES_LENGTH));
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
