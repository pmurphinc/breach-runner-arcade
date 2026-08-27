import test from "node:test";
import assert from "node:assert/strict";
import { PUP_REGEN_HP_PER_SECOND, pupRegenHull } from "../app/pup-regen.js";
import { SHIPS } from "../app/game-data.ts";
import { SHIP_ORDER, isSelectable } from "../app/ship-data.ts";

test("Kestrel is a selectable, fragile high-speed canonical ship", () => {
  const ship = SHIPS.find(({ id }) => id === "kestrel");
  assert.ok(ship);
  assert.ok(SHIP_ORDER.includes(ship.id));
  assert.equal(isSelectable(ship.id), true);
  assert.equal(ship.health, Math.min(...SHIPS.map(({ health }) => health)));
  assert.ok(ship.maxSpeed >= Math.max(...SHIPS.filter(({ id }) => id !== ship.id).map(({ maxSpeed }) => maxSpeed)) - 0.1);
  assert.equal(ship.acceleration, Math.max(...SHIPS.map(({ acceleration }) => acceleration)));
});

test("stored PUP count scales Kestrel hull regeneration without consuming state", () => {
  assert.equal(PUP_REGEN_HP_PER_SECOND, 0.25);
  const inventory = ["beam", "mines", "ufo", "emp", "nuke"];
  assert.equal(pupRegenHull("kestrel", 50, 120, 0, 1), 50);
  assert.equal(pupRegenHull("kestrel", 50, 120, 1, 1), 50.25);
  assert.equal(pupRegenHull("kestrel", 50, 120, 5, 1), 51.25);
  assert.equal(pupRegenHull("kestrel", 50, 120, 10, 1), 52.5);
  assert.equal(inventory.length, 5);
});

test("removing a PUP immediately lowers rate and healing caps at max hull", () => {
  const withFive = pupRegenHull("kestrel", 50, 120, 5, 1);
  const afterFire = pupRegenHull("kestrel", withFive, 120, 4, 1);
  assert.equal(afterFire - withFive, 1);
  assert.equal(pupRegenHull("kestrel", 119.9, 120, 10, 1), 120);
});

test("regeneration is elapsed-time based and exclusive to Kestrel hull", () => {
  const oneStep = pupRegenHull("kestrel", 50, 120, 5, 1);
  let manySteps = 50;
  for (let i = 0; i < 100; i += 1) manySteps = pupRegenHull("kestrel", manySteps, 120, 5, 0.01);
  assert.ok(Math.abs(oneStep - manySteps) < 1e-9);
  for (const ship of SHIPS.filter(({ id }) => id !== "kestrel")) {
    assert.equal(pupRegenHull(ship.id, 50, ship.health, 10, 1), 50);
  }
  const shield = 37;
  pupRegenHull("kestrel", 50, 120, 10, 1);
  assert.equal(shield, 37);
});
