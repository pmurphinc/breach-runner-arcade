import assert from "node:assert/strict";
import test from "node:test";
import { RULESET_IDS } from "../app/difficulty.ts";
import { RIFT_RUN_SHIPS } from "../app/rift-run/ships.ts";
import { activeHardpointCount, createRiftRun } from "../app/rift-run/state.ts";
import { RIFT_WEAPONS, createWeaponInstance } from "../app/rift-run/weapons.ts";
import { createWeaponRuntime } from "../app/rift-run/weapon-runtime.ts";
import { processHardpointFire, logicalMountOffset } from "../app/rift-run/weapon-fire.ts";
import { admitsProjectile, detonateMissile, projectileFromShot, penetrate, selectMissileTarget, steerMissile, targetsInExplosion, targetsInFlameCone } from "../app/rift-run/weapon-projectiles.ts";

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
  const state = { remainingPenetrations: 2, hitTargetIds: new Set() };
  assert.equal(penetrate(state, "a"), true); assert.equal(penetrate(state, "a"), false); assert.equal(penetrate(state, "b"), true); assert.equal(state.remainingPenetrations, 0);
});

const shot = (weaponId, overrides = {}) => ({ kind: "projectile", weaponId, instanceId: `${weaponId}-1`, hardpointIndex: 0, origin: { x: 0, y: 0 }, angle: 0, damage: 10, speed: 6, radius: 2, life: 100, penetrations: 0, explosionRadius: 0, range: 0, coneDegrees: 0, ...overrides });

test("Rift projectile identity survives creation and budgets are per instance", () => {
  const minigun = projectileFromShot(shot("minigun"));
  assert.equal(minigun.state.weaponId, "minigun"); assert.equal(minigun.state.instanceId, "minigun-1"); assert.equal(minigun.state.hardpointIndex, 0);
  const saturated = Array.from({ length: 48 }, () => projectileFromShot(shot("minigun")));
  assert.equal(admitsProjectile(saturated, "minigun-1", "minigun"), false);
  assert.equal(admitsProjectile(saturated, "railgun-1", "railgun"), true);
  assert.equal(admitsProjectile(saturated, "missile-pod-1", "missile-pod"), true);
});

test("missile holds a target, homes, and flies straight without one", () => {
  const missile = projectileFromShot(shot("missile-pod", { angle: -.3, explosionRadius: 64 }));
  const before = Math.atan2(missile.vy, missile.vx);
  steerMissile(missile, [{ id: "target", x: 100, y: 0, hostile: true }]);
  assert.equal(missile.state.targetId, "target"); assert.ok(Math.atan2(missile.vy, missile.vx) > before);
  const straight = projectileFromShot(shot("missile-pod")), velocity = [straight.vx, straight.vy];
  steerMissile(straight, []); assert.deepEqual([straight.vx, straight.vy], velocity);
});

test("missile blast damages in-radius targets once", () => {
  const missile = projectileFromShot(shot("missile-pod", { explosionRadius: 50 }));
  assert.deepEqual(detonateMissile(missile, [{ id: "inside", x: 49, y: 0 }, { id: "outside", x: 51, y: 0 }]), ["inside"]);
  assert.deepEqual(detonateMissile(missile, [{ id: "inside", x: 0, y: 0 }]), []);
});

test("flame cone is multi-target, directional, and hardpoint cadence is bounded", () => {
  assert.deepEqual(targetsInFlameCone({ x: 0, y: 0 }, 0, 100, 60, [{ id: "a", x: 40, y: 5 }, { id: "b", x: 60, y: -5 }, { id: "behind", x: -10, y: 0 }, { id: "wide", x: 20, y: 80 }]), ["a", "b"]);
  const run = createRiftRun("wing", "flame", "flamethrower"), runtime = createWeaponRuntime(run);
  assert.equal(processHardpointFire(run.hardpoints, runtime, true, { x: 0, y: 0 }, 0).length, 1);
  for (let i=0;i<4;i++) { runtime[run.hardpoints[0].weapon.instanceId].cooldown--; assert.equal(processHardpointFire(run.hardpoints, runtime, true, { x: 0, y: 0 }, 0).length, 0); }
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
