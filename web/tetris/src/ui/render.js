// Canvas drawing for the board, ghost piece and the small hold/next previews.

import { COLS, HIDDEN_ROWS, VISIBLE_ROWS } from "../game/board.js";
import { SQUARE_SIZE as SQUARE_PX } from "../game/squares.js";
import { pieceCells } from "../game/pieces.js";
import { landingY } from "../game/state.js";

/** @typedef {import("../game/pieces.js").PieceType} PieceType */
/** @typedef {import("../game/state.js").Game} Game */
/** @typedef {ReturnType<typeof import("./effects.js").createEffects>} Effects */
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

/**
 * Gold (single-color) and silver (mixed) squares are drawn as one metallic slab across the whole square.
 * The stops run light to dark along the diagonal; the dark ones are still 4.5:1 against INK.
 * @type {Record<"gold" | "silver", { stops: string[], edge: string, glyph: string }>}
 */
export const METAL = {
  gold: { stops: ["#F7E08A", "#D9A520", "#B8860B", "#E9C65A"], edge: "#5A3E06", glyph: "\u2605" },
  silver: { stops: ["#F4F6F9", "#B9C1CC", "#8E98A4", "#DDE2E8"], edge: "#3B4450", glyph: "\u25C6" },
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
 * One cell of a gold or silver square: the slab's metal gradient, plus a dark border on every side that
 * faces something other than the same square.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("../game/board.js").Board} board
 * @param {number} r board row
 * @param {number} c board column
 * @param {{ kind: "gold" | "silver", minR: number, maxR: number, minC: number, maxC: number }} box the square's extent
 * @param {number} size
 */
function drawSquareCell(ctx, board, r, c, box, size) {
  const metal = METAL[box.kind];
  const id = board[r][c]?.squareId;
  const px = c * size;
  const py = (r - HIDDEN_ROWS) * size;
  const grad = ctx.createLinearGradient(
    box.minC * size, (box.minR - HIDDEN_ROWS) * size, (box.maxC + 1) * size, (box.maxR + 1 - HIDDEN_ROWS) * size,
  );
  metal.stops.forEach((color, i) => grad.addColorStop(i / (metal.stops.length - 1), color));
  ctx.fillStyle = grad;
  ctx.fillRect(px, py, size, size);
  // Faint seams between the cells of the slab.
  ctx.strokeStyle = "rgba(0,0,0,0.16)";
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);

  const same = (/** @type {number} */ rr, /** @type {number} */ cc) => board[rr]?.[cc]?.squareId === id;
  const t = Math.max(2, size * 0.1);
  ctx.fillStyle = metal.edge;
  if (!same(r - 1, c)) ctx.fillRect(px, py, size, t);
  if (!same(r + 1, c)) ctx.fillRect(px, py + size - t, size, t);
  if (!same(r, c - 1)) ctx.fillRect(px, py, t, size);
  if (!same(r, c + 1)) ctx.fillRect(px + size - t, py, t, size);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  if (!same(r - 1, c)) ctx.fillRect(px + t, py + t, size - 2 * t, 1);
  if (!same(r, c - 1)) ctx.fillRect(px + t, py + t, 1, size - 2 * t);
}

/** Light and glow colors per effect tone: [bright, deep]. */
const GLOW = {
  gold: ["#FFF2B0", "#E3A91B"],
  silver: ["#FFFFFF", "#9FB0C4"],
  plain: ["#FFFFFF", "#C9D3DF"],
};

/**
 * Draw squares' and line clears' flourish over the board.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Effects} fx
 * @param {number} now
 * @param {number} size cell size in pixels
 */
function drawEffects(ctx, fx, now, size) {
  const calm = fx.calm;
  const W = COLS * size;
  for (const e of fx.active(now)) {
    const p = Math.min(1, (now - e.start) / e.dur);
    const [bright, deep] = GLOW[e.tone];
    ctx.save();
    if (e.kind === "flash") {
      ctx.globalAlpha = (1 - p) * (1 - p) * (e.tone === "plain" ? 0.55 : 0.85);
      ctx.fillStyle = bright;
      ctx.fillRect(0, (e.row - HIDDEN_ROWS) * size, W, size);
    } else if (e.kind === "ring") {
      const grow = calm ? 0 : p * size * 0.9;
      ctx.globalAlpha = (1 - p) * 0.9;
      ctx.strokeStyle = bright;
      ctx.shadowColor = deep;
      ctx.shadowBlur = size * 0.6;
      ctx.lineWidth = Math.max(2, size * 0.14);
      ctx.strokeRect(e.col * size - grow, (e.row - HIDDEN_ROWS) * size - grow, SQUARE_PX * size + 2 * grow, SQUARE_PX * size + 2 * grow);
    } else if (e.kind === "shine") {
      // A diagonal band of light sweeping across the new square.
      const x0 = e.col * size;
      const y0 = (e.row - HIDDEN_ROWS) * size;
      const span = SQUARE_PX * size;
      ctx.beginPath();
      ctx.rect(x0, y0, span, span);
      ctx.clip();
      const pos = (p * 1.6 - 0.3) * span * 2;
      const g = ctx.createLinearGradient(x0 + pos - span * 0.3, y0, x0 + pos + span * 0.3, y0 + span * 0.6);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "rgba(255,255,255,0.85)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, span, span);
    } else if (e.kind === "spark") {
      const t = (now - e.start) / 1000;
      const x = (e.x + e.vx * t) * size;
      const y = (e.y - HIDDEN_ROWS + e.vy * t + 4 * t * t) * size; // a little gravity
      const r = size * 0.16 * (1 - p * 0.6);
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = p < 0.4 ? bright : deep;
      ctx.translate(x, y);
      ctx.rotate(t * 6);
      ctx.fillRect(-r, -r, 2 * r, 2 * r);
    } else if (e.kind === "popup") {
      const rise = calm ? 0 : p * 2.2;
      ctx.globalAlpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
      ctx.font = `bold ${Math.floor(size * 1.05)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const x = W / 2;
      const y = (e.row + 0.5 - HIDDEN_ROWS - rise) * size;
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(3, size * 0.2);
      ctx.strokeStyle = INK;
      ctx.strokeText(e.text, x, y);
      ctx.fillStyle = bright;
      ctx.fillText(e.text, x, y);
    }
    ctx.restore();
  }
}

/**
 * Draw the visible board, the ghost, the current piece and any flourish.
 * @param {HTMLCanvasElement} canvas
 * @param {Game} game
 * @param {Theme} theme
 * @param {Effects} [fx]
 * @param {number} [now] performance.now() for the effects
 */
export function drawBoard(canvas, game, theme, fx, now = 0) {
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

  // Where each square is, so its cells can share one gradient and one glyph.
  /** @type {Map<number, { kind: "gold" | "silver", minR: number, maxR: number, minC: number, maxC: number }>} */
  const squares = new Map();
  game.board.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (!cell?.squareId || !cell.square) return;
      const box = squares.get(cell.squareId) ?? { kind: cell.square, minR: r, maxR: r, minC: c, maxC: c };
      box.minR = Math.min(box.minR, r);
      box.maxR = Math.max(box.maxR, r);
      box.minC = Math.min(box.minC, c);
      box.maxC = Math.max(box.maxC, c);
      squares.set(cell.squareId, box);
    });
  });

  for (let r = HIDDEN_ROWS; r < game.board.length; r++) {
    game.board[r].forEach((cell, c) => {
      if (!cell) return;
      const box = cell.squareId ? squares.get(cell.squareId) : undefined;
      if (box) drawSquareCell(ctx, game.board, r, c, box, size);
      else drawBlock(ctx, cell.type, c * size, (r - HIDDEN_ROWS) * size, size);
    });
  }
  // A star on gold and a diamond on silver, so the kind never rests on color alone.
  ctx.fillStyle = INK;
  ctx.globalAlpha = 0.6;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const box of squares.values()) {
    const height = box.maxR - box.minR + 1;
    ctx.font = `${Math.floor(size * (height >= 3 ? 1.8 : height >= 2 ? 1.2 : 0.8))}px system-ui, sans-serif`;
    const cx = ((box.minC + box.maxC + 1) / 2) * size;
    const cy = ((box.minR + box.maxR + 1) / 2 - HIDDEN_ROWS) * size;
    if (cy > 0) ctx.fillText(METAL[box.kind].glyph, cx, cy);
  }
  ctx.globalAlpha = 1;

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
  if (fx) drawEffects(ctx, fx, now, size);
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
