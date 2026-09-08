/**
 * Classic's handling table.
 *
 * Two things matter here and they pull against each other: the numbers have to
 * be the reference's, and the identity has to be this project's. A test that
 * only checked the statistics would happily pass a Classic fleet wearing the
 * original's names.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SHIPS } from "../app/game-data.ts";
import {
  CLASSIC_SHIPS,
  CLASSIC_SHIP_IDS,
  CLASSIC_SHIP_STATS,
  isClassicShip,
  shipForMode,
} from "../app/classic-ships.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const byId = (id) => CLASSIC_SHIPS.find((ship) => ship.id === id);

test("Classic flies the eight hulls the reference had", () => {
  assert.equal(CLASSIC_SHIPS.length, 8);
  assert.deepEqual([...CLASSIC_SHIP_IDS], ["tank", "wing", "squid", "rabbit", "turtle", "flash", "hunter", "flagship"]);
  // Kestrel and Warden are this project's own: there is no authentic handling
  // to give them, so they stay out rather than being invented.
  assert.ok(!isClassicShip("kestrel"));
  assert.ok(!isClassicShip("warden"));
  assert.equal(byId("kestrel"), undefined);
});

/**
 * Turn rate is a real axis of difference, and this is the regression guard.
 *
 * These numbers were previously read one column to the left of where they
 * live, which produced a flat 3 degrees a tick for seven of the eight hulls
 * and a test asserting that flatness was intended. It was not: that column
 * is the ship-select zoom level. A hull-by-hull spread is the evidence that
 * the right column is being read.
 */
test("turn rate is spread across the fleet, not shared", () => {
  const turns = CLASSIC_SHIP_IDS.map((id) => CLASSIC_SHIP_STATS[id].turn);
  assert.ok(new Set(turns).size > 5, `expected a spread, got ${turns.join(", ")}`);
  assert.equal(Math.min(...turns), 1, "the shape-shifter is the slowest to come about");
  assert.equal(Math.max(...turns), 12, "the corvette is the quickest");
  // The value the old mapping produced for every hull at once. If this comes
  // back, the zoom column is being read as a turn rate again.
  assert.notEqual(turns.filter((turn) => turn === 3).length, turns.length - 1, "flat 3s mean the zoom column");
});

test("the reference handling is reproduced hull by hull", () => {
  assert.deepEqual(CLASSIC_SHIP_STATS.tank, { turn: 5, maxSpeed: 6, acceleration: 0.1, health: 280, gun: 2, thrust: 0 });
  assert.deepEqual(CLASSIC_SHIP_STATS.rabbit, { turn: 12, maxSpeed: 11, acceleration: 0.35, health: 180, gun: 0, thrust: 2 });
  assert.deepEqual(CLASSIC_SHIP_STATS.flagship, { turn: 2, maxSpeed: 3.9, acceleration: 0.11, health: 300, gun: 0, thrust: 2 });
  // Switchback is the outlier in both fleets: barely any thrust, fully upgraded
  // guns to start, and a handling swap instead of speed.
  assert.equal(CLASSIC_SHIP_STATS.flash.maxSpeed, 1);
  assert.equal(CLASSIC_SHIP_STATS.flash.gun, 3);
});

/**
 * Classic is distinguished by the spread of its numbers, not their size.
 *
 * It used to be distinguished by size: the commercial fleet topped out at 3.8
 * against Classic's 11. The commercial fleet has since been doubled, so the
 * two overlap — and what still separates them is that Classic's hulls
 * disagree with each other far more. Its slowest hull is a tenth of its
 * fastest, where the commercial fleet is deliberately grouped much tighter.
 * That is what a balanced roster looks like, and why the two tables exist.
 */
test("Classic is spread far wider than the commercial fleet", () => {
  const spread = (speeds) => Math.max(...speeds) / Math.min(...speeds);
  const classic = spread(CLASSIC_SHIP_IDS.map((id) => CLASSIC_SHIP_STATS[id].maxSpeed));
  const commercial = spread(SHIPS.map((ship) => ship.maxSpeed));
  assert.equal(classic, 11, "the reference's own extremes, 1 through 11");
  assert.ok(commercial < 5, `the commercial fleet stays grouped, got ${commercial}`);
  assert.ok(classic > commercial * 2, "and Classic is more than twice as spread");
  // The fastest thing in the game is still a Classic hull.
  const fastestClassic = Math.max(...CLASSIC_SHIP_IDS.map((id) => CLASSIC_SHIP_STATS[id].maxSpeed));
  assert.ok(fastestClassic > Math.max(...SHIPS.map((ship) => ship.maxSpeed)));
});

/**
 * The commercial fleet keeps its own numbers.
 *
 * COMMERCIALIZATION.md commits to an independent balance pass, and to not
 * describing any value as preserved from the reference. The fleet-wide speed
 * change does not work against that: doubling this project's own numbers is
 * this project's own balance decision, and the results are not the
 * reference's values. This test is what proves it — the two tables have to
 * keep disagreeing, hull by hull.
 */
test("the commercial fleet is not the reference fleet", () => {
  assert.equal(SHIPS.length, 10);
  assert.equal(SHIPS.find((ship) => ship.id === "tank").maxSpeed, 5.4);
  assert.equal(SHIPS.find((ship) => ship.id === "rabbit").health, 150);

  // Every shared hull must differ somewhere on its sheet. Starling happens to
  // land on the same top speed, so it is separated by the rest of its row.
  for (const id of CLASSIC_SHIP_IDS) {
    const commercial = SHIPS.find((ship) => ship.id === id);
    const reference = CLASSIC_SHIP_STATS[id];
    const identical = commercial.maxSpeed === reference.maxSpeed
      && commercial.acceleration === reference.acceleration
      && commercial.health === reference.health
      && commercial.turn === reference.turn;
    assert.ok(!identical, `${id}: the commercial sheet must not reproduce the reference's`);
  }
});

test("only the statistics are borrowed; the identity is this project's", () => {
  for (const ship of CLASSIC_SHIPS) {
    const commercial = SHIPS.find((entry) => entry.id === ship.id);
    assert.equal(ship.name, commercial.name, "names come from the commercial fleet");
    assert.equal(ship.role, commercial.role);
    assert.equal(ship.special, commercial.special);
  }
  assert.equal(byId("tank").name, "Ironclad");
  assert.equal(byId("flagship").name, "Leviathan");
});

test("the roster is derived, so a rename cannot leave Classic stale", () => {
  const source = readFileSync(new URL("../app/classic-ships.ts", import.meta.url), "utf8");
  assert.match(source, /SHIPS\.filter\(\(ship\) => isClassicShip\(ship\.id\)\)\.map/);
});

test("an unavailable hull falls back rather than refusing the launch", () => {
  const kestrel = SHIPS.find((ship) => ship.id === "kestrel");
  const fallback = shipForMode(kestrel, "classic");
  assert.ok(isClassicShip(fallback.id), "the mode is the deliberate choice, the ship is a preference");
  // Every other mode passes the pilot's actual ship straight through.
  assert.equal(shipForMode(kestrel, "pve"), kestrel);
  assert.equal(shipForMode(kestrel, "pvp"), kestrel);
});

test("a Classic hull keeps its own stats through the mode swap", () => {
  const tank = SHIPS.find((ship) => ship.id === "tank");
  const classic = shipForMode(tank, "classic");
  assert.equal(classic.id, "tank");
  assert.equal(classic.maxSpeed, 6);
  assert.equal(classic.health, 280);
  assert.notEqual(classic.maxSpeed, tank.maxSpeed);
});

test("the swap happens once, where a run's hull is fixed", () => {
  // Resolving per read site would leave some part of the loop using the other
  // table's numbers.
  assert.match(game, /ship = shipForMode\(ship, mode\)/);
  assert.equal((game.match(/shipForMode\(/g) ?? []).length, 1);
});
