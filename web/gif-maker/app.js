// gif maker: video -> canvas frames -> gifenc. No uploads, no build step.
import { GIFEncoder, quantize, applyPalette } from "./gifenc.esm.js";

const MAX_FRAMES = 600;
const MIN_LEN = 0.1;

/** @param {string} id */
const $ = (id) => /** @type {any} */ (document.getElementById(id));
const video = /** @type {HTMLVideoElement} */ ($("video"));
const startEl = $("start"), endEl = $("end");
const fpsEl = $("fps"), widthEl = $("width"), speedEl = $("speed");
const directionEl = $("direction"), loopEl = $("loop"), colorsEl = $("colors");
const makeBtn = $("make"), cancelBtn = $("cancel"), playBtn = $("play");
const progress = $("progress"), statusEl = $("status"), errEl = $("err");

let videoUrl = "";
let gifUrl = "";
let baseName = "clip";
let cancelled = false;
let busy = false;
let previewing = false;

const fmt = (/** @type {number} */ t) => t.toFixed(2) + "s";

function showError(/** @type {string} */ msg) {
  errEl.textContent = msg;
  errEl.hidden = !msg;
}

/* ---------- loading ---------- */

function loadFile(/** @type {File | undefined} */ file) {
  if (!file) return;
  showError("");
  if (!file.type.startsWith("video/") && file.type !== "") {
    showError("That doesn't look like a video file.");
    return;
  }
  stopPreview();
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(file);
  baseName = file.name.replace(/\.[^.]+$/, "") || "clip";
  $("fileName").textContent = file.name;
  $("editor").hidden = true;
  $("result").hidden = true;
  video.src = videoUrl;
}

video.addEventListener("error", () => {
  if (!video.src) return;
  $("editor").hidden = true;
  showError("Your browser can't play that video. Try an MP4 (H.264) or WebM.");
});

video.addEventListener("loadedmetadata", () => {
  const d = video.duration;
  if (!isFinite(d) || d <= 0) {
    showError("Couldn't read the video length.");
    return;
  }
  for (const el of [startEl, endEl]) el.max = String(d);
  startEl.value = "0";
  endEl.value = String(Math.min(d, 5));
  widthEl.max = String(video.videoWidth);
  widthEl.value = String(Math.min(480, video.videoWidth));
  $("editor").hidden = false;
  video.currentTime = 0;
  refresh();
});

/* ---------- scrubber ---------- */

function refresh() {
  const d = video.duration || 1;
  const s = +startEl.value, e = +endEl.value;
  $("startT").textContent = fmt(s);
  $("endT").textContent = fmt(e);
  $("lenT").textContent = fmt(e - s);
  const sel = $("sel");
  sel.style.left = (s / d) * 100 + "%";
  sel.style.width = ((e - s) / d) * 100 + "%";
  $("fpsO").textContent = fpsEl.value;
  summarize();
}

function placeHead() {
  const d = video.duration || 1;
  $("head").style.left = (video.currentTime / d) * 100 + "%";
}

startEl.addEventListener("input", () => {
  stopPreview();
  if (+startEl.value > +endEl.value - MIN_LEN) startEl.value = String(Math.max(0, +endEl.value - MIN_LEN));
  video.currentTime = +startEl.value;
  refresh();
});

endEl.addEventListener("input", () => {
  stopPreview();
  if (+endEl.value < +startEl.value + MIN_LEN) endEl.value = String(Math.min(video.duration, +startEl.value + MIN_LEN));
  // Show the last frame that will be included, not the first excluded one.
  video.currentTime = Math.max(0, +endEl.value - 0.001);
  refresh();
});

video.addEventListener("timeupdate", placeHead);
video.addEventListener("seeked", placeHead);

function stopPreview() {
  previewing = false;
  video.pause();
  playBtn.textContent = "Play selection";
}

playBtn.addEventListener("click", () => {
  if (previewing) return stopPreview();
  previewing = true;
  playBtn.textContent = "Stop";
  video.playbackRate = +speedEl.value;
  video.currentTime = +startEl.value;
  video.play();
  const tick = () => {
    if (!previewing) return;
    if (video.currentTime >= +endEl.value || video.ended) video.currentTime = +startEl.value;
    placeHead();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

for (const el of [fpsEl, widthEl, speedEl, directionEl, loopEl, colorsEl]) {
  el.addEventListener("input", () => {
    if (el === speedEl && previewing) video.playbackRate = +speedEl.value;
    refresh();
  });
}

/* ---------- plan ---------- */

function plan() {
  const start = +startEl.value, end = +endEl.value;
  const fps = +fpsEl.value, speed = +speedEl.value;
  const step = speed / fps; // seconds of source per output frame
  const n = Math.max(1, Math.floor((end - start) / step));
  const times = Array.from({ length: n }, (_, i) => start + i * step);
  /** @type {number[]} */
  let order = times.map((_, i) => i);
  if (directionEl.value === "reverse") order.reverse();
  else if (directionEl.value === "boomerang") order = order.concat(order.slice(1, -1).reverse());
  const w = Math.min(video.videoWidth || 1, Math.max(16, Math.round(+widthEl.value) || 480));
  const h = Math.max(1, Math.round((w * video.videoHeight) / video.videoWidth));
  return { times, order, fps, w, h, colors: +colorsEl.value };
}

function summarize() {
  if (!video.videoWidth) return;
  const p = plan();
  const tooMany = p.times.length > MAX_FRAMES;
  $("summary").textContent =
    `${p.order.length} frames at ${p.w}x${p.h}, ${fmt(p.order.length / p.fps)} long.` +
    (tooMany ? ` Too many frames (max ${MAX_FRAMES}): shorten the clip or lower the frame rate.` : "");
  makeBtn.disabled = busy || tooMany;
}

/* ---------- encode ---------- */

function seek(/** @type {number} */ t) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) return resolve(undefined);
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve(undefined);
    };
    video.addEventListener("seeked", done);
    video.currentTime = t;
  });
}

function setBusy(/** @type {boolean} */ b) {
  busy = b;
  cancelBtn.hidden = !b;
  progress.hidden = !b;
  for (const el of [startEl, endEl, fpsEl, widthEl, speedEl, directionEl, loopEl, colorsEl, playBtn]) el.disabled = b;
  summarize();
}

async function make() {
  if (busy) return;
  stopPreview();
  showError("");
  const p = plan();
  if (p.times.length > MAX_FRAMES) return;
  cancelled = false;
  setBusy(true);
  const canvas = document.createElement("canvas");
  canvas.width = p.w;
  canvas.height = p.h;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d", { willReadFrequently: true }));
  const resumeAt = video.currentTime;
  try {
    const frames = [];
    for (let i = 0; i < p.times.length; i++) {
      if (cancelled) return void (statusEl.textContent = "Cancelled.");
      await seek(p.times[i]);
      ctx.drawImage(video, 0, 0, p.w, p.h);
      const { data } = ctx.getImageData(0, 0, p.w, p.h);
      const palette = quantize(data, p.colors);
      frames.push({ palette, index: applyPalette(data, palette) });
      progress.value = ((i + 1) / p.times.length) * 0.95;
      statusEl.textContent = `Capturing frame ${i + 1} of ${p.times.length}`;
    }
    statusEl.textContent = "Encoding";
    const gif = GIFEncoder();
    // GIF delays are whole centiseconds: round cumulative time so the total stays accurate.
    const cum = (/** @type {number} */ j) => Math.round(((j + 1) * 100) / p.fps);
    p.order.forEach((k, j) => {
      const cs = Math.max(2, cum(j) - (j ? cum(j - 1) : 0));
      gif.writeFrame(frames[k].index, p.w, p.h, {
        palette: frames[k].palette,
        delay: cs * 10,
        repeat: loopEl.value === "forever" ? 0 : -1,
      });
    });
    gif.finish();
    const blob = new Blob([gif.bytes()], { type: "image/gif" });
    if (gifUrl) URL.revokeObjectURL(gifUrl);
    gifUrl = URL.createObjectURL(blob);
    $("out").src = gifUrl;
    $("download").href = gifUrl;
    $("download").download = `${baseName}.gif`;
    $("outInfo").textContent = `${p.w}x${p.h}, ${p.order.length} frames, ${(blob.size / 1024 / 1024).toFixed(2)} MB`;
    $("result").hidden = false;
    statusEl.textContent = "Done.";
    $("result").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    showError("Something went wrong: " + (err instanceof Error ? err.message : String(err)));
    statusEl.textContent = "";
  } finally {
    setBusy(false);
    progress.value = 0;
    video.currentTime = resumeAt;
  }
}

makeBtn.addEventListener("click", make);
cancelBtn.addEventListener("click", () => (cancelled = true));

/* ---------- file input and drop ---------- */

const drop = $("drop");
$("file").addEventListener("change", (/** @type {any} */ e) => loadFile(e.target.files[0]));
for (const ev of ["dragenter", "dragover"]) {
  drop.addEventListener(ev, (/** @type {Event} */ e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
}
for (const ev of ["dragleave", "drop"]) {
  drop.addEventListener(ev, () => drop.classList.remove("over"));
}
drop.addEventListener("drop", (/** @type {any} */ e) => {
  e.preventDefault();
  loadFile(e.dataTransfer?.files[0]);
});
