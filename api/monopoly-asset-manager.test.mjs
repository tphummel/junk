// Tests for the Monopoly asset manager logic (web/monopoly-asset-manager/tracker.js). Run with `npm test`.
import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, CLASSIC, MEGA, REPAIR_RATES, exportFileName, gameCreated, slug, uid, basisOf, payRepairs, pieces, planRepairs, canDeleteEntry, deleteEntry, partialAt, buyProperty, collectAutoRent, executeTrade, planTrade, splitEvenly, collectRent, gameStats, improve, migrateGames, newProperty, parseGames, pricePaid, rentFor, setPricePaid, sellImprovement, stats, toggleMortgage } from "../web/monopoly-asset-manager/tracker.js";

const boardwalk = () => newProperty({ name: "Boardwalk", group: "darkblue", price: 400, houseCost: 200, rent: 50 });

test("buying records the cost and nothing is broken even yet", () => {
  const s = stats(boardwalk());
  assert.equal(s.invested, 400);
  assert.equal(s.profit, -400);
  assert.equal(s.remaining, 400);
  assert.equal(s.hitsToBreakEven, 8); // 400 / 50 from the set rent
});

test("rent counts toward break even; avg rent replaces the set rent", () => {
  const p = boardwalk();
  assert.equal(collectRent(p, 200), null);
  const s = stats(p);
  assert.equal(s.remaining, 200);
  assert.equal(s.hitsToBreakEven, 1);
  collectRent(p, 200);
  const done = stats(p);
  assert.equal(done.broken, true);
  assert.equal(done.roi, 0);
  collectRent(p, 400);
  assert.equal(stats(p).roi, 1);
});

test("improvements add to cost; selling returns half", () => {
  const p = boardwalk();
  assert.equal(improve(p, 5), null);
  assert.equal(stats(p).invested, 600);
  assert.equal(sellImprovement(p), null);
  const s = stats(p);
  assert.equal(s.invested, 600);
  assert.equal(s.returned, 100);
  assert.equal(s.remaining, 500);
  assert.match(sellImprovement(p), /Nothing/);
});

test("mortgage is a loan: only the 10% interest costs you; no rent while mortgaged", () => {
  const p = boardwalk();
  toggleMortgage(p);
  assert.equal(stats(p).loan, 200);
  assert.equal(stats(p).profit, -400);
  assert.match(collectRent(p, 50), /Mortgaged/);
  toggleMortgage(p);
  const s = stats(p);
  assert.equal(s.loan, 0);
  assert.equal(s.invested, 420);
});

test("cannot mortgage improved property or build on mortgaged", () => {
  const p = boardwalk();
  improve(p, 5);
  assert.match(toggleMortgage(p), /Sell all/);
  sellImprovement(p);
  toggleMortgage(p);
  assert.match(improve(p, 5), /mortgage/);
});

test("level cap and game totals", () => {
  const p = boardwalk();
  for (let i = 0; i < 5; i++) improve(p, 5);
  assert.match(improve(p, 5), /fully built/);
  const g = { id: "g", name: "g", edition: "classic", properties: [p, boardwalk()] };
  const t = gameStats(g);
  assert.equal(t.invested, 400 + 1000 + 400);
  assert.equal(t.count, 2);
});

test("parseGames validates imports", () => {
  const g = { id: "g", name: "g", edition: "mega", properties: [boardwalk()] };
  assert.equal(parseGames([g]).length, 1);
  assert.equal(parseGames({ games: [g] }).length, 1);
  assert.equal(parseGames([{ ...g, edition: "x" }]), null);
  assert.equal(parseGames("nope"), null);
});

const deed = (name) => newProperty(CLASSIC.find((c) => c.name === name));
const game = (...props) => ({ id: "g", name: "g", edition: "classic", properties: props });

test("card data: 28 deeds with sane tables", () => {
  assert.equal(CLASSIC.length, 28);
  for (const c of CLASSIC.filter((x) => x.kind === "street")) {
    assert.equal(c.rents.length, 6, c.name);
    assert.ok(c.rents.every((r, i) => i === 0 || r > c.rents[i - 1]), c.name);
  }
  assert.deepEqual(CLASSIC.find((c) => c.name === "Boardwalk").rents, [50, 200, 600, 1400, 1700, 2000]);
});

test("street rent follows level and full-set doubling", () => {
  const park = deed("Park Place"), board = deed("Boardwalk");
  const g = game(park);
  assert.equal(rentFor(g, park), 35); // only one of two owned
  g.properties.push(board);
  assert.equal(rentFor(g, park), 70); // full set doubles unimproved rent
  improve(park, 5);
  assert.equal(rentFor(g, park), 175); // no doubling once improved
  assert.equal(rentFor(g, board), 50 * 2);
});

test("railroads scale with count owned; utilities need dice", () => {
  const rr = CLASSIC.filter((c) => c.kind === "railroad").map((c) => newProperty(c));
  const g = game(rr[0]);
  assert.equal(rentFor(g, rr[0]), 25);
  g.properties.push(rr[1], rr[2]);
  assert.equal(rentFor(g, rr[0]), 100);
  const elec = deed("Electric Company");
  g.properties.push(elec);
  assert.equal(rentFor(g, elec), null);
  assert.equal(rentFor(g, elec, 8), 32);
  g.properties.push(deed("Water Works"));
  assert.equal(rentFor(g, elec, 8), 80);
});

test("collectAutoRent records the card rent without entering it", () => {
  const med = deed("Mediterranean Avenue");
  const g = game(med);
  assert.equal(collectAutoRent(g, med), null);
  assert.equal(stats(med, g).rent, 2);
  const elec = deed("Electric Company");
  g.properties.push(elec);
  assert.match(collectAutoRent(g, elec), /dice/);
  assert.equal(collectAutoRent(g, elec, 6), null);
  assert.equal(stats(elec, g).rent, 24);
  toggleMortgage(med);
  assert.match(collectAutoRent(g, med), /Mortgaged/);
});

test("custom card with no rent table falls back to the entered amount", () => {
  const p = newProperty({ name: "Custom Street", group: "other", price: 100 });
  const g = game(p);
  assert.equal(rentFor(g, p), null);
  assert.equal(collectAutoRent(g, p, 30), null);
  assert.equal(stats(p, g).rent, 30);
});

test("migrateGames backfills card data on older saves", () => {
  const old = newProperty({ name: "Boardwalk", group: "darkblue", price: 400 });
  delete old.kind; delete old.rents; delete old.groupSize;
  const g = game(old);
  migrateGames([g]);
  assert.equal(old.kind, "street");
  assert.equal(old.houseCost, 200);
  assert.equal(rentFor(g, old), 50);
});

const mega = (name) => newProperty(MEGA.find((c) => c.name === name));
const megaGame = (...props) => ({ id: "m", name: "m", edition: "mega", properties: props });

test("mega card data: 37 deeds, group sizes add up", () => {
  assert.equal(CARDS.mega, MEGA);
  assert.equal(MEGA.length, 37);
  const count = {};
  for (const c of MEGA) count[c.group] = (count[c.group] || 0) + 1;
  for (const c of MEGA) assert.equal(count[c.group], c.groupSize, c.name);
  for (const c of MEGA.filter((x) => x.kind === "street")) {
    assert.equal(c.rents.length, 7, c.name); // site, 4 houses, hotel, skyscraper
    assert.equal(c.tiers.length, 2, c.name);
    assert.ok(c.rents[6] > c.rents[5] && c.rents[1] > c.tiers[1], c.name);
  }
  assert.equal(new Set(MEGA.map((c) => c.name)).size, 37);
});

test("mega street rent: 1 owned, 2+ owned, full set, then improvements", () => {
  const med = mega("Mediterranean Avenue"), bal = mega("Baltic Avenue"), arc = mega("Arctic Avenue");
  const g = megaGame(med);
  assert.equal(rentFor(g, med), 2);
  g.properties.push(bal);
  assert.equal(rentFor(g, med), 4); // partial
  g.properties.push(arc);
  assert.equal(rentFor(g, med), 6); // full set of three
  for (let i = 0; i < 6; i++) assert.equal(improve(med, 6), null);
  assert.equal(rentFor(g, med), 750); // skyscraper
  assert.match(improve(med, 6), /fully built/);
});

test("mega group of four needs all four for the full-set rent", () => {
  const props = ["Kentucky Avenue", "Indiana Avenue", "Illinois Avenue"].map(mega);
  const g = megaGame(...props);
  assert.equal(rentFor(g, props[0]), 36);
  g.properties.push(mega("Michigan Avenue"));
  assert.equal(rentFor(g, props[0]), 54);
});

test("mega railroad depot doubles rent, capped at one", () => {
  const rr = ["Reading Railroad", "Pennsylvania Railroad"].map(mega);
  const g = megaGame(...rr);
  assert.equal(rentFor(g, rr[0]), 50);
  assert.equal(improve(rr[0], 1), null);
  assert.equal(rentFor(g, rr[0]), 100);
  assert.match(improve(rr[0], 1), /fully built/);
  assert.equal(stats(rr[0], g).invested, 300);
});

test("mega has three utilities with 4x, 10x, 20x", () => {
  const util = ["Gas Company", "Electric Company", "Water Works"].map(mega);
  const g = megaGame(util[0]);
  assert.equal(rentFor(g, util[0], 5), 20);
  g.properties.push(util[1]);
  assert.equal(rentFor(g, util[0], 5), 50);
  g.properties.push(util[2]);
  assert.equal(rentFor(g, util[0], 5), 100);
});

test("price paid defaults to list price and can be overridden for an auction", () => {
  const card = CLASSIC.find((c) => c.name === "Boardwalk");
  const list = newProperty(card);
  assert.equal(pricePaid(list), 400);
  const auction = newProperty({ ...card, paid: 520 });
  assert.equal(pricePaid(auction), 520);
  assert.equal(auction.price, 400);
  assert.equal(auction.mortgageValue, 200); // mortgage value follows the printed price, not the bid
  assert.equal(stats(auction).invested, 520);
  assert.equal(stats(auction).remaining, 520);
});

test("correcting the price paid updates cost basis everywhere", () => {
  const p = newProperty(CLASSIC.find((c) => c.name === "Park Place"));
  collectRent(p, 100);
  setPricePaid(p, 275);
  const s = stats(p);
  assert.equal(s.invested, 275);
  assert.equal(s.profit, -175);
  assert.equal(p.entries.filter((e) => e.type === "buy").length, 1);
  toggleMortgage(p);
  assert.equal(p.mortgageValue, 175);
  assert.equal(stats(p).loan, 175);
});

const card = (name) => CLASSIC.find((c) => c.name === name);
const own = (g, name, paid) => { const p = newProperty({ ...card(name), paid }); g.properties.push(p); return p; };

test("trade: two for one, cash on my side adds to the basis, totals are not double counted", () => {
  const g = game();
  const ori = own(g, "Ornamental Avenue", 150), ver = own(g, "Vermont Avenue", 100);
  collectRent(ori, 30);
  assert.equal(executeTrade(g, { giveIds: [ori.id, ver.id], receive: [card("Boardwalk")], cashPaid: 50 }), null);
  assert.deepEqual(g.properties.map((p) => p.name), ["Boardwalk"]);
  assert.deepEqual(g.archived.map((p) => p.name), ["Ornamental Avenue", "Vermont Avenue"]);
  assert.equal(stats(g.properties[0]).invested, 300); // 150 + 100 carried, 50 cash
  const t = gameStats(g);
  assert.equal(t.invested, 300); // real money in: 150 + 100 + 50
  assert.equal(t.rent, 30);
  assert.equal(t.profit, -270);
  assert.equal(stats(g.archived[0]).profit, 30); // the old property keeps its own rent as profit
});

test("trade: one for two splits the basis evenly", () => {
  const g = game();
  const bw = own(g, "Boardwalk", 400);
  assert.equal(executeTrade(g, { giveIds: [bw.id], receive: [card("Park Place"), card("Mediterranean Avenue")] }), null);
  assert.deepEqual(g.properties.map((p) => stats(p).invested), [200, 200]);
  assert.equal(gameStats(g).invested, 400);
  assert.equal(gameStats(g).profit, -400);
});

test("trade: odd cents are split without losing a cent", () => {
  assert.deepEqual(splitEvenly(100, 3), [33.34, 33.33, 33.33]);
  const g = game();
  const bw = own(g, "Boardwalk", 100);
  executeTrade(g, { giveIds: [bw.id], receive: [card("Park Place"), card("Mediterranean Avenue"), card("Baltic Avenue")] });
  assert.equal(Math.round(g.properties.reduce((a, p) => a + stats(p).invested, 0) * 100), 10000);
});

test("trade: cash I receive reduces the basis I carry; the rest is returned", () => {
  const g = game();
  const pp = own(g, "Park Place", 350);
  executeTrade(g, { giveIds: [pp.id], receive: [card("Mediterranean Avenue")], cashReceived: 50 });
  assert.equal(stats(g.properties[0]).invested, 300);
  assert.equal(stats(g.archived[0]).profit, 0);
  const t = gameStats(g);
  assert.equal(t.invested, 350);
  assert.equal(t.returned, 50);
  assert.equal(t.profit, -300);
});

test("trade: cash beyond the basis is a gain; trading for cash only is a sale", () => {
  const g = game();
  const med = own(g, "Mediterranean Avenue", 60);
  executeTrade(g, { giveIds: [med.id], receive: [card("Baltic Avenue")], cashReceived: 100 });
  assert.equal(stats(g.properties[0]).invested, 0);
  assert.equal(gameStats(g).profit, 40);
  const g2 = game();
  const bw = own(g2, "Boardwalk", 400);
  assert.equal(executeTrade(g2, { giveIds: [bw.id], receive: [], cashReceived: 450 }), null);
  assert.equal(g2.properties.length, 0);
  assert.equal(gameStats(g2).profit, 50);
});

test("trade: buying from another player is just a purchase with a basis", () => {
  const g = game();
  assert.equal(executeTrade(g, { giveIds: [], receive: [card("Boardwalk"), card("Park Place")], cashPaid: 900 }), null);
  assert.deepEqual(g.properties.map((p) => stats(p).invested), [450, 450]);
  assert.equal(gameStats(g).invested, 900);
});

test("trade: only unimproved, unmortgaged properties; cash on one side; no duplicates", () => {
  const g = game();
  const a = own(g, "Park Place", 350), b = own(g, "Boardwalk", 400);
  improve(a, 5);
  assert.match(executeTrade(g, { giveIds: [a.id], receive: [card("Baltic Avenue")] }), /improvements/);
  sellImprovement(a);
  toggleMortgage(b);
  assert.match(executeTrade(g, { giveIds: [b.id], receive: [card("Baltic Avenue")] }), /mortgaged/);
  assert.match(executeTrade(g, { giveIds: [a.id], receive: [card("Baltic Avenue")], cashPaid: 10, cashReceived: 10 }), /one side/);
  assert.match(executeTrade(g, { giveIds: [a.id], receive: [card("Boardwalk")] }), /already own/);
  assert.match(executeTrade(g, { giveIds: [], receive: [] }), /something/);
  assert.equal(g.properties.length, 2); // nothing changed on any refusal
  assert.equal(g.archived, undefined);
});

test("trade: basis ignores improvement spend that was sold back, and set counts drop the traded property", () => {
  const g = game();
  const med = own(g, "Mediterranean Avenue", 60), bal = own(g, "Baltic Avenue", 60);
  improve(med, 5); sellImprovement(med); // spent 50, got 25 back
  assert.equal(basisOf(med), 60 + 25);
  assert.equal(rentFor(g, bal), 8); // full brown set doubles
  executeTrade(g, { giveIds: [med.id], receive: [card("Boardwalk")] });
  assert.equal(rentFor(g, bal), 4); // set broken
  assert.equal(planTrade(g, { giveIds: [bal.id], receive: [card("Park Place")] }).carried, 60);
});

test("a deed can only be bought once; a traded-away one can be bought back", () => {
  const g = game();
  assert.equal(buyProperty(g, card("Boardwalk")), null);
  assert.match(buyProperty(g, card("Boardwalk"), 500), /already own Boardwalk/);
  assert.equal(g.properties.length, 1);
  assert.equal(stats(g.properties[0]).invested, 400); // the refused buy changed nothing
  executeTrade(g, { giveIds: [g.properties[0].id], receive: [card("Park Place")] });
  assert.equal(buyProperty(g, card("Boardwalk"), 450), null);
  assert.deepEqual(g.properties.map((p) => p.name), ["Park Place", "Boardwalk"]);
});

test("migrateGames renames Oriental Avenue to Ornamental Avenue, in lists and history notes", () => {
  const old = own(game(), "Vermont Avenue", 100);
  old.name = "Oriental Avenue";
  old.entries[0].note = "traded for Oriental Avenue";
  const gone = newProperty({ ...CLASSIC.find((c) => c.name === "Baltic Avenue") });
  gone.name = "Oriental Avenue";
  const g = { id: "g", name: "g", edition: "classic", properties: [old], archived: [gone] };
  migrateGames([g]);
  assert.equal(g.properties[0].name, "Ornamental Avenue");
  assert.equal(g.archived[0].name, "Ornamental Avenue");
  assert.equal(g.properties[0].entries[0].note, "traded for Ornamental Avenue");
  assert.ok(![...CLASSIC, ...MEGA].some((c) => c.name.includes("Oriental")));
});

test("mega pink group of four: the plain rent until three are owned (10, 10, 10, Virginia 12)", () => {
  const names = ["Maryland Avenue", "St. Charles Place", "States Avenue", "Virginia Avenue"];
  const props = names.map(mega);
  const g = megaGame(props[0]);
  assert.equal(rentFor(g, props[0]), 10);
  g.properties.push(props[1]);
  assert.equal(rentFor(g, props[0]), 10); // two of four is still the plain rent
  assert.equal(rentFor(g, props[1]), 10);
  g.properties.push(props[3]);
  assert.equal(rentFor(g, props[3]), 24); // Virginia with three of four: partial
  assert.equal(rentFor(g, props[0]), 20);
  g.properties.push(props[2]);
  assert.equal(rentFor(g, props[0]), 30); // all four
  assert.equal(rentFor(megaGame(props[3]), props[3]), 12);
});

test("mega partial rent starts at all but one: 2 of 3 in a group of three, 3 of 4 in a group of four", () => {
  assert.equal(partialAt(mega("Boardwalk")), 2);
  assert.equal(partialAt(mega("Park Place")), 2);
  assert.equal(partialAt(mega("Kentucky Avenue")), 3);
  const fl = mega("Florida Avenue"), pp = mega("Park Place");
  assert.equal(rentFor(megaGame(fl, pp), fl), 70);
});

test("mega unimproved rent: site, double one shy of the full set, triple with the full set, for every street", () => {
  for (const c of MEGA.filter((x) => x.kind === "street")) {
    assert.deepEqual(c.tiers, [c.rents[0] * 2, c.rents[0] * 3], c.name);
    const props = MEGA.filter((x) => x.group === c.group).map((x) => newProperty(x));
    const me = props.find((p) => p.name === c.name);
    const others = props.filter((p) => p !== me);
    const size = props.length;
    assert.equal(rentFor(megaGame(me), me), c.rents[0], c.name + " alone");
    assert.equal(rentFor(megaGame(me, ...others.slice(0, size - 2)), me), c.rents[0] * 2, c.name + " one shy");
    if (size === 4) assert.equal(rentFor(megaGame(me, others[0]), me), c.rents[0], c.name + " two of four");
    assert.equal(rentFor(megaGame(me, ...others), me), c.rents[0] * 3, c.name + " full set");
  }
});

test("mega Marvin Gardens and California Avenue triple to 72", () => {
  const props = ["Atlantic Avenue", "Ventnor Avenue", "Marvin Gardens", "California Avenue"].map(mega);
  const g = megaGame(...props);
  assert.equal(rentFor(g, props[2]), 72);
  assert.equal(rentFor(g, props[3]), 72);
  assert.equal(rentFor(g, props[0]), 66);
  assert.equal(rentFor(megaGame(props[0], props[1], props[2]), props[2]), 48); // one shy: double
});

const entryOf = (p, type) => p.entries.filter((e) => e.type === type);

test("delete history: a rent entry comes out of the totals; the purchase can't be deleted", () => {
  const g = game();
  const bw = own(g, "Boardwalk", 400);
  collectRent(bw, 50); collectRent(bw, 100);
  assert.equal(deleteEntry(g, bw, entryOf(bw, "rent")[0].id), null);
  const s = stats(bw);
  assert.equal(s.rent, 100);
  assert.equal(s.rentCount, 1);
  assert.equal(s.invested, 400);
  assert.match(deleteEntry(g, bw, bw.entries[0].id), /remove the property/);
  assert.equal(bw.entries.length, 2);
  assert.match(deleteEntry(g, bw, "nope"), /already gone/);
});

test("delete history: undoing a sell-back or a build changes the level; one that later entries depend on is refused", () => {
  const g = game();
  const pp = own(g, "Park Place", 350);
  improve(pp, 5); improve(pp, 5); sellImprovement(pp);
  assert.equal(pp.level, 1);
  assert.equal(deleteEntry(g, pp, entryOf(pp, "sell")[0].id), null);
  assert.equal(pp.level, 2); // the sell-back never happened
  assert.equal(stats(pp).invested, 350 + 400);

  const bw = own(g, "Boardwalk", 400);
  improve(bw, 5); sellImprovement(bw);
  assert.match(deleteEntry(g, bw, entryOf(bw, "improve")[0].id), /later history depends/);
  assert.equal(bw.level, 0);
  assert.equal(bw.entries.length, 3); // refused: nothing changed
  assert.equal(deleteEntry(g, bw, entryOf(bw, "sell")[0].id), null);
  assert.equal(deleteEntry(g, bw, entryOf(bw, "improve")[0].id), null);
  assert.equal(bw.level, 0);
  assert.equal(stats(bw).invested, 400);
});

test("delete history: mortgage and lift-mortgage entries keep the flag and the loan right", () => {
  const g = game();
  const pp = own(g, "Park Place", 350);
  toggleMortgage(pp); toggleMortgage(pp);
  assert.equal(pp.mortgaged, false);
  assert.match(deleteEntry(g, pp, entryOf(pp, "mortgage")[0].id), /later history depends/);
  assert.equal(deleteEntry(g, pp, entryOf(pp, "unmortgage")[0].id), null);
  assert.equal(pp.mortgaged, true);
  assert.equal(stats(pp).loan, 175);
  assert.equal(deleteEntry(g, pp, entryOf(pp, "mortgage")[0].id), null);
  assert.equal(pp.mortgaged, false);
  assert.equal(stats(pp).loan, 0);
  assert.equal(stats(pp).invested, 350);
});

test("delete history: trade entries can't be deleted, and a traded-away property only lets you fix its rent", () => {
  const g = game();
  const med = own(g, "Mediterranean Avenue", 60);
  collectRent(med, 2);
  executeTrade(g, { giveIds: [med.id], receive: [card("Boardwalk")] });
  const [old] = g.archived;
  for (const e of old.entries) assert.equal(canDeleteEntry(old, e, true), e.type === "rent", e.type);
  assert.match(deleteEntry(g, old, entryOf(old, "trade-out")[0].id, true), /Trade entries/);
  assert.equal(deleteEntry(g, old, entryOf(old, "rent")[0].id, true), null);
  assert.equal(stats(old).rent, 0);
  assert.equal(canDeleteEntry(g.properties[0], g.properties[0].entries[0]), false); // the traded-in purchase
});

const build = (p, n, max = 6) => { for (let i = 0; i < n; i++) assert.equal(improve(p, max), null); };

test("repairs: the Mega card rates from the photo", () => {
  assert.deepEqual({ ...REPAIR_RATES.chance, name: 0 }, { name: 0, house: 25, hotel: 100, skyscraper: 100, depot: 25 });
  assert.deepEqual({ ...REPAIR_RATES.chest, name: 0 }, { name: 0, house: 40, hotel: 115, skyscraper: 100, depot: 25 });
});

test("repairs: houses, a hotel replacing its houses, a skyscraper replacing its hotel, and a depot", () => {
  const g = megaGame();
  const med = mega("Mediterranean Avenue"), bal = mega("Baltic Avenue"), arc = mega("Arctic Avenue"), rr = mega("Reading Railroad"), idle = mega("Boardwalk");
  g.properties.push(med, bal, arc, rr, idle);
  build(med, 3);  // 3 houses
  build(bal, 5);  // a hotel, not 4 houses and a hotel
  build(arc, 6);  // a skyscraper
  build(rr, 1, 1); // a train depot
  assert.deepEqual(pieces(bal), { houses: 0, hotels: 1, skyscrapers: 0, depots: 0 });
  assert.deepEqual(pieces(arc), { houses: 0, hotels: 0, skyscrapers: 1, depots: 0 });
  assert.deepEqual(pieces(rr), { houses: 0, hotels: 0, skyscrapers: 0, depots: 1 });
  const chance = planRepairs(g, "chance");
  assert.deepEqual(chance.lines.map((l) => [l.property.name, l.cost]), [["Mediterranean Avenue", 75], ["Baltic Avenue", 100], ["Arctic Avenue", 100], ["Reading Railroad", 25]]);
  assert.equal(chance.total, 300);
  const chest = planRepairs(g, "chest");
  assert.deepEqual(chest.lines.map((l) => l.cost), [120, 115, 100, 25]);
  assert.equal(chest.total, 360);
});

test("repairs: paying adds each share to that property's cost basis and history", () => {
  const g = megaGame();
  const med = mega("Mediterranean Avenue"), bal = mega("Baltic Avenue"), idle = mega("Boardwalk");
  g.properties.push(med, bal, idle);
  build(med, 2); build(bal, 4);
  const before = [med, bal, idle].map((p) => stats(p).invested);
  assert.equal(payRepairs(g, "chest"), null);
  assert.deepEqual([med, bal, idle].map((p) => stats(p).invested), [before[0] + 80, before[1] + 160, before[2]]);
  assert.equal(basisOf(med), before[0] + 80); // a cost, so it is part of the basis
  assert.equal(entryOf(med, "repairs").length, 1);
  assert.equal(entryOf(med, "repairs")[0].amount, -80);
  assert.match(entryOf(med, "repairs")[0].note, /Community Chest repairs: 2 houses/);
  assert.equal(entryOf(idle, "repairs").length, 0); // nothing built, nothing owed
  assert.equal(gameStats(g).invested, before.reduce((a, b) => a + b, 0) + 240);
  // a mistaken entry can be removed from history like any other, without disturbing the build
  assert.equal(deleteEntry(g, med, entryOf(med, "repairs")[0].id), null);
  assert.equal(med.level, 2);
  assert.equal(stats(med).invested, before[0]);
});

test("repairs: the original game uses the same house and hotel amounts, and nothing built means nothing to pay", () => {
  const g = game();
  const pp = own(g, "Park Place", 350);
  assert.match(payRepairs(g, "chance"), /nothing to pay/);
  assert.equal(entryOf(pp, "repairs").length, 0);
  build(pp, 5, 5); // a hotel
  assert.equal(planRepairs(g, "chance").total, 100);
  assert.equal(planRepairs(g, "chest").total, 115);
});

test("game totals: left to break even nets the whole game, unpaid properties are summed on their own", () => {
  const g = game();
  const bw = own(g, "Boardwalk", 400), pp = own(g, "Park Place", 350);
  collectRent(bw, 670); // Boardwalk is 270 ahead
  const t = gameStats(g);
  assert.equal(t.profit, -80);
  assert.equal(t.gameRemaining, 80);
  assert.equal(t.remaining, 350);
  assert.equal(t.offset, 270); // the profit on the property that has paid off
  assert.equal(t.broken, 1);
  assert.equal(t.count, 2);
  collectRent(pp, 500); // now everything has paid off
  const done = gameStats(g);
  assert.equal(done.gameRemaining, 0);
  assert.equal(done.remaining, 0);
  assert.equal(done.offset, 0);
});

test("game totals: a traded-away loss is in the game number but not in what owned properties owe", () => {
  const g = game();
  const med = own(g, "Mediterranean Avenue", 60);
  assert.equal(executeTrade(g, { giveIds: [med.id], receive: [], cashReceived: 10 }), null);
  const t = gameStats(g);
  assert.equal(t.profit, -50);
  assert.equal(t.gameRemaining, 50);
  assert.equal(t.remaining, 0);
  assert.equal(t.offset, -50);
});

test("export file name: created date and game name", () => {
  const made = new Date(2026, 10, 27, 12, 0); // local noon, so the local date is 2026-11-27 in any time zone
  const g = { id: "x", name: "Tilden 11/27/2026", edition: "mega", properties: [], created: made.toISOString() };
  assert.equal(exportFileName(g), "monopoly-asset-manager-2026-11-27-tilden-11-27-2026.json");
  assert.equal(slug("  Game #1: The  Boardwalk!  "), "game-1-the-boardwalk");
  assert.equal(slug("???"), "game");
  assert.equal(slug("x".repeat(100)).length, 60);
  assert.equal(exportFileName({ ...g, id: "x", created: undefined, name: "Old" }), "monopoly-asset-manager-undated-old.json");
});

test("a game's created time comes from its id when it was not stored", () => {
  const before = Date.now();
  const id = uid();
  const t = gameCreated({ id, name: "n", edition: "classic", properties: [] });
  assert.ok(t && Math.abs(+t - before) < 5000);
  assert.equal(gameCreated({ id: "00000001x", name: "n", edition: "classic", properties: [] }), null); // 1970: not a plausible creation time
  assert.equal(gameCreated({ id: "abc", name: "n", edition: "classic", properties: [] }), null);
  const stored = new Date(2026, 0, 2).toISOString();
  assert.equal(gameCreated({ id, created: stored, name: "n", edition: "classic", properties: [] }).toISOString(), stored);
});

test("migrateGames stamps created on older games", () => {
  const g = { id: uid(), name: "old", edition: "classic", properties: [] };
  migrateGames([g]);
  assert.match(g.created, /^20\d\d-\d\d-\d\dT/);
  const keep = { id: "x", name: "kept", edition: "classic", properties: [], created: "2026-01-02T03:04:05.000Z" };
  migrateGames([keep]);
  assert.equal(keep.created, "2026-01-02T03:04:05.000Z");
});
