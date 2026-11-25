// Import floss and mouthwash events from a Nomie 5 data export (one JSON file holding every tracker, mixed together).
// Pure, so the API test suite can import it.

import { normalizePlace } from "./logic.js";

/** Nomie tracker tag to the toothup event type it becomes. */
const TAGS = { floss_teeth: "floss", mouthwash: "mouthwash" };
const ID_PREFIX = { floss: "f", mouthwash: "m" };

/**
 * Parse a Nomie export's text. Each Nomie event's note holds its tags, like "#floss_teeth", "#mouthwash(1)" or
 * "#floss_and_mouthwash #floss_teeth(1) #mouthwash(1)". A tag with a value of 0 means it was not done and is skipped;
 * any other tags are ignored. Ids come from the type and start time, the same as makeEvent, so importing twice adds nothing.
 * @param {string} text @returns {{ events: import("./logic.js").Event[], skipped: number }}
 */
export function parseNomie(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Not valid JSON");
  }
  if (!data?.nomie || !Array.isArray(data.events)) throw new Error("Not a Nomie export");
  const found = new Map();
  let skipped = 0;
  for (const e of data.events) {
    const note = typeof e?.note === "string" ? e.note : "";
    for (const [, tag, value] of note.matchAll(/#(\w+?)(?:\((-?[\d.]+)\))?(?![\w(])/g)) {
      const type = TAGS[tag];
      if (!type || Number(value ?? 1) === 0) continue;
      const start = Math.round(Number(e.start));
      const nomieOffset = Number(e.offset);
      // Nomie stores the offset like Date.getTimezoneOffset (minutes west of UTC), so Pacific Daylight is 420. Toothup's is east positive.
      if (!(start > 0) || !Number.isFinite(nomieOffset) || Math.abs(nomieOffset) > 14 * 60) {
        skipped++;
        continue;
      }
      const id = `${ID_PREFIX[type]}${start}`;
      // Nomie records lat and lng (null when unknown) but no accuracy.
      found.set(id, { id, type, start, offset: -nomieOffset, ...normalizePlace({ lat: e.lat, lon: e.lng }) });
    }
  }
  return { events: [...found.values()], skipped };
}
