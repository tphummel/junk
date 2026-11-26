// The page: draws a Game (game.js) and turns taps into engine calls. All rules live in the engine;
// this file only renders and waits for the person.

import { HANDS } from "./card.js";
import { Game } from "./game.js";
import { closestHands } from "./match.js";
import { SUIT_NAMES, tileName } from "./tiles.js";

/** @typedef {import("./tiles.js").Tile} Tile */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const pause = (/** @type {number} */ ms) => sleep(reduceMotion ? Math.min(ms, 150) : ms);

/** @type {Game} */
let game = new Game({ dealer: 0 });
let scores = [0, 0, 0, 0];
/** @type {number[]} */
let sel = [];
/** @type {Set<number>} */
let fresh = new Set();
/** @type {"wait" | "charleston" | "discard"} */
let mode = "wait";
let status = "";
/** @type {HTMLElement[]} */
let actions = [];

// ---- tiles ----

/** @param {string} t @param {string} [extra] @param {boolean} [button] */
function tileEl(t, extra = "", button = false) {
  const el = document.createElement(button ? "button" : "span");
  if (button) /** @type {HTMLButtonElement} */ (el).type = "button";
  el.className = `t ${t[0] === "D" ? t : t.length === 2 && "BCO".includes(t[0]) ? t[0] : t} ${extra}`.trim();
  el.setAttribute("aria-label", tileName(t));
  if (t === "DW") el.innerHTML = '<span class="dragon-white"></span>';
  else if (t === "DR") el.textContent = "中";
  else if (t === "DG") el.textContent = "發";
  else if (t === "F") el.innerHTML = "✿<small>flower</small>";
  else if (t === "J") el.innerHTML = "★<small>joker</small>";
  else if ("NEWS".includes(t) && t.length === 1) el.innerHTML = `${t}<small>wind</small>`;
  else el.innerHTML = `${t[1]}<small>${SUIT_NAMES[t[0]]}</small>`;
  return el;
}

const backEl = () => {
  const el = document.createElement("span");
  el.className = "t back";
  return el;
};

/** @param {import("./game.js").Meld} m @param {number} owner @param {number} index */
function setEl(m, owner, index) {
  const wrap = document.createElement("div");
  const canSwap = mode === "discard" && game.turn === 0 && game.swappable(0).some((s) => s.owner === owner && s.index === index);
  wrap.className = `set${canSwap ? " swappable" : ""}`;
  for (const t of m.tiles) {
    const el = tileEl(t.t);
    if (t.t === "J" && canSwap) {
      el.setAttribute("role", "button");
      el.setAttribute("tabindex", "0");
      el.title = "Swap this joker for the real tile in your rack";
      const swap = () => {
        game.swapJoker(0, owner, index);
        sel = [];
        syncActions?.();
        render();
      };
      el.addEventListener("click", swap);
      el.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && swap());
    }
    wrap.append(el);
  }
  return wrap;
}

// ---- render ----

function render() {
  renderScores();
  renderSeats();
  renderPile();
  renderYou();
  renderCard();
  $("status").textContent = status;
  $("log").textContent = game.log.slice(-3).join(" ");
  $("wall").textContent = `Wall: ${game.wall.length}`;
  $("actions").replaceChildren(...actions);
}

function renderScores() {
  $("scores").replaceChildren(...game.players.map((p, i) => {
    const s = document.createElement("span");
    s.className = i === 0 ? "you-score" : "";
    const v = game.scores[i];
    s.innerHTML = `${p.name}${i === game.dealer ? " (East)" : ""}: <b>${v > 0 ? "+" : ""}${v}</b>`;
    return s;
  }));
}

function renderSeats() {
  for (const i of [1, 2, 3]) {
    const p = game.players[i];
    const box = $(`seat-${i}`);
    box.className = `seat ${["", "seat-right", "seat-top", "seat-left"][i]}${game.turn === i && game.phase === "play" ? " turn" : ""}`;
    const name = document.createElement("div");
    name.className = "seat-name";
    name.textContent = p.name;
    const backs = document.createElement("div");
    backs.className = "backs";
    if (game.phase === "over") for (const t of p.rack) backs.append(tileEl(t.t));
    else for (let k = 0; k < p.rack.length; k++) backs.append(backEl());
    const sets = document.createElement("div");
    sets.className = "sets";
    p.exposed.forEach((m, idx) => sets.append(setEl(m, i, idx)));
    box.replaceChildren(name, backs, sets);
  }
}

function renderPile() {
  const last = game.lastDiscard?.tile.id;
  $("pile").replaceChildren(...game.pile.map((t) => tileEl(t.t, t.id === last ? "latest" : "")));
  const pile = $("pile");
  pile.scrollTop = pile.scrollHeight;
}

function renderYou() {
  const me = game.players[0];
  $("exposed").replaceChildren(...me.exposed.map((m, idx) => setEl(m, 0, idx)));
  const rack = $("rack");
  rack.replaceChildren(...me.rack.map((t) => {
    const classes = [sel.includes(t.id) ? "sel" : "", t.id === game.lastDrawn ? "drawn" : "", fresh.has(t.id) ? "fresh" : ""];
    if (mode === "charleston" && t.t === "J") classes.push("nope");
    const el = tileEl(t.t, classes.join(" "), true);
    el.addEventListener("click", () => tap(t));
    return el;
  }));
}

/** Card text: groups as repeated tiles, slots colored a/b/c. @param {string} pattern */
function patternHtml(pattern) {
  return pattern.split(" ").map((w) => {
    const [spec, n] = w.split("*");
    const count = Number(n);
    const m = /^([1-9])([abc])$/.exec(spec);
    if (m) return `<span class="p${m[2]}">${m[1].repeat(count)}</span>`;
    const sym = { DR: "中", DG: "發", DW: "□", "D?": "D" }[spec] ?? spec;
    return sym.repeat(count);
  }).join(" ");
}

let cardBuilt = false;
function renderCard() {
  const list = $("card-list");
  const hints = /** @type {HTMLInputElement} */ ($("hints")).checked;
  const { rack, exposed } = game.view(0);
  const all = closestHands(rack, exposed);
  const near = new Map(all.map((h, i) => [h.hand.id, { need: h.need, rank: i }]));
  if (!cardBuilt) {
    let cat = "";
    for (const h of HANDS) {
      if (h.cat !== cat) {
        cat = h.cat;
        const hd = document.createElement("h3");
        hd.textContent = cat;
        list.append(hd);
      }
      const row = document.createElement("div");
      row.id = `hand-${h.id}`;
      row.className = `hand${h.concealed ? " conc" : ""}`;
      row.innerHTML = `<span class="pat">${patternHtml(h.pattern)}</span><span class="val">${h.value}</span><span class="need"></span>`;
      list.append(row);
    }
    cardBuilt = true;
  }
  const closest = $("closest");
  closest.hidden = !hints;
  const top = all.slice(0, 3);
  closest.innerHTML = hints
    ? `<h3>Closest to your tiles</h3>${top.map((h) => `<div class="hand close"><span class="pat">${patternHtml(h.hand.pattern)}</span><span class="val">${h.hand.value}</span><span class="need">${h.need === 0 ? "complete" : `${h.need} tile${h.need === 1 ? "" : "s"} away`}</span></div>`).join("")}`
    : "";
  for (const h of HANDS) {
    const row = $(`hand-${h.id}`);
    const info = near.get(h.id);
    row.classList.toggle("close", hints && !!info && info.rank < 3);
    const needEl = /** @type {HTMLElement} */ (row.querySelector(".need"));
    needEl.hidden = !hints;
    needEl.textContent = !info ? "blocked by your exposed sets" : info.need === 0 ? "complete" : `${info.need} tile${info.need === 1 ? "" : "s"} away`;
  }
}

// ---- input ----

/** @param {Tile} t */
function tap(t) {
  if (mode === "wait") return;
  if (mode === "charleston") {
    if (t.t === "J") return say("Jokers cannot be passed.");
    sel = sel.includes(t.id) ? sel.filter((x) => x !== t.id) : sel.length < 3 ? [...sel, t.id] : sel;
  } else {
    sel = sel[0] === t.id ? [] : [t.id];
  }
  fresh = new Set();
  syncActions();
  render();
}

/** @param {string} msg */
function say(msg) {
  status = msg;
  render();
}

/** @param {string} label @param {() => void} fn @param {string} [cls] @param {boolean} [disabled] */
function button(label, fn, cls = "", disabled = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  if (cls) b.className = cls;
  b.disabled = disabled;
  b.addEventListener("click", fn);
  return b;
}

/** @type {null | (() => void)} */
let syncActions = null;

/**
 * Wait for the person to pick tiles and press the button.
 * @param {"charleston" | "discard"} m @param {string} prompt @param {(sel: number[]) => { label: string, ok: boolean }} spec
 * @param {() => HTMLElement[]} [extra] more buttons, each resolving through `resolveWith`
 * @returns {Promise<{ kind: "go", sel: number[] } | { kind: string }>}
 */
function ask(m, prompt, spec, extra = () => []) {
  return new Promise((resolve) => {
    mode = m;
    sel = [];
    say(prompt);
    /** @param {{ kind: string }} v */
    const done = (v) => {
      mode = "wait";
      actions = [];
      syncActions = null;
      resolve(v);
    };
    syncActions = () => {
      const { label, ok } = spec(sel);
      actions = [button(label, () => done({ kind: "go", sel: [...sel] }), "", !ok), ...extra().map((b) => {
        b.addEventListener("click", () => done({ kind: b.dataset.kind ?? "x" }), { once: true });
        return b;
      })];
      $("actions").replaceChildren(...actions);
    };
    syncActions();
    render();
  });
}

/** @param {string} label @param {string} kind @param {string} [cls] */
function kindButton(label, kind, cls = "alt") {
  const b = button(label, () => {}, cls);
  b.dataset.kind = kind;
  return b;
}

/** Buttons that resolve a one-shot choice. @param {string} prompt @param {[string, string, string?][]} choices */
function choose(prompt, choices) {
  return new Promise((resolve) => {
    mode = "wait";
    status = prompt;
    actions = choices.map(([label, kind, cls]) => button(label, () => {
      actions = [];
      resolve(kind);
    }, cls ?? ""));
    render();
  });
}

// ---- the hand ----

async function playHand() {
  render();
  while (game.phase === "charleston" || game.phase === "vote") {
    if (game.phase === "vote") {
      const kind = await choose("First Charleston done. Vote for a second one? Every player must agree.", [
        ["Second Charleston", "yes"], ["Skip it", "no", "ghost"],
      ]);
      status = "";
      const agreed = game.charlestonVote(kind === "yes");
      status = agreed ? "Everyone agreed: second Charleston (left, across, right)." : "No second Charleston.";
      render();
      await pause(900);
      continue;
    }
    const dir = game.direction;
    const r = await ask("charleston", `Charleston: choose 3 tiles to pass ${dir}. Jokers cannot be passed.`,
      (s) => ({ label: `Pass ${s.length}/3 ${dir}`, ok: s.length === 3 }));
    if (r.kind !== "go") continue;
    const before = new Set(game.players[0].rack.map((t) => t.id));
    game.charlestonPass(/** @type {{ sel: number[] }} */ (r).sel);
    fresh = new Set(game.players[0].rack.filter((t) => !before.has(t.id)).map((t) => t.id));
    sel = [];
    status = `Passed ${dir}. The tiles you received are marked.`;
    render();
    await pause(500);
  }
  fresh = new Set();

  while (game.phase === "play") {
    const p = game.turn;
    if (game.needsDraw()) {
      if (!game.draw()) break;
      render();
      if (p !== 0) await pause(350);
    }
    if (p === 0) {
      const canWin = game.canDeclare(0);
      const r = await ask("discard", canWin ? "That is mahjong! Declare it, or keep playing." : "Your turn: tap a tile, then Discard.",
        (s) => ({ label: "Discard", ok: s.length === 1 }), () => (game.canDeclare(0) ? [kindButton("Mahjong!", "win")] : []));
      if (r.kind === "win") {
        game.declareWin(0, null);
        break;
      }
      game.discard(/** @type {{ sel: number[] }} */ (r).sel[0]);
      sel = [];
      status = `You discarded ${tileName(game.lastDiscard?.tile.t ?? "")}.`;
    } else {
      status = `${game.players[p].name} is thinking.`;
      render();
      await pause(500);
      const r = game.botAct();
      if (r.type === "win") break;
      status = `${game.players[p].name} discarded ${tileName(r.tile.t)}.`;
    }
    render();

    const opts = game.humanClaimOptions();
    /** @type {{ type: "win" } | { type: "call", size: number } | null} */
    let choice = null;
    if (opts) {
      const name = tileName(game.lastDiscard?.tile.t ?? "");
      const SET = { 3: "Pung", 4: "Kong", 5: "Quint" };
      const picked = await choose(`${game.players[game.lastDiscard?.from ?? 0].name} discarded ${name}. Take it?`, [
        ...(opts.win ? [["Mahjong!", "win", "alt"]] : []),
        .../** @type {[string, string, string?][]} */ (opts.sizes.map((n) => [`${SET[/** @type {3 | 4 | 5} */ (n)]} (${n})`, `call${n}`])),
        ["Pass", "pass", "ghost"],
      ]);
      choice = picked === "win" ? { type: "win" } : picked.startsWith("call") ? { type: "call", size: Number(picked.slice(4)) } : null;
    }
    const res = game.resolveClaims(choice);
    if (res.type === "call") status = `${game.players[res.seat ?? 0].name} called ${["", "", "", "a pung", "a kong", "a quint"][res.size ?? 3]}.`;
    render();
    if (res.type === "win") break;
    if (res.type === "call") await pause(600);
  }
  finish();
}

function finish() {
  scores = [...game.scores];
  const r = game.result;
  render();
  if (!r) return;
  let text;
  if ("draw" in r) text = "The wall ran out: a draw. Nobody pays.";
  else {
    const w = game.players[r.winner].name;
    const how = r.from === null ? "self-drawn" : `off ${game.players[r.from].name}'s discard`;
    const you = r.deltas[0];
    text = `${r.winner === 0 ? "You win" : `${w} wins`} (${r.cat}, ${r.value}, ${how}). Your result: ${you > 0 ? "+" : ""}${you}.`;
  }
  status = text;
  mode = "wait";
  actions = [
    button("Next hand", () => {
      const dealer = (game.dealer + 1) % 4;
      game = new Game({ dealer, scores });
      sel = [];
      actions = [];
      playHand();
    }),
    button("New game", () => {
      scores = [0, 0, 0, 0];
      game = new Game({ dealer: 0, scores });
      sel = [];
      actions = [];
      playHand();
    }, "ghost"),
  ];
  render();
}

$("hints").addEventListener("change", renderCard);
$("help-btn").addEventListener("click", () => /** @type {HTMLDialogElement} */ ($("help")).showModal());
playHand();
