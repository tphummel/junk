// One hand of American mahjong for four seats: seat 0 is the person, seats 1-3 are bots.
// Turn order runs 0 -> 1 -> 2 -> 3 (counterclockwise from above: you, right, across, left).
// The engine is plain state plus methods so the page (and tests) drive it step by step.
//
// Simplified from the full rules: no blind passes or courtesy pass in the Charleston, no dead hands, no jokerless
// bonus, no exposure-size challenges, and a called set is made with the discard plus the tiles you hold.

import { callSizes, canWin, charlestonPick, chooseDiscard, takeForCall, wantsCall, wantsSecondCharleston } from "./bot.js";
import { winningVariant } from "./match.js";
import { buildWall, sortTiles } from "./tiles.js";

/** @typedef {import("./tiles.js").Tile} Tile */
/** @typedef {{ tile: string, size: number, tiles: Tile[] }} Meld */
/** @typedef {{ name: string, rack: Tile[], exposed: Meld[], discards: Tile[] }} Player */
/** @typedef {{ winner: number, from: number | null, handId: string, cat: string, pattern: string, value: number, deltas: number[] } | { draw: true }} Result */

export const CHARLESTON = ["right", "across", "left", "left", "across", "right"];
const OFFSET = { right: 1, across: 2, left: 3 };

export class Game {
  /** @param {{ dealer?: number, scores?: number[], rng?: () => number, names?: string[] }} [opts] */
  constructor({ dealer = 0, scores = [0, 0, 0, 0], rng = Math.random, names = ["You", "Pearl", "Ruth", "Betty"] } = {}) {
    this.rng = rng;
    this.dealer = dealer;
    this.scores = [...scores];
    /** @type {"charleston" | "vote" | "play" | "over"} */
    this.phase = "charleston";
    this.stage = 0;
    this.turn = dealer;
    /** @type {Tile[]} */
    this.wall = buildWall(rng);
    /** @type {Player[]} */
    this.players = names.map((name) => ({ name, rack: [], exposed: [], discards: [] }));
    /** @type {{ tile: Tile, from: number } | null} */
    this.lastDiscard = null;
    /** @type {Tile[]} every discard so far, oldest first (called ones removed) */
    this.pile = [];
    /** @type {number | null} id of the tile just drawn, shown apart from the rack */
    this.lastDrawn = null;
    /** @type {Result | null} */
    this.result = null;
    /** @type {string[]} */
    this.log = [];
    for (let i = 0; i < 13; i++) for (const p of this.players) p.rack.push(/** @type {Tile} */ (this.wall.pop()));
    this.players[dealer].rack.push(/** @type {Tile} */ (this.wall.pop()));
    for (const p of this.players) p.rack = sortTiles(p.rack);
    this.say(`${this.players[dealer].name} deals and is East.`);
  }

  /** @param {string} msg */
  say(msg) {
    this.log.push(msg);
  }

  /** Tiles a player holds, counting exposed sets. @param {number} p */
  holdings(p) {
    const pl = this.players[p];
    return pl.rack.length + pl.exposed.reduce((n, m) => n + m.size, 0);
  }

  /** Codes and sets for matching. @param {number} p */
  view(p) {
    const pl = this.players[p];
    return { rack: pl.rack.map((t) => t.t), exposed: pl.exposed.map(({ tile, size }) => ({ tile, size })) };
  }

  // ---- Charleston ----

  get direction() {
    return CHARLESTON[this.stage];
  }

  /**
   * Pass three tiles in the current direction. Everyone passes at once; bots choose for themselves.
   * @param {number[]} humanIds three tile ids from the person's rack, none a joker
   */
  charlestonPass(humanIds) {
    if (this.phase !== "charleston") throw new Error("not in the Charleston");
    const mine = this.players[0].rack.filter((t) => humanIds.includes(t.id));
    if (mine.length !== 3 || mine.some((t) => t.t === "J")) throw new Error("pass exactly three tiles, no jokers");
    const picks = [mine, ...[1, 2, 3].map((i) => charlestonPick(this.players[i].rack, this.rng))];
    const off = OFFSET[/** @type {"right" | "across" | "left"} */ (this.direction)];
    picks.forEach((tiles, i) => {
      const ids = tiles.map((t) => t.id);
      this.players[i].rack = this.players[i].rack.filter((t) => !ids.includes(t.id));
    });
    picks.forEach((tiles, i) => this.players[(i + off) % 4].rack.push(...tiles));
    for (const p of this.players) p.rack = sortTiles(p.rack);
    this.say(`Everyone passed three tiles ${this.direction}.`);
    this.stage++;
    if (this.stage === 3) this.phase = "vote";
    else if (this.stage === 6) this.startPlay();
  }

  /** The optional second Charleston needs every player to agree. @param {boolean} humanYes */
  charlestonVote(humanYes) {
    if (this.phase !== "vote") throw new Error("not voting");
    const all = humanYes && [1, 2, 3].every((i) => wantsSecondCharleston(this.players[i].rack));
    if (all) {
      this.phase = "charleston";
      this.say("Everyone agreed to a second Charleston.");
    } else {
      this.say(humanYes ? "Someone declined the second Charleston." : "No second Charleston.");
      this.startPlay();
    }
    return all;
  }

  startPlay() {
    this.phase = "play";
    this.turn = this.dealer;
    this.say(`${this.players[this.dealer].name} plays first.`);
  }

  // ---- Turns ----

  /** Whether the player on turn must draw first (13 tiles). */
  needsDraw() {
    return this.phase === "play" && this.holdings(this.turn) === 13;
  }

  /** Draw for the player on turn. Returns null (and ends the hand) when the wall is empty. */
  draw() {
    const tile = this.wall.pop();
    if (!tile) {
      this.phase = "over";
      this.result = { draw: true };
      this.say("The wall is empty: a draw, nobody wins.");
      return null;
    }
    this.players[this.turn].rack.push(tile);
    this.lastDrawn = tile.id;
    return tile;
  }

  /** Whether a player's 14 tiles make a card hand. @param {number} p */
  canDeclare(p) {
    const { rack, exposed } = this.view(p);
    return this.holdings(p) === 14 && !!winningVariant(rack, exposed);
  }

  /** The player on turn throws a tile. @param {number} id */
  discard(id) {
    const p = this.turn;
    const pl = this.players[p];
    const i = pl.rack.findIndex((t) => t.id === id);
    if (this.phase !== "play" || i < 0 || this.holdings(p) !== 14) throw new Error("cannot discard that");
    const [tile] = pl.rack.splice(i, 1);
    pl.rack = sortTiles(pl.rack);
    pl.discards.push(tile);
    this.pile.push(tile);
    this.lastDiscard = { tile, from: p };
    this.lastDrawn = null;
    return tile;
  }

  /** What the person may do with the latest discard: win, or call a set of these sizes. */
  humanClaimOptions() {
    const d = this.lastDiscard;
    if (!d || d.from === 0 || d.tile.t === "J") return null;
    const win = canWin(this.players[0].rack, this.view(0).exposed, d.tile.t);
    const sizes = callSizes(this.players[0].rack, d.tile.t);
    return win || sizes.length ? { win, sizes } : null;
  }

  /**
   * Settle claims on the latest discard. Mahjong beats a call; ties go to whoever sits next in turn order.
   * @param {{ type: "win" } | { type: "call", size: number } | null} humanChoice
   * @returns {{ type: "win" | "call" | "pass", seat?: number, size?: number }}
   */
  resolveClaims(humanChoice) {
    const d = this.lastDiscard;
    if (!d) throw new Error("nothing to claim");
    const order = [1, 2, 3].map((k) => (d.from + k) % 4).filter((s) => s !== d.from);
    const code = d.tile.t;
    if (code !== "J") {
      for (const s of order) {
        const wins = s === 0 ? humanChoice?.type === "win" : canWin(this.players[s].rack, this.view(s).exposed, code);
        if (wins) {
          this.declareWin(s, d.from);
          return { type: "win", seat: s };
        }
      }
      for (const s of order) {
        const size = s === 0 ? (humanChoice?.type === "call" ? humanChoice.size : null) : wantsCall(this.players[s].rack, this.view(s).exposed, code);
        if (size) {
          this.executeCall(s, size);
          return { type: "call", seat: s, size };
        }
      }
    }
    this.turn = (d.from + 1) % 4;
    this.lastDiscard = null;
    return { type: "pass" };
  }

  /** @param {number} seat @param {number} size */
  executeCall(seat, size) {
    const d = this.lastDiscard;
    if (!d) throw new Error("nothing to call");
    const pl = this.players[seat];
    const code = d.tile.t;
    const { realCount, jokerCount } = takeForCall(pl.rack, code, size);
    const tiles = [d.tile];
    for (let i = 0; i < realCount; i++) tiles.push(/** @type {Tile} */ (this.take(pl, code)));
    for (let i = 0; i < jokerCount; i++) tiles.push(/** @type {Tile} */ (this.take(pl, "J")));
    this.pile = this.pile.filter((t) => t.id !== d.tile.id);
    this.players[d.from].discards = this.players[d.from].discards.filter((t) => t.id !== d.tile.id);
    pl.exposed.push({ tile: code, size, tiles });
    this.turn = seat;
    this.lastDiscard = null;
    this.say(`${pl.name} called ${SET_NAMES[size]} of ${code}.`);
  }

  /** Remove and return one tile with this code from a player's rack. @param {Player} pl @param {string} code */
  take(pl, code) {
    const i = pl.rack.findIndex((t) => t.t === code);
    return pl.rack.splice(i, 1)[0];
  }

  /** Jokers anyone could swap for a tile in `p`'s rack. @param {number} p @returns {{ owner: number, index: number }[]} */
  swappable(p) {
    const have = new Set(this.players[p].rack.map((t) => t.t));
    /** @type {{ owner: number, index: number }[]} */
    const out = [];
    this.players.forEach((pl, owner) =>
      pl.exposed.forEach((m, index) => {
        if (have.has(m.tile) && m.tiles.some((t) => t.t === "J")) out.push({ owner, index });
      }));
    return out;
  }

  /** Swap a real tile from `p`'s rack for a joker in someone's exposed set. @param {number} p @param {number} owner @param {number} index */
  swapJoker(p, owner, index) {
    const pl = this.players[p];
    const meld = this.players[owner].exposed[index];
    const ji = meld?.tiles.findIndex((t) => t.t === "J");
    const ri = pl.rack.findIndex((t) => t.t === meld?.tile);
    if (!meld || ji < 0 || ri < 0) return false;
    const [real] = pl.rack.splice(ri, 1);
    const [joker] = meld.tiles.splice(ji, 1, real);
    pl.rack.push(joker);
    pl.rack = sortTiles(pl.rack);
    this.say(`${pl.name} swapped a joker out of ${this.players[owner].name}'s ${meld.tile}.`);
    return true;
  }

  /** The bot on turn (after drawing) swaps jokers, declares mahjong or discards. @returns {{ type: "win" } | { type: "discard", tile: Tile }} */
  botAct() {
    const p = this.turn;
    for (let s = this.swappable(p)[0]; s; s = this.swappable(p)[0]) this.swapJoker(p, s.owner, s.index);
    if (this.canDeclare(p)) {
      this.declareWin(p, null);
      return { type: "win" };
    }
    const { exposed } = this.view(p);
    const tile = chooseDiscard(this.players[p].rack, exposed, this.rng);
    this.discard(tile.id);
    this.say(`${this.players[p].name} discards ${tile.t}.`);
    return { type: "discard", tile };
  }

  /**
   * End the hand with a win. By discard the discarder pays double and the others pay the hand's value;
   * on a self-drawn tile everyone pays double.
   * @param {number} winner @param {number | null} from seat of the discarder, or null for a self-draw
   */
  declareWin(winner, from) {
    const pl = this.players[winner];
    if (from !== null && this.lastDiscard) {
      pl.rack.push(this.lastDiscard.tile);
      this.pile = this.pile.filter((t) => t.id !== this.lastDiscard?.tile.id);
      this.players[from].discards = this.players[from].discards.filter((t) => t.id !== this.lastDiscard?.tile.id);
      pl.rack = sortTiles(pl.rack);
    }
    const { rack, exposed } = this.view(winner);
    const v = winningVariant(rack, exposed);
    if (!v) throw new Error("not a winning hand");
    const value = v.hand.value;
    const deltas = [0, 0, 0, 0];
    for (let s = 0; s < 4; s++) {
      if (s === winner) continue;
      const pay = from === null || s === from ? value * 2 : value;
      deltas[s] -= pay;
      deltas[winner] += pay;
    }
    this.scores = this.scores.map((x, i) => x + deltas[i]);
    this.phase = "over";
    this.lastDiscard = null;
    this.lastDrawn = null;
    this.result = { winner, from, handId: v.hand.id, cat: v.hand.cat, pattern: v.hand.pattern, value, deltas };
    this.say(`${pl.name} wins with ${v.hand.cat} (${value}).`);
  }
}

const SET_NAMES = /** @type {Record<number, string>} */ ({ 3: "a pung", 4: "a kong", 5: "a quint" });
