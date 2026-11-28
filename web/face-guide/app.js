// @ts-check
// face guide: selfie camera -> MediaPipe Face Landmarker (in the browser) -> live gauges, score and one
// correction at a time. Logic lives in score.js. Nothing leaves the device.
import { AdviceTracker, CONFIG, EXPRESSION_PARTS, POSE_SIGNS, Smoother, adviceText, poseFromMatrix, scoreFrame } from "./score.js";

const MP_VERSION = "0.10.14";
const MP_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const GAUGE_RANGE = 20; // degrees shown either side of centre
const NO_FACE_MS = 600;
const UI_EVERY_MS = 100;

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const video = /** @type {HTMLVideoElement} */ ($("video"));
const canvas = /** @type {HTMLCanvasElement} */ ($("overlay"));
const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));

const WORDS = { yaw: ["left", "right"], pitch: ["down", "up"], roll: ["left", "right"] };
const AXES = /** @type {const} */ (["yaw", "pitch", "roll"]);

/** @type {any} */ let vision = null;
/** @type {any} */ let landmarker = null;
let delegate = "GPU";
/** @type {MediaStream | null} */ let stream = null;
let running = false;
let rafId = 0;
let lastVideoTime = -1;
let lastSeen = 0;
let lastUi = 0;
/** @type {any} */ let wakeLock = null;
const smoother = new Smoother();
const advice = new AdviceTracker();
/** @type {Record<string, string>} */ let colors = {};

function setState(state) {
  document.body.dataset.state = state;
  $("start").hidden = state === "loading" || state === "running";
  $("stop").hidden = state !== "running";
}

function setMsg(text, isError = false) {
  const el = $("msg");
  el.textContent = text;
  el.className = isError ? "msg error" : "msg";
}

function setHint(text, ok = false) {
  const el = $("hint");
  el.textContent = text;
  el.className = ok ? "hint ok" : "hint";
}

function readColors() {
  const css = getComputedStyle(document.documentElement);
  colors = { primary: css.getPropertyValue("--primary").trim(), accent: css.getPropertyValue("--accent").trim() };
  // The overlay sits on a dark video, so the light-mode olive accent is too dim there.
  colors.ok = "#A2D22D";
}
readColors();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readColors);

// Build the expression rows and gauge target zones once.
const rowEls = {};
for (const name of Object.keys(EXPRESSION_PARTS)) {
  const li = document.createElement("li");
  const label = document.createElement("span");
  label.textContent = name.replace("_", " ");
  const val = document.createElement("span");
  val.textContent = "–";
  li.append(label, val);
  $("rows").append(li);
  rowEls[name] = val;
}
for (const gauge of document.querySelectorAll(".gauge")) {
  const zone = /** @type {HTMLElement} */ (gauge.querySelector(".zone"));
  zone.style.width = `${(CONFIG.poseFull / GAUGE_RANGE) * 100}%`;
}

async function loadLandmarker() {
  if (landmarker) return;
  vision = await import(`${MP_CDN}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_CDN}/wasm`);
  const make = (d) =>
    vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: d },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
  try {
    delegate = "GPU";
    landmarker = await make("GPU");
  } catch {
    delegate = "CPU";
    landmarker = await make("CPU");
  }
}

async function openCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
  });
  video.srcObject = stream;
  await new Promise((resolve) => {
    if (video.readyState >= 1) resolve(undefined);
    else video.addEventListener("loadedmetadata", () => resolve(undefined), { once: true });
  });
  await video.play();
  const w = video.videoWidth || 3;
  const h = video.videoHeight || 4;
  canvas.width = w;
  canvas.height = h;
  $("frame").style.setProperty("--ar", String(w / h));
}

function errorText(err) {
  const name = err && err.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access was blocked. Allow the camera for this site in your browser settings, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera was found on this device.";
  if (name === "NotReadableError") return "The camera is busy. Close other apps using it, then try again.";
  if (name === "NotSupportedError") return "The camera isn't available here. The page needs HTTPS and camera permission.";
  if (name === "Error" && err.message) return err.message; // our own messages
  return `Could not start: ${err && err.message ? err.message : err}`;
}

async function start() {
  setState("loading");
  setMsg("");
  setHint("Starting camera and loading the face model…");
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("This browser has no camera support (needs HTTPS).");
    const results = await Promise.allSettled([loadLandmarker(), openCamera()]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed) {
      if (results[0].status === "rejected") {
        stopStream();
        throw new Error("Could not load the face model. Check your connection and try again.");
      }
      throw /** @type {PromiseRejectedResult} */ (failed).reason;
    }
  } catch (err) {
    stopStream();
    setState("error");
    setMsg(errorText(err), true);
    $("start").textContent = "Try again";
    return;
  }
  smoother.reset();
  advice.reset();
  lastSeen = 0;
  lastVideoTime = -1;
  running = true;
  setState("running");
  setHint("Look at the camera");
  requestWakeLock();
  rafId = requestAnimationFrame(tick);
}

function stopStream() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
}

function stop() {
  running = false;
  cancelAnimationFrame(rafId);
  stopStream();
  releaseWakeLock();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  setState("idle");
  setMsg("");
  $("start").textContent = "Start camera";
  resetReadouts();
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) wakeLock = await /** @type {any} */ (navigator).wakeLock.request("screen");
  } catch {}
}
function releaseWakeLock() {
  try {
    if (wakeLock) wakeLock.release();
  } catch {}
  wakeLock = null;
}
document.addEventListener("visibilitychange", () => {
  if (running && document.visibilityState === "visible") requestWakeLock();
});
addEventListener("pagehide", () => {
  stopStream();
  releaseWakeLock();
});

function resetReadouts() {
  $("total").textContent = "–";
  $("parts").textContent = "out of 100";
  for (const axis of AXES) {
    $(`v-${axis}`).textContent = "–";
    $(`m-${axis}`).style.left = "50%";
    $(`m-${axis}`).closest(".gauge")?.classList.remove("ok");
  }
  for (const el of Object.values(rowEls)) el.textContent = "–";
}

function tick() {
  if (!running) return;
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    try {
      handle(landmarker.detectForVideo(video, performance.now()));
    } catch (err) {
      console.error(err);
      if (delegate === "GPU") fallbackToCpu();
    }
  }
  rafId = requestAnimationFrame(tick);
}

async function fallbackToCpu() {
  running = false;
  try {
    landmarker.close();
    landmarker = null;
    delegate = "CPU";
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_CDN}/wasm`);
    landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    running = true;
    rafId = requestAnimationFrame(tick);
  } catch (err) {
    setState("error");
    setMsg(errorText(err), true);
  }
}

function handle(result) {
  const now = performance.now();
  const hasFace = result.faceLandmarks && result.faceLandmarks.length && result.facialTransformationMatrixes && result.facialTransformationMatrixes.length;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!hasFace) {
    if (now - lastSeen > NO_FACE_MS) {
      smoother.reset();
      advice.reset();
      if (now - lastUi > UI_EVERY_MS) {
        lastUi = now;
        setHint("Can't see your face. Center it in the frame.");
        resetReadouts();
      }
    }
    return;
  }
  lastSeen = now;

  const pose = poseFromMatrix(result.facialTransformationMatrixes[0].data);
  /** @type {Record<string, number>} */
  const raw = { ...pose };
  const categories = (result.faceBlendshapes && result.faceBlendshapes[0] && result.faceBlendshapes[0].categories) || [];
  for (const c of categories) raw[c.categoryName] = c.score;
  const smooth = smoother.update(raw);
  const scored = scoreFrame({ pose: { pitch: smooth.pitch, yaw: smooth.yaw, roll: smooth.roll }, blendshapes: smooth });
  const key = advice.update(scored.parts, now);

  drawOval(result.faceLandmarks[0], scored.perfect);

  if (now - lastUi < UI_EVERY_MS) return;
  lastUi = now;
  render(scored, key, smooth);
}

function drawOval(landmarks, perfect) {
  const conns = vision.FaceLandmarker.FACE_LANDMARKS_FACE_OVAL;
  ctx.lineWidth = Math.max(2, canvas.width / 200);
  ctx.lineJoin = "round";
  ctx.strokeStyle = perfect ? colors.ok : "rgba(255,255,255,.75)";
  ctx.beginPath();
  for (const { start, end } of conns) {
    ctx.moveTo(landmarks[start].x * canvas.width, landmarks[start].y * canvas.height);
    ctx.lineTo(landmarks[end].x * canvas.width, landmarks[end].y * canvas.height);
  }
  ctx.stroke();
}

function render(scored, key, smooth) {
  $("total").textContent = String(Math.round(scored.total));
  $("parts").textContent = `Pose ${Math.round(scored.pose)} · Expression ${Math.round(scored.expression)}`;

  for (const axis of AXES) {
    const part = scored.parts[axis];
    const shown = part.value * POSE_SIGNS[axis];
    const clamped = Math.max(-GAUGE_RANGE, Math.min(GAUGE_RANGE, shown));
    $(`m-${axis}`).style.left = `${50 + (clamped / GAUGE_RANGE) * 50}%`;
    $(`v-${axis}`).textContent = `${Math.abs(shown).toFixed(1)}° ${WORDS[axis][shown >= 0 ? 1 : 0]}`;
    $(`m-${axis}`).closest(".gauge")?.classList.toggle("ok", part.penalty === 0);
  }
  for (const [name, el] of Object.entries(rowEls)) {
    const part = scored.parts[name];
    el.textContent = part ? `${Math.round(part.score * 100)}` : "–";
  }

  if (scored.perfect) setHint("Perfect. Hold it right there.", true);
  else if (key) setHint(adviceText(key, scored.parts[key].value));
  else setHint("Almost there. Hold steady.");
  void smooth;
}

$("start").addEventListener("click", start);
$("stop").addEventListener("click", stop);
