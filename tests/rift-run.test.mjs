import assert from "node:assert/strict";
import test from "node:test";
import { RULESET_IDS } from "../app/difficulty.ts";
import { RIFT_RUN_SHIPS, RIFT_RUN_SHIP_IDS, riftRunShip } from "../app/rift-run/ships.ts";
import { activeHardpointCount, createRiftRun } from "../app/rift-run/state.ts";
import { RIFT_WEAPONS, createWeaponInstance } from "../app/rift-run/weapons.ts";
import { createWeaponRuntime } from "../app/rift-run/weapon-runtime.ts";
import { processHardpointFire, logicalMountOffset } from "../app/rift-run/weapon-fire.ts";
import { admitsProjectile, applyScorched, detonateMissile, evolutionRadialHit, projectileFromShot, penetrate, SCORCHED_DURATION_TICKS, SCORCHED_TICK_CADENCE, selectMissileTarget, steerMissile, targetsInExplosion, targetsInFlameCone, tickScorched } from "../app/rift-run/weapon-projectiles.ts";
import { clearInactiveFlameFx, flameDisplayTransform, refreshFlameFx } from "../app/rift-run/flame-fx.ts";
import { awardRiftEnergy, enemyKillEnergy, riftDamaged, riftEnergyProgress, riftEnergyRequiredForLevel } from "../app/rift-run/progression.ts";
import { applyRiftRunHullWeaponDamage, RIFT_RUN_BASE_INTEGRITY, RIFT_RUN_BREACH_REWARDS, RIFT_RUN_REFORM_DELAY_MS, RIFT_RUN_RIFT_DAMAGE_SCALE, riftIntegrityForBreach } from "../app/rift-run/rift-damage.ts";
import { breachRiftRun, tickRiftReform } from "../app/rift-run/breach.ts";
import { RIFT_EVOLUTIONS, activeEvolution, eligibleEvolutions } from "../app/rift-run/evolutions.ts";
import { eligibleUpgradeChoices, rollUpgradeChoices } from "../app/rift-run/upgrade-pool.ts";
import { applyUpgrade, mountUnlockedWeapon } from "../app/rift-run/upgrade-apply.ts";
import { RIFT_REWARD_CATEGORIES, RIFT_UPGRADES, rewardCategoryLabel, upgradeStack } from "../app/rift-run/upgrades.ts";
import { claimHullGunWeapon } from "../app/rift-run/hull-gun-reward.ts";
import { HARDPOINT_BREACH_MILESTONES, hardpointIndexForBreach, hardpointUnlockForBreach } from "../app/rift-run/hardpoint-milestones.ts";
import { riftRunHandling, riftRunHullDamage } from "../app/rift-run/live-modifiers.ts";
import { applyIntent, intentFromKeys } from "../app/movement.ts";
import { createRunAgainRiftRun, replayForCompletedRun } from "../app/run-replay.ts";

test("Run Again preserves Rift Run identity and ship while creating fresh progression", () => {
  const completed = createArmedRun("tank", "completed-seed", "railgun");
  completed.level = 8;
  completed.riftEnergy = 42;
  completed.riftBreaches = 3;
  completed.upgradeHistory = [{ upgradeId: "impact-plating", stack: 2, level: 2 }];
  completed.status = "completed";

  const replay = replayForCompletedRun("pve", "difficult", completed);
  assert.deepEqual(replay, { kind: "rift-run", shipId: "tank" });
  const restarted = createRunAgainRiftRun(replay, "new-seed");

  assert.equal(restarted.selectedShip, completed.selectedShip);
  assert.equal(restarted.status, "active");
  assert.equal(restarted.seed, "new-seed");
  assert.equal(restarted.level, 1);
  assert.equal(restarted.riftEnergy, 0);
  assert.equal(restarted.riftBreaches, 0);
  assert.deepEqual(restarted.upgradeHistory, []);
  assert.ok(restarted.hardpoints.every(({ status }) => status === "locked"));
  assert.equal(activeHardpointCount(restarted), 0);
});

test("normal PvE Run Again remains normal PvE", () => {
  assert.deepEqual(replayForCompletedRun("pve", "difficult", null), { kind: "pve" });
});

test("Rift Run exposes exactly its canonical ten-ship fleet", () => {
  assert.equal(RIFT_RUN_SHIPS.length, 10);
  assert.deepEqual(RIFT_RUN_SHIPS.map(({ name }) => name), [
    "Ironclad", "Starling", "Phantom", "Needle", "Rampart", "Switchback", "Talon", "Leviathan", "Kestrel", "Warden",
  ]);
  assert.deepEqual(RIFT_RUN_SHIP_IDS, ["tank", "wing", "squid", "rabbit", "turtle", "flash", "hunter", "flagship", "kestrel", "warden"]);
});

test("Kestrel and Warden reuse their canonical classes, hardpoints, and specials", () => {
  assert.deepEqual(riftRunShip("kestrel"), {
    id: "kestrel", name: "Kestrel", shipClass: "light", maximumHardpoints: 1, abilityName: "SALVAGE LINK",
  });
  assert.deepEqual(riftRunShip("warden"), {
    id: "warden", name: "Warden", shipClass: "medium", maximumHardpoints: 2, abilityName: "SUPPRESSION BARRAGE",
  });
});

test("Kestrel and Warden follow their class milestones and replay from locked sockets", () => {
  for (const shipId of ["kestrel", "warden"]) {
    const fresh = createRiftRun(shipId, `${shipId}-fresh`);
    assert.equal(fresh.selectedShip, shipId);
    assert.equal(activeHardpointCount(fresh), 0);
    assert.ok(fresh.hardpoints.every(({ status }) => status === "locked"));

    const first = breachRiftRun(fresh, { integrity: 0, maximumIntegrity: 100, reformRemainingMs: 0, breached: false });
    assert.deepEqual(first.state.pendingHullGunReward, { hardpointIndex: 0, breach: 1 });
    assert.equal(first.state.hardpoints.filter(({ status }) => status === "available").length, 1);
    assert.equal(activeHardpointCount(first.state), 0);

    let progressed = claimHullGunWeapon(first.state, 0, "pulse-cannon");
    progressed.riftBreaches = 2;
    progressed = breachRiftRun(progressed, { integrity: 0, maximumIntegrity: 100, reformRemainingMs: 0, breached: false }).state;
    if (shipId === "warden") {
      assert.deepEqual(progressed.pendingHullGunReward, { hardpointIndex: 1, breach: 3 });
      progressed = claimHullGunWeapon(progressed, 1, "pulse-cannon");
      assert.equal(activeHardpointCount(progressed), 2);
      assert.notEqual(progressed.hardpoints[0].weapon.instanceId, progressed.hardpoints[1].weapon.instanceId);
    } else {
      assert.equal(progressed.pendingHullGunReward, null);
      assert.equal(activeHardpointCount(progressed), 1);
    }

    const replay = replayForCompletedRun("pve", "difficult", { ...progressed, status: "completed" });
    assert.deepEqual(replay, { kind: "rift-run", shipId });
    const restarted = createRunAgainRiftRun(replay, `${shipId}-again`);
    assert.equal(restarted.selectedShip, shipId);
    assert.equal(activeHardpointCount(restarted), 0);
    assert.equal(restarted.pendingHullGunReward, null);
    assert.equal(restarted.riftBreaches, 0);
    assert.ok(restarted.hardpoints.every(({ status }) => status === "locked"));
  }
});

test("Rift Run setup renders every canonical fleet entry with the shared ship renderer", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/main-menu.tsx", import.meta.url), "utf8"));
  assert.match(source, /RIFT_RUN_SHIPS\.map\(\(candidate\) =>/);
  assert.match(source, /renderShip\(candidate\.id, 44\)/);
});

test("Rift Run classes constrain physical hardpoints", () => {
  const expected = { light: 1, medium: 2, heavy: 3 };
  for (const ship of RIFT_RUN_SHIPS) assert.equal(ship.maximumHardpoints, expected[ship.shipClass]);
});

test("fresh runs start with every class socket locked and no hull guns", () => {
  const maximums = { light: 1, medium: 2, heavy: 3 };
  for (const ship of RIFT_RUN_SHIPS) {
    const state = createRiftRun(ship.id, "phase-1-test");
    assert.equal(activeHardpointCount(state), 0);
    assert.equal(state.hardpoints.length, maximums[ship.shipClass]);
    assert.ok(state.hardpoints.every(({ status }) => status === "locked"));
    assert.equal(JSON.parse(JSON.stringify(state)).seed, "phase-1-test");
  }
});

function createArmedRun(ship, seed, weaponId) {
  const run = createRiftRun(ship, seed);
  run.hardpoints[0] = { index: 0, status: "available" };
  return mountUnlockedWeapon(run, 0, weaponId);
}

test("all five stable weapons can be mounted after a socket unlock", () => {
  assert.deepEqual(RIFT_WEAPONS.map(({ id }) => id), ["pulse-cannon", "minigun", "railgun", "missile-pod", "flamethrower"]);
  for (const weapon of RIFT_WEAPONS) assert.equal(createArmedRun("wing", "seed", weapon.id).hardpoints[0].weapon.weaponId, weapon.id);
});

test("Rift Run defensive and mobility modifiers alter live simulation inputs only while active", () => {
  let run = createRiftRun("tank", "live-modifiers");
  run = { ...run, status: "active", pendingLevels: 3 };
  const choice = (upgradeId, gameplayCategory) => ({ key: upgradeId, upgradeId, gameplayCategory, title: "", target: "", description: "" });
  run = applyUpgrade(run, choice("impact-plating", "defensive"));
  run = applyUpgrade(run, choice("thruster-tuning", "mobility"));
  run = applyUpgrade(run, choice("vector-nozzles", "mobility"));
  assert.ok(riftRunHullDamage(20, run) < 20, "Impact Plating must reduce actual hull loss");
  assert.equal(riftRunHullDamage(20, { ...run, status: "completed" }), 20, "other modes/inactive runs retain raw damage");

  const base = { acceleration: .4, maxSpeed: 4 };
  const tuned = riftRunHandling(base, run);
  assert.ok(tuned.maxSpeed > base.maxSpeed, "Thruster Tuning raises the existing top speed");
  assert.ok(tuned.acceleration > base.acceleration * run.shipModifiers.movement, "Vector Nozzles improves response beyond speed tuning");
  const intent = intentFromKeys({ up: false, down: false, left: false, right: true });
  assert.ok(applyIntent({ vx: 0, vy: 0 }, intent, tuned).vx > applyIntent({ vx: 0, vy: 0 }, intent, base).vx);
});

test("every local hull-loss path applies Rift Run damage resistance", async () => {
  const game = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/game.tsx", import.meta.url), "utf8"));
  assert.doesNotMatch(game, /player\.health\s*=\s*Math\.max\(1,\s*player\.health\s*-\s*\(Math\.random/,
    "Reactor Burst must not bypass Impact Plating with a direct health subtraction");
  assert.match(game, /player\.health\s*=\s*Math\.max\(1,\s*player\.health\s*-\s*riftRunHullDamage\(reactorCost,\s*riftRunRef\.current\)\)/);
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
  const run = createArmedRun("wing", "flame", "flamethrower"), runtime = createWeaponRuntime(run);
  assert.equal(processHardpointFire(run.hardpoints, runtime, true, { x: 0, y: 0 }, 0).length, 1);
  for (let i=0;i<4;i++) { runtime[run.hardpoints[0].weapon.instanceId].cooldown--; assert.equal(processHardpointFire(run.hardpoints, runtime, true, { x: 0, y: 0 }, 0).length, 0); }
});

test("flame presentation stays bounded and follows its mounted hardpoint and heading", () => {
  const flames = [];
  const shot = { instanceId: "flame-1", hardpointIndex: 1, range: 125, coneDegrees: 58, angle: 0.25 };
  refreshFlameFx(flames, shot, 2, 0.2);
  refreshFlameFx(flames, { ...shot, angle: 0.35 }, 2, 0.3);
  assert.equal(flames.length, 1);
  assert.deepEqual(flameDisplayTransform(flames[0], { x: 100, y: 50 }, Math.PI / 2).origin, { x: 92, y: 59 });
  assert.ok(Math.abs(flameDisplayTransform(flames[0], { x: 100, y: 50 }, 1).angle - 1.05) < 1e-12);
});

test("stopping fire and weapon replacement clear flame presentation records", () => {
  const flames = [];
  refreshFlameFx(flames, { instanceId: "old", hardpointIndex: 0, range: 125, coneDegrees: 58, angle: 0 }, 1, 0);
  clearInactiveFlameFx(flames, new Set(), true);
  assert.equal(flames.length, 0);
  refreshFlameFx(flames, { instanceId: "current", hardpointIndex: 0, range: 125, coneDegrees: 58, angle: 0 }, 1, 0);
  clearInactiveFlameFx(flames, new Set(["current"]), false);
  assert.equal(flames.length, 0);
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
  const start=createRiftRun("wing", "energy"), damaged=riftDamaged(start,10,"socket-1"); assert.ok(damaged.riftEnergy>0);
  const advanced=awardRiftEnergy(start,1000); assert.ok(advanced.level>3); assert.equal(advanced.pendingLevels,advanced.level-1);
});

test("Rift Energy progress normalizes the current threshold and becomes full when ready", () => {
  const run = createRiftRun("wing", "ring");
  const required = riftEnergyRequiredForLevel(run.level);
  assert.deepEqual(riftEnergyProgress({ ...run, riftEnergy: required / 2 }), { current: required / 2, required, fraction: .5, ready: false });
  assert.equal(riftEnergyProgress({ ...run, riftEnergy: -100 }).fraction, 0);
  assert.equal(riftEnergyProgress({ ...run, riftEnergy: required * 2 }).fraction, 1);
  assert.deepEqual(riftEnergyProgress({ ...run, riftEnergy: 1, pendingLevels: 2 }), { current: 1, required, fraction: 1, ready: true });

  const earned = awardRiftEnergy(run, required + 5);
  assert.equal(riftEnergyProgress(earned).fraction, 1, "a queued choice keeps the ring ready");
  const resolved = applyUpgrade(earned, eligibleUpgradeChoices(earned).find(choice => choice.upgradeId === "impact-plating"));
  assert.equal(resolved.pendingLevels, 0);
  assert.equal(riftEnergyProgress(resolved).fraction, 5 / riftEnergyRequiredForLevel(resolved.level), "the ring reveals banked progress after selection");
});

test("Rift Energy ring integration is Rift Run-only", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/game.tsx", import.meta.url), "utf8"));
  const ring = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/rift-run/energy-ring.ts", import.meta.url), "utf8"));
  assert.match(source, /drawRiftEnergyRing\(ctx, player\.x, player\.y, riftRunRef\.current, time\)/);
  assert.doesNotMatch(source, /drawRiftEnergyRing\(ctx, game\.portalX, game\.portalY/);
  assert.match(ring, /if \(!state \|\| state\.status !== "active"\) return/);
});

test("HULL GUN extends the reward categories without changing the original three", () => {
  assert.deepEqual(RIFT_REWARD_CATEGORIES, ["offensive", "defensive", "mobility", "hull-gun"]);
  assert.equal(rewardCategoryLabel("hull-gun"), "HULL GUN");
  assert.ok(RIFT_UPGRADES.filter(definition => definition.effect === "damage" || definition.effect === "fireRate").some(definition => definition.category === "hull-gun"));
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
  const run = createArmedRun("wing", "flame-rift", "flamethrower");
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

test("standard PvE cannon and hull weapons share nominal PUP charging", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/game.tsx", import.meta.url), "utf8"));
  assert.match(source, /chargeRiftPup\(game, bullet\.damage\)/);
  assert.match(source, /chargeRiftPup\(game, weaponDamage\)/);
});

test("upgrade rolls are deterministic, unique, seeded, and weapon eligible", () => {
  const a=createArmedRun("tank", "same", "railgun"), b=createArmedRun("tank", "same", "railgun"), c=createArmedRun("tank", "other", "railgun");
  assert.deepEqual(rollUpgradeChoices(a),rollUpgradeChoices(b)); assert.notDeepEqual(rollUpgradeChoices(a).choices,rollUpgradeChoices(c).choices);
  const choices=rollUpgradeChoices(a).choices; assert.equal(choices.length,3); assert.equal(new Set(choices.map(x=>x.key)).size,3);
  assert.deepEqual(choices.map(x=>x.gameplayCategory), ["offensive", "defensive", "mobility"]);
  assert.ok(!eligibleUpgradeChoices(createRiftRun("wing","pulse")).some(x=>x.upgradeId==="penetrator"));
});

test("deep deterministic progression always retains exactly one eligible card per category", () => {
  let run=createArmedRun("flagship", "deep-category-run", "railgun");
  run.status="active"; run.riftBreaches=1;
  for (let level=0; level<60; level++) {
    run.pendingLevels=1;
    const roll=rollUpgradeChoices(run);
    assert.equal(roll.choices.length,3,`level ${level+1}`);
    assert.deepEqual(roll.choices.map(x=>x.gameplayCategory),["offensive","defensive","mobility"]);
    assert.equal(new Set(roll.choices.map(x=>x.key)).size,3);
    for (const card of roll.choices) assert.ok(eligibleUpgradeChoices(run).some(x=>x.key===card.key) || card.kind==="evolution");
    const selected=roll.choices[level%3];
    run=applyUpgrade({...run,rollIndex:roll.nextRollIndex},selected);
    const definition=RIFT_UPGRADES.find(x=>x.id===selected.upgradeId);
    if (definition && upgradeStack(run,definition.id,selected.targetInstanceId)>=definition.maxStacks) {
      assert.ok(!eligibleUpgradeChoices(run).some(x=>x.key===selected.key),`${selected.key} must disappear at max stacks`);
    }
    const available=run.hardpoints.find(x=>x.status==="available");
    if (available) run=mountUnlockedWeapon(run,available.index,"pulse-cannon");
  }
});

test("adversarial single-category progression cannot exhaust any class or category", () => {
  const classes=[["wing","light"],["squid","medium"],["tank","heavy"]];
  const categories=["offensive","defensive","mobility"];
  for (const [ship,shipClass] of classes) for (const selectedCategory of categories) {
    let run=createRiftRun(ship,`${shipClass}-${selectedCategory}-exhaustion`);
    run.status="active";
    run=breachRiftRun(run,{integrity:0,maximumIntegrity:100,reformRemainingMs:0,breached:false}).state;
    run=mountUnlockedWeapon(run,0,"railgun");
    for (let level=0; level<75; level++) {
      run.pendingLevels=1;
      const roll=rollUpgradeChoices(run);
      assert.equal(roll.choices.length,3,`${shipClass} ${selectedCategory} level ${level+1}`);
      assert.deepEqual(roll.choices.map(x=>x.gameplayCategory),categories);
      assert.equal(new Set(roll.choices.map(x=>x.key)).size,3);
      for (const card of roll.choices) {
        if (card.kind==="evolution") continue;
        const definition=RIFT_UPGRADES.find(x=>x.id===card.upgradeId);
        assert.ok(definition);
        assert.ok(definition.repeatable || upgradeStack(run,definition.id,card.targetInstanceId)<definition.maxStacks,`${card.key} was offered maxed`);
      }
      const selected=roll.choices.find(x=>x.gameplayCategory===selectedCategory);
      run=applyUpgrade({...run,rollIndex:roll.nextRollIndex},selected);
      const available=run.hardpoints.find(x=>x.status==="available");
      if (available) run=mountUnlockedWeapon(run,available.index,"pulse-cannon");
    }
    const next=rollUpgradeChoices({...run,pendingLevels:1});
    assert.equal(next.choices.length,3);
    assert.deepEqual(next.choices.map(x=>x.gameplayCategory),categories);
  }
});

test("every selectable upgrade effect has a live combat or flight consumer", async () => {
  const effects=new Set(RIFT_UPGRADES.map(x=>x.effect));
  assert.deepEqual([...effects].sort(), ["cannonDamage","cannonFireRate","coneWidth","damage","damageReduction","explosionRadius","fireRate","handling","hull","movement","penetration","projectileCount","projectileSpeed","range","shield"].sort());
  const game=await import("node:fs/promises").then(({readFile})=>readFile(new URL("../app/game.tsx",import.meta.url),"utf8"));
  assert.match(game,/riftRunHullDamage\(amount, riftRunRef\.current\)/);
  assert.match(game,/riftRunHandling\(specialHandling, riftRunRef\.current\)/);
  assert.match(game,/next\.shipModifiers\.hull-current\.shipModifiers\.hull/);
  assert.match(game,/next\.shipModifiers\.shield-current\.shipModifiers\.shield/);
  assert.match(game,/shipModifiers\.cannonDamage/);
  assert.match(game,/shipModifiers\.cannonFireRate/);
});

test("per-instance upgrades are capped and create deterministic real volleys", () => {
  let run=createArmedRun("tank", "upgrades", "pulse-cannon"); run.hardpoints[1]={index:1,status:"occupied",weapon:createWeaponInstance("pulse-cannon","second")};
  const choice={key:"twin-pulse:second",upgradeId:"twin-pulse",targetInstanceId:"second",hardpointIndex:1,title:"",target:"",description:""};
  run=applyUpgrade(run,choice); assert.equal(run.hardpoints[0].weapon.modifiers.projectileCount,0); assert.equal(run.hardpoints[1].weapon.modifiers.projectileCount,1);
  const shots=processHardpointFire(run.hardpoints,createWeaponRuntime(run),true,{x:0,y:0},0).filter(x=>x.instanceId==="second"); assert.equal(shots.length,2); assert.notEqual(shots[0].angle,shots[1].angle);
  for(let i=0;i<10;i++) run=applyUpgrade(run,choice); assert.ok(run.hardpoints[1].weapon.modifiers.projectileCount<=3);
});

test("hardpoint breach milestones map exact class-limited sockets", () => {
  assert.deepEqual(HARDPOINT_BREACH_MILESTONES, [1, 3, 5]);
  assert.equal(hardpointIndexForBreach(1, 3), 0);
  assert.equal(hardpointIndexForBreach(3, 3), 1);
  assert.equal(hardpointIndexForBreach(5, 3), 2);
  for (const breach of [0, 2, 4, 6]) assert.equal(hardpointIndexForBreach(breach, 3), null);
  assert.equal(hardpointIndexForBreach(3, 1), null);
  assert.equal(hardpointIndexForBreach(5, 2), null);
});

test("milestone unlocking is exact and idempotent for available and occupied old state", () => {
  const locked = createRiftRun("flagship", "idempotent").hardpoints;
  const unlocked = hardpointUnlockForBreach(locked, 3, 3);
  assert.equal(unlocked.hardpointIndex, 1);
  assert.equal(unlocked.hardpoints[1].status, "available");
  assert.equal(hardpointUnlockForBreach(unlocked.hardpoints, 3, 3).hardpointIndex, null);
  const occupied = structuredClone(locked);
  occupied[1] = { index: 1, status: "occupied", weapon: createWeaponInstance("railgun", "legacy") };
  const unchanged = hardpointUnlockForBreach(occupied, 3, 3);
  assert.equal(unchanged.hardpointIndex, null);
  assert.equal(unchanged.hardpoints[2].status, "locked");
  assert.equal(unchanged.hardpoints[1].weapon.instanceId, "legacy");
});

test("random upgrades contain no hardpoint activation and offensive upgrades remain valid", () => {
  const armed = createArmedRun("flagship", "no-random-sockets", "pulse-cannon");
  assert.ok(!RIFT_UPGRADES.some(({ id, effect }) => id === "hardpoint-online" || effect === "hardpoint"));
  assert.ok(!eligibleUpgradeChoices(armed).some(({ upgradeId }) => upgradeId === "hardpoint-online"));
  assert.ok(rollUpgradeChoices({ ...armed, pendingLevels: 1 }).choices.some(({ gameplayCategory }) => gameplayCategory === "offensive"));
});

test("Phase 3B breach rewards once, blocks reform damage, and reforms stronger", () => {
  const run = createRiftRun("tank", "breach-once");
  const runtime = { integrity: 0, maximumIntegrity: RIFT_RUN_BASE_INTEGRITY, reformRemainingMs: 0, breached: false };
  const first = breachRiftRun(run, runtime);
  assert.equal(first.state.riftBreaches, 1);
  assert.equal(first.state.riftEnergy, RIFT_RUN_BREACH_REWARDS.energy);
  assert.equal(first.state.score, RIFT_RUN_BREACH_REWARDS.score);
  assert.equal(first.runtime.reformRemainingMs, RIFT_RUN_REFORM_DELAY_MS);
  const duplicate = breachRiftRun(first.state, first.runtime);
  assert.equal(duplicate.state.riftBreaches, 1);
  assert.equal(duplicate.state.riftEnergy, first.state.riftEnergy);
  assert.equal(duplicate.state.score, first.state.score);
  const guarded = { rivalHealth: 100, riftReformTicks: 2 };
  assert.equal(applyRiftRunHullWeaponDamage(guarded, 999), 0);
  assert.equal(guarded.rivalHealth, 100);
  const reformed = tickRiftReform(first.runtime, RIFT_RUN_REFORM_DELAY_MS, RIFT_RUN_BASE_INTEGRITY, first.state.riftBreaches);
  assert.equal(reformed.breached, false);
  assert.equal(reformed.integrity, riftIntegrityForBreach(RIFT_RUN_BASE_INTEGRITY, 1));
  assert.equal(reformed.maximumIntegrity, reformed.integrity);
});

test("Light, Medium, and Heavy earn exact milestone Hull Guns without exceeding capacity", () => {
  for (const [ship, milestones] of [["wing", [1]], ["squid", [1, 3]], ["flagship", [1, 3, 5]]]) {
    let run = createRiftRun(ship, `milestones-${ship}`);
    let runtime = { integrity: 0, maximumIntegrity: 100, reformRemainingMs: 0, breached: false };
    for (let breach = 1; breach <= 5; breach++) {
      const result = breachRiftRun(run, runtime);
      run = result.state;
      if (milestones.includes(breach)) {
        const index = milestones.indexOf(breach);
        assert.deepEqual(run.pendingHullGunReward, { hardpointIndex: index, breach });
        const pendingLevels = run.pendingLevels;
        run = claimHullGunWeapon(run, index, "railgun");
        assert.equal(run.pendingLevels, pendingLevels, "Hull Gun selection preserves normal levels");
        assert.equal(run.hardpoints[index].status, "occupied");
      } else {
        assert.equal(run.pendingHullGunReward, null);
      }
      runtime = tickRiftReform(result.runtime, RIFT_RUN_REFORM_DELAY_MS, RIFT_RUN_BASE_INTEGRITY, run.riftBreaches);
      runtime = { ...runtime, integrity: 0 };
    }
    const weapons = run.hardpoints.filter(point => point.status === "occupied").map(point => point.weapon);
    assert.equal(weapons.length, milestones.length);
    assert.equal(new Set(weapons.map(({ instanceId }) => instanceId)).size, weapons.length);
  }
});

test("duplicate weapon types mount as fresh independent milestone instances", () => {
  let run = createRiftRun("squid", "duplicates");
  let first = breachRiftRun(run, { integrity: 0, maximumIntegrity: 100, reformRemainingMs: 0, breached: false });
  run = claimHullGunWeapon(first.state, 0, "minigun");
  run.riftBreaches = 2;
  const third = breachRiftRun(run, { integrity: 0, maximumIntegrity: 100, reformRemainingMs: 0, breached: false }).state;
  const mounted = claimHullGunWeapon(third, 1, "minigun");
  assert.notEqual(mounted.hardpoints[0].weapon.instanceId, mounted.hardpoints[1].weapon.instanceId);
  assert.deepEqual(mounted.hardpoints[0].weapon.modifiers, mounted.hardpoints[1].weapon.modifiers);
});

test("occupied or available milestone sockets do not reward or unlock a different socket", () => {
  for (const status of ["available", "occupied"]) {
    const run = createRiftRun("flagship", `legacy-${status}`);
    run.riftBreaches = 2;
    run.hardpoints[1] = status === "available" ? { index: 1, status } : { index: 1, status, weapon: createWeaponInstance("railgun", "existing") };
    const breached = breachRiftRun(run, { integrity: 0, maximumIntegrity: 100, reformRemainingMs: 0, breached: false }).state;
    assert.equal(breached.pendingHullGunReward, null);
    assert.equal(breached.hardpoints[2].status, "locked");
  }
});

test("breach energy can queue a level-up and live integration pauses it", async () => {
  const run = createRiftRun("tank", "breach-level");
  run.riftEnergy = riftEnergyRequiredForLevel(run.level) - 1;
  const breached = breachRiftRun(run, { integrity: 0, maximumIntegrity: RIFT_RUN_BASE_INTEGRITY, reformRemainingMs: 0, breached: false });
  assert.ok(breached.state.pendingLevels > 0);
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/game.tsx", import.meta.url), "utf8"));
  assert.match(source, /breachRiftRun\(run,/);
  assert.match(source, /breached\.state\.pendingLevels > 0 \|\| pendingHullGunReward\(breached\.state\)/);
  assert.match(source, /if \(!game\.running \|\| game\.paused \|\| game\.result\) return;/);
  assert.match(source, /else if \(game\.rivalHealth <= 0\)/, "standard PvE retains its normal zero-integrity victory branch");
});

function qualifyForEvolution(run, evolution, instanceId = run.hardpoints[0].weapon.instanceId, hardpointIndex = 0) {
  for (const [upgradeId, stack] of Object.entries(evolution.prerequisites)) {
    run.upgradeHistory.push({ upgradeId, targetInstanceId: instanceId, hardpointIndex, stack, level: run.level });
  }
  return run;
}

test("all five evolution recipes are per-instance and prioritized on the next roll", () => {
  for (const evolution of RIFT_EVOLUTIONS) {
    const run = qualifyForEvolution(createArmedRun("tank", `evo-${evolution.id}`, evolution.sourceWeapon), evolution);
    const instanceId = run.hardpoints[0].weapon.instanceId;
    const eligible = eligibleEvolutions(run);
    assert.ok(eligible.some(({ definition, weapon }) => definition.id === evolution.id && weapon.instanceId === instanceId));
    const roll = rollUpgradeChoices(run);
    assert.equal(roll.choices[0].kind, "evolution");
    assert.equal(roll.choices[0].evolutionId, evolution.id);
  }
});

test("duplicate weapon stacks never combine and duplicate instances can evolve independently", () => {
  const evolution = RIFT_EVOLUTIONS.find(({ id }) => id === "seismic-rail");
  let run = createArmedRun("tank", "duplicate-rails", "railgun");
  run.hardpoints[1] = { index: 1, status: "occupied", weapon: createWeaponInstance("railgun", "rail-two") };
  const first = run.hardpoints[0].weapon.instanceId;
  const second = run.hardpoints[1].weapon.instanceId;
  const requirements = Object.entries(evolution.prerequisites);
  requirements.forEach(([upgradeId, count], index) => {
    run.upgradeHistory.push({ upgradeId, targetInstanceId: index % 2 ? second : first, hardpointIndex: index % 2, stack: count, level: 1 });
  });
  assert.equal(eligibleEvolutions(run).length, 0, "split stacks cannot combine across weapon instances");
  run.upgradeHistory = [];
  qualifyForEvolution(run, evolution, first, 0);
  run.pendingLevels = 1;
  const choice = rollUpgradeChoices(run).choices.find(({ evolutionId }) => evolutionId === evolution.id);
  assert.ok(choice);
  run = applyUpgrade(run, choice);
  assert.equal(run.hardpoints[0].weapon.evolution.id, evolution.id);
  assert.equal(activeEvolution(run.hardpoints[1].weapon), null);
  qualifyForEvolution(run, evolution, second, 1);
  assert.ok(eligibleEvolutions(run).some(({ weapon }) => weapon.instanceId === second));
  assert.ok(!eligibleEvolutions(run).some(({ weapon }) => weapon.instanceId === first));
});

test("Nova and Seismic radial effects are bounded and respect already-hit identities", () => {
  for (const evolutionId of ["nova-cannon", "seismic-rail"]) {
    const projectile = projectileFromShot(shot(evolutionId === "nova-cannon" ? "pulse-cannon" : "railgun", { evolutionId, explosionRadius: 40 }));
    projectile.state.hitTargetIds.add("direct");
    assert.deepEqual(evolutionRadialHit(projectile, { x: 0, y: 0 }, [
      { id: "direct", x: 0, y: 0 },
      { id: "near", x: 30, y: 0 },
      { id: "far", x: 41, y: 0 },
    ]), ["near"]);
  }
});

test("MIRV salvos spread wider, distribute deterministic targets, and keep per-instance caps", () => {
  const normal = createArmedRun("tank", "normal-missiles", "missile-pod");
  normal.hardpoints[0].weapon.modifiers.projectileCount = 2;
  const normalShots = processHardpointFire(normal.hardpoints, createWeaponRuntime(normal), true, { x: 0, y: 0 }, 0);
  const mirv = createArmedRun("tank", "mirv-missiles", "missile-pod");
  mirv.hardpoints[0].weapon.modifiers.projectileCount = 2;
  mirv.hardpoints[0].weapon.evolution = { id: "mirv-battery", name: "MIRV BATTERY" };
  const mirvShots = processHardpointFire(mirv.hardpoints, createWeaponRuntime(mirv), true, { x: 0, y: 0 }, 0);
  assert.ok(Math.abs(mirvShots[0].angle - mirvShots.at(-1).angle) > Math.abs(normalShots[0].angle - normalShots.at(-1).angle));
  assert.deepEqual(mirvShots.map(({ salvoIndex }) => salvoIndex), [0, 1, 2]);
  const projectiles = mirvShots.map((entry) => projectileFromShot(entry));
  const targets = [
    { id: "a", x: 120, y: -8, hostile: true },
    { id: "b", x: 130, y: 0, hostile: true },
    { id: "c", x: 120, y: 8, hostile: true },
    { id: "rift", x: 100, y: 0, hostile: false },
  ];
  projectiles.forEach((projectile) => steerMissile(projectile, targets));
  assert.equal(new Set(projectiles.map(({ state }) => state.targetId)).size, 3);
  assert.ok(projectiles.every(({ state }) => state.targetId !== "rift"));
  const max = RIFT_WEAPONS.find(({ id }) => id === "missile-pod").maxProjectiles;
  const saturated = Array.from({ length: max }, () => projectileFromShot(mirvShots[0]));
  assert.equal(admitsProjectile(saturated, mirv.hardpoints[0].weapon.instanceId, "missile-pod"), false);
});

test("Scorched refreshes one status, ticks on cadence, and fully expires", () => {
  const statuses = new Map();
  applyScorched(statuses, "enemy");
  for (let i = 0; i < 5; i++) tickScorched(statuses);
  const cadenceBeforeRefresh = statuses.get("enemy").tickIn;
  applyScorched(statuses, "enemy");
  assert.equal(statuses.size, 1);
  assert.equal(statuses.get("enemy").remainingTicks, SCORCHED_DURATION_TICKS);
  assert.equal(statuses.get("enemy").tickIn, cadenceBeforeRefresh, "refresh preserves the current damage cadence");
  let ticks = 0;
  let damageEvents = 0;
  while (statuses.size > 0 && ticks < SCORCHED_DURATION_TICKS + SCORCHED_TICK_CADENCE + 5) {
    damageEvents += tickScorched(statuses).length;
    ticks += 1;
  }
  assert.ok(damageEvents > 0);
  assert.equal(statuses.size, 0);
});

test("Inferno/Scorched and breach runtime are integrated and reset with fresh game state", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/game.tsx", import.meta.url), "utf8"));
  assert.match(source, /riftScorched: new Map\(\)/);
  assert.match(source, /mounted\.evolutionId === "inferno-projector"/);
  assert.match(source, /applyScorched\(game\.riftScorched, id\)/);
  assert.match(source, /tickScorched\(game\.riftScorched\)/);
  assert.match(source, /if \(!liveScorched\.has\(id\)\) game\.riftScorched\.delete\(id\)/);
  assert.match(source, /tickRiftReform\(/);
});

test("Rift Run payload destruction breaches instead of starting PvE victory", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/game.tsx", import.meta.url), "utf8"));
  const riftRunBranch = source.indexOf("else if (game.rivalHealth <= 0 && riftRunRef.current)");
  const standardVictory = source.indexOf("game.victorySequence = ticksForSeconds(VICTORY_TOTAL_SECONDS)", riftRunBranch);
  assert.ok(riftRunBranch >= 0, "Rift Run must intercept zero integrity in the payload path");
  assert.ok(standardVictory > riftRunBranch, "standard PvE victory must remain after the Rift Run continuation branch");
  assert.match(source.slice(riftRunBranch, standardVictory), /breachRiftRun\(run/);
});
