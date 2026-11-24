import { MODES, targets, prob, value, rollOne, expectedRolls, covered, isComplete, emptyState, parseImport, computeStats, toCsv } from '/roll-and-cover/game.js';

const KEY = 'roll-and-cover:v1';
const $ = (id) => document.getElementById(id);

/** @returns {import('./game.js').State} */
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const data = JSON.parse(raw);
    const { games, current } = parseImport(data);
    return { v: 1, mode: MODES.includes(data.mode) ? data.mode : 'd6', games, current };
  } catch { return emptyState(); }
}
let storageOk = true;
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { storageOk = false; }
}
let state = load();
let tab = 'play';
let expanded = new Set();
let lastRoll = null;

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d).replace(/\.?0+$/, '') : '-');
const pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '-');
const when = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const dur = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  kids.flat().forEach((k) => e.append(k));
  return e;
};
const stat = (label, val, sub = '') => el('div', { className: 'stat' }, el('b', { textContent: val }), el('span', { textContent: label + (sub ? ` · ${sub}` : '') }));

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function die(v) {
  const d = el('div', { className: 'die' + (v ? '' : ' empty'), role: 'img', ariaLabel: v ? `die showing ${v}` : 'no roll yet' });
  for (let i = 0; i < 9; i++) d.append(el('i', { className: v && PIPS[v].includes(i) ? 'on' : '' }));
  return d;
}

function setTab(name) {
  tab = name;
  for (const t of ['play', 'stats', 'history', 'data']) {
    $('t-' + t).setAttribute('aria-selected', String(t === name));
    $('p-' + t).hidden = t !== name;
  }
  render();
}

function roll(simulate = false) {
  const cur = state.current[state.mode];
  if (!cur.startedAt) cur.startedAt = Date.now();
  const startedWithRolls = cur.rolls.length;
  let finished = null;
  do {
    const r = rollOne(state.mode);
    cur.rolls.push(r);
    lastRoll = r;
    if (isComplete(state.mode, cur.rolls)) {
      finished = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, mode: state.mode, startedAt: cur.startedAt, endedAt: Date.now(), rolls: cur.rolls };
      if (simulate) finished.sim = true;
      state.games.push(finished);
      state.current[state.mode] = { startedAt: null, rolls: [] };
      lastFinished[state.mode] = finished;
    }
  } while (simulate && !finished);
  if (!finished) delete lastFinished[state.mode];
  save();
  render();
}
const lastFinished = {};

function renderPlay() {
  const mode = state.mode;
  const nums = targets(mode);
  // After a finish, keep showing the finished game's board until the next roll.
  const fin = lastFinished[mode];
  const rolls = fin ? fin.rolls : state.current[mode].rolls;
  const first = covered(mode, rolls);
  const lastVal = rolls.length ? value(rolls[rolls.length - 1]) : null;

  $('dice').replaceChildren(...(rolls.length
    ? (Array.isArray(rolls[rolls.length - 1]) ? rolls[rolls.length - 1] : [rolls[rolls.length - 1]]).map(die)
    : (mode === 'd6' ? [die(0)] : [die(0), die(0)])));
  $('total').textContent = mode === '2d6' && rolls.length ? `= ${lastVal}` : '';
  $('roll').textContent = fin ? 'Roll a new game' : rolls.length ? 'Roll' : 'Start rolling';
  $('board').replaceChildren(...nums.map((n) => {
    const hits = rolls.filter((r) => value(r) === n).length;
    return el('li', { className: 'tile' + (first.has(n) ? ' on' : '') + (n === lastVal ? ' last' : ''),
      ariaLabel: `${n}: ${hits ? `covered, rolled ${hits} times` : 'not yet rolled'}` },
      el('b', { textContent: n }), el('small', { textContent: hits ? `×${hits}` : '·' }));
  }));
  $('done').textContent = fin ? `Covered everything in ${fin.rolls.length} rolls! (expected ${fmt(expectedRolls(mode), 1)})` : '';
  $('progress').textContent = `${first.size} of ${nums.length} covered · ${rolls.length} ${rolls.length === 1 ? "roll" : "rolls"}`;
  $('abandon').hidden = !!fin || !rolls.length;

  const missing = nums.filter((n) => !first.has(n));
  const grid = [
    stat('rolls', rolls.length),
    stat('covered', `${first.size}/${nums.length}`),
    stat('still needed', missing.length ? missing.join(' ') : 'none'),
    stat('wasted rolls', rolls.length - first.size, 'repeats'),
  ];
  if (missing.length) {
    const pAny = missing.reduce((a, n) => a + prob(mode, n), 0);
    grid.push(stat('chance next roll covers one', pct(pAny)), stat('rolls until next new number', fmt(1 / pAny, 1), 'on average'));
    // expected remaining: inclusion-exclusion over the missing set
    let e = 0;
    for (let m = 1; m < 1 << missing.length; m++) {
      let p = 0, b = 0;
      missing.forEach((n, i) => { if (m & (1 << i)) { p += prob(mode, n); b++; } });
      e += (b % 2 ? 1 : -1) / p;
    }
    grid.push(stat('expected rolls to finish', fmt(e, 1)));
  }
  if (rolls.length) grid.push(stat('time', fin ? dur(fin.endedAt - fin.startedAt) : dur(Date.now() - state.current[mode].startedAt)));
  $('gameStats').replaceChildren(...grid);
  const seen = new Set();
  $('seq').replaceChildren(...(rolls.length ? rolls.flatMap((r, i) => {
    const v = value(r), isNew = !seen.has(v); seen.add(v);
    const t = Array.isArray(r) ? `${r[0]}+${r[1]}=${v}` : String(v);
    return [el('span', { className: isNew ? 'n' : '', textContent: t, title: isNew ? 'newly covered' : '' }), i < rolls.length - 1 ? ' · ' : ''];
  }) : ['No rolls yet.']));
}

function bar(label, share, expShare, text, max, alt) {
  return el('div', { className: 'row' },
    el('span', { className: 'lbl', textContent: label }),
    el('div', { className: 'track' },
      el('div', { className: 'fill' + (alt ? ' alt' : ''), style: `width:${(share / max) * 100}%` }),
      expShare == null ? '' : el('div', { className: 'exp', style: `left:calc(${(expShare / max) * 100}% - 1px)`, title: 'expected' })),
    el('span', { className: 'val', textContent: text }));
}

function renderStats() {
  const mode = state.mode;
  const s = computeStats(mode, state.games, state.current[mode]);
  const root = $('p-stats');
  if (!s.games && !s.curFreq) { root.replaceChildren(); return; }
  const kids = [];
  kids.push(el('h2', { textContent: `Games · ${mode}` }));
  kids.push(el('div', { className: 'grid' },
    stat('games finished', s.games, `${s.today} today`),
    stat('days played', s.daysPlayed),
    stat('total rolls', s.totalRolls),
    stat('expected rolls / game', fmt(s.expected), 'theory'),
    stat('average rolls / game', fmt(s.mean), s.games ? `${s.vsExpected >= 0 ? '+' : ''}${fmt(s.vsExpected)} vs expected` : ''),
    stat('last 10 average', fmt(s.last10Mean)),
    stat('median', fmt(s.median)),
    stat('most common length', fmt(s.modeLen, 0)),
    stat('fastest', fmt(s.min, 0), s.min === s.nums.length ? 'perfect' : ''),
    stat('slowest', fmt(s.max, 0)),
    stat('std deviation', fmt(s.sd)),
    stat('25th / 75th pct', `${fmt(s.p25)} / ${fmt(s.p75)}`),
    stat('90th percentile', fmt(s.p90)),
    stat('beat expected', s.games ? `${s.beatExpected} (${pct(s.beatExpected / s.games)})` : '-', 'games'),
    stat('perfect games', s.perfect, `${s.nums.length} rolls`),
    stat('wasted rolls', s.wasted, s.games ? `${fmt(s.wasted / s.games)} / game` : ''),
    stat('streak under expected', s.streak, `best ${s.bestStreak}`),
    stat('repeat of previous roll', s.repeats, s.allRolls ? pct(s.repeats / s.allRolls) : ''),
    stat('longest repeat run', s.allRolls ? s.longestRepeat : '-'),
    ...(mode === '2d6' ? [stat('doubles', s.doubles, s.allRolls ? `${pct(s.doubles / s.allRolls)} vs 16.7%` : '')] : []),
  ));

  // roll distribution (finished games + game in progress)
  const total = s.allRolls;
  const cTotal = [...s.curFreq.values()].reduce((a, b) => a + b, 0);
  const all = total + cTotal;
  kids.push(el('h2', { textContent: 'Distribution of every roll' }));
  if (all) {
    const shares = s.nums.map((n) => (s.freq.get(n) + s.curFreq.get(n)) / all);
    const max = Math.max(...shares, ...s.nums.map((n) => prob(mode, n))) * 1.05;
    kids.push(el('div', { className: 'chart' }, ...s.nums.map((n, i) => {
      const c = s.freq.get(n) + s.curFreq.get(n);
      return bar(n, shares[i], prob(mode, n), `${c} · ${pct(shares[i])}`, max);
    })));
    kids.push(el('p', { className: 'legend', textContent: `${all} rolls including the game in progress. The black tick marks the expected share. Rolls from finished games stop at the moment the last number appears, so they lean toward the rarer numbers.` }));
  } else kids.push(el('p', { className: 'muted', textContent: 'No rolls yet.' }));

  kids.push(el('h2', { textContent: 'Which number finished the game' }));
  if (s.games) {
    const max = Math.max(...[...s.lastCovered.values()].map((c) => c / s.games), 0.01) * 1.05;
    kids.push(el('div', { className: 'chart' }, ...s.nums.map((n) => bar(n, s.lastCovered.get(n) / s.games, null, `${s.lastCovered.get(n)} · ${pct(s.lastCovered.get(n) / s.games)}`, max, true))));
  } else kids.push(el('p', { className: 'muted', textContent: 'Finish a game to see this.' }));

  kids.push(el('h2', { textContent: 'Average roll on which each number first appeared' }));
  if (s.games) {
    const max = Math.max(...s.nums.map((n) => s.avgFirst.get(n))) * 1.05;
    kids.push(el('div', { className: 'chart' }, ...s.nums.map((n) => bar(n, s.avgFirst.get(n), null, fmt(s.avgFirst.get(n), 1), max, true))));
  } else kids.push(el('p', { className: 'muted', textContent: 'Finish a game to see this.' }));

  kids.push(el('h2', { textContent: 'Game length' }));
  if (s.games) {
    const max = Math.max(...s.hist.map((h) => h.count)) * 1.05;
    kids.push(el('div', { className: 'chart' }, ...s.hist.map((h) =>
      bar(h.from === h.to ? h.from : `${h.from}-${h.to}`, h.count, null, `${h.count} · ${pct(h.count / s.games)}`, max))));
    kids.push(el('p', { className: 'legend', textContent: 'Rolls needed to cover every number, number of games per length.' }));
  } else kids.push(el('p', { className: 'muted', textContent: 'Finish a game to see this.' }));

  const recent = state.games.filter((g) => g.mode === mode).slice(-30);
  if (recent.length > 1) {
    kids.push(el('h2', { textContent: 'Recent games (oldest to newest)' }));
    const max = Math.max(...recent.map((g) => g.rolls.length), s.expected) * 1.05;
    kids.push(el('div', { className: 'chart' }, ...recent.map((g, i) =>
      bar(i + 1, g.rolls.length, s.expected, String(g.rolls.length), max, g.rolls.length <= s.expected))));
    kids.push(el('p', { className: 'legend', textContent: 'Teal bars beat the expected length (black tick).' }));
  }
  root.replaceChildren(...kids);
}

function renderHistory() {
  const root = $('p-history');
  const mode = state.mode;
  const games = state.games.filter((g) => g.mode === mode).sort((a, b) => b.endedAt - a.endedAt);
  if (!games.length) { root.replaceChildren(el('p', { className: 'muted', textContent: `No finished ${mode} games yet.` })); return; }
  const exp = expectedRolls(mode);
  const rows = games.flatMap((g, i) => {
    const open = expanded.has(g.id);
    const tr = el('tr', {},
      el('td', { className: 'num', textContent: games.length - i }),
      el('td', { textContent: when(g.endedAt) + (g.sim ? ' (sim)' : '') }),
      el('td', { className: 'num', textContent: g.rolls.length }),
      el('td', { className: 'num', textContent: `${g.rolls.length <= exp ? '' : '+'}${fmt(g.rolls.length - exp, 1)}` }),
      el('td', { className: 'num', textContent: dur(g.endedAt - g.startedAt) }),
      el('td', {}, el('button', { textContent: open ? 'Hide' : 'Rolls', onclick: () => { open ? expanded.delete(g.id) : expanded.add(g.id); renderHistory(); }, ariaExpanded: String(open) }), ' ',
        el('button', { textContent: 'Delete', onclick: () => { if (confirm('Delete this game?')) { state.games = state.games.filter((x) => x.id !== g.id); delete lastFinished[mode]; save(); render(); } } })));
    if (!open) return [tr];
    const seen = new Set();
    const seq = el('td', { colSpan: 6, className: 'seq' }, ...g.rolls.flatMap((r, k) => {
      const v = value(r), isNew = !seen.has(v); seen.add(v);
      return [el('span', { className: isNew ? 'n' : '', textContent: Array.isArray(r) ? `${r[0]}+${r[1]}=${v}` : String(v) }), k < g.rolls.length - 1 ? ' · ' : ''];
    }));
    return [tr, el('tr', {}, seq)];
  });
  root.replaceChildren(
    el('h2', { textContent: `History · ${mode}` }),
    el('table', {},
      el('thead', {}, el('tr', {}, el('th', { className: 'num', textContent: '#' }), el('th', { textContent: 'Finished' }), el('th', { className: 'num', textContent: 'Rolls' }),
        el('th', { className: 'num', textContent: `vs ${fmt(exp, 1)}` }), el('th', { className: 'num', textContent: 'Time' }), el('th', { textContent: '' }))),
      el('tbody', {}, rows)),
    el('p', { className: 'legend', textContent: 'Highlighted rolls in an expanded game covered a new number.' }));
}

function render() {
  const mode = state.mode;
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  $('modeHint').textContent = mode === 'd6' ? 'one die, cover 1 to 6' : 'two dice added together, cover 2 to 12';
  if (tab === 'play') renderPlay();
  else if (tab === 'stats') renderStats();
  else if (tab === 'history') renderHistory();
}

function download(name, text, type) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const exportData = () => ({ app: 'roll-and-cover', version: 1, exportedAt: new Date().toISOString(), games: state.games, current: state.current });
const stamp = () => new Date().toISOString().slice(0, 10);
const say = (t, bad) => { $('msg').textContent = t; $('msg').style.color = bad ? 'var(--accent)' : ''; };

function doImport(replace) {
  try {
    const text = $('imText').value.trim();
    if (!text) throw new Error('Choose a file or paste JSON first.');
    const { games, current } = parseImport(JSON.parse(text));
    if (replace) {
      if (!confirm(`Replace all ${state.games.length} saved games with ${games.length} imported ones?`)) return;
      state.games = games;
      state.current = current;
      say(`Replaced data with ${games.length} games.`);
    } else {
      const ids = new Set(state.games.map((g) => g.id));
      const fresh = games.filter((g) => !ids.has(g.id));
      state.games.push(...fresh);
      state.games.sort((a, b) => a.endedAt - b.endedAt);
      for (const m of MODES) if (!state.current[m].rolls.length && current[m].rolls.length) state.current[m] = current[m];
      say(`Added ${fresh.length} new games, skipped ${games.length - fresh.length} already present.`);
    }
    for (const k of Object.keys(lastFinished)) delete lastFinished[k];
    save(); $('imText').value = ''; $('imFile').value = '';
  } catch (e) { say(e.message || 'Import failed.', true); }
}

document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.mode; save(); render(); }));
for (const t of ['play', 'stats', 'history', 'data']) $('t-' + t).addEventListener('click', () => setTab(t));
$('roll').addEventListener('click', () => roll());
$('sim').addEventListener('click', () => roll(true));
$('abandon').addEventListener('click', () => {
  if (confirm('Abandon this game? It will not be recorded.')) { state.current[state.mode] = { startedAt: null, rolls: [] }; save(); render(); }
});
$('exJson').addEventListener('click', () => download(`roll-and-cover-${stamp()}.json`, JSON.stringify(exportData(), null, 2), 'application/json'));
$('exCsv').addEventListener('click', () => download(`roll-and-cover-${stamp()}.csv`, toCsv(state.games), 'text/csv'));
$('exCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(JSON.stringify(exportData())); say('Copied to clipboard.'); } catch { say('Copy failed; use Download instead.', true); }
});
$('imFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) { $('imText').value = await f.text(); say(`Loaded ${f.name}. Choose merge or replace.`); }
});
$('imMerge').addEventListener('click', () => doImport(false));
$('imReplace').addEventListener('click', () => doImport(true));
$('wipe').addEventListener('click', () => {
  if (confirm('Delete every saved game and the games in progress? This cannot be undone.')) {
    state = emptyState(); for (const k of Object.keys(lastFinished)) delete lastFinished[k]; save(); say('All data deleted.'); render();
  }
});
addEventListener('keydown', (e) => {
  if (tab === 'play' && (e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) roll();
});
render();
if (!storageOk) say('Local storage is unavailable; progress will not be saved.', true);
