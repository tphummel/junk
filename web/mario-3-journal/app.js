// Shared journal logic. Each page ships its own copy next to its own data.js (config).
import CONFIG from './data.js';

const KEY = CONFIG.storageKey;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const fmt = (n) => (n == null ? '–' : n.toLocaleString());

/** @typedef {{coins:number|null, points:number|null, difficulty:number|null, attempts:number|null, notes:string, updated:string}} Entry */
/** @typedef {{id:string, name:string, system:string, created:string, entries:Record<string,Entry>, custom:{id:string,name:string}[]}} Playthrough */

let persistOK = true;
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && Array.isArray(raw.playthroughs)) return raw;
  } catch { /* fall through to empty store */ }
  return { v: 1, current: null, playthroughs: [] };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(store)); persistOK = true; } catch { persistOK = false; }
  $('storage-warning').hidden = persistOK;
}
const store = load();
let editing = null; // level id loaded into the form

const cur = () => store.playthroughs.find((p) => p.id === store.current) || null;

function allItems(p) {
  const groups = CONFIG.groups.map((g) => ({ label: g.label, items: g.items }));
  if (p && p.custom.length) groups.push({ label: 'Custom', items: p.custom });
  return groups;
}
const findName = (p, id) => {
  for (const g of allItems(p)) for (const it of g.items) if (it.id === id) return { group: g.label, name: it.name };
  return { group: '', name: id };
};

function flash(msg) {
  const el = $('flash'); el.textContent = msg; el.hidden = !msg;
  if (msg) setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- playthrough bar ----------
function renderBar() {
  const sel = $('pt-select');
  sel.innerHTML = store.playthroughs.map((p) => `<option value="${esc(p.id)}"${p.id === store.current ? ' selected' : ''}>${esc(p.name)}${p.system ? ' · ' + esc(p.system) : ''}</option>`).join('');
  const p = cur();
  $('pt-edit').hidden = !p;
  $('main').hidden = !p;
  $('empty').hidden = !!p;
  if (p) { $('pt-name').value = p.name; $('pt-system').value = p.system; }
}

// ---------- log form ----------
function renderLevelSelect() {
  const p = cur(); if (!p) return;
  const sel = $('level');
  const keep = editing ?? sel.value;
  sel.innerHTML = '<option value="">Choose a ' + CONFIG.unit + '…</option>' + allItems(p).map((g) =>
    `<optgroup label="${esc(g.label)}">${g.items.map((it) => `<option value="${esc(it.id)}">${p.entries[it.id] ? '✓ ' : ''}${esc(it.name)}</option>`).join('')}</optgroup>`).join('');
  sel.value = keep || '';
}
function fillForm() {
  const p = cur(); if (!p) return;
  const id = $('level').value;
  editing = id || null;
  const e = id ? p.entries[id] : null;
  $('coins').value = e?.coins ?? '';
  if (CONFIG.points) $('points').value = e?.points ?? '';
  $('difficulty').value = e?.difficulty ?? '';
  $('attempts').value = e?.attempts ?? '';
  $('notes').value = e?.notes ?? '';
  $('save').textContent = e ? 'Update entry' : 'Log entry';
  $('delete').hidden = !e;
  $('form-status').textContent = e ? 'Last saved ' + new Date(e.updated).toLocaleString() : '';
}
// Next level/star after `id` in list order that has no entry yet, wrapping around; null if everything is logged.
function suggestNext(p, id) {
  const flat = allItems(p).flatMap((g) => g.items);
  const i = flat.findIndex((it) => it.id === id);
  for (let k = 1; k <= flat.length; k++) {
    const it = flat[(i + k) % flat.length];
    if (!p.entries[it.id]) return it;
  }
  return null;
}
function onSave(ev) {
  ev.preventDefault();
  const p = cur(); const id = $('level').value;
  if (!p || !id) { $('form-status').textContent = 'Choose a ' + CONFIG.unit + ' first.'; return; }
  const dif = num($('difficulty').value);
  const att = num($('attempts').value);
  p.entries[id] = {
    coins: num($('coins').value),
    points: CONFIG.points ? num($('points').value) : null,
    difficulty: dif,
    attempts: att == null ? null : Math.max(1, Math.round(att)),
    notes: $('notes').value.trim(),
    updated: new Date().toISOString(),
  };
  save(); flash('Saved ' + findName(p, id).name);
  const next = suggestNext(p, id);
  editing = next ? next.id : id; // prefilled, but the dropdown still lets you pick anything else
  renderLevelSelect(); fillForm(); renderSummary();
  if (next) $('form-status').textContent = 'Saved. Next up: ' + next.name + ' (change it above if you went elsewhere)';
}
function onDelete() {
  const p = cur(); const id = $('level').value;
  if (!p || !p.entries[id] || !confirm('Delete the entry for ' + findName(p, id).name + '?')) return;
  delete p.entries[id]; save();
  renderLevelSelect(); fillForm(); renderSummary();
}
function onAddCustom() {
  const p = cur(); if (!p) return;
  const name = (prompt('Name of the custom ' + CONFIG.unit + ' (for example a bonus area or hack):') || '').trim();
  if (!name) return;
  const id = 'c-' + uid();
  p.custom.push({ id, name }); save();
  editing = id; renderLevelSelect(); fillForm(); renderSummary();
}

// ---------- summary & entries ----------
function renderSummary() {
  const p = cur(); if (!p) return;
  const ents = Object.entries(p.entries);
  const presetIds = new Set(CONFIG.groups.flatMap((g) => g.items.map((i) => i.id)));
  const cleared = ents.filter(([id]) => presetIds.has(id)).length;
  const sum = (k) => ents.reduce((a, [, e]) => a + (e[k] || 0), 0);
  const difs = ents.map(([, e]) => e.difficulty).filter((d) => d != null);
  const stats = [
    [`${cleared} / ${presetIds.size}`, CONFIG.clearedLabel],
    [fmt(sum('coins')), 'coins logged'],
  ];
  if (CONFIG.points) stats.push([fmt(sum('points')), 'points logged']);
  stats.push([fmt(sum('attempts')), 'total attempts'], [difs.length ? (difs.reduce((a, b) => a + b, 0) / difs.length).toFixed(1) : '–', 'avg difficulty (1–5)']);
  $('stats').innerHTML = stats.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');

  const out = [];
  for (const g of allItems(p)) {
    const done = g.items.filter((it) => p.entries[it.id]);
    if (!done.length) continue;
    const pct = g.label === 'Custom' ? '' : ` <span class="muted">${done.length} / ${g.items.length}</span>`;
    out.push(`<h3>${esc(g.label)}${pct}</h3><ul class="entries">${done.map((it) => {
      const e = p.entries[it.id];
      const bits = [];
      if (e.coins != null) bits.push(`🪙 ${fmt(e.coins)}`);
      if (CONFIG.points && e.points != null) bits.push(`★ ${fmt(e.points)} pts`);
      if (e.difficulty != null) bits.push(`difficulty ${'●'.repeat(e.difficulty)}${'○'.repeat(5 - e.difficulty)}`);
      if (e.attempts != null) bits.push(`${e.attempts} attempt${e.attempts === 1 ? '' : 's'}`);
      return `<li><button class="entry" data-id="${esc(it.id)}"><span class="en">${esc(it.name)}</span><span class="eb">${bits.map(esc).join(' · ')}</span>${e.notes ? `<span class="enote">${esc(e.notes)}</span>` : ''}</button></li>`;
    }).join('')}</ul>`);
  }
  $('entries').innerHTML = out.join('') || `<p class="muted">Nothing logged yet. Choose a ${esc(CONFIG.unit)} above and log your first run.</p>`;
}

// ---------- playthrough actions ----------
function onNew() {
  const name = (prompt('Name this playthrough:', 'Playthrough ' + (store.playthroughs.length + 1)) || '').trim();
  if (!name) return;
  const p = { id: uid(), name, system: CONFIG.systems[0], created: new Date().toISOString(), entries: {}, custom: [] };
  store.playthroughs.push(p); store.current = p.id; editing = null; save(); renderAll();
}
function onDeletePt() {
  const p = cur(); if (!p || !confirm(`Delete "${p.name}" and all its entries? Export first if you want a copy.`)) return;
  store.playthroughs = store.playthroughs.filter((x) => x.id !== p.id);
  store.current = store.playthroughs[0]?.id ?? null; editing = null; save(); renderAll();
}

// ---------- export / import ----------
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'playthrough';
function exportJSON() {
  const p = cur(); if (!p) return;
  download(`${CONFIG.storageKey}-${slug(p.name)}.json`, JSON.stringify({ app: CONFIG.storageKey, version: 1, playthrough: p }, null, 2), 'application/json');
}
function exportCSV() {
  const p = cur(); if (!p) return;
  const cols = ['group', 'name', 'coins', ...(CONFIG.points ? ['points'] : []), 'difficulty', 'attempts', 'notes', 'updated'];
  const q = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['playthrough', 'system', ...cols].join(',')];
  for (const g of allItems(p)) for (const it of g.items) {
    const e = p.entries[it.id]; if (!e) continue;
    rows.push([p.name, p.system, g.label, it.name, e.coins, ...(CONFIG.points ? [e.points] : []), e.difficulty, e.attempts, e.notes, e.updated].map(q).join(','));
  }
  download(`${CONFIG.storageKey}-${slug(p.name)}.csv`, rows.join('\n') + '\n', 'text/csv');
}
function importJSON(file) {
  file.text().then((t) => {
    const d = JSON.parse(t); const src = d.playthrough;
    if (!src || typeof src.entries !== 'object') throw new Error('not a journal export');
    const clean = {};
    for (const [id, e] of Object.entries(src.entries)) {
      clean[id] = { coins: num(e.coins), points: CONFIG.points ? num(e.points) : null, difficulty: num(e.difficulty), attempts: num(e.attempts), notes: String(e.notes || ''), updated: String(e.updated || new Date().toISOString()) };
    }
    const custom = (Array.isArray(src.custom) ? src.custom : []).map((c) => ({ id: String(c.id), name: String(c.name) }));
    const p = { id: uid(), name: String(src.name || 'Imported') + ' (imported)', system: String(src.system || ''), created: String(src.created || new Date().toISOString()), entries: clean, custom };
    store.playthroughs.push(p); store.current = p.id; editing = null; save(); renderAll(); flash('Imported ' + p.name);
  }).catch((e) => flash('Import failed: ' + e.message));
}

function renderAll() { renderBar(); if (cur()) { renderLevelSelect(); fillForm(); renderSummary(); } save(); }

// ---------- wire up ----------
$('pt-select').addEventListener('change', (e) => { store.current = e.target.value; editing = null; save(); renderAll(); });
$('pt-new').addEventListener('click', onNew);
$('pt-new2').addEventListener('click', onNew);
$('pt-delete').addEventListener('click', onDeletePt);
$('pt-name').addEventListener('change', (e) => { const p = cur(); if (p && e.target.value.trim()) { p.name = e.target.value.trim(); save(); renderBar(); } });
$('pt-system').addEventListener('change', (e) => { const p = cur(); if (p) { p.system = e.target.value.trim(); save(); renderBar(); } });
$('level').addEventListener('change', fillForm);
$('log-form').addEventListener('submit', onSave);
$('delete').addEventListener('click', onDelete);
$('add-custom').addEventListener('click', onAddCustom);
$('export-json').addEventListener('click', exportJSON);
$('export-csv').addEventListener('click', exportCSV);
$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importJSON(f); e.target.value = ''; });
$('entries').addEventListener('click', (e) => {
  const b = e.target.closest('.entry'); if (!b) return;
  $('level').value = b.dataset.id; fillForm();
  $('log-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('system-list').innerHTML = CONFIG.systems.map((s) => `<option value="${esc(s)}">`).join('');
if (store.current && !cur()) store.current = store.playthroughs[0]?.id ?? null;
renderAll();
