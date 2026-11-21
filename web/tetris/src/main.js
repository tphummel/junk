// Boot, the fixed-timestep loop and the screen state machine (title, playing, paused, over).
// The game advances only through step(), 60 times per game second, so rendering speed never changes play.

import { TICKS_PER_SECOND } from "./game/rules.js";
import { summarize } from "./game/stats.js";
import { createGame, step } from "./game/state.js";
import { createRepeater } from "./input/actions.js";
import { createGamepad, describeBinding, describePad } from "./input/gamepad.js";
import { createKeyboard } from "./input/keyboard.js";
import { createHud } from "./ui/hud.js";
import { createEffects } from "./ui/effects.js";
import { drawBoard, readTheme } from "./ui/render.js";

/** @typedef {import("./game/state.js").Game} Game */
/** @typedef {import("./game/state.js").GameAction} GameAction */
/** @typedef {"title" | "playing" | "paused" | "over"} Screen */
/**
 * One round, kept in memory for stats and replays later: seed + inputLog + ticks reproduces it exactly.
 * @typedef {object} Round
 * @property {number} rulesVersion
 * @property {number} seed
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
/** @type {Game} */
let game = newGame();
/** @type {Round} */
let round = newRound(game);
/** @type {Round[]} */
const rounds = [];

/** @returns {Game} */
function newGame() {
  // The seed is made here, outside game/, and recorded; the game itself never touches randomness.
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  return createGame(seed);
}

/** @param {Game} g @returns {Round} */
function newRound(g) {
  return {
    rulesVersion: g.rulesVersion, seed: g.seed, startedAt: Date.now(), ticks: 0,
    score: 0, lines: 0, level: g.level, piecesPlaced: 0, goldSquares: 0, silverSquares: 0, holdsUsed: 0,
    inputLog: [],
  };
}

/** @type {string | undefined} */
let note;

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
      (pad
        ? "Press A or Enter to start.\nD-pad move, A/B rotate, shoulder hold, up hard drop, Start pause."
        : "Press Enter to start, or press any button on your controller to connect it.") +
        "\nKeyboard: arrows or WASD move, Z/X rotate, C hold, Space hard drop, Esc pause." +
        "\nHard drop falls at once; slide or turn before it settles, or press again to lock.",
    ],
    paused: ["Paused", note ?? "Press Esc or Start to resume, Backspace or B to quit."],
    over: [
      "Game over",
      `Lines ${game.score} (${game.lines} raw), level ${game.level}.\n${summarize(game.tick, game.score).rate} lines/sec` +
        (game.score > 0 ? `, grade ${summarize(game.tick, game.score).grade}` : "") +
        ".\nPress A or Enter to play again.",
    ],
  };
  const [title, text] = texts[screen];
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  overlay.hidden = false;
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
  renderOverlay();
}

function startRound() {
  effects.clear();
  game = newGame();
  round = newRound(game);
  setScreen("playing");
}

/** Handle menu-style presses (confirm, back, pause). @param {string} action */
function onMenuAction(action) {
  if (screen === "title" && (action === "confirm" || action === "hardDrop")) startRound();
  else if (screen === "playing" && action === "pause") setScreen("paused");
  else if (screen === "paused" && action === "pause") setScreen("playing");
  else if (screen === "paused" && action === "back") setScreen("title");
  else if (screen === "over" && action === "confirm") startRound();
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
    Object.assign(round, {
      ticks: game.tick, score: game.score, lines: game.lines, level: game.level, piecesPlaced: game.piecesPlaced,
      goldSquares: game.goldSquares, silverSquares: game.silverSquares, holdsUsed: game.holdsUsed,
    });
    rounds.push(round);
    setScreen("over");
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
  hud.update(game, theme);
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
