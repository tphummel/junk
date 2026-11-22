// Turning log entries and statistics into text a person can read, copy and keep. Pure.

/** @typedef {import("./registry.js").LogEvent} LogEvent */
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
 * A controller's statistics as text, for the Stats view and the text download.
 * @param {Summary} s
 */
export function summaryText(s) {
  /** @type {string[]} */
  const out = [];
  const name = s.id.replace(/\s*\(.*\)\s*$/, "") || s.id;
  out.push(`P${s.slot}  ${name}`, `${s.connected ? "connected" : "disconnected"}, ${s.index === null ? "no index" : `index ${s.index}`}, ${s.mapping || "no"} mapping`, "");
  out.push("PERFORMANCE");
  if (s.report.samples > 0) {
    out.push(`  Device reports   about ${num(s.report.approxHz, 0)} Hz while a stick or trigger is moving  (every ${num(s.report.avgMs, 1)} ms on average)`);
    out.push(`                   min ${num(s.report.minMs, 1)}  median ${num(s.report.p50Ms, 1)}  95th ${num(s.report.p95Ms, 1)}  max ${num(s.report.maxMs, 1)} ms  jitter ${num(s.report.jitterMs, 2)} ms  (${s.report.samples} intervals)`);
  } else {
    out.push(s.deviceTimestamps ? "  Device reports   not measured yet: move a stick or trigger (button presses are too far apart to tell)" : "  Device reports   this browser gives no device timestamps, so the report rate cannot be measured");
  }
  if (s.age) out.push(`  Seen after       ${num(s.age.avgMs, 1)} ms on average, 95th ${num(s.age.p95Ms, 1)}, worst ${num(s.age.maxMs, 1)} ms  (from the device report to this page reading it)`);
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
 * @param {{ startedAt: string, exportedAt: string, dropped?: number }} meta
 */
export function controllerReport(summary, events, meta) {
  return [
    `controller lab - transcript for P${summary.slot}`,
    `session started ${meta.startedAt}, exported ${meta.exportedAt}`,
    "",
    summaryText(summary),
    "",
    `TRANSCRIPT  (${events.length} entries${meta.dropped ? `, ${meta.dropped} older entries were dropped` : ""})`,
    "     time        gap  event",
    transcriptText(events),
    "",
  ].join("\n");
}
