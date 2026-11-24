# blackjack

A blackjack quick reference you can print, drill, and use to keep an honest record of live play. Served at `https://junk.tomhummel.com/blackjack/`.

This file is the project's plan and living notes. (It sits in `web/`, so it is served as-is; ADR 0003 prefers no notes there, and this is an agreed exception.)

## Decisions

- **Static, offline PWA.** Vanilla ES modules, no build step ([ADR 0002](../../adr/0002-no-web-build-step.md)), icons, manifest and a service worker ([ADR 0008](../../adr/0008-pwa-for-all-offline-for-self-contained.md)).
- **Rules are switchable.** Default is 6 decks, dealer hits soft 17, blackjack pays 3:2, double after split, late surrender, no resplit aces. Presets: 6D H17, 6D S17, 8D S17, 2D H17, 1D 6:5 (flagged "avoid").
- **Basic strategy only.** Hi-Lo counting is an optional last phase.
- **Printables are black and white first.** Meaning is carried by letter and texture (plain, hatch, box, black fill), never color. One 8.5×11 sheet, single-sided (home duplex alignment is unreliable), cut or folded so that every panel is 3×5 inches or smaller.
- **No spaced-repetition engine.** Weak-spot drilling is weighted-random from your miss history; for real SRS, export a file to Anki.
- **Data stays in the browser.** localStorage, with JSON and CSV export and import. No account, no API.
- **Fun first.** Live stats are hidden during a session; review happens afterward. Session limits are opt-in, and the reports show fun next to results.
- **No casino-policy warnings in the UI.**

## The engine

The strategy is computed, not typed in. `engine/ev.js` solves the EV of stand, hit, double, split and surrender for a hand against a dealer upcard; `engine/strategy.js` picks the best play for every cell and the house edge. The chart, printed cards, quiz answers, "why" explanations and Anki cards all read from it, so they cannot disagree. `api/blackjack.test.mjs` pins the output to published basic strategy (run `npm test` from the repo root).

Approximations, so the numbers can be trusted for what they are:

- The dealer has peeked: EVs assume no dealer blackjack. Insurance is never recommended.
- Every draw comes from the shoe with your first two cards and the dealer's upcard removed, with replacement afterward. Exact for infinite decks and a rounding error away for 4+ decks; for 1 and 2 decks it keeps the effect of the cards you can see.
- Hard totals are judged over every two-card way to make them (weighted by how likely each is), the usual "total-dependent" strategy.
- Hands with three or more cards use the hit/stand half of the code (D = hit, Ds = stand, R = the letter after it).
- The house edge assumes you follow the chart exactly. It is an estimate for the chosen rules.

## Layout

```
web/blackjack/
  index.html           reference chart (home)
  engine/rules.js      rule sets, presets, labels
  engine/ev.js         EV solver
  engine/strategy.js   charts, lookup, house edge
  manifest.webmanifest sw.js icon*.png apple-touch-icon.png
```

Planned (add every new file to `PRECACHE` in `sw.js`): `print/`, `drill/`, `play/`, `sessions/`, `stats/`, and a small shared store module.

## Plan and status

1. **Engine and reference chart.** Done.
2. **Printables.** The 8-panel one-cut mini-zine on US Letter landscape (each panel 4.25 × 2.75 in), plus a layout that cuts the sheet into four 3×5 cards. Panels: cover, hard totals, soft totals, pairs, table reference (payouts, hand signals, etiquette, no insurance), session log A (tally grid), session log B (tally, buy-in, cash-out, hours, fun rating, deviation count), guardrails (budget, time limit, "leave when", house edge and expected cost per hour). Verify by exporting to PDF in headless Chromium.
3. **Drills and Anki export.** Flash drill (hand vs upcard) with the reason and the EV cost of a miss, weak-spot mode, and a tab-separated file for Anki (front, back, tags such as `blackjack`, the rule-set key and the hand type; roughly 350 cards per rule set).
4. **Sessions and stats.** An entry form that mirrors the paper log, localStorage store, accuracy heatmap on the chart (hatch density, not color), trend, session ledger, bankroll against expectation, fun against result.
5. **Play-through and report polish.** A dealt-hand simulator with a real shoe, graded afterward, and a printable one-page report.
6. **Optional.** A Hi-Lo counting drill.

## The analog log

One mark per hand: `/` win, `\` loss, `–` push, `★` blackjack. Circle the mark if you broke from the chart; deviations are counted without judgment. The session header records date, table, rules, buy-in, cash-out and start and end times. The digital form is the same layout, so entering a session is just tallying the sheet.
