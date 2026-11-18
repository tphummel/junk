// Browser persistence for HTTP Rocket. localStorage can throw (private windows, blocked site data, quota),
// so every access is wrapped and the app keeps working in memory when it fails.
import { emptyConfig, sanitizeConfig } from "./model.js";

const CONFIG_KEY = "http-rocket:config:v1";
const AUDIT_KEY = "http-rocket:audit:v1";
const SELECTION_KEY = "http-rocket:selection:v1";

/** @returns {import("./model.js").Config} */
export function loadConfig() {
  try {
    const text = localStorage.getItem(CONFIG_KEY);
    if (text) return sanitizeConfig(JSON.parse(text));
  } catch {
    /* fall through to an empty config */
  }
  return emptyConfig();
}

/** @returns {boolean} whether the write succeeded */
export function saveConfig(/** @type {import("./model.js").Config} */ config) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

/** @returns {any[]} */
export function loadAudit() {
  try {
    const v = JSON.parse(localStorage.getItem(AUDIT_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Save the audit log; on quota errors drop the oldest tenth and retry.
 * @param {any[]} log newest first
 * @returns {any[]} what was actually kept
 */
export function saveAudit(log) {
  let kept = log;
  for (let i = 0; i < 20; i++) {
    try {
      localStorage.setItem(AUDIT_KEY, JSON.stringify(kept));
      return kept;
    } catch {
      if (!kept.length) return kept;
      kept = kept.slice(0, Math.floor(kept.length * 0.9));
    }
  }
  return kept;
}

/** @returns {{ id: string } | null} */
export function loadSelection() {
  try {
    const v = JSON.parse(localStorage.getItem(SELECTION_KEY) || "null");
    return v && typeof v.id === "string" ? v : null;
  } catch {
    return null;
  }
}

export function saveSelection(/** @type {{ id: string } | null} */ sel) {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(sel));
  } catch {
    /* ignore */
  }
}
