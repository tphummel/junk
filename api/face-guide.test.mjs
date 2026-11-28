// Tests for the pure logic of face guide (web/face-guide/score.js). Run with `npm test`.
import assert from "node:assert/strict";
import test from "node:test";
import {
  AdviceTracker,
  CONFIG,
  Smoother,
  adviceText,
  poseFromMatrix,
  ramp,
  scoreFrame,
} from "../web/face-guide/score.js";

const perfectFrame = () => ({
  pose: { pitch: 0, yaw: 0, roll: 0 },
  blendshapes: { mouthSmileLeft: 0, mouthSmileRight: 0, jawOpen: 0, eyeSquintLeft: 0, browDownLeft: 0 },
});

/** Column-major 4x4 from a 3x3 rotation given row by row. */
const columnMajor = (rows) => {
  const m = new Array(16).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[c * 4 + r] = rows[r][c];
  m[15] = 1;
  return m;
};
const rad = (d) => (d * Math.PI) / 180;

test("ramp: full, zero and linear between", () => {
  assert.equal(ramp(0, 4, 15), 1);
  assert.equal(ramp(4, 4, 15), 1);
  assert.equal(ramp(15, 4, 15), 0);
  assert.equal(ramp(30, 4, 15), 0);
  assert.ok(Math.abs(ramp(9.5, 4, 15) - 0.5) < 1e-12);
});

test("poseFromMatrix: identity is zero", () => {
  const p = poseFromMatrix(columnMajor([[1, 0, 0], [0, 1, 0], [0, 0, 1]]));
  assert.ok(Math.abs(p.pitch) < 1e-9 && Math.abs(p.yaw) < 1e-9 && Math.abs(p.roll) < 1e-9);
});

test("poseFromMatrix: recovers single-axis rotations, reading the matrix column-major", () => {
  const a = rad(12);
  const [c, s] = [Math.cos(a), Math.sin(a)];
  // Rotation about x gives pitch, about y gives yaw (negated in the formula), about z gives roll.
  const pitch = poseFromMatrix(columnMajor([[1, 0, 0], [0, c, -s], [0, s, c]]));
  assert.ok(Math.abs(pitch.pitch - 12) < 1e-9 && Math.abs(pitch.yaw) < 1e-9 && Math.abs(pitch.roll) < 1e-9);
  const yaw = poseFromMatrix(columnMajor([[c, 0, s], [0, 1, 0], [-s, 0, c]]));
  assert.ok(Math.abs(yaw.yaw - 12) < 1e-9 && Math.abs(yaw.pitch) < 1e-9 && Math.abs(yaw.roll) < 1e-9);
  const roll = poseFromMatrix(columnMajor([[c, -s, 0], [s, c, 0], [0, 0, 1]]));
  assert.ok(Math.abs(roll.roll - 12) < 1e-9 && Math.abs(roll.pitch) < 1e-9 && Math.abs(roll.yaw) < 1e-9);
  // A transposed (row-major) read would flip the sign of roll, so this pins the layout.
  assert.ok(roll.roll > 0);
});

test("scoreFrame: perfect frame scores 100 and is perfect", () => {
  const s = scoreFrame(perfectFrame());
  assert.equal(s.total, 100);
  assert.equal(s.perfect, true);
});

test("scoreFrame: within tolerance is still perfect, beyond it is not", () => {
  const f = perfectFrame();
  f.pose.yaw = CONFIG.poseFull;
  assert.equal(scoreFrame(f).perfect, true);
  f.pose.yaw = CONFIG.poseFull + 1;
  const s = scoreFrame(f);
  assert.equal(s.perfect, false);
  assert.ok(s.pose < 100 && s.parts.yaw.penalty > 0);
});

test("scoreFrame: pose and expression are weighted equally; sign of angle does not matter", () => {
  const f = perfectFrame();
  f.pose = { pitch: -15, yaw: 15, roll: 0 };
  const s = scoreFrame(f);
  assert.ok(Math.abs(s.pose - 100 / 3) < 1e-9);
  assert.ok(Math.abs(s.total - (s.pose + 100) / 2) < 1e-9);
});

test("scoreFrame: averages the left/right blendshape pair and skips absent groups", () => {
  const f = perfectFrame();
  f.blendshapes.mouthSmileLeft = 0.5;
  f.blendshapes.mouthSmileRight = 0.1;
  const s = scoreFrame(f);
  assert.ok(Math.abs(s.parts.smile.value - 0.3) < 1e-12);
  assert.equal(s.parts.pucker, undefined);
});

test("Smoother: first value passes through, then moves toward new values; blink is slower", () => {
  const sm = new Smoother(0.5, 0.1);
  assert.equal(sm.update({ yaw: 10, eyeBlinkLeft: 1 }).yaw, 10);
  const out = sm.update({ yaw: 0, eyeBlinkLeft: 0 });
  assert.equal(out.yaw, 5);
  assert.ok(Math.abs(out.eyeBlinkLeft - 0.9) < 1e-12);
  sm.reset();
  assert.equal(sm.update({ yaw: 3 }).yaw, 3);
});

test("AdviceTracker: pose outranks expression, hint holds, then clears", () => {
  const t = new AdviceTracker({ holdMs: 600 });
  const part = (kind, penalty, value = 0) => ({ kind, penalty, value, score: 1 - penalty });
  // Expression only
  assert.equal(t.update({ yaw: part("pose", 0), squint: part("expr", 0.4) }, 0), "squint");
  // A pose problem appears but is not clearly worse and the hold has not elapsed: keep squint
  assert.equal(t.update({ yaw: part("pose", 0.3), squint: part("expr", 0.4) }, 100), "squint");
  // After the hold, and clearly worse (0.7 >= 0.4 + 0.15): switch to pose
  assert.equal(t.update({ yaw: part("pose", 0.7), squint: part("expr", 0.4) }, 800), "yaw");
  // Fixed: clears
  assert.equal(t.update({ yaw: part("pose", 0), squint: part("expr", 0) }, 900), null);
  // Tiny penalties never show
  assert.equal(t.update({ yaw: part("pose", 0.05) }, 1000), null);
});

test("adviceText: tells the person to correct away from where they are (mirrored preview)", () => {
  // matrix yaw > 0 = turned toward their left, so tell them to turn right
  assert.equal(adviceText("yaw", 8), "Turn a little to your right");
  assert.equal(adviceText("yaw", -8), "Turn a little to your left");
  // matrix pitch > 0 = chin down, so raise it
  assert.equal(adviceText("pitch", 8), "Raise your chin a little");
  assert.equal(adviceText("pitch", -8), "Lower your chin a little");
  // matrix roll > 0 = tilted toward right shoulder, so tilt back toward the left
  assert.equal(adviceText("roll", 8), "Tilt your head toward your left shoulder");
  assert.equal(adviceText("roll", -8), "Tilt your head toward your right shoulder");
  assert.equal(adviceText("squint"), "Ease the squint: relax your eyes");
  assert.equal(adviceText("nope"), "");
});
