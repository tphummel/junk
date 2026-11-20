// Canvas drawing for the board, ghost piece and the small hold/next previews.

import { COLS, HIDDEN_ROWS, VISIBLE_ROWS } from "../game/board.js";
import { pieceCells } from "../game/pieces.js";
import { landingY } from "../game/state.js";

/** @typedef {import("../game/pieces.js").PieceType} PieceType */
/** @typedef {import("../game/state.js").Game} Game */
/** @typedef {{ board: string, grid: string, text: string }} Theme */

/**
 * Hand-chosen piece colors, each about 4.2:1 against both board backgrounds (#F2F2F2 light, #0A0A0A dark),
 * so one set works in both modes. A letter is drawn on every block so color is never the only cue.
 * @type {Record<PieceType, string>}
 */
export const PIECE_COLORS = {
  I: "#1A7F93",
  O: "#897218",
  T: "#B235DB",
  S: "#18862A",
  Z: "#DA302B",
  J: "#456BDE",
  L: "#B05E1F",
};

/** Read the page's current colors from its CSS variables, so the canvas follows light and dark mode. @returns {Theme} */
export function readTheme() {
  const css = getComputedStyle(document.documentElement);
  const get = (/** @type {string} */ name) => css.getPropertyValue(name).trim();
  return { board: get("--board"), grid: get("--grid"), text: get("--text") };
}

/**
 * Size a canvas's backing store to its CSS size at the device pixel ratio.
 * @param {HTMLCanvasElement} canvas
 * @returns {CanvasRenderingContext2D}
 */
export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {PieceType} type
 * @param {number} px left
 * @param {number} py top
 * @param {number} size cell size in pixels
 * @param {number} [alpha]
 */
function drawBlock(ctx, type, px, py, size, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = PIECE_COLORS[type];
  ctx.fillRect(px, py, size, size);
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fillRect(px, py, size, Math.max(1, size * 0.12));
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fillRect(px, py + size - Math.max(1, size * 0.12), size, Math.max(1, size * 0.12));
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.floor(size * 0.5)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(type, px + size / 2, py + size / 2 + size * 0.04);
  ctx.globalAlpha = 1;
}

/**
 * Draw the visible board, the ghost and the current piece.
 * @param {HTMLCanvasElement} canvas
 * @param {Game} game
 * @param {Theme} theme
 */
export function drawBoard(canvas, game, theme) {
  const ctx = fitCanvas(canvas);
  const size = Math.min(canvas.width / COLS, canvas.height / VISIBLE_ROWS);
  ctx.fillStyle = theme.board;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 1; c < COLS; c++) {
    ctx.moveTo(Math.round(c * size) + 0.5, 0);
    ctx.lineTo(Math.round(c * size) + 0.5, VISIBLE_ROWS * size);
  }
  for (let r = 1; r < VISIBLE_ROWS; r++) {
    ctx.moveTo(0, Math.round(r * size) + 0.5);
    ctx.lineTo(COLS * size, Math.round(r * size) + 0.5);
  }
  ctx.stroke();

  for (let r = HIDDEN_ROWS; r < game.board.length; r++) {
    game.board[r].forEach((cell, c) => {
      if (cell) drawBlock(ctx, cell.type, c * size, (r - HIDDEN_ROWS) * size, size);
    });
  }

  const p = game.current;
  if (p) {
    const ghostY = /** @type {number} */ (landingY(game));
    for (const [dx, dy] of pieceCells(p.type, p.rot)) {
      const ghostRow = ghostY + dy - HIDDEN_ROWS;
      if (ghostRow >= 0) drawBlock(ctx, p.type, (p.x + dx) * size, ghostRow * size, size, 0.25);
    }
    for (const [dx, dy] of pieceCells(p.type, p.rot)) {
      const row = p.y + dy - HIDDEN_ROWS;
      if (row >= 0) drawBlock(ctx, p.type, (p.x + dx) * size, row * size, size);
    }
  }
}

/**
 * Draw one piece centered on a small canvas, or clear it when `type` is null.
 * @param {HTMLCanvasElement} canvas
 * @param {PieceType | null} type
 * @param {Theme} theme
 * @param {boolean} [dim] draw faded, for a hold slot that cannot be used yet
 */
export function drawMini(canvas, type, theme, dim = false) {
  const ctx = fitCanvas(canvas);
  ctx.fillStyle = theme.board;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!type) return;
  const cells = pieceCells(type, 0);
  const size = Math.floor(Math.min(canvas.width / 5, canvas.height / 3.5));
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  const w = Math.max(...xs) - Math.min(...xs) + 1;
  const h = Math.max(...ys) - Math.min(...ys) + 1;
  const ox = (canvas.width - w * size) / 2 - Math.min(...xs) * size;
  const oy = (canvas.height - h * size) / 2 - Math.min(...ys) * size;
  for (const [dx, dy] of cells) drawBlock(ctx, type, ox + dx * size, oy + dy * size, size, dim ? 0.4 : 1);
}
