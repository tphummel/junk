// Pure logic for the Monopoly asset manager. No DOM; tested by api/monopoly-asset-manager.test.mjs.

/**
 * @typedef {{ id: string, type: "buy"|"rent"|"improve"|"sell"|"mortgage"|"unmortgage"|"repairs"|"trade-out"|"trade-cash"|"other", amount: number, note?: string, at: number, carried?: number }} Entry
 *   amount is the cash flow to you: negative when you pay, positive when you receive. Trades: a property received
 *   is a "buy" whose `carried` part is cost basis moved over from what you gave (not new cash); a property given
 *   away gets a "trade-out" for the basis it passed on and a "trade-cash" for cash received.
 * @typedef {{ id: string, name: string, group: string, kind: "street"|"railroad"|"utility"|"custom", rents: number[] | null,
 *   tiers?: number[] | null, groupSize: number, price: number, mortgageValue: number, houseCost: number, rent: number, level: number, mortgaged: boolean, entries: Entry[] }} Property
 * @typedef {{ id: string, name: string, edition: "classic"|"mega", properties: Property[], archived?: Property[], created?: string }} Game
 * `created` is an ISO time, set when the game is made (older games get it from their id). `archived` holds properties traded away: out of your set counts and lists, still in the game's money totals.
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
  let invested = 0, rent = 0, sold = 0, interest = 0, loan = 0, rentCount = 0, other = 0, transferIn = 0, transferOut = 0, tradeCash = 0;
  for (const e of p.entries) {
    switch (e.type) {
      case "buy": invested -= e.amount; transferIn += e.carried ?? 0; break;
      case "improve": case "repairs": invested -= e.amount; break;
      case "trade-out": transferOut += e.amount; break;
      case "trade-cash": tradeCash += e.amount; break;
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
  const returned = rent + sold + tradeCash + transferOut + (other > 0 ? other : 0);
  invested += other < 0 ? -other : 0;
  const profit = returned - invested;
  const remaining = Math.max(0, invested - returned);
  const avgRent = rentCount ? rent / rentCount : 0;
  const perHit = avgRent || (g ? rentFor(g, p, 7) : null) || p.rent || 0;
  return {
    invested: round(invested), rent: round(rent), sold: round(sold), returned: round(returned), transferIn: round(transferIn), transferOut: round(transferOut),
    profit: round(profit), loan: round(loan), rentCount, avgRent: round(avgRent),
    remaining: round(remaining), broken: invested > 0 && remaining === 0,
    roi: invested > 0 ? profit / invested : 0,
    hitsToBreakEven: remaining > 0 && perHit > 0 ? Math.ceil(remaining / perHit) : remaining > 0 ? null : 0,
  };
}

/**
 * Game totals. Money counts every property including ones traded away; basis carried from a traded-away
 * property to what replaced it is a transfer, not new money, so it is left out of invested and returned.
 * Break-even, loans and counts cover only what you own now.
 * @param {Game} g
 */
export function gameStats(g) {
  const t = { invested: 0, rent: 0, returned: 0, profit: 0, loan: 0, remaining: 0, count: g.properties.length, broken: 0 };
  for (const p of [...g.properties, ...(g.archived || [])]) {
    const s = stats(p, g);
    t.invested += s.invested - s.transferIn; t.rent += s.rent; t.returned += s.returned - s.transferOut; t.profit += s.profit;
  }
  for (const p of g.properties) {
    const s = stats(p, g);
    t.loan += s.loan; t.remaining += s.remaining;
    if (s.broken) t.broken++;
  }
  for (const k of ["invested", "rent", "returned", "profit", "loan", "remaining"]) t[k] = round(t[k]);
  // `remaining` adds up what each property you own still owes (never below zero per property), so a property that
  // has paid off does not offset the others. `gameRemaining` nets everything, including traded-away properties.
  const gameRemaining = Math.max(0, round(-t.profit));
  return { ...t, gameRemaining, offset: round(t.remaining - gameRemaining), roi: t.invested > 0 ? t.profit / t.invested : 0 };
}

let seq = 0;
/** @returns {string} */
export const uid = () => Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);

/**
 * `price` is the printed list price (mortgage value comes from it); `paid` is what you actually paid,
 * for example an auction bid, and defaults to the list price. The purchase entry records `paid`.
 * @param {{name: string, group: string, price: number, paid?: number, kind?: Property["kind"], rents?: number[] | null, tiers?: number[] | null, groupSize?: number, houseCost?: number, rent?: number, mortgageValue?: number}} o @returns {Property} */
export function newProperty(o) {
  return {
    id: uid(), name: o.name, group: o.group || "other", price: o.price,
    kind: o.kind ?? "custom", rents: o.rents ?? null, tiers: o.tiers ?? null, groupSize: o.groupSize ?? 0,
    mortgageValue: o.mortgageValue ?? Math.floor(o.price / 2), houseCost: o.houseCost ?? 0, rent: o.rent ?? 0,
    level: 0, mortgaged: false,
    entries: [{ id: uid(), type: "buy", amount: -(o.paid ?? o.price), at: Date.now() }],
  };
}

/** What you paid for the property (the purchase entry). @param {Property} p */
export function pricePaid(p) {
  const e = p.entries.find((x) => x.type === "buy");
  return e ? -e.amount : p.price;
}

/** Correct the purchase price, for example after an auction. @param {Property} p @param {number} amount */
export function setPricePaid(p, amount) {
  const e = p.entries.find((x) => x.type === "buy");
  if (e) e.amount = -round(amount);
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

/**
 * Whether a history entry may be deleted. The purchase (including one that carries basis from a trade) can't be:
 * delete the property instead. Trade entries tie two properties together. Once a property is traded away only its
 * rent can be corrected, because its other state is closed.
 * @param {Property} p @param {Entry} e @param {boolean} [archived]
 */
export function canDeleteEntry(p, e, archived = false) {
  if (e.type === "buy" || e.type === "trade-out" || e.type === "trade-cash") return false;
  if (archived) return e.type === "rent";
  return true;
}

/**
 * Delete one history entry and rebuild the property's level and mortgage from what is left. Refused, with nothing
 * changed, if the remaining history would not make sense (for example, deleting a build that a later sell-back
 * depends on): delete the later entries first.
 * @param {Game} g @param {Property} p @param {string} entryId @param {boolean} [archived] @returns {string | null}
 */
export function deleteEntry(g, p, entryId, archived = false) {
  const e = p.entries.find((x) => x.id === entryId);
  if (!e) return "That entry is already gone.";
  if (!canDeleteEntry(p, e, archived)) return e.type === "buy" ? "The purchase can't be deleted; remove the property instead." : "Trade entries can't be deleted.";
  const left = p.entries.filter((x) => x !== e);
  let level = 0, mortgaged = false;
  if (!archived) {
    const max = maxLevel(g, p);
    for (const x of left) {
      if (x.type === "improve") { if (mortgaged || level >= max) return "Can't delete this: later history depends on it. Delete the later entries first."; level++; }
      else if (x.type === "sell") { if (level <= 0) return "Can't delete this: later history depends on it. Delete the later entries first."; level--; }
      else if (x.type === "mortgage") { if (mortgaged || level > 0) return "Can't delete this: later history depends on it. Delete the later entries first."; mortgaged = true; }
      else if (x.type === "unmortgage") { if (!mortgaged) return "Can't delete this: later history depends on it. Delete the later entries first."; mortgaged = false; }
    }
  }
  p.entries = left;
  if (!archived) { p.level = level; p.mortgaged = mortgaged; }
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
  ["Ornamental Avenue", "lightblue", 100, 50, [6, 30, 90, 270, 400, 550]], ["Vermont Avenue", "lightblue", 100, 50, [6, 30, 90, 270, 400, 550]],
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
 * [name, group, price, [site rent, 1 house, 2, 3, 4, hotel, skyscraper]].
 * Unimproved rent steps up with how much of the group you own: the site rent, double it when you are one
 * shy of the full set (see partialAt), triple it with the full set.
 * Not on the printed table, so assumed: mortgage value = half the price, building cost = the standard
 * cost for the color group, a skyscraper costs the same as a house, train depots cost $100 and sell for half.
 */
const MEGA_ROWS = [
  ["Mediterranean Avenue", "brown", 60, [2, 10, 30, 90, 160, 250, 750]],
  ["Baltic Avenue", "brown", 60, [4, 20, 60, 180, 320, 450, 950]],
  // The skyscraper rent is missing from the source for this US row; hotel + 500 matches every other brown, light blue and pink deed.
  ["Arctic Avenue", "brown", 80, [5, 30, 80, 240, 360, 500, 1000]],
  ["Reading Railroad"],
  ["Massachusetts Avenue", "lightblue", 100, [6, 30, 90, 270, 400, 550, 1050]],
  ["Ornamental Avenue", "lightblue", 100, [6, 30, 90, 270, 400, 550, 1050]],
  ["Gas Company"],
  ["Vermont Avenue", "lightblue", 100, [6, 30, 90, 270, 400, 550, 1050]],
  ["Connecticut Avenue", "lightblue", 120, [8, 40, 100, 300, 450, 600, 1100]],
  ["Maryland Avenue", "pink", 140, [10, 50, 150, 450, 625, 750, 1250]],
  ["St. Charles Place", "pink", 140, [10, 50, 150, 450, 625, 750, 1250]],
  ["Electric Company"],
  ["States Avenue", "pink", 140, [10, 50, 150, 450, 625, 750, 1250]],
  ["Virginia Avenue", "pink", 160, [12, 60, 180, 500, 700, 900, 1400]],
  ["Pennsylvania Railroad"],
  ["St. James Place", "orange", 180, [14, 70, 200, 550, 750, 950, 1450]],
  ["Tennessee Avenue", "orange", 180, [14, 70, 200, 550, 750, 950, 1450]],
  ["New York Avenue", "orange", 200, [16, 80, 220, 600, 800, 1000, 1500]],
  ["New Jersey Avenue", "orange", 200, [16, 80, 220, 600, 800, 1000, 1500]],
  ["Kentucky Avenue", "red", 220, [18, 90, 250, 700, 875, 1050, 2050]],
  ["Indiana Avenue", "red", 220, [18, 90, 250, 700, 875, 1050, 2050]],
  ["Illinois Avenue", "red", 240, [20, 100, 300, 750, 925, 1100, 2100]],
  ["Michigan Avenue", "red", 240, [20, 100, 300, 750, 925, 1100, 2100]],
  ["B. & O. Railroad"],
  ["Atlantic Avenue", "yellow", 260, [22, 110, 330, 800, 975, 1150, 2150]],
  ["Ventnor Avenue", "yellow", 260, [22, 110, 330, 800, 975, 1150, 2150]],
  ["Water Works"],
  ["Marvin Gardens", "yellow", 280, [24, 120, 360, 850, 1025, 1200, 2200]],
  ["California Avenue", "yellow", 280, [24, 120, 360, 850, 1025, 1200, 2200]],
  ["Pacific Avenue", "green", 300, [26, 130, 390, 900, 1100, 1275, 2275]],
  ["South Carolina Avenue", "green", 300, [26, 130, 390, 900, 1100, 1275, 2275]],
  ["North Carolina Avenue", "green", 300, [26, 130, 390, 900, 1100, 1275, 2275]],
  ["Pennsylvania Avenue", "green", 320, [28, 150, 450, 1000, 1200, 1400, 2400]],
  ["Short Line"],
  ["Florida Avenue", "darkblue", 350, [35, 175, 500, 1100, 1300, 1500, 2500]],
  ["Park Place", "darkblue", 350, [35, 175, 500, 1100, 1300, 1500, 2500]],
  ["Boardwalk", "darkblue", 400, [50, 200, 600, 1400, 1700, 2000, 3000]],
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
  return { name, group, kind: /** @type {const} */ ("street"), price, houseCost: HOUSE_COST[group], rents: t, tiers: [t[0] * 2, t[0] * 3], groupSize: MEGA_GROUP_SIZE[group] };
});

/** Title deeds for each edition's picker. */
export const CARDS = { classic: CLASSIC, mega: MEGA };

/** How many of the group you must own for the partial-set rent: all but one. @param {Property} p */
export const partialAt = (p) => (p.groupSize > 1 ? p.groupSize - 1 : 2);

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
    // Mega: one shy of the full set pays double the site rent (2 of 3, 3 of 4) and the full set triples it.
    // Owning fewer than that pays the plain site rent.
    const n = owned(g, p);
    if (p.groupSize > 0 && n >= p.groupSize) return p.tiers[1];
    return n >= partialAt(p) ? p.tiers[0] : base;
  }
  const set = p.level === 0 && p.groupSize > 0 && owned(g, p) >= p.groupSize;
  return set ? base * 2 : base;
}

/**
 * When a game was created, as a Date, or null if unknown. Games store `created`; older ones are recovered from the
 * time at the front of their id (see uid).
 * @param {Game} g @returns {Date | null}
 */
export function gameCreated(g) {
  const fromField = g.created ? new Date(g.created) : null;
  if (fromField && !Number.isNaN(+fromField)) return fromField;
  const ms = parseInt(String(g.id).slice(0, 8), 36);
  return ms > Date.UTC(2020, 0, 1) && ms < Date.UTC(2100, 0, 1) ? new Date(ms) : null;
}

/** Lowercase kebab-case for a file name; never empty. @param {string} text */
export function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "game";
}

/** Local calendar date as YYYY-MM-DD. @param {Date} d */
export function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** File name for exporting one game: the day it was created and its name. @param {Game} g */
export function exportFileName(g) {
  const made = gameCreated(g);
  return `monopoly-asset-manager-${made ? ymd(made) : "undated"}-${slug(g.name)}.json`;
}

/** Deeds that were renamed; saved games get the new name, including in history notes. */
const RENAMED = { "Oriental Avenue": "Ornamental Avenue" };

/** Fill in card data on properties saved before cards were stored, and apply deed renames. @param {Game[]} games */
export function migrateGames(games) {
  for (const g of games) {
    g.archived ||= [];
    g.created ||= gameCreated(g)?.toISOString();
    for (const p of [...g.properties, ...g.archived]) {
      for (const [from, to] of Object.entries(RENAMED)) {
        if (p.name === from) p.name = to;
        for (const e of p.entries) if (e.note?.includes(from)) e.note = e.note.split(from).join(to);
      }
    }
  }
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

/**
 * Buy a deed. You can only own a deed once; one you traded away can be bought back.
 * Returns an error string if it is not allowed.
 * @param {Game} g @param {Card} card @param {number} [paid] what you paid; defaults to the list price @returns {string | null}
 */
export function buyProperty(g, card, paid) {
  if (g.properties.some((p) => p.name === card.name)) return `You already own ${card.name}.`;
  g.properties.push(newProperty({ ...card, paid }));
  return null;
}

/**
 * Property repairs from a Chance or Community Chest card, per piece on the board (the Mega cards, which match the
 * original's house and hotel amounts and add skyscrapers and train depots).
 */
export const REPAIR_RATES = {
  chance: { name: "Chance", house: 25, hotel: 100, skyscraper: 100, depot: 25 },
  chest: { name: "Community Chest", house: 40, hotel: 115, skyscraper: 100, depot: 25 },
};

/**
 * What is built on a property. Level 1-4 is that many houses, 5 is a hotel (it replaces the houses), 6 is a
 * skyscraper (it replaces the hotel); a railroad's depot is its one improvement.
 * @param {Property} p
 */
export function pieces(p) {
  if (p.kind === "railroad") return { houses: 0, hotels: 0, skyscrapers: 0, depots: p.level >= 1 ? 1 : 0 };
  return { houses: p.level >= 1 && p.level <= 4 ? p.level : 0, hotels: p.level === 5 ? 1 : 0, skyscrapers: p.level >= 6 ? 1 : 0, depots: 0 };
}

/** @param {{houses: number, hotels: number, skyscrapers: number, depots: number}} n */
function describePieces(n) {
  const out = [];
  if (n.houses) out.push(`${n.houses} ${n.houses === 1 ? "house" : "houses"}`);
  if (n.hotels) out.push(`${n.hotels} ${n.hotels === 1 ? "hotel" : "hotels"}`);
  if (n.skyscrapers) out.push(`${n.skyscrapers} ${n.skyscrapers === 1 ? "skyscraper" : "skyscrapers"}`);
  if (n.depots) out.push(`${n.depots} train ${n.depots === 1 ? "depot" : "depots"}`);
  return out.join(", ");
}

/**
 * What a repairs card costs you, property by property. Only properties with something built on them pay.
 * @param {Game} g @param {"chance"|"chest"} card
 */
export function planRepairs(g, card) {
  const r = REPAIR_RATES[card];
  const lines = [];
  for (const p of g.properties) {
    const n = pieces(p);
    const cost = n.houses * r.house + n.hotels * r.hotel + n.skyscrapers * r.skyscraper + n.depots * r.depot;
    if (cost > 0) lines.push({ property: p, text: describePieces(n), cost });
  }
  return { card: r.name, lines, total: lines.reduce((a, l) => a + l.cost, 0) };
}

/**
 * Pay a repairs card: each property's share goes on its own history and is added to its cost basis.
 * Returns an error string if there is nothing to pay.
 * @param {Game} g @param {"chance"|"chest"} card @returns {string | null}
 */
export function payRepairs(g, card) {
  const plan = planRepairs(g, card);
  if (!plan.lines.length) return "You have no improvements, so there is nothing to pay.";
  for (const l of plan.lines) addEntry(l.property, "repairs", -l.cost, `${plan.card} repairs: ${l.text}`);
  return null;
}

/** Cost basis of an unimproved property: what you put in, less any improvements sold back. @param {Property} p */
export function basisOf(p) {
  const s = stats(p);
  return Math.max(0, round(s.invested - s.sold));
}

/** Why a property can't be traded, or null. @param {Property} p @returns {string | null} */
export function tradeBlock(p) {
  if (p.level > 0) return "has improvements";
  if (p.mortgaged) return "is mortgaged";
  return null;
}

/** Split an amount evenly into `n` shares in whole cents; the leftover cents go to the first shares. @param {number} amount @param {number} n */
export function splitEvenly(amount, n) {
  const cents = Math.round(amount * 100);
  const base = Math.floor(cents / n), extra = cents - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
}

/** @param {number} amount @param {number[]} weights positive weights; rounded to cents, remainder on the last */
function splitProportional(amount, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let left = amount;
  return weights.map((w, i) => {
    const part = i === weights.length - 1 ? round(left) : round((amount * w) / total);
    left = round(left - part);
    return part;
  });
}

/**
 * Work out a trade without changing anything. You give properties (and maybe cash) and receive deeds (and maybe
 * cash). The basis of what you give, plus cash you pay, less cash you receive, becomes the cost basis of what
 * you receive, split evenly. Cash on one side only. Returns `error` if the trade is not allowed.
 * @param {Game} g
 * @param {{ giveIds: string[], receive: Card[], cashPaid?: number, cashReceived?: number }} t
 */
export function planTrade(g, t) {
  const give = t.giveIds.map((id) => g.properties.find((p) => p.id === id));
  if (give.some((p) => !p)) return { error: "Pick properties you own." };
  const gives = /** @type {Property[]} */ (give);
  const paid = t.cashPaid || 0, got = t.cashReceived || 0;
  if (!(paid >= 0) || !(got >= 0)) return { error: "Cash must be zero or more." };
  if (paid > 0 && got > 0) return { error: "Cash goes on one side of a trade: either you pay it or you receive it." };
  if (!gives.length && !t.receive.length) return { error: "Pick something to trade." };
  if (!t.receive.length && !(got > 0)) return { error: "You receive nothing: add a property or cash." };
  for (const p of gives) {
    const b = tradeBlock(p);
    if (b) return { error: `${p.name} ${b}. Only unimproved, unmortgaged properties can be traded.` };
  }
  const owned = new Set(g.properties.map((p) => p.name));
  for (const c of t.receive) if (owned.has(c.name) && !gives.some((p) => p.name === c.name)) return { error: `You already own ${c.name}.` };
  const bases = gives.map(basisOf);
  const giveBasis = round(bases.reduce((a, b) => a + b, 0));
  // Cash received soaks up basis first; anything beyond the basis is a gain, booked as cash on the properties given.
  const cashParts = !gives.length ? [] : giveBasis > 0 ? splitProportional(got, bases) : gives.map((_, i) => (i === 0 ? got : 0));
  const n = t.receive.length;
  // With nothing received there is nowhere for basis to go: a cash-only trade is a sale and realizes the gain or loss.
  const out = gives.map((_, i) => (n ? round(Math.max(0, bases[i] - cashParts[i])) : 0));
  const carried = n ? round(out.reduce((a, b) => a + b, 0)) : 0;
  const carriedShares = n ? splitEvenly(carried, n) : [];
  const cashShares = n ? splitEvenly(paid, n) : [];
  return {
    give: gives, bases, giveBasis, cashParts, out, carried, cashPaid: paid, cashReceived: got,
    shares: carriedShares.map((c, i) => ({ carried: c, cash: cashShares[i], basis: round(c + cashShares[i]) })),
  };
}

/** Do the trade. Returns an error string if it is not allowed. @param {Game} g @param {Parameters<typeof planTrade>[1]} t @returns {string | null} */
export function executeTrade(g, t) {
  const plan = planTrade(g, t);
  if ("error" in plan) return plan.error;
  const names = t.receive.map((c) => c.name).join(", ") || "cash";
  const gave = plan.give.map((p) => p.name).join(", ") || "cash";
  plan.give.forEach((p, i) => {
    if (plan.out[i] > 0) addEntry(p, "trade-out", plan.out[i], `traded for ${names}: basis carried over`);
    if (plan.cashParts[i] > 0) addEntry(p, "trade-cash", plan.cashParts[i], `cash received in trade for ${names}`);
    g.properties = g.properties.filter((x) => x !== p);
    (g.archived ||= []).push(p);
  });
  t.receive.forEach((card, i) => {
    const sh = plan.shares[i];
    const p = newProperty({ ...card, paid: sh.basis });
    p.entries[0].carried = sh.carried;
    p.entries[0].note = `traded for ${gave}: basis $${sh.basis}` + (sh.cash ? ` (incl. $${sh.cash} cash)` : "");
    g.properties.push(p);
  });
  return null;
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
