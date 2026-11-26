// Tests for the American mahjong engine in web/mahjong/: the card, matching, and a full simulated hand.
import assert from "node:assert/strict";
import test from "node:test";
import { callSizes, takeForCall } from "../web/mahjong/bot.js";
import { HANDS, VARIANTS } from "../web/mahjong/card.js";
import { Game } from "../web/mahjong/game.js";
import { closestHands, deficiency, winningVariant } from "../web/mahjong/match.js";
import { buildWall } from "../web/mahjong/tiles.js";

/** Seeded random numbers so a simulated game is repeatable. */
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Build a rack from "B1 B1 J" style text. */
const rack = (text) => text.split(" ");
const variant = (handId, pred = () => true) => VARIANTS.find((v) => v.hand.id === handId && pred(v));

test("wall: 152 tiles with the right makeup", () => {
  const wall = buildWall(seeded(1));
  assert.equal(wall.length, 152);
  assert.equal(new Set(wall.map((t) => t.id)).size, 152);
  const count = (code) => wall.filter((t) => t.t === code).length;
  assert.equal(count("B5"), 4);
  assert.equal(count("O9"), 4);
  assert.equal(count("E"), 4);
  assert.equal(count("DW"), 4);
  assert.equal(count("F"), 8);
  assert.equal(count("J"), 8);
});

test("card: every concrete hand is 14 tiles, with distinct tiles per group", () => {
  assert.ok(HANDS.length >= 20);
  for (const v of VARIANTS) {
    assert.equal(v.groups.reduce((n, g) => n + g.count, 0), 14, v.key);
    assert.equal(new Set(v.groups.map((g) => g.tile)).size, v.groups.length, `${v.key} repeats a tile`);
    for (const g of v.groups) assert.match(g.tile, /^([BCO][1-9]|[NEWS]|D[RGW]|F)$/, v.key);
  }
  assert.equal(new Set(VARIANTS.map((v) => v.key)).size, VARIANTS.length, "variants are unique");
});

test("card: no group is bigger than the tiles that exist", () => {
  for (const v of VARIANTS) for (const g of v.groups) assert.ok(g.count <= (g.tile === "F" ? 8 : 5), v.key);
});

test("matching: a complete natural hand wins", () => {
  const v = winningVariant(rack("F F B1 B1 B1 B2 B2 B2 B3 B3 B3 B4 B4 B4"));
  assert.equal(v?.hand.id, "run1");
});

test("matching: jokers fill groups of three or more", () => {
  assert.equal(winningVariant(rack("F F B1 B1 J B2 B2 B2 B3 B3 J B4 B4 B4"))?.hand.id, "run1");
  assert.equal(winningVariant(rack("F J B1 B1 B1 B2 B2 B2 B3 B3 B3 B4 B4 B4")), null, "a joker cannot be half of the flower pair");
});

test("matching: jokers cannot fill a pair or a single", () => {
  // Seven pairs of consecutive numbers with one pair completed by a joker: not a win.
  const almost = rack("B1 B1 B2 B2 B3 B3 B4 B4 B5 B5 B6 B6 B7 J");
  assert.equal(winningVariant(almost), null);
  const real = rack("B1 B1 B2 B2 B3 B3 B4 B4 B5 B5 B6 B6 B7 B7");
  assert.equal(winningVariant(real)?.hand.id, "sp1");
});

test("matching: needs exactly 14 tiles and the right ones", () => {
  assert.equal(winningVariant(rack("F F B1 B1 B1 B2 B2 B2 B3 B3 B3 B4 B4")), null);
  assert.equal(winningVariant(rack("F F B1 B1 B1 B2 B2 B2 B3 B3 B3 B4 B4 C4")), null);
});

test("matching: exposed sets must belong to the hand, and concealed hands allow none", () => {
  // Pung of B1 exposed, the other 11 concealed.
  const open = rack("F F B2 B2 B2 B3 B3 B3 B4 B4 B4");
  assert.equal(winningVariant(open, [{ tile: "B1", size: 3 }])?.hand.id, "run1");
  assert.equal(winningVariant(open, [{ tile: "C1", size: 3 }]), null);
  const pairs = rack("B2 B2 B3 B3 B4 B4 B5 B5 B6 B6 B7 B7");
  assert.equal(winningVariant(pairs, [{ tile: "B1", size: 3 }]), null);
});

test("matching: deficiency counts what is still needed", () => {
  const v = variant("run1", (x) => x.groups[1].tile === "B1");
  assert.equal(deficiency(v, rack("F F B1 B1 B1 B2 B2 B2 B3 B3 B3 B4 B4 B4")), 0);
  assert.equal(deficiency(v, rack("F F B1 B1 B1 B2 B2 B2 B3 B3 B3 B4 B4")), 1);
  assert.equal(deficiency(v, rack("F B1 B1 B1 B2 B2 B2 B3 B3 B3 B4 B4 B4 J")), 1); // one flower short, joker cannot fill a pair
  assert.equal(deficiency(v, rack("F F B1 B1 B1 B2 B2 B2 B3 B3 B3 B4 B4 J")), 0);
});

test("closestHands: nearest first, one entry per hand", () => {
  const hands = closestHands(rack("F F B1 B1 B1 B2 B2 B2 B3 B3 B3 B4 B4"));
  assert.equal(hands[0].need, 1);
  assert.equal(new Set(hands.map((h) => h.hand.id)).size, hands.length);
  for (let i = 1; i < hands.length; i++) assert.ok(hands[i].need >= hands[i - 1].need);
});

test("calls: sizes depend on real tiles and jokers held, and jokers cannot be called", () => {
  const t = (code, id) => ({ id, t: code });
  const r = [t("B1", 1), t("B1", 2), t("C2", 3)];
  assert.deepEqual(callSizes(r, "B1"), [3]);
  assert.deepEqual(callSizes([t("B1", 1), t("J", 2), t("J", 3)], "B1"), [3, 4]);
  assert.deepEqual(callSizes(r, "C2"), []);
  assert.deepEqual(callSizes(r, "J"), []);
  const { rest, meld } = takeForCall([t("B1", 1), t("J", 2), t("C2", 3)], "B1", 3);
  assert.deepEqual(rest, ["C2"]);
  assert.deepEqual(meld, { tile: "B1", size: 3 });
});

test("game: deal gives 14 to the dealer and 13 to everyone else", () => {
  const g = new Game({ dealer: 2, rng: seeded(7) });
  assert.deepEqual(g.players.map((p) => p.rack.length), [13, 13, 14, 13]);
  assert.equal(g.wall.length, 152 - 53);
});

test("charleston: passes three tiles around, never jokers, then ends", () => {
  const g = new Game({ rng: seeded(11) });
  const pick = () => g.players[0].rack.filter((t) => t.t !== "J").slice(0, 3).map((t) => t.id);
  const joker = g.players[0].rack.find((t) => t.t === "J");
  if (joker) assert.throws(() => g.charlestonPass([joker.id, ...pick().slice(0, 2)]));
  assert.throws(() => g.charlestonPass(pick().slice(0, 2)));
  const before = g.players.reduce((n, p) => n + p.rack.length, 0);
  for (let i = 0; i < 3; i++) g.charlestonPass(pick());
  assert.equal(g.phase, "vote");
  assert.equal(g.players.reduce((n, p) => n + p.rack.length, 0), before);
  g.charlestonVote(false);
  assert.equal(g.phase, "play");
  assert.equal(g.turn, g.dealer);
});

test("game: simulated hands finish and payments balance to zero", () => {
  let wins = 0;
  for (let n = 0; n < 12; n++) {
    const g = new Game({ dealer: n % 4, rng: seeded(100 + n) });
    while (g.phase === "charleston" || g.phase === "vote") {
      if (g.phase === "vote") g.charlestonVote(false);
      else g.charlestonPass(g.players[0].rack.filter((t) => t.t !== "J").slice(0, 3).map((t) => t.id));
    }
    for (let guard = 0; g.phase === "play" && guard < 400; guard++) {
      if (g.needsDraw() && !g.draw()) break;
      if (g.turn === 0) {
        if (g.canDeclare(0)) {
          g.declareWin(0, null);
          break;
        }
        g.discard(g.players[0].rack[0].id);
      } else if (g.botAct().type === "win") break;
      if (g.lastDiscard) g.resolveClaims(null);
    }
    assert.equal(g.phase, "over");
    for (const p of g.players) assert.ok(p.rack.length + p.exposed.reduce((s, m) => s + m.size, 0) <= 14);
    const r = g.result;
    assert.ok(r);
    if ("draw" in r) {
      assert.deepEqual(g.scores, [0, 0, 0, 0]);
    } else {
      wins++;
      assert.equal(r.deltas.reduce((a, b) => a + b, 0), 0);
      assert.equal(r.deltas[r.winner], r.deltas.reduce((s, d) => (d > 0 ? s + d : s), 0));
      assert.ok(r.value >= 25);
    }
  }
  assert.ok(wins > 0, "at least one simulated hand has a winner");
});

test("payment: self-draw doubles for everyone; a discard win doubles only the discarder", () => {
  const set = (g, winner) => {
    const win = rack("F F B1 B1 B1 B2 B2 B2 B3 B3 B3 B4 B4 B4");
    g.players[winner].rack = win.map((t, i) => ({ id: 1000 + i, t }));
    g.players[winner].exposed = [];
  };
  const self = new Game({ rng: seeded(3) });
  set(self, 1);
  self.declareWin(1, null);
  assert.deepEqual(self.result.deltas, [-50, 150, -50, -50]);

  const off = new Game({ rng: seeded(3) });
  off.players[1].rack = rack("F F B1 B1 B1 B2 B2 B2 B3 B3 B3 B4 B4").map((t, i) => ({ id: 2000 + i, t }));
  off.lastDiscard = { tile: { id: 3000, t: "B4" }, from: 3 };
  off.pile.push(off.lastDiscard.tile);
  off.declareWin(1, 3);
  assert.deepEqual(off.result.deltas, [-25, 100, -25, -50]);
});

test("joker swap: a real tile takes a joker out of an exposed set", () => {
  const g = new Game({ rng: seeded(5) });
  g.players[2].exposed = [{ tile: "B7", size: 3, tiles: [{ id: 1, t: "B7" }, { id: 2, t: "B7" }, { id: 3, t: "J" }] }];
  g.players[0].rack = [{ id: 10, t: "B7" }, { id: 11, t: "C1" }];
  assert.deepEqual(g.swappable(0), [{ owner: 2, index: 0 }]);
  assert.equal(g.swapJoker(0, 2, 0), true);
  assert.deepEqual(g.players[2].exposed[0].tiles.map((t) => t.t), ["B7", "B7", "B7"]);
  assert.ok(g.players[0].rack.some((t) => t.t === "J"));
  assert.equal(g.swapJoker(0, 2, 0), false);
});
