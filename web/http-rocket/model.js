// Pure logic for HTTP Rocket: data model, import/export, variable interpolation, request building.
// No DOM and no storage here, so it runs under `npm test` (api/http-rocket.test.mjs).

/**
 * @typedef {{ key: string, value: string, enabled: boolean }} Pair
 * @typedef {{ type: "none" | "basic" | "bearer", username: string, password: string, token: string }} Auth
 * @typedef {{ type: "none" | "json" | "text", text: string }} Body
 * @typedef {{ id: string, name: string, variables: Pair[] }} Folder
 * @typedef {{ id: string, folderId: string | null, name: string, method: string, url: string,
 *   params: Pair[], headers: Pair[], auth: Auth, body: Body }} RequestConfig
 * @typedef {{ folders: Folder[], requests: RequestConfig[] }} Config
 */

export const FORMAT = "http-rocket";
export const VERSION = 1;
export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
export const AUDIT_LIMIT = 1000;

/** @returns {string} */
export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** @returns {Pair} */
export const newPair = () => ({ key: "", value: "", enabled: true });

/** @param {string} [name] @returns {Folder} */
export function newFolder(name = "New folder") {
  return { id: uid(), name, variables: [] };
}

/** @param {string | null} [folderId] @returns {RequestConfig} */
export function newRequest(folderId = null) {
  return {
    id: uid(),
    folderId,
    name: "New request",
    method: "GET",
    url: "",
    params: [],
    headers: [],
    auth: { type: "none", username: "", password: "", token: "" },
    body: { type: "none", text: "" },
  };
}

/** @returns {Config} */
export const emptyConfig = () => ({ folders: [], requests: [] });

const str = (v, fallback = "") => (typeof v === "string" ? v : fallback);

/** @param {unknown} v @returns {Pair[]} */
function pairs(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter((p) => p && typeof p === "object")
    .map((p) => ({ key: str(p.key), value: str(p.value), enabled: p.enabled !== false }));
}

/**
 * Coerce untrusted JSON (from storage or an import file) into a valid Config.
 * Unknown fields are dropped; a request pointing at a missing folder moves to the top level.
 * @param {unknown} raw
 * @returns {Config}
 */
export function sanitizeConfig(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.folders) || !Array.isArray(raw.requests)) {
    throw new Error("Not an HTTP Rocket config: expected folders and requests arrays.");
  }
  const seen = new Set();
  const unique = (id) => {
    let out = typeof id === "string" && id && !seen.has(id) ? id : uid();
    seen.add(out);
    return out;
  };
  /** @type {Folder[]} */
  const folders = raw.folders
    .filter((f) => f && typeof f === "object")
    .map((f) => ({ id: unique(f.id), name: str(f.name, "Folder") || "Folder", variables: pairs(f.variables) }));
  const folderIds = new Set(folders.map((f) => f.id));
  /** @type {RequestConfig[]} */
  const requests = raw.requests
    .filter((r) => r && typeof r === "object")
    .map((r) => {
      const method = str(r.method, "GET").toUpperCase();
      const auth = r.auth && typeof r.auth === "object" ? r.auth : {};
      const body = r.body && typeof r.body === "object" ? r.body : {};
      return {
        id: unique(r.id),
        folderId: typeof r.folderId === "string" && folderIds.has(r.folderId) ? r.folderId : null,
        name: str(r.name, "Request") || "Request",
        method: METHODS.includes(method) ? method : "GET",
        url: str(r.url),
        params: pairs(r.params),
        headers: pairs(r.headers),
        auth: {
          type: ["basic", "bearer"].includes(auth.type) ? auth.type : "none",
          username: str(auth.username),
          password: str(auth.password),
          token: str(auth.token),
        },
        body: { type: ["json", "text"].includes(body.type) ? body.type : "none", text: str(body.text) },
      };
    });
  return { folders, requests };
}

/** The export document. Plain JSON, safe to commit or share (note: it contains any auth values you saved). */
export function exportConfig(/** @type {Config} */ config, now = new Date()) {
  return { format: FORMAT, version: VERSION, exportedAt: now.toISOString(), folders: config.folders, requests: config.requests };
}

/**
 * Parse an import file's text. Throws a readable Error for bad input.
 * @param {string} text
 * @returns {Config}
 */
export function parseImport(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON.");
  }
  if (raw && raw.format !== undefined && raw.format !== FORMAT) throw new Error(`Unknown format "${raw.format}".`);
  if (raw && typeof raw.version === "number" && raw.version > VERSION) {
    throw new Error(`Config version ${raw.version} is newer than this app understands (${VERSION}).`);
  }
  return sanitizeConfig(raw);
}

/**
 * Add imported folders and requests to the current config under fresh ids, so nothing is overwritten.
 * @param {Config} current
 * @param {Config} incoming
 * @returns {Config}
 */
export function mergeConfig(current, incoming) {
  const folderMap = new Map(incoming.folders.map((f) => [f.id, uid()]));
  const folders = incoming.folders.map((f) => ({ ...clone(f), id: folderMap.get(f.id) }));
  const requests = incoming.requests.map((r) => ({
    ...clone(r),
    id: uid(),
    folderId: r.folderId ? (folderMap.get(r.folderId) ?? null) : null,
  }));
  return { folders: [...current.folders, ...folders], requests: [...current.requests, ...requests] };
}

/** @template T @param {T} v @returns {T} */
export const clone = (v) => JSON.parse(JSON.stringify(v));

/** Copy a request (same folder, " copy" suffix, new id). @param {RequestConfig} r @returns {RequestConfig} */
export function duplicateRequest(r) {
  return { ...clone(r), id: uid(), name: `${r.name} copy` };
}

/** Remove a folder. Its requests are deleted too unless `keepRequests`, which moves them to the top level. */
export function deleteFolder(/** @type {Config} */ config, /** @type {string} */ id, keepRequests = false) {
  return {
    folders: config.folders.filter((f) => f.id !== id),
    requests: keepRequests
      ? config.requests.map((r) => (r.folderId === id ? { ...r, folderId: null } : r))
      : config.requests.filter((r) => r.folderId !== id),
  };
}

/** Enabled variables of a folder as a lookup. Later duplicates win. @param {Folder | undefined} folder */
export function variablesOf(folder) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const v of folder?.variables ?? []) if (v.enabled && v.key.trim()) out[v.key.trim()] = v.value;
  return out;
}

/**
 * Replace {{name}} with values from `vars`. Unknown names are left as written and listed in `missing`.
 * @param {string} text
 * @param {Record<string, string>} vars
 * @returns {{ text: string, missing: string[] }}
 */
export function interpolate(text, vars) {
  /** @type {Set<string>} */
  const missing = new Set();
  const out = text.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (whole, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
    missing.add(name);
    return whole;
  });
  return { text: out, missing: [...missing] };
}

/** @param {string} s base64 of the UTF-8 bytes */
function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Turn a saved config into what `fetch` needs. Variables, query params, auth and body are resolved here.
 * @param {RequestConfig} req
 * @param {Record<string, string>} vars
 * @returns {{ url: string, method: string, headers: [string, string][], body: string | undefined, missing: string[] }}
 */
export function buildRequest(req, vars) {
  /** @type {Set<string>} */
  const missing = new Set();
  const sub = (s) => {
    const r = interpolate(s, vars);
    r.missing.forEach((m) => missing.add(m));
    return r.text;
  };

  let url = sub(req.url.trim());
  const query = req.params
    .filter((p) => p.enabled && p.key.trim())
    .map((p) => `${encodeURIComponent(sub(p.key))}=${encodeURIComponent(sub(p.value))}`)
    .join("&");
  if (query) {
    const hashAt = url.indexOf("#");
    const hash = hashAt >= 0 ? url.slice(hashAt) : "";
    let base = hashAt >= 0 ? url.slice(0, hashAt) : url;
    base += base.includes("?") ? (/[?&]$/.test(base) ? "" : "&") : "?";
    url = base + query + hash;
  }

  /** @type {[string, string][]} */
  const headers = req.headers.filter((h) => h.enabled && h.key.trim()).map((h) => [sub(h.key.trim()), sub(h.value)]);
  const has = (name) => headers.some(([k]) => k.toLowerCase() === name);

  if (!has("authorization")) {
    if (req.auth.type === "bearer" && req.auth.token) headers.push(["Authorization", `Bearer ${sub(req.auth.token)}`]);
    if (req.auth.type === "basic") {
      headers.push(["Authorization", `Basic ${b64(`${sub(req.auth.username)}:${sub(req.auth.password)}`)}`]);
    }
  }

  let body;
  if (req.body.type !== "none" && !["GET", "HEAD"].includes(req.method)) {
    body = sub(req.body.text);
    if (!has("content-type")) headers.push(["Content-Type", req.body.type === "json" ? "application/json" : "text/plain"]);
  }

  return { url, method: req.method, headers, body, missing: [...missing] };
}

/** Header names whose values never go into the audit log. */
const SECRET_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "x-api-key"]);

/** @param {[string, string][]} headers @returns {[string, string][]} */
export function redactHeaders(headers) {
  return headers.map(([k, v]) => [k, SECRET_HEADERS.has(k.toLowerCase()) ? "[redacted]" : v]);
}

/** Pretty-print JSON text when it parses; otherwise return it unchanged. */
export function prettyBody(/** @type {string} */ text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Cut text to `max` characters, noting how many were dropped. */
export function truncate(/** @type {string} */ text, max) {
  return text.length <= max ? text : `${text.slice(0, max)}\n… [${text.length - max} more characters not stored]`;
}

/** Newest first, capped. @template T @param {T[]} log @param {T} entry @returns {T[]} */
export function pushAudit(log, entry, limit = AUDIT_LIMIT) {
  return [entry, ...log].slice(0, limit);
}

/** Human-readable byte count. */
export function formatBytes(/** @type {number} */ n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
