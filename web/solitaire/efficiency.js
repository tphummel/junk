// Efficiency measures for a Klondike game, worked out from its move log. Load before the page
// script. Nothing here is stored: the log is replayed from the saved moves, so the numbers are
// the same live, after a reload and in exports.
//
// log entries are { type: 'draw' | 'recycle' | 'move', from, t, ... } where t is game time in ms
// (the clock excludes paused time), so a gap between two moves is time spent thinking.
//
// Wasted draws: a pass is one trip through the stock, ended by a recycle. A repeat pass (the
// second or later) in which no card was played from the waste shows the same cards as the pass
// before, so every draw in it was wasted. A pass still in progress is not counted until it ends.
function solitaireEfficiency(log, elapsedMs) {
  let wastedDraws = 0;
  let fruitlessPasses = 0;
  let backFromFoundation = 0;
  let pass = 1;
  let draws = 0;
  let wastePlays = 0;
  let longestIdleMs = 0;
  let idleAfterMove = 0; // move number the longest gap came after
  let prevT = null;
  for (const m of log) {
    if (prevT !== null && m.t - prevT > longestIdleMs) {
      longestIdleMs = m.t - prevT;
      idleAfterMove = m.n - 1;
    }
    prevT = m.t;
    if (m.type === 'draw') draws++;
    else if (m.type === 'recycle') {
      if (pass > 1 && wastePlays === 0) {
        wastedDraws += draws;
        fruitlessPasses++;
      }
      pass++;
      draws = 0;
      wastePlays = 0;
    } else if (m.type === 'move') {
      if (m.from === 'w') wastePlays++;
      if (m.from[0] === 'f') backFromFoundation++;
    }
  }
  // time since the last move counts too, so the figure keeps growing while you think
  if (prevT !== null && Number.isFinite(elapsedMs) && elapsedMs - prevT > longestIdleMs) {
    longestIdleMs = elapsedMs - prevT;
    idleAfterMove = log.length;
  }
  return { wastedDraws, fruitlessPasses, backFromFoundation, longestIdleMs, idleAfterMove };
}
