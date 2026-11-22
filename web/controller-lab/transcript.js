// Turning log entries and statistics into text a person can read, copy and keep. Pure.

import { clock, unavailable } from "./deviceinfo.js";

/** @typedef {import("./registry.js").LogEvent} LogEvent */
/** @typedef {import("./deviceinfo.js").Environment} Environment */
/** @typedef {ReturnType<typeof import("./registry.js").summarize>} Summary */

/** @param {number} ms @returns {string} like 12.345s */
export const seconds = (ms) => `${(ms / 1000).toFixed(3)}s`;

/** A duration in ms or seconds, whichever is easier to read; a dash if unknown. @param {number | null | undefined} ms */
export function duration(ms) {
  if (ms === null || ms === undefined) return "-";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Number.isInteger(ms) ? ms : ms.toFixed(1)} ms`;
}

/** @param {number | null | undefined} x @param {number} places @param {string} [unit] */
const num = (x, places, unit = "") => (x === null || x === undefined ? "-" : `${x.toFixed(places)}${unit}`);

/**
 * One line of a transcript.
 * @param {LogEvent} e
 * @param {{ player?: boolean }} [options] player: start the line with the player, for the all-controllers view
 */
export function formatEvent(e, options = {}) {
  const gap = e.gap === null ? "" : `+${(e.gap / 1000).toFixed(3)}s`;
  const who = options.player ? `P${e.slot}  ` : "";
  const head = `${seconds(e.t).padStart(10)}  ${gap.padStart(9)}  ${who}`;
  /** Device timestamp and how old the report was when we saw it. */
  const stamp = "ts" in e && e.ts !== undefined ? `   [device ${seconds(e.ts)}, seen ${e.age?.toFixed(1)} ms later]` : "";
  switch (e.type) {
    case "register":
      return `${head}REGISTERED  ${e.id}  (index ${e.index}, ${e.mapping || "no"} mapping, ${e.buttons} buttons, ${e.axes} axes)`;
    case "disconnect":
      return `${head}DISCONNECTED`;
    case "reconnect":
      return `${head}RECONNECTED  (index ${e.index})`;
    case "button": {
      const analog = e.value > 0 && e.value < 1 ? `  value ${e.value.toFixed(2)}` : "";
      if (e.state === "down") {
        const since = e.sinceLast === null ? "first press" : `${duration(e.sinceLast)} since last`;
        return `${head}${e.name.padEnd(8)} down  #${e.count}  ${since}${analog}${stamp}`;
      }
      return `${head}${e.name.padEnd(8)} up    held ${duration(e.heldMs)}${analog}${stamp}`;
    }
    case "axis": {
      const change = `${e.change >= 0 ? "+" : ""}${e.change.toFixed(2)}`;
      return `${head}${e.name.padEnd(8)} ${e.value.toFixed(2).padStart(5)}  (change ${change})${stamp}`;
    }
  }
}

/**
 * A transcript as text.
 * @param {readonly LogEvent[]} events
 * @param {{ player?: boolean }} [options]
 */
export function transcriptText(events, options = {}) {
  return events.map((e) => formatEvent(e, options)).join("\n");
}

/**
 * A controller's identity, connection and statistics as text, for the Stats view and the text download.
 * @param {Summary} s
 * @param {Environment} [env] the browser, to explain what it cannot report
 */
export function summaryText(s, env) {
  /** @type {string[]} */
  const out = [];
  const id = s.device.identity;
  const known = (/** @type {string | null} */ name, /** @type {string | null} */ code) => (name ? `${name}${code ? ` (${code})` : ""}` : code ? `unknown (${code})` : "not given by this browser");
  out.push(`P${s.slot}  ${id.name}`, "");
  out.push("DEVICE");
  out.push(`  Name             ${id.name}`);
  out.push(`  Maker            ${known(id.vendorName, id.vendorId)}`);
  out.push(`  Product          ${known(id.productName, id.productId)}`);
  out.push(`  Id as reported   ${id.raw}`);
  if (id.profile) out.push(`  Apple profile    ${id.profile}${/^extended/i.test(id.profile) ? " (the full layout: two sticks, triggers, shoulders, d-pad and four buttons)" : /^gamepad$/i.test(id.profile) ? " (the basic layout: d-pad, four buttons and shoulders; no sticks)" : ""}`);
  out.push(`  Mapping          ${s.mapping || "none"}${s.mapping === "standard" ? " (the standard layout: buttons and sticks have fixed meanings)" : " (not the standard layout: only the numbers are known)"}`);
  out.push(`  Index            ${s.index === null ? "none while disconnected" : s.index}`);
  out.push(`  Controls         ${s.controls.buttons} buttons, ${s.controls.axes} axes`);
  out.push(`  Analog buttons   ${s.device.analogButtons.length ? s.device.analogButtons.join(", ") : "none seen (triggers that report a value between 0 and 1 show here)"}`);
  out.push(`  Touch buttons    ${s.device.touchSensitiveButtons.length ? s.device.touchSensitiveButtons.join(", ") : "none seen"}`);
  if (s.device.axisResolution.length) {
    out.push("  Stick resolution (smallest step seen so far; it can only shrink with more movement)");
    for (const a of s.device.axisResolution) out.push(`      ${a.name.padEnd(8)} ${a.smallestStep}  ${a.approxBits === null ? "too few small steps to tell the bit depth: move it slowly" : `about ${a.approxBits}-bit`}  (${a.steps} steps measured)`);
  } else out.push("  Stick resolution not measured yet: move a stick slowly");
  out.push(`  Vibration        ${s.device.vibration ? `${s.device.vibration.type}${s.device.vibration.playEffect ? ", can be played from a page" : ""}` : s.device.hapticActuators ? `${s.device.hapticActuators} haptic actuator(s) (older API)` : "none shown by this browser"}`);
  out.push(`  Extras           hand: ${s.device.hand ?? "none"}, touchpad touch points seen: ${s.device.touchesMax}, motion pose: ${s.device.pose ? "yes" : "no"}${s.device.displayId ? `, display ${s.device.displayId}` : ""}`);
  out.push("");
  out.push("CONNECTION");
  const c = s.connection;
  out.push(`  Status           ${c.connected ? `connected for ${clock(c.uptimeMs)} this time` : "disconnected now"}`);
  out.push(`  History          connected ${c.connects} time${c.connects === 1 ? "" : "s"}, dropped ${c.disconnects} time${c.disconnects === 1 ? "" : "s"}; ${clock(c.totalConnectedMs)} connected out of ${clock(c.sinceRegistrationMs)} since it registered`);
  const notes = env ? unavailable(env) : unavailable({ browser: "this browser", os: "this device", webKitOnly: false, gamepadApi: true, secureContext: true, webBluetooth: false, webHid: false, userAgent: "" });
  for (const n of notes) out.push(`  ${n.short.padEnd(16)} NOT AVAILABLE: ${n.why}`);
  out.push("");
  out.push("PERFORMANCE");
  const viaPolls = s.report.basis === "our polls";
  if (s.report.samples > 0) {
    out.push(`  Device reports   about ${num(s.report.approxHz, 0)} Hz while a stick or trigger is moving  (every ${num(s.report.avgMs, 1)} ms on average)`);
    out.push(`                   min ${num(s.report.minMs, 1)}  median ${num(s.report.p50Ms, 1)}  95th ${num(s.report.p95Ms, 1)}  max ${num(s.report.maxMs, 1)} ms  jitter ${num(s.report.jitterMs, 2)} ms  (${s.report.samples} intervals)`);
    if (viaPolls) out.push(`                   measured from this page's own polls, so it can be no finer than they are (about ${num(s.poll.approxHz, 0)} Hz here)`);
  } else {
    out.push(s.deviceTimestamps ? "  Device reports   not measured yet: move a stick or trigger (button presses are too far apart to tell)" : s.timestampsUnusable ? "  Device reports   not measured yet: move a stick or trigger (measured from this page's polls)" : "  Device reports   this browser gives no device timestamps, so it is measured from this page's polls once a stick or trigger moves");
  }
  if (s.timestampsUnusable) out.push("  Device clock     this browser's timestamps for the controller are not on the page's clock, so they are ignored: the report rate above comes from our polls and \"seen after\" is not available");
  else if (s.age) out.push(`  Seen after       ${num(s.age.avgMs, 1)} ms on average, 95th ${num(s.age.p95Ms, 1)}, worst ${num(s.age.maxMs, 1)} ms  (from the device report to this page reading it)`);
  out.push(`  Page polled it   ${s.polls} times, about ${num(s.poll.approxHz, 0)} Hz  (every ${num(s.poll.avgMs, 1)} ms, range ${num(s.poll.minMs, 1)} to ${num(s.poll.maxMs, 1)} ms)`);
  out.push(`  State changes    ${s.stateChanges}`);
  out.push(`  Inputs           ${s.inputs.total} in all: ${s.inputs.presses} presses, ${s.inputs.releases} releases, ${s.inputs.axisEvents} stick moves`);
  out.push(`                   ${s.inputs.perSecondNow} in the last second, peak ${s.inputs.perSecondPeak} in one second, idle for ${duration(s.inputs.idleMs)}`);
  out.push("", "BUTTONS");
  if (s.buttons.length === 0) out.push("  none pressed yet");
  for (const b of s.buttons) {
    out.push(`  ${b.name.padEnd(9)} ${String(b.presses).padStart(4)} presses  held avg ${duration(b.holdAvgMs).padStart(8)}  min ${duration(b.holdMinMs).padStart(8)}  max ${duration(b.holdMaxMs).padStart(8)}  fastest repeat ${duration(b.fastestRepeatMs)}`);
  }
  out.push("", "STICKS AND AXES");
  for (const a of s.axes) {
    out.push(`  ${a.name.padEnd(8)} range ${num(a.min, 2)} to ${num(a.max, 2)}  now ${num(a.last, 2)}  ${String(a.events).padStart(4)} moves  at rest: average ${num(a.restAvg, 3)}, noise ${num(a.restNoise, 3)}  (${a.restSamples} samples)`);
  }
  return out.join("\n");
}

/**
 * Everything for one controller as a text file: its statistics, then its transcript.
 * @param {Summary} summary
 * @param {readonly LogEvent[]} events
 * @param {{ startedAt: string, exportedAt: string, dropped?: number, environment?: Environment }} meta
 */
export function controllerReport(summary, events, meta) {
  return [
    `controller lab - transcript for P${summary.slot}`,
    `session started ${meta.startedAt}, exported ${meta.exportedAt}`,
    ...(meta.environment ? [`browser ${meta.environment.browser} on ${meta.environment.os}${meta.environment.webKitOnly ? " (every browser here uses Safari's engine)" : ""}`] : []),
    "",
    summaryText(summary, meta.environment),
    "",
    `TRANSCRIPT  (${events.length} entries${meta.dropped ? `, ${meta.dropped} older entries were dropped` : ""})`,
    "     time        gap  event",
    transcriptText(events),
    "",
  ].join("\n");
}
