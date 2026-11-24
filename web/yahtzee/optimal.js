// Hindsight benchmark for a finished Yahtzee daily. Load after engine.js.
//
// The daily dice are a fixed tape: the die at (puzzle, turn, roll number, position) never
// depends on earlier choices (see tapeDie). So once a puzzle's dice are known, the best
// possible game is a plain optimisation: for every turn, which dice to keep and which box to
// fill. This file finds it, and splits the gap to your score into "dice you chose to keep"
// and "boxes you chose to fill".
//
// State of the search: which boxes are filled (13 bits), the upper-section total capped at 63,
// and whether the Yahtzee box holds 50 (so a bonus Yahtzee is worth +100). Values are the most
// points still to come, so a turn's cost is (best from that state) - (points taken + best from
// the next state), and the costs of all 13 turns add up to exactly the gap to the best game.
//
// The search takes about a second, so the page runs it in a Web Worker: loaded as a worker
// script this file imports engine.js, answers { puzzle, tokens } messages with the report, and
// loaded as a normal script it exposes the same functions as YahtzeeOptimal. Everything lives
// inside one function because top-level script constants are several times slower to read.

(function () {
  'use strict';
  if (typeof importScripts === 'function') importScripts('/yahtzee/engine.js');
  const OPT_FULL = 8191; // all 13 boxes filled
  const YZ = YAHTZEE; // local copy: read in the hot loop
  const OPT_UPPER_CAP = 63;

  // one end-of-turn dice set (sorted) with everything the search needs to score it quickly
  function optionFor(dice, steps) {
    const sorted = dice.slice().sort((a, b) => a - b);
    const y = isYahtzee(sorted);
    const pts = [];
    const ptsJoker = [];
    for (let c = 0; c < 13; c++) {
      pts.push(points(c, sorted, false));
      ptsJoker.push(points(c, sorted, true));
    }
    return { dice: sorted, isY: y, pts, ptsJoker, steps: steps || null };
  }

  // the dice after re-rolling every die not held by mask (bit i = keep die i)
  function tapeReroll(puzzle, turn, rollNo, dice, mask) {
    return dice.map((d, i) => (mask & (1 << i) ? d : tapeDie(puzzle, turn, rollNo, i)));
  }

  // every distinct dice set a turn can end on, each with the shortest keep-plan that reaches it
  function turnOptions(puzzle, turn) {
    const seen = new Map();
    const add = (steps) => {
      const dice = steps[steps.length - 1].dice;
      const key = dice.slice().sort((a, b) => a - b).join('');
      if (!seen.has(key)) seen.set(key, optionFor(dice, steps));
    };
    const first = [0, 1, 2, 3, 4].map((i) => tapeDie(puzzle, turn, 1, i));
    const s1 = [{ dice: first, kept: [] }];
    add(s1);
    // two passes so a dice set reachable in two rolls is never recorded as a three-roll plan
    const second = [];
    for (let m1 = 0; m1 < 31; m1++) {
      const d2 = tapeReroll(puzzle, turn, 2, first, m1);
      const s2 = [...s1, { dice: d2, kept: first.map((_, i) => !!(m1 & (1 << i))) }];
      add(s2);
      second.push(s2);
    }
    for (const s2 of second) {
      const d2 = s2[1].dice;
      for (let m2 = 0; m2 < 31; m2++) {
        const d3 = tapeReroll(puzzle, turn, 3, d2, m2);
        add([...s2, { dice: d3, kept: d2.map((_, i) => !!(m2 & (1 << i))) }]);
      }
    }
    return [...seen.values()];
  }

  // the move tokens for a turn's steps followed by the box chosen
  function stepsToTokens(steps, cat) {
    let t = 'r' + steps[0].dice.join('');
    for (let i = 1; i < steps.length; i++) {
      let mask = 0;
      steps[i].kept.forEach((k, j) => { if (k) mask |= 1 << j; });
      t += 'x' + mask.toString(32) + steps[i].dice.join('');
    }
    return t + 's' + CAT_CHARS[cat];
  }

  function popcount13(m) {
    let n = 0;
    for (; m; m &= m - 1) n++;
    return n;
  }

  function createSolver(puzzle) {
    const memo = new Int16Array(8192 * 64 * 2).fill(-1);
    const optionsByTurn = [];
    const optionsFor = (turn) => optionsByTurn[turn] || (optionsByTurn[turn] = turnOptions(puzzle, turn));
    let argCat = -1; // box picked by the last evalOption call

    // boxes the dice may go in, as a bit mask (same rules as legalCats in engine.js)
    function legalMask(mask, o) {
      const open = ~mask & OPT_FULL;
      if (!(o.isY && mask & (1 << YZ))) return open;
      const upper = o.dice[0] - 1;
      if (open & (1 << upper)) return 1 << upper;
      return open >> 6 ? open & ~63 : open;
    }

    // points banked now and the state after filling box cat with option o
    function transition(mask, upper, yz, o, cat) {
      const joker = o.isY && (mask & (1 << YZ)) !== 0;
      const p = joker ? o.ptsJoker[cat] : o.pts[cat];
      let gain = p + (o.isY && yz ? 100 : 0);
      let nu = upper;
      if (cat < 6) {
        nu = upper + p;
        if (upper < OPT_UPPER_CAP && nu >= OPT_UPPER_CAP) gain += 35;
        if (nu > OPT_UPPER_CAP) nu = OPT_UPPER_CAP;
      }
      return { gain, mask: mask | (1 << cat), upper: nu, yz: cat === YZ ? (p === 50 ? 1 : 0) : yz, points: p };
    }

    // best total (points now + points to come) for ending the turn on option o
    function evalOption(mask, upper, yz, o) {
      let legal = legalMask(mask, o);
      const joker = o.isY && (mask & (1 << YZ)) !== 0;
      const table = joker ? o.ptsJoker : o.pts;
      const bonus = o.isY && yz ? 100 : 0;
      let best = -1;
      let bestCat = -1;
      while (legal) {
        const bit = legal & -legal;
        legal ^= bit;
        const cat = 31 - Math.clz32(bit);
        const p = table[cat];
        let gain = p + bonus;
        let nu = upper;
        if (cat < 6) {
          nu = upper + p;
          if (upper < OPT_UPPER_CAP && nu >= OPT_UPPER_CAP) gain += 35;
          if (nu > OPT_UPPER_CAP) nu = OPT_UPPER_CAP;
        }
        const total = gain + value(mask | bit, nu, cat === YZ ? (p === 50 ? 1 : 0) : yz);
        if (total > best) { best = total; bestCat = cat; }
      }
      argCat = bestCat;
      return best;
    }

    // most points still to come from this state
    function value(mask, upper, yz) {
      if (mask === OPT_FULL) return 0;
      const idx = ((mask << 6) | upper) * 2 + yz;
      const known = memo[idx];
      if (known >= 0) return known;
      let best = 0;
      for (const o of optionsFor(popcount13(mask) + 1)) {
        const v = evalOption(mask, upper, yz, o);
        if (v > best) best = v;
      }
      memo[idx] = best;
      return best;
    }

    // the best keep-plan and box from a state, in hindsight
    function bestPlay(mask, upper, yz) {
      let best = -1;
      let pick = null;
      let pickCat = -1;
      for (const o of optionsFor(popcount13(mask) + 1)) {
        const v = evalOption(mask, upper, yz, o);
        if (v > best) { best = v; pick = o; pickCat = argCat; }
      }
      const t = transition(mask, upper, yz, pick, pickCat);
      return { steps: pick.steps, cat: pickCat, points: t.points, gain: t.gain, value: best, next: t };
    }

    return { value, evalOption, transition, bestPlay, get argCat() { return argCat; } };
  }

  // the best possible game for a puzzle as an engine token string, plus its score
  function optimalGame(puzzle) {
    const solver = createSolver(puzzle);
    let st = { mask: 0, upper: 0, yz: 0 };
    let tokens = '';
    for (let turn = 1; turn <= 13; turn++) {
      const p = solver.bestPlay(st.mask, st.upper, st.yz);
      tokens += stepsToTokens(p.steps, p.cat);
      st = p.next;
    }
    return { tokens, total: solver.value(0, 0, 0) };
  }

  // does every die in this game match the puzzle's tape? (stored games can be edited or imported)
  function followsTape(puzzle, s) {
    return s.turns.every((turn) => turn.rolls.every((r, j) => r.dice.every((d, i) => {
      if (j > 0 && r.kept[i]) return d === turn.rolls[j - 1].dice[i];
      return d === tapeDie(puzzle, turn.turn, j + 1, i);
    })));
  }

  // Compare a finished game with the best one on the same dice. Returns null for an unfinished
  // game, { mismatch: true } when the dice are not the puzzle's, else the report:
  //   total / best         your score and the best possible
  //   rollLoss / catLoss   points lost to which dice you kept vs which box you filled
  //   turns[]              per turn: your dice, box and points, the cost, and the best line
  function efficiencyReport(puzzle, tokens) {
    const { s } = replay(tokens);
    if (!s.over) return null;
    if (!followsTape(puzzle, s)) return { mismatch: true };
    const solver = createSolver(puzzle);
    let st = { mask: 0, upper: 0, yz: 0 };
    let rollLoss = 0;
    let catLoss = 0;
    const turns = s.turns.map((turn) => {
      const dice = turn.rolls[turn.rolls.length - 1].dice;
      const o = optionFor(dice);
      const before = solver.value(st.mask, st.upper, st.yz);
      const bestForDice = solver.evalOption(st.mask, st.upper, st.yz, o);
      const t = solver.transition(st.mask, st.upper, st.yz, o, turn.cat);
      const actual = t.gain + solver.value(t.mask, t.upper, t.yz);
      const rl = before - bestForDice;
      const cl = bestForDice - actual;
      const best = rl + cl > 0 ? solver.bestPlay(st.mask, st.upper, st.yz) : null;
      rollLoss += rl;
      catLoss += cl;
      st = t;
      return {
        turn: turn.turn,
        rolls: turn.rolls,
        dice,
        cat: turn.cat,
        category: turn.category,
        points: turn.points,
        gain: t.gain,
        loss: rl + cl,
        rollLoss: rl,
        catLoss: cl,
        best: best && {
          steps: best.steps,
          cat: best.cat,
          category: CATS[best.cat],
          points: best.points,
          gain: best.gain,
        },
      };
    });
    const best = solver.value(0, 0, 0);
    return { puzzle, total: totals(s).total, best, rollLoss, catLoss, turns };
  }

  const api = { optimalGame, efficiencyReport, turnOptions, stepsToTokens, followsTape };
  if (typeof importScripts === 'function') {
    // worker: engine.js is not loaded here yet
    onmessage = (e) => {
      try { postMessage({ report: api.efficiencyReport(e.data.puzzle, e.data.tokens) }); }
      catch (err) { postMessage({ error: String(err && err.message || err) }); }
    };
  } else {
    globalThis.YahtzeeOptimal = api;
  }
})();
