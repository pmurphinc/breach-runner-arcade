import assert from "node:assert/strict";
import test from "node:test";
import { RULESET_IDS } from "../app/difficulty.ts";
import { RIFT_RUN_SHIPS } from "../app/rift-run/ships.ts";
import { activeHardpointCount, createRiftRun } from "../app/rift-run/state.ts";
import { RIFT_WEAPONS, createWeaponInstance } from "../app/rift-run/weapons.ts";
import { createWeaponRuntime } from "../app/rift-run/weapon-runtime.ts";
import { processHardpointFire, logicalMountOffset } from "../app/rift-run/weapon-fire.ts";
import { admitsProjectile, detonateMissile, projectileFromShot, penetrate, selectMissileTarget, steerMissile, targetsInExplosion, targetsInFlameCone } from "../app/rift-run/weapon-projectiles.ts";
import { awardRiftEnergy, enemyKillEnergy, riftDamaged, riftEnergyRequiredForLevel } from "../app/rift-run/progression.ts";
import { applyRiftRunHullWeaponDamage, RIFT_RUN_RIFT_DAMAGE_SCALE } from "../app/rift-run/rift-damage.ts";
import { eligibleUpgradeChoices, rollUpgradeChoices } from "../app/rift-run/upgrade-pool.ts";
import { applyUpgrade, mountUnlockedWeapon } from "../app/rift-run/upgrade-apply.ts";

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

test("combat energy rewards and an increasing curve safely queue multiple levels", () => {
  assert.ok(enemyKillEnergy("nuke") > enemyKillEnergy("turret")); assert.ok(enemyKillEnergy("turret") > enemyKillEnergy("ufo"));
  assert.ok(riftEnergyRequiredForLevel(4) > riftEnergyRequiredForLevel(2));
  const start=createRiftRun("wing","energy"), damaged=riftDamaged(start,10,"socket-1"); assert.ok(damaged.riftEnergy>0);
  const advanced=awardRiftEnergy(start,1000); assert.ok(advanced.level>3); assert.equal(advanced.pendingLevels,advanced.level-1);
});

function riftRunHullHit(game, run, weaponDamage, instanceId = "weapon-1") {
  game.portalCharge += weaponDamage;
  const integrityDamage = applyRiftRunHullWeaponDamage(game, weaponDamage);
  return { integrityDamage, run: integrityDamage > 0 ? riftDamaged(run, integrityDamage, instanceId) : run };
}

for (const [weaponId, label] of [
  ["pulse-cannon", "Pulse Cannon"],
  ["minigun", "Minigun"],
  ["railgun", "Railgun"],
  ["missile-pod", "Missile direct impact"],
]) test(`${label} Rift hit reduces integrity using Rift Run scaling`, () => {
  const weapon = RIFT_WEAPONS.find(({ id }) => id === weaponId);
  const game = { rivalHealth: 200, portalCharge: 0 };
  const hit = riftRunHullHit(game, createRiftRun("wing", weaponId), weapon.damage);
  assert.equal(hit.integrityDamage, weapon.damage * RIFT_RUN_RIFT_DAMAGE_SCALE);
  assert.equal(game.rivalHealth, 200 - hit.integrityDamage);
});

test("Flamethrower cadence tick applies exactly one scaled Rift hit", () => {
  const run = createRiftRun("wing", "flame-rift", "flamethrower");
  const runtime = createWeaponRuntime(run);
  const [tick] = processHardpointFire(run.hardpoints, runtime, true, { x: 0, y: 0 }, 0);
  const game = { rivalHealth: 200, portalCharge: 0 };
  const hit = riftRunHullHit(game, run, tick.damage, tick.instanceId);
  assert.equal(hit.integrityDamage, tick.damage * RIFT_RUN_RIFT_DAMAGE_SCALE);
  assert.equal(processHardpointFire(run.hardpoints, runtime, true, { x: 0, y: 0 }, 0).length, 0);
});

test("Rift Energy uses actual removed integrity and zero integrity awards no more", () => {
  const start = createRiftRun("wing", "clamped-energy");
  const game = { rivalHealth: 0.5, portalCharge: 0 };
  const first = riftRunHullHit(game, start, 10);
  assert.equal(first.integrityDamage, 0.5);
  assert.equal(game.rivalHealth, 0);
  assert.equal(first.run.riftEnergy, 0.5 * 0.12);
  const second = riftRunHullHit(game, first.run, 10);
  assert.equal(second.integrityDamage, 0);
  assert.equal(second.run.riftEnergy, first.run.riftEnergy);
  assert.equal(game.portalCharge, 20, "portal charge advances independently for both nominal hits");
});

test("Railgun and missile Rift collision remain direct, terminating impacts without homing at the Rift", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/game.tsx", import.meta.url), "utf8"));
  assert.match(source, /steerMissile\(projectile, liveTargets\)/);
  assert.match(source, /hitRiftWithRiftRunWeapon\(game, projectile\.state\.damage, projectile\.state\.instanceId\);\s*projectile\.state\.remainingLifetime = 0/);
});

test("standard PvE cannon Rift contact retains its unscaled portal-charge behavior", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/game.tsx", import.meta.url), "utf8"));
  assert.match(source, /if \(!bullet\.autoGun && dist\(bullet, \{ x: game\.portalX, y: game\.portalY \}\) < 43\) \{\s*bullet\.life = 0;\s*game\.portalCharge \+= bullet\.damage;/);
});

test("upgrade rolls are deterministic, unique, seeded, and weapon eligible", () => {
  const a=createRiftRun("tank","same","railgun"), b=createRiftRun("tank","same","railgun"), c=createRiftRun("tank","other","railgun");
  assert.deepEqual(rollUpgradeChoices(a),rollUpgradeChoices(b)); assert.notDeepEqual(rollUpgradeChoices(a).choices,rollUpgradeChoices(c).choices);
  const choices=rollUpgradeChoices(a).choices; assert.equal(choices.length,3); assert.equal(new Set(choices.map(x=>x.key)).size,3);
  assert.ok(!eligibleUpgradeChoices(createRiftRun("wing","pulse")).some(x=>x.upgradeId==="penetrator"));
});

test("per-instance upgrades are capped and create deterministic real volleys", () => {
  let run=createRiftRun("tank","upgrades","pulse-cannon"); run.hardpoints[1]={index:1,status:"occupied",weapon:createWeaponInstance("pulse-cannon","second")};
  const choice={key:"twin-pulse:second",upgradeId:"twin-pulse",targetInstanceId:"second",hardpointIndex:1,title:"",target:"",description:""};
  run=applyUpgrade(run,choice); assert.equal(run.hardpoints[0].weapon.modifiers.projectileCount,0); assert.equal(run.hardpoints[1].weapon.modifiers.projectileCount,1);
  const shots=processHardpointFire(run.hardpoints,createWeaponRuntime(run),true,{x:0,y:0},0).filter(x=>x.instanceId==="second"); assert.equal(shots.length,2); assert.notEqual(shots[0].angle,shots[1].angle);
  for(let i=0;i<10;i++) run=applyUpgrade(run,choice); assert.ok(run.hardpoints[1].weapon.modifiers.projectileCount<=3);
});

test("hardpoint online activates one socket and mounting creates a fresh instance", () => {
  const light=createRiftRun("wing","light"); assert.ok(!eligibleUpgradeChoices(light).some(x=>x.upgradeId==="hardpoint-online"));
  let heavy=createRiftRun("flagship","heavy"), choice=eligibleUpgradeChoices(heavy).find(x=>x.upgradeId==="hardpoint-online"); assert.ok(choice);
  heavy=applyUpgrade(heavy,choice); assert.equal(heavy.hardpoints.filter(x=>x.status==="available").length,1); assert.equal(heavy.hardpoints.filter(x=>x.status==="locked").length,1);
  heavy=mountUnlockedWeapon(heavy,1,"missile-pod"); assert.equal(heavy.hardpoints[1].weapon.level,1); assert.notEqual(heavy.hardpoints[1].weapon.instanceId,heavy.hardpoints[0].weapon.instanceId);
});
