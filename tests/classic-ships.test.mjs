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

test("every hull turns at the same rate except the flagship", () => {
  // Not an approximation — the fleet is differentiated by thrust, acceleration
  // and hull rather than by turn rate, which is a real design difference from
  // Breach Runner's own fleet.
  for (const id of CLASSIC_SHIP_IDS) {
    if (id === "flagship") continue;
    assert.equal(CLASSIC_SHIP_STATS[id].turn, 3, `${id} should turn at the shared rate`);
  }
  assert.equal(CLASSIC_SHIP_STATS.flagship.turn, 1.5, "the flagship pays for its hull in turn rate");
});

test("the reference handling is reproduced hull by hull", () => {
  assert.deepEqual(CLASSIC_SHIP_STATS.tank, { turn: 3, maxSpeed: 5, acceleration: 0.1, health: 280, gun: 2, thrust: 0 });
  assert.deepEqual(CLASSIC_SHIP_STATS.rabbit, { turn: 3, maxSpeed: 12, acceleration: 0.35, health: 180, gun: 0, thrust: 2 });
  assert.deepEqual(CLASSIC_SHIP_STATS.flagship, { turn: 1.5, maxSpeed: 2, acceleration: 0.11, health: 300, gun: 0, thrust: 2 });
  // Switchback is the outlier in both fleets: barely any thrust, fully upgraded
  // guns to start, and a handling swap instead of speed.
  assert.equal(CLASSIC_SHIP_STATS.flash.maxSpeed, 1);
  assert.equal(CLASSIC_SHIP_STATS.flash.gun, 3);
});

test("Classic ships are markedly faster than the commercial fleet", () => {
  // This is most of why the original reads as twitchy against the same
  // 10-units-per-tick bullet.
  for (const id of CLASSIC_SHIP_IDS) {
    const commercial = SHIPS.find((ship) => ship.id === id);
    if (id === "flash") continue; // already at 1.0 in both
    assert.ok(
      CLASSIC_SHIP_STATS[id].maxSpeed > commercial.maxSpeed,
      `${id}: classic ${CLASSIC_SHIP_STATS[id].maxSpeed} should exceed ${commercial.maxSpeed}`
    );
  }
});

test("the commercial fleet is untouched", () => {
  // COMMERCIALIZATION.md commits to an independent balance pass; retuning SHIPS
  // toward the reference would work against it. Two tables, on purpose.
  assert.equal(SHIPS.length, 10);
  assert.equal(SHIPS.find((ship) => ship.id === "tank").maxSpeed, 2.7);
  assert.equal(SHIPS.find((ship) => ship.id === "rabbit").health, 150);
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
  assert.equal(classic.maxSpeed, 5);
  assert.equal(classic.health, 280);
  assert.notEqual(classic.maxSpeed, tank.maxSpeed);
});

test("the swap happens once, where a run's hull is fixed", () => {
  // Resolving per read site would leave some part of the loop using the other
  // table's numbers.
  assert.match(game, /ship = shipForMode\(ship, mode\)/);
  assert.equal((game.match(/shipForMode\(/g) ?? []).length, 1);
});
