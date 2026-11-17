// Builds the project model from decoded data and renders the standalone report HTML.
// Pure functions, no DOM access: the page shows the report in an iframe, and the exported
// file is the identical string, so what you see is what you download.

export const PROJECT_FORMAT = 'x4-reading-project';
export const PROJECT_VERSION = 1;

const FINISHED_PERCENT = 95;

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function coverDataUri(bytes) {
  return bytes ? `data:image/jpeg;base64,${toBase64(bytes)}` : null;
}

/**
 * @param {ReturnType<import('./x4.js').decodeExport>} decoded
 * @param {Map<string, Uint8Array>} covers book id -> cover jpeg bytes
 */
export function buildModel(decoded, covers = new Map(), now = new Date()) {
  const recentOrder = new Map((decoded.recent?.entries ?? []).map((e, i) => [e.cacheDir.split('/').pop(), i]));
  const books = decoded.books.map((b) => {
    const st = b.statistics && !b.statistics.error ? b.statistics : null;
    const cache = b.cache && !b.cache.error ? b.cache : null;
    const pr = b.progress && !b.progress.error ? b.progress : null;
    const percent = st?.percent ?? pr?.percent ?? 0;
    const readingMs = st?.readingMs ?? 0;
    const pageTurns = st?.pagesRead ?? 0;
    const sessions = st?.sessions ?? 0;
    const status = percent >= FINISHED_PERCENT ? 'finished' : readingMs > 0 || percent > 0 ? 'in progress' : 'not started';
    const spineCount = cache?.spineCount ?? 0;
    const curSpine = st?.spine ?? pr?.spine ?? 0;
    let chapters = [];
    if (cache) {
      const sizeOf = (i) => (cache.spine[i]?.cumulativeSize ?? 0) - (i > 0 ? cache.spine[i - 1]?.cumulativeSize ?? 0 : 0);
      const entries = cache.toc.filter((t) => t.spineIndex >= 0).sort((a, c) => a.spineIndex - c.spineIndex);
      let currentIdx = -1;
      entries.forEach((t, i) => { if (t.spineIndex <= curSpine) currentIdx = i; });
      chapters = entries.map((t, i) => {
        const endSpine = i + 1 < entries.length ? entries[i + 1].spineIndex : spineCount;
        let size = 0;
        for (let s = t.spineIndex; s < Math.max(endSpine, t.spineIndex + 1); s++) size += sizeOf(s);
        const state = status === 'finished' ? 'read' : i < currentIdx ? 'read' : i === currentIdx ? 'current' : 'unread';
        return { title: t.title, level: t.level, spineIndex: t.spineIndex, size, state };
      });
    }
    const current = chapters.find((c) => c.state === 'current') ?? null;
    return {
      id: b.id,
      path: b.path,
      title: cache?.title || st?.title || b.path || b.id,
      author: cache?.author || st?.author || '',
      language: cache?.language || '',
      status,
      percent,
      readingMs,
      pageTurns,
      sessions,
      chaptersRead: st?.chaptersRead ?? 0,
      minPerPage: pageTurns ? readingMs / 60000 / pageTurns : null,
      avgSessionMin: sessions ? readingMs / 60000 / sessions : null,
      pagesPerSession: sessions ? pageTurns / sessions : null,
      // Linear extrapolation from percent and time so far; rough, only for in-progress books.
      etaMs: status === 'in progress' && percent > 0 ? (readingMs * (100 - percent)) / percent : null,
      position: { spine: curSpine, spineCount, page: st?.page ?? null, chapter: current?.title ?? null },
      sizeBytes: cache?.spine.at(-1)?.cumulativeSize ?? null,
      recentRank: recentOrder.get(b.id) ?? null,
      chapters,
      cover: coverDataUri(covers.get(b.id)),
      raw: { progress: pr, statistics: st },
    };
  });
  books.sort((a, b) => (a.recentRank ?? 99) - (b.recentRank ?? 99));

  const known = new Set(decoded.books.map((b) => b.path));
  const unopened = (decoded.library?.books ?? [])
    .filter((l) => !known.has(l.path))
    .map((l) => ({ path: l.path, title: l.title || l.path.replace(/^\//, '').replace(/\.epub$/i, '') }));

  const sum = (k) => books.reduce((n, b) => n + b[k], 0);
  const readingMs = sum('readingMs');
  const pageTurns = sum('pageTurns');
  const sessions = sum('sessions');
  const sys = decoded.system?.statistics && !decoded.system.statistics.error ? decoded.system.statistics : null;
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    generatedAt: now.toISOString(),
    device: {
      openBook: decoded.system?.state?.openEpubPath ?? null,
      systemTotals: sys && { readingMs: sys.totalReadingMs, pagesRead: sys.totalPagesRead, chaptersRead: sys.totalChaptersRead, sessions: sys.totalSessions },
    },
    totals: {
      books: books.length,
      finished: books.filter((b) => b.status === 'finished').length,
      inProgress: books.filter((b) => b.status === 'in progress').length,
      readingMs, pageTurns, sessions,
      minPerPage: pageTurns ? readingMs / 60000 / pageTurns : null,
      avgSessionMin: sessions ? readingMs / 60000 / sessions : null,
    },
    books,
    unopened,
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function fmtDuration(ms) {
  if (ms == null) return '–';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')} min`;
}
const fmtNum = (n) => (n == null ? '–' : Math.round(n).toLocaleString('en-US'));
const fmtMin = (n) => (n == null ? '–' : `${n.toFixed(1)} min`);

// Horizontal bar chart as inline SVG; direct value labels, no legend or gridlines needed.
function barChart(rows, { unit }) {
  const max = Math.max(...rows.map((r) => r.value), 1e-9);
  const rowH = 34;
  const h = rows.length * rowH + 4;
  const bars = rows.map((r, i) => {
    const y = i * rowH + 2;
    const w = Math.max(2, (r.value / max) * 100);
    return `<g transform="translate(0 ${y})">
      <text x="0" y="12" class="lbl">${esc(r.label)}</text>
      <rect x="0" y="17" width="${w.toFixed(2)}%" height="10" rx="2" class="bar${r.hl ? ' hl' : ''}"/>
      <text x="${Math.min(w, 82).toFixed(2)}%" dx="8" y="26" class="val">${esc(r.text)}</text>
    </g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 600 ${h}" width="100%" preserveAspectRatio="none" role="img" aria-label="${esc(unit)}">${bars}</svg>`;
}

function chapterStrip(b) {
  const total = b.chapters.reduce((n, c) => n + Math.max(c.size, 1), 0) || 1;
  const segs = b.chapters.map((c) => {
    const w = Math.max(c.size, 1) / total * 100;
    return `<span class="seg ${c.state}" style="flex:${w.toFixed(3)} 1 0" title="${esc(c.title)}"></span>`;
  }).join('');
  return `<div class="strip" aria-hidden="true">${segs}</div>`;
}

const STYLE = `
:root{color-scheme:light dark;
  /* golden-angle seed: #2DD267 cw */
  /* >= 4.5:1 on #FFFFFF (light) and #111111 (dark) */
  --primary:#1D8843;--support:#4C825F;--accent:#972DD2;--bg:#FFFFFF;--text:#111111;--muted:#555555}
@media (prefers-color-scheme:dark){:root{--primary:#2DD267;--support:#5FA176;--accent:#AB54DA;--bg:#111111;--text:#EEEEEE;--muted:#A8A8A8}}
:root{--surface:color-mix(in srgb,var(--bg),var(--text) 5%);--line:color-mix(in srgb,var(--bg),var(--text) 16%)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:32px 16px 64px}
h1{font:700 clamp(2rem,6vw,3.2rem)/1.05 Georgia,"Times New Roman",serif;letter-spacing:-.02em;margin:0 0 4px;color:var(--primary)}
h2{font:600 1.25rem/1.2 Georgia,serif;margin:48px 0 16px;padding-bottom:8px;border-bottom:1px solid var(--line)}
h3{font-size:1.1rem;margin:0}
.sub{color:var(--muted);margin:0 0 28px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.tile{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.tile b{display:block;font:700 1.8rem/1.1 Georgia,serif;font-variant-numeric:tabular-nums}
.tile span{color:var(--muted);font-size:.85rem}
.shelf{display:grid;gap:16px}
.book{display:grid;grid-template-columns:96px 1fr;gap:16px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px}
.cover{width:96px;aspect-ratio:2/3;object-fit:cover;border-radius:4px;background:var(--line);box-shadow:0 1px 4px #0004}
.author{color:var(--muted);margin:0 0 8px}
.badge{display:inline-block;font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;border:1px solid var(--support);color:var(--support);border-radius:99px;padding:1px 8px;margin-left:8px;vertical-align:middle}
.badge.finished{border-color:var(--primary);color:var(--primary)}
.badge.progress{border-color:var(--accent);color:var(--accent)}
.meter{height:8px;border-radius:99px;background:var(--line);overflow:hidden;margin:8px 0}
.meter i{display:block;height:100%;background:var(--primary)}
.progress .meter i{background:var(--accent)}
dl.facts{display:flex;flex-wrap:wrap;gap:4px 20px;margin:8px 0 0;font-size:.9rem}
dl.facts div{display:flex;gap:6px}dl.facts dt{color:var(--muted)}dl.facts dd{margin:0;font-variant-numeric:tabular-nums}
.chart{display:block;overflow:visible}.chart .lbl{font-size:12.5px;fill:var(--text)}.chart .val{font-size:12.5px;fill:var(--muted);font-variant-numeric:tabular-nums}
.chart .bar{fill:var(--support)}.chart .bar.hl{fill:var(--primary)}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:28px}
.charts h3{font-size:.95rem;margin-bottom:8px}.charts p{margin:0 0 10px;color:var(--muted);font-size:.85rem}
.strip{display:flex;gap:2px;height:14px;margin:12px 0 6px}
.seg{border-radius:2px;background:var(--line)}.seg.read{background:var(--primary)}.seg.current{background:var(--accent)}
details{margin-top:8px}summary{cursor:pointer;color:var(--muted);font-size:.9rem}
ol.toc{margin:8px 0 0;padding-left:1.4rem;font-size:.9rem;columns:2 240px}
ol.toc li.read{color:var(--muted)}ol.toc li.current{color:var(--accent);font-weight:600}
.legend{font-size:.8rem;color:var(--muted);display:flex;gap:14px;flex-wrap:wrap}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.note{color:var(--muted);font-size:.85rem;border-left:3px solid var(--support);padding-left:12px;margin-top:40px}
ul.plain{margin:0;padding-left:1.2rem;color:var(--muted);columns:2 280px;font-size:.9rem}
@media (max-width:520px){.book{grid-template-columns:72px 1fr}.cover{width:72px}}
@media print{body{background:#fff;color:#000}.book,.tile{break-inside:avoid}}
`;

/** Full standalone HTML document string (no external requests). */
export function renderReportHtml(model) {
  const t = model.totals;
  const withTime = model.books.filter((b) => b.readingMs > 0);
  const tiles = [
    [fmtDuration(t.readingMs), 'total reading time'],
    [fmtNum(t.pageTurns), 'pages read'],
    [fmtNum(t.sessions), 'reading sessions'],
    [`${t.finished} / ${t.books}`, 'books finished'],
    [fmtMin(t.avgSessionMin), 'average session'],
    [t.minPerPage == null ? '–' : `${Math.round(t.minPerPage * 60)} s`, 'per page'],
  ].map(([v, l]) => `<div class="tile"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');

  const shelf = model.books.map((b) => {
    const cls = b.status === 'finished' ? 'finished' : b.status === 'in progress' ? 'progress' : '';
    const facts = [
      ['read for', fmtDuration(b.readingMs)], ['pages read', fmtNum(b.pageTurns)], ['sessions', fmtNum(b.sessions)],
      ['pace', b.minPerPage == null ? '–' : `${Math.round(b.minPerPage * 60)} s/page`],
      ['avg session', fmtMin(b.avgSessionMin)],
      ...(b.etaMs != null ? [['est. remaining', `~${fmtDuration(b.etaMs)}`]] : []),
      ...(b.position.chapter && b.status !== 'finished' ? [['now at', b.position.chapter]] : []),
    ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    const toc = b.chapters.length
      ? `<details><summary>${b.chapters.length} chapters</summary><ol class="toc">${b.chapters.map((c) => `<li class="${c.state}">${esc(c.title)}</li>`).join('')}</ol></details>` : '';
    return `<article class="book ${cls}">
      ${b.cover ? `<img class="cover" src="${b.cover}" alt="">` : '<div class="cover"></div>'}
      <div><h3>${esc(b.title)}<span class="badge ${cls}">${esc(b.status)}</span></h3>
      <p class="author">${esc(b.author)}</p>
      <div class="meter" role="img" aria-label="${b.percent.toFixed(0)}% read"><i style="width:${Math.min(100, b.percent).toFixed(2)}%"></i></div>
      <div style="font-size:.85rem;color:var(--muted)">${b.percent.toFixed(1)}% through</div>
      ${b.chapters.length ? chapterStrip(b) : ''}
      <dl class="facts">${facts}</dl>${toc}</div></article>`;
  }).join('');

  const charts = withTime.length ? `
    <div class="charts">
      <div><h3>Reading time</h3><p>Total time with each book open.</p>${barChart(
        [...withTime].sort((a, b) => b.readingMs - a.readingMs).map((b) => ({ label: b.title, value: b.readingMs, text: fmtDuration(b.readingMs), hl: b.status === 'in progress' })), { unit: 'Reading time per book' })}</div>
      <div><h3>Pace</h3><p>Seconds per page turn. Lower is faster.</p>${barChart(
        withTime.filter((b) => b.minPerPage).sort((a, b) => a.minPerPage - b.minPerPage).map((b) => ({ label: b.title, value: b.minPerPage, text: `${Math.round(b.minPerPage * 60)} s`, hl: b.status === 'in progress' })), { unit: 'Seconds per page' })}</div>
      <div><h3>Session length</h3><p>Average minutes per sitting.</p>${barChart(
        withTime.filter((b) => b.avgSessionMin).sort((a, b) => b.avgSessionMin - a.avgSessionMin).map((b) => ({ label: b.title, value: b.avgSessionMin, text: fmtMin(b.avgSessionMin), hl: b.status === 'in progress' })), { unit: 'Average session minutes' })}</div>
      <div><h3>Pages read</h3><p>Pages you spent 5+ seconds on.</p>${barChart(
        [...withTime].sort((a, b) => b.pageTurns - a.pageTurns).map((b) => ({ label: b.title, value: b.pageTurns, text: fmtNum(b.pageTurns), hl: b.status === 'in progress' })), { unit: 'Pages read' })}</div>
    </div>
    <p class="legend" style="margin-top:14px"><span><i style="background:var(--primary)"></i>finished</span><span><i style="background:var(--accent)"></i>in progress</span></p>` : '<p class="sub">No reading statistics found.</p>';

  const unopened = model.unopened.length
    ? `<h2>On the device, not opened</h2><ul class="plain">${model.unopened.map((u) => `<li>${esc(u.title)}</li>`).join('')}</ul>` : '';
  const date = new Date(model.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Reading report</title><style>${STYLE}</style></head>
<body><main>
<h1>Reading report</h1>
<p class="sub">Xteink X4 · ${model.books.length} books with reading data · generated ${esc(date)}</p>
<section class="tiles">${tiles}</section>
<h2>Bookshelf</h2><section class="shelf">${shelf}</section>
<h2>Comparisons</h2>${charts}
${unopened}
<p class="note">The reader stores totals per book: time, pages read (5 seconds or more on the page), chapters, sessions (a sitting counts after 45 seconds) and current position. It keeps no dates or per-day history, so this report can't show reading by day. Estimated time remaining is a straight-line extrapolation from progress so far. Chapter bars are sized by chapter text length.</p>
</main></body></html>`;
}
