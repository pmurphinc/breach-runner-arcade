import assert from "node:assert/strict";
import test from "node:test";
import { RULESET_IDS } from "../app/difficulty.ts";
import { RIFT_RUN_SHIPS } from "../app/rift-run/ships.ts";
import { activeHardpointCount, createRiftRun } from "../app/rift-run/state.ts";
import { RIFT_WEAPONS, createWeaponInstance } from "../app/rift-run/weapons.ts";
import { createWeaponRuntime } from "../app/rift-run/weapon-runtime.ts";
import { processHardpointFire, logicalMountOffset } from "../app/rift-run/weapon-fire.ts";
import { penetrate, selectMissileTarget, targetsInExplosion, targetsInFlameCone } from "../app/rift-run/weapon-projectiles.ts";

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

test("a fresh run has one occupied pulse cannon and all remaining hardpoints locked", () => {
  for (const ship of RIFT_RUN_SHIPS) {
    const state = createRiftRun(ship.id, "phase-1-test");
    assert.equal(activeHardpointCount(state), 1);
    assert.equal(state.hardpoints[0].weapon.weaponId, "pulse-cannon");
    assert.ok(state.hardpoints.slice(1).every(({ status }) => status === "locked"));
    assert.equal(JSON.parse(JSON.stringify(state)).seed, "phase-1-test");
  }
});

test("all five stable weapons can start a serializable run", () => {
  assert.deepEqual(RIFT_WEAPONS.map(({ id }) => id), ["pulse-cannon", "minigun", "railgun", "missile-pod", "flamethrower"]);
  for (const weapon of RIFT_WEAPONS) assert.equal(createRiftRun("wing", "seed", weapon.id).hardpoints[0].weapon.weaponId, weapon.id);
});

test("hardpoints schedule independently and ignore locked or empty sockets", () => {
  const run = createRiftRun("flagship", "multi");
  run.hardpoints = ["minigun", "railgun", "missile-pod"].map((id, index) => ({ index, status: "occupied", weapon: createWeaponInstance(id, `w${index}`) }));
  const runtime = createWeaponRuntime(run);
  runtime.w0.cooldown = 2;
  assert.deepEqual(processHardpointFire(run.hardpoints, runtime, true, { x: 0, y: 0 }, 0).map(({ weaponId }) => weaponId), ["railgun", "missile-pod"]);
  assert.notDeepEqual(logicalMountOffset(3, 0), logicalMountOffset(3, 1));
  assert.equal(processHardpointFire([{ index: 0, status: "locked" }, { index: 1, status: "empty" }], {}, true, { x: 0, y: 0 }, 0).length, 0);
});

test("penetration records unique targets", () => {
  const state = { remaining: 2, hitTargets: new Set() };
  assert.equal(penetrate(state, "a"), true); assert.equal(penetrate(state, "a"), false); assert.equal(penetrate(state, "b"), true); assert.equal(state.remaining, 0);
});

test("missiles, explosions and flame geometry are deterministic", () => {
  const targets = [{ id: "b", x: 30, y: 1, hostile: true }, { id: "a", x: 40, y: 0, hostile: true }, { id: "behind", x: -5, y: 0, hostile: true }];
  assert.equal(selectMissileTarget({ x: 0, y: 0 }, 0, 100, 60, targets), "a");
  assert.deepEqual(targetsInExplosion({ x: 0, y: 0 }, 31, targets), ["b", "behind"]);
  assert.deepEqual(targetsInFlameCone({ x: 0, y: 0 }, 0, 50, 60, targets), ["b", "a"]);
});

test("Rift Run remains a format rather than a DifficultyId", () => {
  assert.ok(!RULESET_IDS.includes("rift-run"));
});
