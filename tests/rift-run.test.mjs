import assert from "node:assert/strict";
import test from "node:test";
import { RULESET_IDS } from "../app/difficulty.ts";
import { RIFT_RUN_SHIPS } from "../app/rift-run/ships.ts";
import { activeHardpointCount, createRiftRun } from "../app/rift-run/state.ts";

test("Rift Run exposes exactly its canonical eight-ship fleet", () => {
  assert.equal(RIFT_RUN_SHIPS.length, 8);
  assert.deepEqual(RIFT_RUN_SHIPS.map(({ name }) => name), [
    "Ironclad", "Starling", "Phantom", "Needle", "Rampart", "Switchback", "Talon", "Leviathan",
  ]);
  assert.ok(!RIFT_RUN_SHIPS.some(({ id }) => id === "kestrel" || id === "warden"));
});

test("Rift Run classes constrain physical hardpoints", () => {
  const expected = { light: 1, medium: 2, heavy: 3 };
  for (const ship of RIFT_RUN_SHIPS) assert.equal(ship.maximumHardpoints, expected[ship.shipClass]);
});

test("a fresh run has one occupied cannon and all remaining hardpoints locked", () => {
  for (const ship of RIFT_RUN_SHIPS) {
    const state = createRiftRun(ship.id, "phase-1-test");
    assert.equal(activeHardpointCount(state), 1);
    assert.deepEqual(state.hardpoints[0], { index: 0, status: "occupied", weaponId: "standard-cannon" });
    assert.ok(state.hardpoints.slice(1).every(({ status }) => status === "locked"));
    assert.equal(JSON.parse(JSON.stringify(state)).seed, "phase-1-test");
  }
});

test("Rift Run remains a format rather than a DifficultyId", () => {
  assert.ok(!RULESET_IDS.includes("rift-run"));
});
