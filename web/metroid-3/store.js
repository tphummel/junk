// Metroid 3: durable browser storage.
//
// Games live in IndexedDB (one record per game) and the page asks the browser for persistent
// storage so it is not evicted under disk pressure. If IndexedDB is unavailable (some private
// windows) it falls back to localStorage, and the UI says so via `store.kind`.

const DB_NAME = "metroid-3";
const DB_VERSION = 1;
const LS_PREFIX = "metroid-3:";

/** @typedef {import("./engine.js").Game} Game */

/**
 * @typedef {{
 *   kind: "indexeddb" | "localstorage" | "memory",
 *   all(): Promise<Game[]>,
 *   put(game: Game): Promise<void>,
 *   remove(id: string): Promise<void>,
 *   getMeta(key: string): Promise<any>,
 *   setMeta(key: string, value: any): Promise<void>,
 * }} Store
 */

/** @template T @param {IDBRequest<T>} req @returns {Promise<T>} */
const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** @returns {Promise<Store>} */
async function openIndexedDb() {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("games", { keyPath: "id" });
      req.result.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
  const os = (name, mode) => db.transaction(name, mode).objectStore(name);
  return {
    kind: "indexeddb",
    all: () => wrap(os("games", "readonly").getAll()),
    put: async (game) => void (await wrap(os("games", "readwrite").put(game))),
    remove: async (id) => void (await wrap(os("games", "readwrite").delete(id))),
    getMeta: (key) => wrap(os("meta", "readonly").get(key)),
    setMeta: async (key, value) => void (await wrap(os("meta", "readwrite").put(value, key))),
  };
}

/** @returns {Store} */
function openLocalStorage() {
  const read = (k, fallback) => {
    try {
      const v = localStorage.getItem(LS_PREFIX + k);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  };
  const write = (k, v) => localStorage.setItem(LS_PREFIX + k, JSON.stringify(v));
  localStorage.setItem(LS_PREFIX + "probe", "1");
  localStorage.removeItem(LS_PREFIX + "probe");
  return {
    kind: "localstorage",
    all: async () => read("games", []),
    put: async (game) => {
      const games = read("games", []).filter((g) => g.id !== game.id);
      games.push(game);
      write("games", games);
    },
    remove: async (id) => write("games", read("games", []).filter((g) => g.id !== id)),
    getMeta: async (k) => read("meta:" + k, undefined),
    setMeta: async (k, v) => write("meta:" + k, v),
  };
}

/** @returns {Store} */
function openMemory() {
  /** @type {Map<string, Game>} */
  const games = new Map();
  const meta = new Map();
  return {
    kind: "memory",
    all: async () => [...games.values()],
    put: async (g) => void games.set(g.id, g),
    remove: async (id) => void games.delete(id),
    getMeta: async (k) => meta.get(k),
    setMeta: async (k, v) => void meta.set(k, v),
  };
}

/** @returns {Promise<Store>} */
export async function openStore() {
  try {
    return await openIndexedDb();
  } catch {
    try {
      return openLocalStorage();
    } catch {
      return openMemory();
    }
  }
}

/**
 * Ask the browser not to evict this origin's storage.
 * @returns {Promise<"persisted" | "denied" | "unsupported">}
 */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return "unsupported";
    if (await navigator.storage.persisted()) return "persisted";
    return (await navigator.storage.persist()) ? "persisted" : "denied";
  } catch {
    return "unsupported";
  }
}
