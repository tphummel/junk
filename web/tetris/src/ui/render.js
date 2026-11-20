// Canvas drawing for the board, ghost piece and the small hold/next previews.

import { COLS, HIDDEN_ROWS, VISIBLE_ROWS } from "../game/board.js";
import { pieceCells } from "../game/pieces.js";
import { landingY } from "../game/state.js";

/** @typedef {import("../game/pieces.js").PieceType} PieceType */
/** @typedef {import("../game/state.js").Game} Game */
/** @typedef {{ board: string, grid: string, text: string }} Theme */

/**
 * Hand-chosen block colors, bright like carved stone inlays. Each is at least 4:1 against both board
 * backgrounds (#2A3440 light, #1B222B dark) and 6:1 against the engraved letter color INK.
 * @type {Record<PieceType, string>}
 */
export const PIECE_COLORS = {
  I: "#18A1C3",
  O: "#AC9315",
  T: "#EA55DE",
  S: "#15AA21",
  Z: "#EC6974",
  J: "#6093EB",
  L: "#E1781C",
};

/** Engraved letter and carved-outline color; a letter on every block keeps color from being the only cue. */
export const INK = "#1A1208";

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
 * One block: a bright face, a carved inset outline and an engraved letter, lit from the top left.
 * @param {CanvasRenderingContext2D} ctx
 * @param {PieceType} type
 * @param {number} px left
 * @param {number} py top
 * @param {number} size cell size in pixels
 * @param {number} [alpha]
 */
function drawBlock(ctx, type, px, py, size, alpha = 1) {
  ctx.globalAlpha = alpha;
  const lw = Math.max(1, size * 0.07);
  ctx.fillStyle = PIECE_COLORS[type];
  ctx.fillRect(px, py, size, size);
  // Bevel: light on the top and left edges, shade on the bottom and right.
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fillRect(px, py, size, lw);
  ctx.fillRect(px, py, lw, size);
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(px, py + size - lw, size, lw);
  ctx.fillRect(px + size - lw, py, lw, size);
  // Carved outline inset from the edge.
  const inset = size * 0.2;
  ctx.strokeStyle = INK;
  ctx.globalAlpha = alpha * 0.55;
  ctx.lineWidth = lw;
  ctx.strokeRect(px + inset, py + inset, size - 2 * inset, size - 2 * inset);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = INK;
  ctx.font = `bold ${Math.floor(size * 0.4)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(type, px + size / 2, py + size / 2 + size * 0.03);
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
  const stone = ctx.createLinearGradient(0, 0, 0, canvas.height);
  stone.addColorStop(0, theme.board);
  stone.addColorStop(1, theme.grid);
  ctx.fillStyle = stone;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(255,255,255,0.07)";
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
