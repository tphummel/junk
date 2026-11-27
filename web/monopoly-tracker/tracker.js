// Pure logic for the Monopoly property tracker. No DOM; tested by api/monopoly-tracker.test.mjs.

/**
 * @typedef {{ id: string, type: "buy"|"rent"|"improve"|"sell"|"mortgage"|"unmortgage"|"other", amount: number, note?: string, at: number }} Entry
 *   amount is the cash flow to you: negative when you pay, positive when you receive.
 * @typedef {{ id: string, name: string, group: string, kind: "street"|"railroad"|"utility"|"custom", rents: number[] | null,
 *   tiers?: number[] | null, groupSize: number, price: number, mortgageValue: number, houseCost: number, rent: number, level: number, mortgaged: boolean, entries: Entry[] }} Property
 * @typedef {{ id: string, name: string, edition: "classic"|"mega", properties: Property[] }} Game
 */

/** Highest improvement level per edition: 1-4 houses, 5 hotel, 6 skyscraper (Mega). */
export const MAX_LEVEL = { classic: 5, mega: 6 };

/** Name of a property's current improvement: a railroad has a train depot, not houses. @param {Property} p */
export function levelName(p) {
  return p.kind === "railroad" ? (p.level ? "train depot" : "no depot") : levelLabel(p.level);
}

/** Highest improvement level for this property: a railroad takes one depot. @param {Game} g @param {Property} p */
export function maxLevel(g, p) {
  return p.kind === "railroad" ? 1 : MAX_LEVEL[g.edition];
}

/** @param {number} level */
export function levelLabel(level) {
  if (level <= 0) return "unimproved";
  if (level <= 4) return level === 1 ? "1 house" : `${level} houses`;
  return level === 5 ? "hotel" : "skyscraper";
}

/** Interest charged on top of the mortgage value to lift a mortgage. */
export const UNMORTGAGE_INTEREST = 0.1;

/** @param {number} n */
export const round = (n) => Math.round(n * 100) / 100;

/**
 * Money figures for one property.
 * - invested: purchase + improvements + mortgage interest paid (cost of owning it)
 * - returned: rent collected + improvements sold back
 * - profit: returned - invested (mortgage principal is a loan, so it is excluded)
 * - loan: mortgage principal currently outstanding
 * @param {Property} p
 * @param {Game} [g] when given, the estimate of rents to break even uses the rent the card pays now
 */
export function stats(p, g) {
  let invested = 0, rent = 0, sold = 0, interest = 0, loan = 0, rentCount = 0, other = 0;
  for (const e of p.entries) {
    switch (e.type) {
      case "buy": case "improve": invested -= e.amount; break;
      case "rent": rent += e.amount; rentCount++; break;
      case "sell": sold += e.amount; break;
      case "mortgage": loan += e.amount; break;
      case "unmortgage": {
        // Paid mortgage value + interest; the principal part clears the loan, the rest is cost.
        const principal = Math.min(loan, p.mortgageValue);
        loan -= principal;
        interest += -e.amount - principal;
        break;
      }
      default: other += e.amount;
    }
  }
  invested += interest;
  const returned = rent + sold + (other > 0 ? other : 0);
  invested += other < 0 ? -other : 0;
  const profit = returned - invested;
  const remaining = Math.max(0, invested - returned);
  const avgRent = rentCount ? rent / rentCount : 0;
  const perHit = avgRent || (g ? rentFor(g, p, 7) : null) || p.rent || 0;
  return {
    invested: round(invested), rent: round(rent), sold: round(sold), returned: round(returned),
    profit: round(profit), loan: round(loan), rentCount, avgRent: round(avgRent),
    remaining: round(remaining), broken: invested > 0 && remaining === 0,
    roi: invested > 0 ? profit / invested : 0,
    hitsToBreakEven: remaining > 0 && perHit > 0 ? Math.ceil(remaining / perHit) : remaining > 0 ? null : 0,
  };
}

/** @param {Game} g */
export function gameStats(g) {
  const t = { invested: 0, rent: 0, returned: 0, profit: 0, loan: 0, remaining: 0, count: g.properties.length, broken: 0 };
  for (const p of g.properties) {
    const s = stats(p, g);
    t.invested += s.invested; t.rent += s.rent; t.returned += s.returned; t.profit += s.profit; t.loan += s.loan;
    t.remaining += s.remaining;
    if (s.broken) t.broken++;
  }
  for (const k of ["invested", "rent", "returned", "profit", "loan", "remaining"]) t[k] = round(t[k]);
  return { ...t, roi: t.invested > 0 ? t.profit / t.invested : 0 };
}

let seq = 0;
/** @returns {string} */
export const uid = () => Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);

/** @param {{name: string, group: string, price: number, kind?: Property["kind"], rents?: number[] | null, tiers?: number[] | null, groupSize?: number, houseCost?: number, rent?: number, mortgageValue?: number}} o @returns {Property} */
export function newProperty(o) {
  return {
    id: uid(), name: o.name, group: o.group || "other", price: o.price,
    kind: o.kind ?? "custom", rents: o.rents ?? null, tiers: o.tiers ?? null, groupSize: o.groupSize ?? 0,
    mortgageValue: o.mortgageValue ?? Math.floor(o.price / 2), houseCost: o.houseCost ?? 0, rent: o.rent ?? 0,
    level: 0, mortgaged: false,
    entries: [{ id: uid(), type: "buy", amount: -o.price, at: Date.now() }],
  };
}

/** @param {Property} p @param {Entry["type"]} type @param {number} amount @param {string} [note] */
export function addEntry(p, type, amount, note) {
  p.entries.push({ id: uid(), type, amount: round(amount), note, at: Date.now() });
}

/**
 * Mortgage or lift the mortgage. Returns an error string if not allowed.
 * @param {Property} p @returns {string | null}
 */
export function toggleMortgage(p) {
  if (!p.mortgaged) {
    if (p.level > 0) return "Sell all improvements before mortgaging.";
    p.mortgaged = true;
    addEntry(p, "mortgage", p.mortgageValue, "mortgaged");
  } else {
    p.mortgaged = false;
    addEntry(p, "unmortgage", -Math.ceil((p.mortgageValue * 11) / 10), "lifted mortgage (+10%)");
  }
  return null;
}

/** Build one improvement level. @param {Property} p @param {number} max @returns {string | null} */
export function improve(p, max) {
  if (p.mortgaged) return "Lift the mortgage first.";
  if (p.level >= max) return "Already fully built.";
  if (!(p.houseCost > 0)) return "Set a house cost first.";
  p.level++;
  addEntry(p, "improve", -p.houseCost, `built → ${levelName(p)}`);
  return null;
}

/** Sell one improvement level back to the bank at half cost. @param {Property} p @returns {string | null} */
export function sellImprovement(p) {
  if (p.level <= 0) return "Nothing to sell.";
  p.level--;
  addEntry(p, "sell", Math.floor(p.houseCost / 2), `sold → ${levelName(p)}`);
  return null;
}

/** Collect rent. @param {Property} p @param {number} amount @returns {string | null} */
export function collectRent(p, amount) {
  if (p.mortgaged) return "Mortgaged properties collect no rent.";
  if (!(amount > 0)) return "Enter a rent amount.";
  addEntry(p, "rent", amount, levelName(p));
  return null;
}

/**
 * Collect the rent the card says is due, from the game state. `input` is only needed when the card
 * cannot say: the dice total for a utility, or an amount for a custom card with no rent for this level.
 * @param {Game} g @param {Property} p @param {number} [input] @returns {string | null}
 */
export function collectAutoRent(g, p, input) {
  if (p.mortgaged) return "Mortgaged properties collect no rent.";
  if (p.kind === "utility") {
    if (!(input >= 2 && input <= 12)) return "Enter the dice total (2-12) for utility rent.";
    return collectRent(p, rentFor(g, p, input) ?? 0);
  }
  const due = rentFor(g, p);
  return collectRent(p, due ?? input);
}

/**
 * Classic (US) title deeds: [name, group, price, cost per house, rents].
 * Street rents are indexed by improvement level: unimproved, 1-4 houses, hotel. Full-set doubling is
 * computed, not stored. Railroad rents are by number owned; utility rents are dice multipliers by number owned.
 */
const STREETS = [
  ["Mediterranean Avenue", "brown", 60, 50, [2, 10, 30, 90, 160, 250]], ["Baltic Avenue", "brown", 60, 50, [4, 20, 60, 180, 320, 450]],
  ["Oriental Avenue", "lightblue", 100, 50, [6, 30, 90, 270, 400, 550]], ["Vermont Avenue", "lightblue", 100, 50, [6, 30, 90, 270, 400, 550]],
  ["Connecticut Avenue", "lightblue", 120, 50, [8, 40, 100, 300, 450, 600]],
  ["St. Charles Place", "pink", 140, 100, [10, 50, 150, 450, 625, 750]], ["States Avenue", "pink", 140, 100, [10, 50, 150, 450, 625, 750]],
  ["Virginia Avenue", "pink", 160, 100, [12, 60, 180, 500, 700, 900]],
  ["St. James Place", "orange", 180, 100, [14, 70, 200, 550, 750, 950]], ["Tennessee Avenue", "orange", 180, 100, [14, 70, 200, 550, 750, 950]],
  ["New York Avenue", "orange", 200, 100, [16, 80, 220, 600, 800, 1000]],
  ["Kentucky Avenue", "red", 220, 150, [18, 90, 250, 700, 875, 1050]], ["Indiana Avenue", "red", 220, 150, [18, 90, 250, 700, 875, 1050]],
  ["Illinois Avenue", "red", 240, 150, [20, 100, 300, 750, 925, 1100]],
  ["Atlantic Avenue", "yellow", 260, 150, [22, 110, 330, 800, 975, 1150]], ["Ventnor Avenue", "yellow", 260, 150, [22, 110, 330, 800, 975, 1150]],
  ["Marvin Gardens", "yellow", 280, 150, [24, 120, 360, 850, 1025, 1200]],
  ["Pacific Avenue", "green", 300, 200, [26, 130, 390, 900, 1100, 1275]], ["North Carolina Avenue", "green", 300, 200, [26, 130, 390, 900, 1100, 1275]],
  ["Pennsylvania Avenue", "green", 320, 200, [28, 150, 450, 1000, 1200, 1400]],
  ["Park Place", "darkblue", 350, 200, [35, 175, 500, 1100, 1300, 1500]], ["Boardwalk", "darkblue", 400, 200, [50, 200, 600, 1400, 1700, 2000]],
];
const RAILROADS = ["Reading Railroad", "Pennsylvania Railroad", "B&O Railroad", "Short Line"];
const UTILITIES = ["Electric Company", "Water Works"];

/** Properties per group on the classic board. */
export const GROUP_SIZE = { brown: 2, lightblue: 3, pink: 3, orange: 3, red: 3, yellow: 3, green: 3, darkblue: 2, railroad: 4, utility: 2 };

/** @typedef {{ name: string, group: string, kind: "street"|"railroad"|"utility", price: number, houseCost: number, rents: number[], tiers?: number[], groupSize: number }} Card */
/** @type {Card[]} */
export const CLASSIC = [
  ...STREETS.map(([name, group, price, houseCost, rents]) => ({ name, group, kind: /** @type {const} */ ("street"), price, houseCost, rents, groupSize: GROUP_SIZE[group] })),
  ...RAILROADS.map((name) => ({ name, group: "railroad", kind: /** @type {const} */ ("railroad"), price: 200, houseCost: 0, rents: [25, 50, 100, 200], groupSize: 4 })),
  ...UTILITIES.map((name) => ({ name, group: "utility", kind: /** @type {const} */ ("utility"), price: 150, houseCost: 0, rents: [4, 10], groupSize: 2 })),
];

/**
 * Monopoly Mega (US names, board order). Each street is
 * [name, group, price, [site, partial set, full set, 1 house, 2, 3, 4, hotel, skyscraper]].
 * "Partial set" is applied here when you own two or more of the group but not all of it.
 * Not on the printed table, so assumed: mortgage value = half the price, building cost = the standard
 * cost for the color group, a skyscraper costs the same as a house, train depots cost $100 and sell for half.
 */
const MEGA_ROWS = [
  ["Mediterranean Avenue", "brown", 60, [2, 4, 6, 10, 30, 90, 160, 250, 750]],
  ["Baltic Avenue", "brown", 60, [4, 8, 12, 20, 60, 180, 320, 450, 950]],
  // Skyscraper rent is missing from the source for this US row; hotel + 500 matches every other brown, light blue and pink deed.
  ["Arctic Avenue", "brown", 80, [5, 10, 15, 30, 80, 240, 360, 500, 1000]],
  ["Reading Railroad"],
  ["Massachusetts Avenue", "lightblue", 100, [6, 12, 18, 30, 90, 270, 400, 550, 1050]],
  ["Oriental Avenue", "lightblue", 100, [6, 12, 18, 30, 90, 270, 400, 550, 1050]],
  ["Gas Company"],
  ["Vermont Avenue", "lightblue", 100, [6, 12, 18, 30, 90, 270, 400, 550, 1050]],
  ["Connecticut Avenue", "lightblue", 120, [8, 16, 24, 40, 100, 300, 450, 600, 1100]],
  ["Maryland Avenue", "pink", 140, [10, 20, 30, 50, 150, 450, 625, 750, 1250]],
  ["St. Charles Place", "pink", 140, [10, 20, 30, 50, 150, 450, 625, 750, 1250]],
  ["Electric Company"],
  ["States Avenue", "pink", 140, [10, 20, 30, 50, 150, 450, 625, 750, 1250]],
  ["Virginia Avenue", "pink", 160, [12, 24, 36, 60, 180, 500, 700, 900, 1400]],
  ["Pennsylvania Railroad"],
  ["St. James Place", "orange", 180, [14, 28, 42, 70, 200, 550, 750, 950, 1450]],
  ["Tennessee Avenue", "orange", 180, [14, 28, 42, 70, 200, 550, 750, 950, 1450]],
  ["New York Avenue", "orange", 200, [16, 32, 48, 80, 220, 600, 800, 1000, 1500]],
  ["New Jersey Avenue", "orange", 200, [16, 32, 48, 80, 220, 600, 800, 1000, 1500]],
  ["Kentucky Avenue", "red", 220, [18, 36, 54, 90, 250, 700, 875, 1050, 2050]],
  ["Indiana Avenue", "red", 220, [18, 36, 54, 90, 250, 700, 875, 1050, 2050]],
  ["Illinois Avenue", "red", 240, [20, 40, 60, 100, 300, 750, 925, 1100, 2100]],
  ["Michigan Avenue", "red", 240, [20, 40, 60, 100, 300, 750, 925, 1100, 2100]],
  ["B. & O. Railroad"],
  ["Atlantic Avenue", "yellow", 260, [22, 44, 66, 110, 330, 800, 975, 1150, 2150]],
  ["Ventnor Avenue", "yellow", 260, [22, 44, 66, 110, 330, 800, 975, 1150, 2150]],
  ["Water Works"],
  // Full-set rent is 60 as printed in the source table (every other deed's is 3x the site rent, which would be 72).
  ["Marvin Gardens", "yellow", 280, [24, 48, 60, 120, 360, 850, 1025, 1200, 2200]],
  ["California Avenue", "yellow", 280, [24, 48, 60, 120, 360, 850, 1025, 1200, 2200]],
  ["Pacific Avenue", "green", 300, [26, 52, 78, 130, 390, 900, 1100, 1275, 2275]],
  ["South Carolina Avenue", "green", 300, [26, 52, 78, 130, 390, 900, 1100, 1275, 2275]],
  ["North Carolina Avenue", "green", 300, [26, 52, 78, 130, 390, 900, 1100, 1275, 2275]],
  ["Pennsylvania Avenue", "green", 320, [28, 56, 84, 150, 450, 1000, 1200, 1400, 2400]],
  ["Short Line"],
  ["Florida Avenue", "darkblue", 350, [35, 70, 105, 175, 500, 1100, 1300, 1500, 2500]],
  ["Park Place", "darkblue", 350, [35, 70, 105, 175, 500, 1100, 1300, 1500, 2500]],
  ["Boardwalk", "darkblue", 400, [50, 100, 150, 200, 600, 1400, 1700, 2000, 3000]],
];
const HOUSE_COST = { brown: 50, lightblue: 50, pink: 100, orange: 100, red: 150, yellow: 150, green: 200, darkblue: 200 };
const MEGA_RAIL = ["Reading Railroad", "Pennsylvania Railroad", "B. & O. Railroad", "Short Line"];

/** Properties per group in Mega. */
export const MEGA_GROUP_SIZE = { brown: 3, lightblue: 4, pink: 4, orange: 4, red: 4, yellow: 4, green: 4, darkblue: 3, railroad: 4, utility: 3 };

/** @type {Card[]} */
export const MEGA = MEGA_ROWS.map((row) => {
  const [name, group, price, t] = row;
  if (!group) {
    const rail = MEGA_RAIL.includes(name);
    return rail
      ? { name, group: "railroad", kind: /** @type {const} */ ("railroad"), price: 200, houseCost: 100, rents: [25, 50, 100, 200], groupSize: 4 }
      : { name, group: "utility", kind: /** @type {const} */ ("utility"), price: 150, houseCost: 0, rents: [4, 10, 20], groupSize: 3 };
  }
  return { name, group, kind: /** @type {const} */ ("street"), price, houseCost: HOUSE_COST[group], rents: [t[0], ...t.slice(3)], tiers: [t[1], t[2]], groupSize: MEGA_GROUP_SIZE[group] };
});

/** Title deeds for each edition's picker. */
export const CARDS = { classic: CLASSIC, mega: MEGA };

/** @param {Game} g @param {Property} p */
const owned = (g, p) => g.properties.filter((x) => x.group === p.group).length;

/**
 * Rent you would collect on this property right now, from the card and the game state: improvement
 * level, full-set doubling, number of railroads or utilities owned. Utilities need the dice total.
 * Returns null when it cannot be known (utility without dice, or a card with no rent for this level).
 * @param {Game} g @param {Property} p @param {number} [dice]
 * @returns {number | null}
 */
export function rentFor(g, p, dice) {
  if (p.mortgaged) return 0;
  const r = p.rents;
  if (!r || !r.length) return null;
  if (p.kind === "railroad") {
    const rent = r[Math.min(owned(g, p), r.length) - 1];
    return rent == null ? null : p.level >= 1 ? rent * 2 : rent; // a train depot doubles it
  }
  if (p.kind === "utility") {
    const mult = r[Math.min(owned(g, p), r.length) - 1];
    return dice > 0 && mult ? mult * dice : null;
  }
  const base = r[p.level];
  if (!(base >= 0)) return null;
  if (p.level === 0 && p.tiers) {
    // Mega: rent steps up with the number owned, with a bigger step for the full set.
    const n = owned(g, p);
    if (p.groupSize > 0 && n >= p.groupSize) return p.tiers[1];
    return n >= 2 ? p.tiers[0] : base;
  }
  const set = p.level === 0 && p.groupSize > 0 && owned(g, p) >= p.groupSize;
  return set ? base * 2 : base;
}

/** Fill in card data on properties saved before cards were stored. @param {Game[]} games */
export function migrateGames(games) {
  for (const g of games) for (const p of g.properties) {
    if (p.kind) continue;
    const c = CLASSIC.find((x) => x.name === p.name);
    p.kind = c ? c.kind : "custom";
    p.rents = c ? c.rents.slice() : null;
    p.groupSize = c ? c.groupSize : 0;
    if (c && !(p.houseCost > 0)) p.houseCost = c.houseCost;
  }
  return games;
}

export const GROUPS = ["brown", "lightblue", "pink", "orange", "red", "yellow", "green", "darkblue", "railroad", "utility", "other"];

/** Whole-game export/import. @param {unknown} data @returns {Game[] | null} */
export function parseGames(data) {
  const list = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray(/** @type {any} */ (data).games) ? /** @type {any} */ (data).games : null;
  if (!list) return null;
  const ok = list.every((g) => g && typeof g.id === "string" && typeof g.name === "string" && (g.edition === "classic" || g.edition === "mega") &&
    Array.isArray(g.properties) && g.properties.every((p) => p && typeof p.id === "string" && typeof p.name === "string" &&
      Number.isFinite(p.price) && Array.isArray(p.entries) && p.entries.every((e) => e && Number.isFinite(e.amount) && typeof e.type === "string")));
  return ok ? list : null;
}
