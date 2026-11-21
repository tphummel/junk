'use strict'

// Math game. State lives in localStorage under STORE_KEY and is written after every change.
const STORE_KEY = 'math-game:v1'
const FORMAT = 'math-game-export'
const VERSION = 1
const MAX_MS = 120000 // cap time per problem so a walk-away does not skew averages
const PAGE = 50

const OPS = {
  add: { label: 'Addition', symbol: '+', start: 0, defaults: { min: 0, max: 500, quantity: 2 } },
  multiply: { label: 'Multiplication', symbol: '×', start: 1, defaults: { min: 0, max: 12, quantity: 2 } }
}

const $ = id => document.getElementById(id)
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2))

// ---------- state and storage ----------

function defaultSettings () {
  return { op: 'add', add: { ...OPS.add.defaults }, multiply: { ...OPS.multiply.defaults } }
}

function freshState () {
  return { version: VERSION, settings: defaultSettings(), session: uid(), attempts: [] }
}

const int = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.trunc(Number(v)) : fallback)

function cleanRange (r, op) {
  const d = OPS[op].defaults
  let min = int(r && r.min, d.min)
  let max = int(r && r.max, d.max)
  if (min > max) [min, max] = [max, min]
  const quantity = Math.min(10, Math.max(2, int(r && r.quantity, d.quantity)))
  return { min, max, quantity }
}

function cleanSettings (s) {
  s = s && typeof s === 'object' ? s : {}
  return { op: s.op === 'multiply' ? 'multiply' : 'add', add: cleanRange(s.add, 'add'), multiply: cleanRange(s.multiply, 'multiply') }
}

// Returns a clean attempt, or null if the record is unusable.
function cleanAttempt (a) {
  if (!a || typeof a !== 'object' || !OPS[a.op]) return null
  const numbers = Array.isArray(a.numbers) ? a.numbers.map(Number) : []
  if (numbers.length < 2 || numbers.some(n => !Number.isFinite(n))) return null
  const t = Number(a.t)
  const answer = Number(a.answer)
  const expected = Number(a.expected)
  if (!Number.isFinite(t) || !Number.isFinite(answer) || !Number.isFinite(expected)) return null
  return {
    id: typeof a.id === 'string' && a.id ? a.id.slice(0, 64) : uid(),
    t,
    session: typeof a.session === 'string' && a.session ? a.session.slice(0, 64) : 'imported',
    op: a.op,
    numbers,
    expected,
    answer,
    correct: answer === expected,
    ms: Math.min(MAX_MS, Math.max(0, int(a.ms, 0)))
  }
}

function cleanState (raw) {
  const s = freshState()
  if (!raw || typeof raw !== 'object') return s
  s.settings = cleanSettings(raw.settings)
  if (typeof raw.session === 'string' && raw.session) s.session = raw.session.slice(0, 64)
  const seen = new Set()
  for (const a of Array.isArray(raw.attempts) ? raw.attempts : []) {
    const c = cleanAttempt(a)
    if (c && !seen.has(c.id)) { seen.add(c.id); s.attempts.push(c) }
  }
  s.attempts.sort((x, y) => x.t - y.t)
  return s
}

let storageOk = true

function load () {
  try {
    const text = localStorage.getItem(STORE_KEY)
    if (text) return cleanState(JSON.parse(text))
  } catch (e) {
    // corrupt or unavailable: fall through to a fresh state
  }
  return freshState()
}

function save () {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state))
    storageOk = true
  } catch (e) {
    storageOk = false
  }
  $('storage-warning').hidden = storageOk
}

let state = load()

// ---------- problems ----------

function makeProblem () {
  const op = state.settings.op
  const { min, max, quantity } = state.settings[op]
  const range = max - min + 1
  const numbers = []
  for (let i = 0; i < quantity; i++) numbers.push(Math.floor(Math.random() * range) + min)
  const expected = op === 'multiply' ? numbers.reduce((a, b) => a * b, 1) : numbers.reduce((a, b) => a + b, 0)
  return { op, numbers, expected, shownAt: Date.now() }
}

const promptText = (op, numbers) => numbers.join(` ${OPS[op].symbol} `)

let problem = makeProblem()

// ---------- formatting and stats ----------

const pct = (n, d) => (d ? Math.round((n / d) * 100) + '%' : '–')
const secs = ms => (ms == null ? '–' : (ms / 1000).toFixed(1) + 's')
const avg = list => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null)
const dayOf = t => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const when = t => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

function summarize (list) {
  const right = list.filter(a => a.correct)
  let best = 0
  let run = 0
  for (const a of list) {
    run = a.correct ? run + 1 : 0
    if (run > best) best = run
  }
  return {
    attempts: list.length,
    correct: right.length,
    accuracy: pct(right.length, list.length),
    points: right.reduce((s, a) => s + a.expected, 0),
    avgMs: avg(right.map(a => a.ms)),
    bestStreak: best,
    streak: run
  }
}

function groupBy (list, keyFn) {
  const map = new Map()
  for (const a of list) {
    const k = keyFn(a)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(a)
  }
  return map
}

// ---------- DOM helpers ----------

function el (tag, text, attrs) {
  const e = document.createElement(tag)
  if (text != null) e.textContent = text
  if (attrs) for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k])
  return e
}

function fillTable (table, headers, rows, emptyText) {
  table.replaceChildren()
  const head = table.createTHead().insertRow()
  headers.forEach(h => {
    const th = el('th', typeof h === 'string' ? h : h.text, { scope: 'col' })
    if (h.num) th.className = 'num'
    head.appendChild(th)
  })
  const body = table.createTBody()
  if (!rows.length) {
    const td = body.insertRow().insertCell()
    td.colSpan = headers.length
    td.className = 'muted'
    td.textContent = emptyText || 'Nothing yet.'
    return
  }
  for (const r of rows) {
    const tr = body.insertRow()
    r.forEach((cell, i) => {
      const td = tr.insertCell()
      if (cell instanceof Node) td.appendChild(cell)
      else td.textContent = cell
      if (headers[i].num) td.className = 'num'
    })
  }
}

function fillCards (container, s) {
  container.replaceChildren()
  const items = [
    [s.attempts, 'Attempts'],
    [s.correct, 'Correct'],
    [s.accuracy, 'Accuracy'],
    [s.points, 'Points'],
    [secs(s.avgMs), 'Avg time (correct)'],
    [s.bestStreak, 'Best streak'],
    [s.streak, 'Current streak']
  ]
  for (const [value, label] of items) {
    const c = el('div', null, { class: 'card' })
    c.appendChild(el('b', String(value)))
    c.appendChild(el('span', label))
    container.appendChild(c)
  }
}

// ---------- play ----------

function showProblem () {
  $('prompt').textContent = promptText(problem.op, problem.numbers)
  const { min, max, quantity } = state.settings[state.settings.op]
  $('mode-label').textContent = `${OPS[state.settings.op].label}: ${quantity} numbers from ${min} to ${max}`
}

function newProblem () {
  problem = makeProblem()
  $('actual').value = ''
  showProblem()
}

function record (answer, correct) {
  const attempt = {
    id: uid(),
    t: Date.now(),
    session: state.session,
    op: problem.op,
    numbers: problem.numbers,
    expected: problem.expected,
    answer,
    correct,
    ms: Math.min(MAX_MS, Date.now() - problem.shownAt)
  }
  state.attempts.push(attempt)
  save()
}

function submitAnswer (e) {
  e.preventDefault()
  const text = $('actual').value.trim()
  if (!/^-?\d+$/.test(text)) return
  const answer = parseInt(text, 10)
  const correct = answer === problem.expected
  const fb = $('feedback')
  record(answer, correct)
  if (correct) {
    fb.className = 'ok'
    fb.textContent = `🎉 Correct! ${promptText(problem.op, problem.numbers)} = ${problem.expected}`
    newProblem()
  } else {
    fb.className = 'bad'
    fb.textContent = '❌ Incorrect, try again!'
    $('actual').select()
  }
  renderSession()
}

function skipProblem () {
  const fb = $('feedback')
  fb.className = ''
  fb.textContent = `Skipped: ${promptText(problem.op, problem.numbers)} = ${problem.expected}`
  newProblem()
  $('actual').focus()
}

function renderSession () {
  fillCards($('session-cards'), summarize(state.attempts.filter(a => a.session === state.session)))
}

// ---------- stats ----------

function sessionsList () {
  return [...groupBy(state.attempts, a => a.session).entries()]
    .map(([id, list]) => ({ id, list, start: list[0].t }))
    .sort((a, b) => b.start - a.start)
}

function renderScopeOptions () {
  const select = $('stats-scope')
  const keep = select.value || 'all'
  select.replaceChildren(el('option', 'All time', { value: 'all' }), el('option', 'Today', { value: 'today' }), el('option', 'Last 7 days', { value: '7d' }))
  for (const s of sessionsList()) select.appendChild(el('option', `Session ${when(s.start)}`, { value: 's:' + s.id }))
  select.value = [...select.options].some(o => o.value === keep) ? keep : 'all'
}

function scopeFilter (value) {
  if (value === 'today') { const d = dayOf(Date.now()); return a => dayOf(a.t) === d }
  if (value === '7d') { const cut = Date.now() - 7 * 864e5; return a => a.t >= cut }
  if (value.startsWith('s:')) { const id = value.slice(2); return a => a.session === id }
  return () => true
}

function problemTable (table, list, sortFn) {
  const rows = [...groupBy(list, a => a.op + ':' + a.numbers.join(',')).values()]
    .map(g => ({ g, misses: g.filter(a => !a.correct).length, avgMs: avg(g.filter(a => a.correct).map(a => a.ms)) }))
    .filter(sortFn.keep)
    .sort(sortFn.cmp)
    .slice(0, 10)
    .map(({ g, misses, avgMs }) => [promptText(g[0].op, g[0].numbers) + ' = ' + g[0].expected, g.length, misses, secs(avgMs)])
  fillTable(table, ['Problem', { text: 'Tries', num: true }, { text: 'Misses', num: true }, { text: 'Avg time', num: true }], rows, 'Nothing yet.')
}

function renderStats () {
  renderScopeOptions()
  const list = state.attempts.filter(scopeFilter($('stats-scope').value))
  fillCards($('stats-cards'), summarize(list))

  fillTable($('stats-ops'),
    ['Operation', { text: 'Attempts', num: true }, { text: 'Correct', num: true }, { text: 'Accuracy', num: true }, { text: 'Points', num: true }, { text: 'Avg time', num: true }],
    Object.keys(OPS).map(op => {
      const s = summarize(list.filter(a => a.op === op))
      return [OPS[op].label, s.attempts, s.correct, s.accuracy, s.points, secs(s.avgMs)]
    }).filter(r => r[1] > 0))

  const days = [...groupBy(list, a => dayOf(a.t)).entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 30)
  fillTable($('stats-days'),
    ['Day', { text: 'Attempts', num: true }, { text: 'Correct', num: true }, 'Accuracy'],
    days.map(([day, l]) => {
      const s = summarize(l)
      const track = el('div', null, { class: 'bartrack' })
      const bar = el('div', null, { class: 'bar', title: s.accuracy })
      bar.style.width = (s.attempts ? (s.correct / s.attempts) * 100 : 0) + '%'
      track.appendChild(bar)
      const cell = el('div')
      cell.appendChild(el('span', s.accuracy))
      cell.appendChild(track)
      return [day, s.attempts, s.correct, cell]
    }))

  fillTable($('stats-sessions'),
    ['Started', { text: 'Attempts', num: true }, { text: 'Correct', num: true }, { text: 'Points', num: true }, { text: 'Avg time', num: true }],
    sessionsList().filter(s => s.list.some(scopeFilter($('stats-scope').value))).slice(0, 20).map(s => {
      const sum = summarize(s.list.filter(scopeFilter($('stats-scope').value)))
      return [when(s.start), sum.attempts, sum.correct, sum.points, secs(sum.avgMs)]
    }))

  problemTable($('stats-missed'), list, {
    keep: r => r.misses > 0,
    cmp: (a, b) => b.misses - a.misses || b.g.length - a.g.length
  })
  problemTable($('stats-slow'), list, {
    keep: r => r.avgMs != null,
    cmp: (a, b) => b.avgMs - a.avgMs
  })
}

// ---------- history ----------

let shown = PAGE

function renderHistory () {
  const op = $('h-op').value
  const outcome = $('h-outcome').value
  const list = state.attempts
    .filter(a => (!op || a.op === op) && (!outcome || (outcome === 'correct') === a.correct))
    .reverse()
  const page = list.slice(0, shown)
  fillTable($('h-table'),
    ['When', 'Problem', { text: 'Answer', num: true }, 'Result', { text: 'Time', num: true }],
    page.map(a => [when(a.t), promptText(a.op, a.numbers) + ' = ' + a.expected, a.answer, a.correct ? '✅ Correct' : '❌ Wrong', secs(a.ms)]),
    'No history yet. Play a few problems.')
  $('h-count').textContent = `Showing ${page.length} of ${list.length}`
  $('h-more').hidden = page.length >= list.length
}

// ---------- settings, data ----------

function fillSettingsForm () {
  const op = $('s-op').value
  const r = state.settings[op]
  $('s-min').value = r.min
  $('s-max').value = r.max
  $('s-quantity').value = r.quantity
}

function renderSettings () {
  $('s-op').value = state.settings.op
  fillSettingsForm()
  $('s-error').textContent = ''
  const n = state.attempts.length
  $('data-summary').textContent = `${n} attempt${n === 1 ? '' : 's'} saved in this browser.`
  const status = $('persist-status')
  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then(p => {
      status.textContent = p
        ? 'Storage is marked persistent: the browser will not clear it automatically.'
        : 'Storage is not marked persistent, so the browser may clear it when space is low. Export a backup now and then.'
    })
  } else {
    status.textContent = 'Export a backup now and then; this browser cannot report storage durability.'
  }
}

function saveSettings (e) {
  e.preventDefault()
  const op = $('s-op').value
  const min = parseInt($('s-min').value, 10)
  const max = parseInt($('s-max').value, 10)
  const quantity = parseInt($('s-quantity').value, 10)
  const err = $('s-error')
  if (![min, max, quantity].every(Number.isInteger)) { err.textContent = 'Enter whole numbers.'; return }
  if (min > max) { err.textContent = 'Smallest number must not be larger than the largest.'; return }
  if (quantity < 2 || quantity > 10) { err.textContent = 'Numbers per problem must be 2 to 10.'; return }
  state.settings.op = op
  state.settings[op] = { min, max, quantity }
  save()
  err.textContent = ''
  newProblem()
  $('feedback').className = ''
  $('feedback').textContent = ''
  $('s-note').textContent = 'Saved.'
}

function resetDefaults () {
  const op = $('s-op').value
  state.settings[op] = { ...OPS[op].defaults }
  save()
  fillSettingsForm()
  if (state.settings.op === op) newProblem()
  $('s-note').textContent = `${OPS[op].label} reset to defaults.`
}

function download (name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = el('a', null, { href: url, download: name })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const stamp = () => new Date().toISOString().slice(0, 10)

function exportJson () {
  const data = { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), settings: state.settings, session: state.session, attempts: state.attempts }
  download(`math-game-${stamp()}.json`, 'application/json', JSON.stringify(data, null, 2))
}

function exportCsv () {
  const rows = [['time', 'session', 'operation', 'problem', 'expected', 'answer', 'correct', 'seconds']]
  for (const a of state.attempts) {
    rows.push([new Date(a.t).toISOString(), a.session, a.op, promptText(a.op, a.numbers), a.expected, a.answer, a.correct, (a.ms / 1000).toFixed(1)])
  }
  download(`math-game-history-${stamp()}.csv`, 'text/csv', rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n')
}

async function importFile (e) {
  const input = e.target
  const file = input.files[0]
  const out = $('import-result')
  out.className = ''
  if (!file) return
  try {
    const data = JSON.parse(await file.text())
    if (!data || data.format !== FORMAT || !Array.isArray(data.attempts)) throw new Error('This is not a math game export.')
    if (Number(data.version) > VERSION) throw new Error('This export is from a newer version of the game.')
    const incoming = cleanState(data)
    const mode = $('import-mode').value
    if (mode === 'replace') {
      if (!confirm(`Replace all current data with ${incoming.attempts.length} imported attempts?`)) return
      state = incoming
      state.session = uid()
      out.textContent = `Replaced data with ${incoming.attempts.length} attempts.`
    } else {
      const have = new Set(state.attempts.map(a => a.id))
      const fresh = incoming.attempts.filter(a => !have.has(a.id))
      state.attempts = state.attempts.concat(fresh).sort((a, b) => a.t - b.t)
      out.textContent = `Imported ${fresh.length} new attempts (${incoming.attempts.length - fresh.length} already present).`
    }
    save()
    newProblem()
    renderSettings()
    renderSession()
  } catch (err) {
    out.className = 'err'
    out.textContent = 'Import failed: ' + err.message
  } finally {
    input.value = ''
  }
}

function clearHistory () {
  if (!state.attempts.length || !confirm('Delete all saved history? Export first if you may want it back.')) return
  state.attempts = []
  save()
  renderSettings()
  renderSession()
  $('import-result').textContent = 'History deleted.'
}

// ---------- routing ----------

const VIEWS = ['play', 'stats', 'history', 'settings']

function route () {
  const name = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'play'
  for (const v of VIEWS) $('view-' + v).hidden = v !== name
  document.querySelectorAll('nav a').forEach(a => {
    if (a.getAttribute('href') === '#' + name) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  })
  if (name === 'play') { renderSession(); showProblem(); $('actual').focus() }
  if (name === 'stats') renderStats()
  if (name === 'history') { shown = PAGE; renderHistory() }
  if (name === 'settings') { renderSettings(); $('s-note').textContent = 'Each operation remembers its own range.' }
}

// A link like ?op=multiply&min=2&max=12 presets the settings once, then is removed from the URL.
function applyQuery () {
  const p = new URLSearchParams(location.search)
  if (!p.has('op') && !p.has('min') && !p.has('max') && !p.has('quantity')) return
  const op = p.get('op') === 'multiply' ? 'multiply' : 'add'
  state.settings.op = op
  state.settings[op] = cleanRange({
    min: p.has('min') ? p.get('min') : state.settings[op].min,
    max: p.has('max') ? p.get('max') : state.settings[op].max,
    quantity: p.has('quantity') ? p.get('quantity') : state.settings[op].quantity
  }, op)
  save()
  history.replaceState(null, '', location.pathname + location.hash)
}

function init () {
  applyQuery()
  save() // writes the initial state and sets the storage warning
  $('answer-form').addEventListener('submit', submitAnswer)
  $('skip').addEventListener('click', skipProblem)
  $('new-session').addEventListener('click', () => {
    state.session = uid()
    save()
    $('feedback').className = ''
    $('feedback').textContent = 'New session started.'
    renderSession()
  })
  $('stats-scope').addEventListener('change', renderStats)
  $('h-op').addEventListener('change', () => { shown = PAGE; renderHistory() })
  $('h-outcome').addEventListener('change', () => { shown = PAGE; renderHistory() })
  $('h-more').addEventListener('click', () => { shown += PAGE; renderHistory() })
  $('s-op').addEventListener('change', fillSettingsForm)
  $('settings-form').addEventListener('submit', saveSettings)
  $('s-defaults').addEventListener('click', resetDefaults)
  $('export-json').addEventListener('click', exportJson)
  $('export-csv').addEventListener('click', exportCsv)
  $('import-file').addEventListener('change', importFile)
  $('clear-history').addEventListener('click', clearHistory)
  addEventListener('hashchange', route)
  // keep tabs in sync: another tab changed the saved data
  addEventListener('storage', e => {
    if (e.key !== STORE_KEY) return
    state = load()
    problem = makeProblem()
    route()
  })
  // ask the browser not to evict our data
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {})
  route()
}

init()
