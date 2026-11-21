// Boot, the fixed-timestep loop and the screen state machine (title, playing, paused, over).
// The game advances only through step(), 60 times per game second, so rendering speed never changes play.

import { DIFFICULTIES, difficultyById } from "./game/difficulty.js";
import { TICKS_PER_SECOND } from "./game/rules.js";
import { summarize } from "./game/stats.js";
import { createGame, step } from "./game/state.js";
import { createRepeater } from "./input/actions.js";
import { createGamepad, describeBinding, describePad } from "./input/gamepad.js";
import { createKeyboard } from "./input/keyboard.js";
import { createHud } from "./ui/hud.js";
import { createEffects } from "./ui/effects.js";
import { drawBoard, readTheme } from "./ui/render.js";
import { bestByMode, browserStorage, loadScores, saveScore } from "./ui/scores.js";

/** @typedef {import("./game/state.js").Game} Game */
/** @typedef {import("./game/state.js").GameAction} GameAction */
/** @typedef {"title" | "playing" | "paused" | "over"} Screen */
/**
 * One round, kept in memory for stats and replays later: seed + inputLog + ticks reproduces it exactly.
 * @typedef {object} Round
 * @property {number} rulesVersion
 * @property {number} seed
 * @property {string} mode difficulty id
 * @property {number} startedAt epoch ms
 * @property {number} ticks
 * @property {number} score
 * @property {number} lines
 * @property {number} level
 * @property {number} piecesPlaced
 * @property {number} goldSquares
 * @property {number} silverSquares
 * @property {number} holdsUsed
 * @property {{ t: number, action: GameAction }[]} inputLog
 */

const TICK_MS = 1000 / TICKS_PER_SECOND;
const MAX_TICKS_PER_FRAME = 5; // after a long stall, catch up a little, never spiral

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const boardCanvas = /** @type {HTMLCanvasElement} */ ($("board"));
const overlay = $("overlay");
const overlayTitle = $("overlay-title");
const overlayText = $("overlay-text");

const padStatus = $("pad-status");
const padDebug = $("pad-debug");
const padPanel = /** @type {HTMLDetailsElement} */ ($("pad-panel"));

/** @typedef {import("./input/gamepad.js").Bindings} Bindings */
const BINDINGS_KEY = "tetris-pad-bindings";

/** Learned controls per pad id, kept in localStorage. Storage can be blocked or empty, so every access is guarded. */
/** @returns {Record<string, Bindings>} */
function loadBindings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BINDINGS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
/** @type {Record<string, Bindings>} */
let savedBindings = loadBindings();
/** @param {Record<string, Bindings>} all */
function saveBindings(all) {
  savedBindings = all;
  try {
    localStorage.setItem(BINDINGS_KEY, JSON.stringify(all));
  } catch {
    // The binding still works for this visit.
  }
}

/** Last message from the "set hard drop" button, shown in the status panel. */
let bindNote = "";

const keyboard = createKeyboard(window);
const gamepad = createGamepad(window, {
  bindings: (pad) => savedBindings[pad.id] ?? {},
  onConnect: () => refreshStatus(),
  onDisconnect: () => {
    refreshStatus();
    if (screen === "playing") setScreen("paused", "Controller disconnected.\nReconnect it and press Start, or press Esc to continue with the keyboard.");
  },
});
const repeater = createRepeater();
const hud = createHud(document);
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const effects = createEffects({ reducedMotion: () => motion.matches });
let theme = readTheme();

/** @type {Screen} */
let screen = "title";
/** The difficulty of the round in play, or last chosen: the title menu starts on it. */
let mode = "practice";
/** @type {Game} */
let game = newGame(mode);
/** @type {Round} */
let round = newRound(game, mode);
/** @type {Round[]} */
const rounds = [];
const storage = browserStorage();
let bests = bestByMode(loadScores(storage));
/** @type {{ record: import("./ui/scores.js").ScoreRecord, newBest: boolean, saved: boolean } | null} */
let lastResult = null;

/** @param {string} mode difficulty id @returns {Game} */
function newGame(mode) {
  // The seed is made here, outside game/, and recorded; the game itself never touches randomness.
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  return createGame(seed, { garbagePerSecond: difficultyById(mode).garbagePerSecond });
}

/** @param {Game} g @param {string} mode @returns {Round} */
function newRound(g, mode) {
  return {
    rulesVersion: g.rulesVersion, seed: g.seed, mode, startedAt: Date.now(), ticks: 0,
    score: 0, lines: 0, level: g.level, piecesPlaced: 0, goldSquares: 0, silverSquares: 0, holdsUsed: 0,
    inputLog: [],
  };
}

/** @type {string | undefined} */
let note;

/** @typedef {{ label: string, detail?: string, run: () => void }} MenuItem */
const menuEl = $("menu");
let menuIndex = 0;
/** @type {MenuItem[]} */
let menuItems = [];

/** @param {import("./ui/scores.js").ScoreRecord} r */
function describeRecord(r) {
  return `${r.score} \u00b7 ${r.grade}${r.natural ? " \u00b7 NATURAL" : ""}`;
}

/** Menu items for the screen being shown. @returns {MenuItem[]} */
function menuFor(/** @type {Screen} */ screenName) {
  if (screenName === "title") {
    return DIFFICULTIES.map((d) => ({
      label: d.grade ? `${d.label} (${d.grade})` : d.label,
      detail: bests[d.id] ? `best ${describeRecord(bests[d.id])}` : "",
      run: () => startRound(d.id),
    }));
  }
  if (screenName === "paused") {
    return [
      { label: "Resume", run: () => setScreen("playing") },
      { label: "End game", detail: "locks in your score", run: () => finishRound("ended") },
    ];
  }
  if (screenName === "over") {
    return [
      { label: "Play again", run: () => startRound(mode) },
      { label: "Menu", run: () => setScreen("title") },
    ];
  }
  return [];
}

/** Draw the menu buttons, with the selected one marked. */
function renderMenu() {
  menuEl.replaceChildren(
    ...menuItems.map((item, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = item.label;
      if (item.detail) {
        const d = document.createElement("span");
        d.textContent = item.detail;
        b.appendChild(d);
      }
      if (i === menuIndex) b.setAttribute("aria-current", "true");
      b.addEventListener("click", () => {
        menuIndex = i;
        b.blur(); // so a later Enter or Space is ours alone, not also a click on this button
        item.run();
      });
      return b;
    }),
  );
}

/** The overlay for the current screen. */
function renderOverlay() {
  if (screen === "playing") {
    overlay.hidden = true;
    return;
  }
  const pad = gamepad.pad();
  /** @type {Record<Exclude<Screen, "playing">, [string, string]>} */
  const texts = {
    title: [
      "Tetris",
      "Pick a difficulty. Up and down choose, A or Enter starts." +
        (pad ? "\nD-pad move, A/B rotate, shoulder hold, up hard drop, Start pause." : "\nPress any button on your controller to connect it.") +
        "\nKeyboard: arrows or WASD move, Z/X rotate, C hold, Space hard drop, Esc pause." +
        "\nHard drop falls at once; slide or turn before it settles, or press again to lock." +
        "\nEasy, Medium and Hard push garbage rows up at the pace of a D, B or S rating.",
    ],
    paused: ["Paused", note ?? "Esc, Start or B resumes. End game locks in your score."],
    over: resultText(),
  };
  const [title, text] = texts[screen];
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  overlay.hidden = false;
  renderMenu();
}

/** Title and text for the game-over card. @returns {[string, string]} */
function resultText() {
  const r = lastResult?.record;
  if (!r) return ["Game over", ""];
  const label = difficultyById(r.mode).label;
  const lines = [
    `Lines ${r.score} (${r.lines} raw), level ${r.level}.`,
    `${r.rate} lines/sec` + (r.score > 0 ? `, grade ${r.grade}` : "") + (r.natural ? ", NATURAL!" : "."),
    lastResult?.newBest ? `New best for ${label}!` : bests[r.mode] ? `Best for ${label}: ${describeRecord(bests[r.mode])}` : "",
    lastResult?.saved ? "" : "(Could not save: this browser is blocking storage.)",
  ];
  return [r.ended === "ended" ? "Game ended" : "Game over", lines.filter(Boolean).join("\n")];
}

/** Controller line under the board. */
function refreshStatus() {
  const pad = gamepad.pad();
  padStatus.textContent = pad ? `Controller: ${describePad(pad)}` : "Controller: none (press any button to connect)";
  if (screen === "title") renderOverlay();
}

/** @param {Screen} next @param {string} [message] replaces the paused text, e.g. after a disconnect */
function setScreen(next, message) {
  screen = next;
  note = message;
  keyboard.clear();
  repeater.reset();
  menuItems = menuFor(next);
  menuIndex = next === "title" ? Math.max(0, DIFFICULTIES.findIndex((d) => d.id === mode)) : 0;
  renderOverlay();
}

/** @param {string} id difficulty */
function startRound(id) {
  mode = id;
  effects.clear();
  game = newGame(mode);
  round = newRound(game, mode);
  lastResult = null;
  setScreen("playing");
}

/**
 * Lock in the round: build the record, save it, and show the result.
 * @param {"topout" | "ended"} how the stack overflowed, or the player ended it from the pause menu
 */
function finishRound(how) {
  const stats = summarize(game.tick, game.score);
  Object.assign(round, {
    ticks: game.tick, score: game.score, lines: game.lines, level: game.level, piecesPlaced: game.piecesPlaced,
    goldSquares: game.goldSquares, silverSquares: game.silverSquares, holdsUsed: game.holdsUsed,
  });
  rounds.push(round);
  /** @type {import("./ui/scores.js").ScoreRecord} */
  const record = {
    at: Date.now(), mode, ended: how, score: game.score, lines: game.lines, level: game.level, ticks: game.tick,
    rate: stats.rate, grade: stats.grade, natural: stats.natural, piecesPlaced: game.piecesPlaced,
    goldSquares: game.goldSquares, silverSquares: game.silverSquares, seed: game.seed, rulesVersion: game.rulesVersion,
  };
  const before = bests[mode];
  const saved = saveScore(storage, record);
  bests = bestByMode(saved ? loadScores(storage) : [...Object.values(bests), record]);
  const newBest = game.score > 0 && (!before || bests[mode] === record);
  lastResult = { record, newBest, saved };
  setScreen("over");
}

/** Handle menu-style presses: move the selection, activate it, pause, back. @param {string} action */
function onMenuAction(action) {
  if (screen === "playing") {
    if (action === "pause") setScreen("paused");
    return;
  }
  if (action === "up" || action === "down") {
    menuIndex = (menuIndex + (action === "down" ? 1 : -1) + menuItems.length) % menuItems.length;
    renderMenu();
  } else if (action === "confirm") menuItems[menuIndex]?.run();
  else if (screen === "paused" && (action === "pause" || action === "back")) setScreen("playing");
  else if (screen === "over" && action === "back") setScreen("title");
}

/** Run one game tick from the keyboard state. */
function tick() {
  const pad = gamepad.poll();
  const held = new Set([...keyboard.held(), ...pad.held]);
  /** @type {GameAction[]} */
  const actions = [];
  for (const dir of repeater.update(held)) actions.push(dir);
  for (const a of [...keyboard.takePressed(), ...pad.pressed]) {
    if (a === "pause") {
      onMenuAction("pause");
      return false;
    }
    if (a === "rotateCW" || a === "rotateCCW" || a === "hardDrop" || a === "hold") actions.push(a);
  }
  if (held.has("softDrop")) actions.push("softDrop");

  step(game, actions);
  effects.add(game.events, performance.now());
  for (const action of actions) round.inputLog.push({ t: game.tick, action });
  if (game.over) {
    finishRound("topout");
    return false;
  }
  return true;
}

/** Raw pad state for comparing against a gamepad tester: id, mapping, pressed buttons and axes. */
function padReadout() {
  const pad = gamepad.pad();
  if (!pad) return "no controller";
  const pressed = Array.from(pad.buttons, (b, i) => (b.pressed ? i : -1)).filter((i) => i >= 0);
  const hard = savedBindings[pad.id]?.hardDrop;
  return [
    `id: ${pad.id}`,
    `mapping: ${pad.mapping || "(none)"}`,
    `buttons down: ${pressed.join(", ") || "-"}`,
    `axes: ${Array.from(pad.axes, (v) => v.toFixed(2)).join(", ")}`,
    `hard drop: d-pad up${hard ? ` or ${describeBinding(hard)}` : ""}`,
    bindNote,
  ].filter(Boolean).join("\n");
}

$("pad-bind").addEventListener("click", () => {
  if (screen === "playing") setScreen("paused");
  const started = gamepad.learn((binding) => {
    const pad = gamepad.pad();
    if (pad) saveBindings({ ...savedBindings, [pad.id]: { ...savedBindings[pad.id], hardDrop: binding } });
    bindNote = `Saved: hard drop is now ${describeBinding(binding)}.`;
  });
  bindNote = started ? "Press the control you want for hard drop (up on the d-pad)..." : "Connect a controller first: press any button on it.";
});
$("pad-reset").addEventListener("click", () => {
  gamepad.cancelLearn();
  const pad = gamepad.pad();
  if (pad) {
    const { [pad.id]: _removed, ...rest } = savedBindings;
    saveBindings(rest);
  }
  bindNote = "Hard drop reset to d-pad up.";
});

let last = performance.now();
let acc = 0;

/** @param {number} now */
function frame(now) {
  const dt = Math.min(now - last, 250);
  last = now;

  if (screen === "playing") {
    acc += dt;
    let n = 0;
    while (acc >= TICK_MS && n < MAX_TICKS_PER_FRAME) {
      acc -= TICK_MS;
      n++;
      if (!tick()) {
        acc = 0;
        break;
      }
    }
    if (n === MAX_TICKS_PER_FRAME) acc = 0;
  } else {
    acc = 0;
    for (const a of [...keyboard.takePressed(), ...gamepad.poll().pressed]) onMenuAction(a);
  }

  if (padPanel.open) padDebug.textContent = padReadout();
  drawBoard(boardCanvas, game, theme, effects, now);
  hud.update(game, theme, difficultyById(mode).label);
  requestAnimationFrame(frame);
}

// Pause when the page is hidden or loses focus, so a game never runs unattended.
const autoPause = () => {
  if (screen === "playing") setScreen("paused");
};
document.addEventListener("visibilitychange", () => document.hidden && autoPause());
window.addEventListener("blur", autoPause);

// Follow light/dark mode changes on the canvas.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  theme = readTheme();
});

setScreen("title");
refreshStatus();
requestAnimationFrame(frame);
