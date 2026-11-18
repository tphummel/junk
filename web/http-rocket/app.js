// HTTP Rocket UI. Everything runs in the browser; requests go straight from here to the target server.
import {
  METHODS, buildRequest, deleteFolder, duplicateRequest, exportConfig, formatBytes, mergeConfig,
  newFolder, newPair, newRequest, parseImport, prettyBody, pushAudit, redactHeaders, truncate,
  uid, variablesOf,
} from "./model.js";
import { loadAudit, loadConfig, loadSelection, saveAudit, saveConfig, saveSelection } from "./storage.js";

const BODY_STORED_CHARS = 2000; // audit entries keep a body preview so 1000 of them fit in localStorage
const BODY_SHOWN_CHARS = 500000;

let config = loadConfig();
let audit = loadAudit();
/** @type {{ type: "request" | "folder", id: string } | null} */
let selection = null;
const saved = loadSelection();
if (saved && (config.requests.some((r) => r.id === saved.id) || config.folders.some((f) => f.id === saved.id))) {
  selection = { type: config.requests.some((r) => r.id === saved.id) ? "request" : "folder", id: saved.id };
}
/** @type {Set<string>} */
const collapsed = new Set();
/** Last response per request id (in memory only; the audit log has the stored preview). */
const lastResponse = new Map();
let inFlight = /** @type {AbortController | null} */ (null);
let activeTab = "params";

const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));

/** Create an element. Text goes in as text, never as HTML. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

// ---- persistence ----------------------------------------------------------------------------

let saveTimer = 0;
let dirty = false;
function setStatus(text, isError = false) {
  const el = $("#status");
  el.textContent = text;
  el.className = isError ? "error" : "muted";
}
/** Write the config now if an edit is waiting for its debounce. */
function flush() {
  clearTimeout(saveTimer);
  if (!dirty) return;
  dirty = false;
  if (saveConfig(config)) setStatus("Saved in this browser");
  else setStatus("Could not save: browser storage is unavailable or full", true);
}
function persist() {
  dirty = true;
  clearTimeout(saveTimer);
  setStatus("Saving…");
  saveTimer = setTimeout(flush, 250);
}
// A tab can close inside the debounce window, so also save when the page is hidden or unloaded.
addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
function select(sel) {
  selection = sel;
  saveSelection(sel ? { id: sel.id } : null);
}

const currentRequest = () => (selection?.type === "request" ? config.requests.find((r) => r.id === selection.id) : undefined);
const currentFolder = () => (selection?.type === "folder" ? config.folders.find((f) => f.id === selection.id) : undefined);
const folderOfRequest = (r) => config.folders.find((f) => f.id === r.folderId);

// ---- sidebar --------------------------------------------------------------------------------

function renderTree() {
  const tree = $("#tree");
  tree.replaceChildren();
  if (!config.folders.length && !config.requests.length) {
    tree.append(h("p", { class: "muted empty" }, "No requests yet. Add a request or a folder to begin, or import a config."));
    return;
  }
  const requestRow = (r) =>
    h("li", {},
      h("div", { class: `row${selection?.id === r.id ? " selected" : ""}` },
        h("button", { type: "button", class: "item", title: r.url, onclick: () => { select({ type: "request", id: r.id }); render(); } },
          h("span", { class: "method" }, r.method), r.name)));

  const ul = h("ul", { class: "tree" });
  for (const f of config.folders) {
    const open = !collapsed.has(f.id);
    const kids = config.requests.filter((r) => r.folderId === f.id);
    ul.append(h("li", {},
      h("div", { class: `row${selection?.id === f.id ? " selected" : ""}` },
        h("button", { type: "button", class: "link", "aria-expanded": String(open), "aria-label": `${open ? "Collapse" : "Expand"} ${f.name}`,
          onclick: () => { open ? collapsed.add(f.id) : collapsed.delete(f.id); renderTree(); } }, open ? "▾" : "▸"),
        h("button", { type: "button", class: "item", onclick: () => { select({ type: "folder", id: f.id }); render(); } },
          `📁 ${f.name} `, h("span", { class: "muted" }, `(${kids.length})`))),
      open ? h("ul", {}, kids.map(requestRow)) : null));
  }
  for (const r of config.requests.filter((r) => !r.folderId)) ul.append(requestRow(r));
  tree.append(ul);
}

// ---- editor ---------------------------------------------------------------------------------

/** Editable list of {key, value, enabled} rows. */
function kvEditor(list, { onChange, keyLabel = "Name", valueLabel = "Value" }) {
  const box = h("div", {});
  const draw = () => {
    box.replaceChildren();
    list.forEach((p, i) => {
      box.append(h("div", { class: "kv" },
        h("input", { type: "checkbox", checked: p.enabled, "aria-label": "Enabled", onchange: (e) => { p.enabled = e.target.checked; onChange(); } }),
        h("input", { type: "text", class: "mono", value: p.key, placeholder: keyLabel, "aria-label": `${keyLabel} ${i + 1}`, oninput: (e) => { p.key = e.target.value; onChange(); } }),
        h("input", { type: "text", class: "mono", value: p.value, placeholder: valueLabel, "aria-label": `${valueLabel} ${i + 1}`, oninput: (e) => { p.value = e.target.value; onChange(); } }),
        h("button", { type: "button", class: "link", "aria-label": `Remove ${keyLabel.toLowerCase()} ${i + 1}`, onclick: () => { list.splice(i, 1); onChange(); draw(); } }, "✕")));
    });
    box.append(h("button", { type: "button", onclick: () => { list.push(newPair()); onChange(); draw(); box.querySelector(".kv:last-of-type input[type=text]")?.focus(); } }, "+ Add"));
  };
  draw();
  return box;
}

function renderEditor() {
  const el = $("#editor");
  el.replaceChildren();
  const req = currentRequest();
  const folder = currentFolder();
  if (req) el.append(...requestEditor(req).filter(Boolean));
  else if (folder) el.append(...folderEditor(folder).filter(Boolean));
  else el.append(h("p", { class: "muted" }, "Select a request or folder, or create one."));
}

function folderEditor(f) {
  const members = config.requests.filter((r) => r.folderId === f.id).length;
  return [
    h("h2", {}, "Folder"),
    h("div", { class: "field" },
      h("label", { for: "folder-name" }, "Name"),
      h("input", { id: "folder-name", type: "text", value: f.name, oninput: (e) => { f.name = e.target.value || "Folder"; persist(); renderTree(); } })),
    h("h2", { style: "margin-top:1rem" }, "Variables"),
    h("p", { class: "muted" }, "Use ", h("code", {}, "{{name}}"), " in a request's URL, params, headers, auth or body. Every request in this folder sees these."),
    kvEditor(f.variables, { onChange: persist, keyLabel: "Variable", valueLabel: "Value" }),
    h("p", { style: "margin-top:1rem" },
      h("button", { type: "button", onclick: () => { const r = newRequest(f.id); config.requests.push(r); select({ type: "request", id: r.id }); persist(); render(); } }, "+ Request in this folder"), " ",
      h("button", { type: "button", onclick: () => {
        const keep = members && confirm(`Folder "${f.name}" has ${members} request(s). OK moves them out of the folder; Cancel deletes them with it.`);
        if (members && !keep && !confirm(`Delete "${f.name}" and its ${members} request(s)? This cannot be undone.`)) return;
        config = deleteFolder(config, f.id, Boolean(keep));
        select(null); persist(); render();
      } }, "Delete folder")),
  ];
}

function requestEditor(r) {
  const nameInput = h("input", { id: "req-name", type: "text", value: r.name, "aria-label": "Request name", oninput: (e) => { r.name = e.target.value || "Request"; persist(); renderTree(); } });
  const folderSelect = h("select", { "aria-label": "Folder", onchange: (e) => { r.folderId = e.target.value || null; persist(); render(); } },
    h("option", { value: "" }, "No folder"),
    config.folders.map((f) => h("option", { value: f.id, selected: f.id === r.folderId }, f.name)));
  const methodSelect = h("select", { "aria-label": "Method", onchange: (e) => { r.method = e.target.value; persist(); renderTree(); } },
    METHODS.map((m) => h("option", { value: m, selected: m === r.method }, m)));
  const urlInput = h("input", { type: "text", class: "url mono", value: r.url, placeholder: "https://api.example.com/path or {{baseUrl}}/path", "aria-label": "URL",
    oninput: (e) => { r.url = e.target.value; persist(); updatePreview(); }, onkeydown: (e) => { if (e.key === "Enter") send(r); } });
  const sendBtn = h("button", { type: "button", class: "primary", id: "send", onclick: () => send(r) }, "Send");
  const preview = h("p", { class: "muted mono", style: "word-break:break-all;margin:0" });

  const vars = () => variablesOf(folderOfRequest(r));
  function updatePreview() {
    const built = buildRequest(r, vars());
    preview.textContent = built.url ? `→ ${built.method} ${built.url}` : "";
    preview.classList.toggle("error", built.missing.length > 0);
    if (built.missing.length) preview.textContent += `   (undefined: ${built.missing.map((m) => `{{${m}}}`).join(", ")})`;
  }

  const panels = {
    params: () => kvEditor(r.params, { onChange: () => { persist(); updatePreview(); }, keyLabel: "Param" }),
    headers: () => kvEditor(r.headers, { onChange: () => { persist(); updatePreview(); }, keyLabel: "Header" }),
    auth: () => authPanel(r, updatePreview),
    body: () => bodyPanel(r),
  };
  const counts = { params: r.params.filter((p) => p.enabled && p.key).length, headers: r.headers.filter((p) => p.enabled && p.key).length };
  const tabNames = [["params", "Params"], ["headers", "Headers"], ["auth", "Auth"], ["body", "Body"]];
  const panel = h("div", { class: "tabpanel", role: "tabpanel" });
  const tabs = h("div", { class: "tabs", role: "tablist" });
  const drawTabs = () => {
    tabs.replaceChildren(...tabNames.map(([id, label]) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(activeTab === id), onclick: () => { activeTab = id; drawTabs(); } },
        counts[id] ? `${label} (${counts[id]})` : label)));
    panel.replaceChildren(panels[activeTab]());
  };
  drawTabs();

  return [
    h("div", { class: "grid2" },
      h("div", { class: "field" }, h("label", { for: "req-name" }, "Name"), nameInput),
      h("div", { class: "field" }, h("label", {}, "Folder"), folderSelect)),
    h("div", { class: "bar" }, methodSelect, urlInput, sendBtn),
    preview,
    tabs, panel,
    h("p", {},
      h("button", { type: "button", onclick: () => { const c = duplicateRequest(r); config.requests.push(c); select({ type: "request", id: c.id }); persist(); render(); } }, "Duplicate"), " ",
      h("button", { type: "button", onclick: () => { if (!confirm(`Delete "${r.name}"?`)) return; config.requests = config.requests.filter((x) => x.id !== r.id); select(null); persist(); render(); } }, "Delete")),
    h("div", { id: "response" }),
    (updatePreview(), null),
    (queueMicrotask(() => renderResponse(r)), null),
  ];
}

function authPanel(r, onChange) {
  const box = h("div", {});
  const change = () => { persist(); onChange(); };
  const draw = () => {
    const typeSel = h("select", { "aria-label": "Auth type", onchange: (e) => { r.auth.type = e.target.value; change(); draw(); } },
      [["none", "No auth"], ["bearer", "Bearer token"], ["basic", "Basic auth"]].map(([v, l]) => h("option", { value: v, selected: r.auth.type === v }, l)));
    box.replaceChildren(h("div", { class: "field" }, typeSel));
    if (r.auth.type === "bearer") {
      box.append(h("div", { class: "field" }, h("label", {}, "Token"),
        h("input", { type: "text", class: "mono", value: r.auth.token, oninput: (e) => { r.auth.token = e.target.value; change(); } })));
    }
    if (r.auth.type === "basic") {
      box.append(
        h("div", { class: "field" }, h("label", {}, "Username"), h("input", { type: "text", value: r.auth.username, oninput: (e) => { r.auth.username = e.target.value; change(); } })),
        h("div", { class: "field" }, h("label", {}, "Password"), h("input", { type: "password", autocomplete: "off", value: r.auth.password, oninput: (e) => { r.auth.password = e.target.value; change(); } })));
    }
    if (r.auth.type !== "none") {
      box.append(h("p", { class: "muted" }, "Stored unencrypted in this browser and included in exports. Prefer a ", h("code", {}, "{{variable}}"), " you fill in after importing. Skipped if you set an Authorization header."));
    }
  };
  draw();
  return box;
}

function bodyPanel(r) {
  const area = h("textarea", { class: "body", "aria-label": "Request body", placeholder: '{"hello": "world"}', spellcheck: "false", oninput: (e) => { r.body.text = e.target.value; persist(); } });
  area.value = r.body.text;
  const note = h("p", { class: "muted" });
  const draw = () => {
    area.hidden = r.body.type === "none";
    note.textContent = ["GET", "HEAD"].includes(r.method) && r.body.type !== "none" ? `${r.method} requests are sent without a body.` : "";
  };
  const typeSel = h("select", { "aria-label": "Body type", onchange: (e) => { r.body.type = e.target.value; persist(); draw(); } },
    [["none", "No body"], ["json", "JSON"], ["text", "Plain text"]].map(([v, l]) => h("option", { value: v, selected: r.body.type === v }, l)));
  const format = h("button", { type: "button", onclick: () => { area.value = r.body.text = prettyBody(area.value); persist(); } }, "Format JSON");
  draw();
  return h("div", {}, h("div", { class: "field" }, h("div", {}, typeSel, " ", format)), area, note);
}

// ---- sending --------------------------------------------------------------------------------

async function send(r) {
  if (inFlight) { inFlight.abort(); return; }
  const built = buildRequest(r, variablesOf(folderOfRequest(r)));
  /** @type {any} */
  const result = { id: uid(), at: new Date().toISOString(), requestId: r.id, name: r.name, method: built.method, url: built.url, requestHeaders: redactHeaders(built.headers), requestBody: built.body === undefined ? undefined : truncate(built.body, BODY_STORED_CHARS) };

  let parsed;
  try { parsed = new URL(built.url); } catch { /* handled below */ }
  if (!parsed || !/^https?:$/.test(parsed.protocol)) {
    result.error = built.url ? `"${built.url}" is not a valid http(s) URL.` : "Enter a URL first.";
    finish(r, result, false);
    return;
  }
  if (built.missing.length) result.warning = `Undefined variables sent as written: ${built.missing.map((m) => `{{${m}}}`).join(", ")}`;

  inFlight = new AbortController();
  const btn = document.getElementById("send");
  if (btn) btn.textContent = "Cancel";
  const t0 = performance.now();
  try {
    const res = await fetch(built.url, { method: built.method, headers: built.headers, body: built.body, signal: inFlight.signal, cache: "no-store", redirect: "follow" });
    const buf = await res.arrayBuffer();
    result.ms = Math.round(performance.now() - t0);
    result.status = res.status;
    result.statusText = res.statusText;
    result.size = buf.byteLength;
    result.responseHeaders = [...res.headers.entries()];
    const text = new TextDecoder().decode(buf);
    result.body = text.length > BODY_SHOWN_CHARS ? truncate(text, BODY_SHOWN_CHARS) : text;
    result.redirected = res.redirected;
  } catch (e) {
    result.ms = Math.round(performance.now() - t0);
    result.error = e.name === "AbortError"
      ? "Cancelled."
      : !navigator.onLine
      ? "You are offline. The app works offline, but requests need a network connection."
      : `${e.message || "Request failed"}. In a browser this usually means the server is unreachable, is blocked by CORS (it must send Access-Control-Allow-Origin), or the page is HTTPS and the target is plain HTTP.`;
  } finally {
    inFlight = null;
  }
  finish(r, result, true);
}

function finish(r, result, record) {
  lastResponse.set(r.id, result);
  if (record) {
    const stored = { ...result, body: result.body === undefined ? undefined : truncate(result.body, BODY_STORED_CHARS) };
    audit = saveAudit(pushAudit(audit, stored));
  }
  if (currentRequest()?.id === r.id) {
    const btn = document.getElementById("send");
    if (btn) btn.textContent = "Send";
    renderResponse(r);
  }
}

function renderResponse(r) {
  const box = document.getElementById("response");
  if (!box) return;
  box.replaceChildren();
  const res = lastResponse.get(r.id);
  if (!res) return;
  box.className = "response";
  box.append(h("h2", {}, "Response"));
  if (res.warning) box.append(h("p", { class: "muted" }, res.warning));
  if (res.error) { box.append(h("p", { class: "error", role: "alert" }, res.error)); return; }
  const ok = res.status >= 200 && res.status < 400;
  box.append(
    h("div", { class: "meta" },
      h("strong", { class: ok ? "" : "error" }, `${res.status} ${res.statusText}`),
      h("span", { class: "muted" }, `${res.ms} ms`),
      h("span", { class: "muted" }, formatBytes(res.size))),
    h("details", {}, h("summary", {}, `Headers (${res.responseHeaders.length})`),
      h("pre", {}, res.responseHeaders.map(([k, v]) => `${k}: ${v}`).join("\n"))),
    h("pre", { "aria-label": "Response body" }, res.body === "" ? "(empty body)" : prettyBody(res.body)));
}

// ---- audit view -----------------------------------------------------------------------------

function renderAudit() {
  const el = $("#audit-view");
  el.replaceChildren(h("div", { style: "display:flex;gap:1rem;align-items:center" },
    h("h2", {}, `Audit log (${audit.length})`),
    h("span", { class: "muted" }, "Last 1000 sends, newest first. Bodies are cut to 2000 characters and secret headers are redacted."),
    h("span", { style: "flex:1" }),
    h("button", { type: "button", disabled: !audit.length, onclick: () => { if (confirm("Clear the whole audit log?")) { audit = saveAudit([]); renderAudit(); } } }, "Clear")));
  if (!audit.length) { el.append(h("p", { class: "muted" }, "Nothing sent yet.")); return; }
  const table = h("table", { class: "audit" }, h("thead", {}, h("tr", {}, ["Time", "Request", "Status", "ms", "URL"].map((t) => h("th", {}, t)))));
  const tbody = h("tbody", {});
  for (const e of audit) {
    tbody.append(h("tr", {},
      h("td", {}, new Date(e.at).toLocaleString()),
      h("td", {}, h("span", { class: "method" }, e.method), e.name),
      h("td", { class: e.error ? "error" : "" }, e.error ? "error" : `${e.status}`),
      h("td", {}, e.ms ?? ""),
      h("td", { class: "url mono" }, e.url,
        h("details", {}, h("summary", {}, "details"),
          h("pre", {}, [
            `${e.method} ${e.url}`, ...(e.requestHeaders ?? []).map(([k, v]) => `${k}: ${v}`), e.requestBody ? `\n${e.requestBody}` : "",
            "", e.error ? `ERROR: ${e.error}` : `HTTP ${e.status} ${e.statusText}`, ...(e.responseHeaders ?? []).map(([k, v]) => `${k}: ${v}`), e.body ? `\n${e.body}` : "",
          ].join("\n"))))));
  }
  table.append(tbody);
  el.append(table);
}

// ---- views, import/export -------------------------------------------------------------------

function render() { renderTree(); renderEditor(); }

function showView(name) {
  const isAudit = name === "audit";
  $("#requests-view").hidden = isAudit;
  $("#audit-view").hidden = !isAudit;
  $("#view-requests").setAttribute("aria-pressed", String(!isAudit));
  $("#view-audit").setAttribute("aria-pressed", String(isAudit));
  if (isAudit) renderAudit();
}

$("#view-requests").addEventListener("click", () => showView("requests"));
$("#view-audit").addEventListener("click", () => showView("audit"));
$("#new-request").addEventListener("click", () => {
  const inFolder = currentFolder()?.id ?? currentRequest()?.folderId ?? null;
  const r = newRequest(inFolder);
  config.requests.push(r); select({ type: "request", id: r.id }); persist(); render();
  document.getElementById("req-name")?.focus();
});
$("#new-folder").addEventListener("click", () => {
  const f = newFolder(); config.folders.push(f); select({ type: "folder", id: f.id }); persist(); render();
  document.getElementById("folder-name")?.focus();
});

$("#export").addEventListener("click", () => {
  flush();
  const blob = new Blob([JSON.stringify(exportConfig(config), null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `http-rocket-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setStatus(`Exported ${config.requests.length} request(s) in ${config.folders.length} folder(s)`);
});

$("#import").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (e) => {
  const input = /** @type {HTMLInputElement} */ (e.target);
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const incoming = parseImport(await file.text());
    const summary = `${incoming.requests.length} request(s) in ${incoming.folders.length} folder(s)`;
    const replace = config.requests.length || config.folders.length
      ? confirm(`Import ${summary} from "${file.name}".\n\nOK = replace everything you have now.\nCancel = choose to add them alongside instead.`)
      : true;
    if (replace) config = incoming;
    else if (confirm(`Add ${summary} alongside your existing requests?`)) config = mergeConfig(config, incoming);
    else return;
    select(null); persist(); render();
    setStatus(`Imported ${summary}`);
  } catch (err) {
    setStatus(`Import failed: ${err.message}`, true);
    alert(`Import failed: ${err.message}`);
  }
});

window.addEventListener("storage", (e) => {
  if (e.key === "http-rocket:config:v1") { config = loadConfig(); render(); }
});

render();

// Offline support (see sw.js). Registration failures are not fatal: the app works without it.
if ("serviceWorker" in navigator) {
  addEventListener("load", () => {
    navigator.serviceWorker.register("/http-rocket/sw.js", { scope: "/http-rocket/" }).catch(() => {});
  });
}
