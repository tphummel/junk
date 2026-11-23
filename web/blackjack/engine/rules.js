// Blackjack rule sets: the one place that says what game is being played.
// Plain JavaScript that runs in the browser as written (ADR 0002); tests are in api/blackjack.test.mjs.

/**
 * @typedef {object} Rules
 * @property {number} decks number of decks in the shoe (1, 2, 4, 6 or 8)
 * @property {boolean} h17 dealer hits soft 17 (false: dealer stands on all 17s)
 * @property {1.5|1.2} blackjackPays blackjack payout (3:2 or 6:5)
 * @property {boolean} das double allowed after splitting
 * @property {'none'|'late'} surrender late surrender (after the dealer checks for blackjack)
 * @property {boolean} resplitAces aces may be split again
 * @property {number} maxHands most hands a player may split to (aces included)
 */

/** US peek game: 6 decks, H17, 3:2, DAS, late surrender. */
export const DEFAULT_RULES = Object.freeze(
  /** @type {Rules} */ ({
    decks: 6,
    h17: true,
    blackjackPays: 1.5,
    das: true,
    surrender: "late",
    resplitAces: false,
    maxHands: 4,
  }),
);

export const DECK_OPTIONS = [1, 2, 4, 6, 8];

/**
 * Fill in defaults and check every field, so a bad URL or stored value cannot reach the solver.
 * @param {Partial<Rules>} [partial]
 * @returns {Rules}
 */
export function normalizeRules(partial = {}) {
  const r = { ...DEFAULT_RULES, ...partial };
  return {
    decks: DECK_OPTIONS.includes(Number(r.decks)) ? Number(r.decks) : DEFAULT_RULES.decks,
    h17: Boolean(r.h17),
    blackjackPays: Number(r.blackjackPays) === 1.2 ? 1.2 : 1.5,
    das: Boolean(r.das),
    surrender: r.surrender === "late" ? "late" : "none",
    resplitAces: Boolean(r.resplitAces),
    maxHands: Math.min(4, Math.max(2, Math.round(Number(r.maxHands)) || 4)),
  };
}

/**
 * A short stable identifier, e.g. "6d-h17-32-das-ls". Used as a storage key and an Anki tag.
 * @param {Rules} rules
 */
export function rulesKey(rules) {
  return [
    `${rules.decks}d`,
    rules.h17 ? "h17" : "s17",
    rules.blackjackPays === 1.5 ? "32" : "65",
    rules.das ? "das" : "nodas",
    rules.surrender === "late" ? "ls" : "nosur",
    rules.resplitAces ? "rsa" : "norsa",
  ].join("-");
}

/**
 * One line a human can read, e.g. for the cover of a printed card.
 * @param {Rules} rules
 */
export function describeRules(rules) {
  return [
    rules.decks === 1 ? "1 deck" : `${rules.decks} decks`,
    rules.h17 ? "dealer hits soft 17" : "dealer stands on soft 17",
    rules.blackjackPays === 1.5 ? "blackjack pays 3:2" : "blackjack pays 6:5",
    rules.das ? "double after split" : "no double after split",
    rules.surrender === "late" ? "late surrender" : "no surrender",
    rules.resplitAces ? "resplit aces" : "no resplit aces",
  ].join(" · ");
}

/** Compact form of {@link describeRules}, e.g. "6D H17 3:2 DAS LS". */
export function shortRules(/** @type {Rules} */ rules) {
  return [
    `${rules.decks}D`,
    rules.h17 ? "H17" : "S17",
    rules.blackjackPays === 1.5 ? "3:2" : "6:5",
    rules.das ? "DAS" : "no DAS",
    rules.surrender === "late" ? "LS" : "no LS",
  ].join(" ");
}

/** Named rule sets for the picker. */
export const PRESETS = [
  { id: "common", label: "6 deck, H17 (most casinos)", rules: DEFAULT_RULES },
  { id: "s17", label: "6 deck, S17", rules: normalizeRules({ h17: false }) },
  { id: "eight", label: "8 deck, S17", rules: normalizeRules({ decks: 8, h17: false }) },
  { id: "double", label: "2 deck, H17", rules: normalizeRules({ decks: 2 }) },
  { id: "single-65", label: "1 deck, 6:5 (avoid)", rules: normalizeRules({ decks: 1, blackjackPays: 1.2, surrender: "none", das: false }) },
];
