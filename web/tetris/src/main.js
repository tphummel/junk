// Boot, the fixed-timestep loop and the screen state machine (title, playing, paused, over).
// The game advances only through step(), 60 times per game second, so rendering speed never changes play.

import { TICKS_PER_SECOND } from "./game/rules.js";
import { createGame, step } from "./game/state.js";
import { createRepeater } from "./input/actions.js";
import { createGamepad, describePad } from "./input/gamepad.js";
import { createKeyboard } from "./input/keyboard.js";
import { createHud } from "./ui/hud.js";
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

const keyboard = createKeyboard(window);
const gamepad = createGamepad(window, {
  onConnect: () => refreshStatus(),
  onDisconnect: () => {
    refreshStatus();
    if (screen === "playing") setScreen("paused", "Controller disconnected.\nReconnect it and press Start, or press Esc to continue with the keyboard.");
  },
});
const repeater = createRepeater();
const hud = createHud(document);
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
  return { rulesVersion: g.rulesVersion, seed: g.seed, startedAt: Date.now(), ticks: 0, inputLog: [] };
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
        "\nKeyboard: arrows or WASD move, Z/X rotate, C hold, Space hard drop, Esc pause.",
    ],
    paused: ["Paused", note ?? "Press Esc or Start to resume, Backspace or B to quit."],
    over: ["Game over", `Score ${game.score}, ${game.lines} lines, level ${game.level}.\nPress A or Enter to play again.`],
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
  for (const action of actions) round.inputLog.push({ t: game.tick, action });
  if (game.over) {
    round.ticks = game.tick;
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
  return `id: ${pad.id}\nmapping: ${pad.mapping || "(none)"}\nbuttons down: ${pressed.join(", ") || "-"}\naxes: ${Array.from(pad.axes, (v) => v.toFixed(2)).join(", ")}`;
}

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
  drawBoard(boardCanvas, game, theme);
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
