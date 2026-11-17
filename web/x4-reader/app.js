import { decodeExport, normalizePaths, wantedPath } from './x4.js';
import { buildModel, renderReportHtml, PROJECT_FORMAT } from './report.js';

const $ = (id) => document.getElementById(id);
const files = new Map(); // path -> bytes, only files wantedPath() accepts
let model = null;

const SKIP_DIRS = /^(sections|images|fonts|cache)$/;

async function addEntry(entry, prefix) {
  if (entry.isFile) {
    const path = prefix + entry.name;
    if (!wantedPath(path)) return;
    const file = await new Promise((res, rej) => entry.file(res, rej));
    files.set(path, new Uint8Array(await file.arrayBuffer()));
  } else if (entry.isDirectory && !SKIP_DIRS.test(entry.name)) {
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const child of batch) await addEntry(child, `${prefix}${entry.name}/`);
    }
  }
}

async function addFileList(list) {
  for (const f of list) {
    const path = f.webkitRelativePath || f.name;
    if (wantedPath(path)) files.set(path, new Uint8Array(await f.arrayBuffer()));
  }
}

async function loadProjectJson(file) {
  const data = JSON.parse(await file.text());
  if (data?.format !== PROJECT_FORMAT) throw new Error('Not an x4 reading project file.');
  return data;
}

function setStatus(msg, isError = false) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

function summarizeLoaded() {
  const top = new Set([...files.keys()].map((p) => p.split('/')[0].replace(/^\./, '')));
  return `${files.size} files read from ${[...top].map((t) => '.' + t).join(', ')}`;
}

function showReport(m) {
  model = m;
  const html = renderReportHtml(m);
  const frame = $('report');
  frame.srcdoc = html;
  frame.onload = () => {
    const resize = () => { frame.style.height = frame.contentDocument.documentElement.scrollHeight + 'px'; };
    resize();
    new ResizeObserver(resize).observe(frame.contentDocument.documentElement);
  };
  $('intake').hidden = true;
  $('viewer').hidden = false;
}

// Covers are full-size on the device; shrink them so the exported report stays small.
async function shrinkCover(bytes, width = 240) {
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    const scale = Math.min(1, width / bmp.width);
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.8));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : bytes;
  } catch { return bytes; }
}

async function buildFromFiles() {
  const decoded = decodeExport(files);
  if (!decoded.books.length) {
    setStatus(`${summarizeLoaded() || 'No matching files'}. Found no reading data; drop both the .metadata and .system folders.`, true);
    return;
  }
  const norm = normalizePaths(files);
  const covers = new Map();
  for (const b of decoded.books) {
    const c = norm.get(`metadata/epub/${b.id}/cover.jpg`);
    if (c) covers.set(b.id, await shrinkCover(c));
  }
  showReport(buildModel(decoded, covers));
}

async function handleDrop(ev) {
  ev.preventDefault();
  $('drop').classList.remove('over');
  const items = [...ev.dataTransfer.items].filter((i) => i.kind === 'file');
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean); // must run synchronously
  setStatus('Reading…');
  try {
    if (entries.length === 1 && entries[0].isFile && /\.json$/i.test(entries[0].name)) {
      const file = await new Promise((res, rej) => entries[0].file(res, rej));
      return showReport(await loadProjectJson(file));
    }
    for (const e of entries) await addEntry(e, '');
    setStatus(summarizeLoaded());
    buildFromFiles();
  } catch (e) { setStatus(String(e.message || e), true); }
}

function download(name, type, data) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 10);

const drop = $('drop');
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', handleDrop);

$('pick-folder').addEventListener('change', async (e) => {
  setStatus('Reading…');
  await addFileList(e.target.files);
  e.target.value = '';
  setStatus(summarizeLoaded());
  $('build').disabled = files.size === 0;
});
$('pick-json').addEventListener('change', async (e) => {
  try { showReport(await loadProjectJson(e.target.files[0])); } catch (err) { setStatus(String(err.message || err), true); }
  e.target.value = '';
});
$('build').addEventListener('click', buildFromFiles);
$('dl-html').addEventListener('click', () => model && download(`reading-report-${stamp()}.html`, 'text/html', renderReportHtml(model)));
$('dl-json').addEventListener('click', () => model && download(`x4-reading-project-${stamp()}.json`, 'application/json', JSON.stringify(model, null, 2)));
$('print').addEventListener('click', () => $('report').contentWindow.print());
$('reset').addEventListener('click', () => {
  files.clear(); model = null;
  $('report').srcdoc = '';
  $('viewer').hidden = true; $('intake').hidden = false;
  $('build').disabled = true;
  setStatus('');
});
