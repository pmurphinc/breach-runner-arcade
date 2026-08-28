from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


# Central breach helper owns its configured delay.
replace_once(
    "app/rift-run/breach.ts",
    'import { RIFT_RUN_BREACH_REWARDS, riftIntegrityForBreach } from "./rift-damage";',
    'import { RIFT_RUN_BREACH_REWARDS, RIFT_RUN_REFORM_DELAY_MS, riftIntegrityForBreach } from "./rift-damage";',
)
replace_once(
    "app/rift-run/breach.ts",
    'export function breachRiftRun(state: RiftRunState, runtime: RiftBreachRuntime, delayMs = 1500): { state: RiftRunState; runtime: RiftBreachRuntime } {',
    'export function breachRiftRun(state: RiftRunState, runtime: RiftBreachRuntime, delayMs = RIFT_RUN_REFORM_DELAY_MS): { state: RiftRunState; runtime: RiftBreachRuntime } {',
)

# MIRV salvos carry a stable index and spread wider than ordinary multishot.
replace_once(
    "app/rift-run/weapon-fire.ts",
    'export type FireShot = { kind: "projectile" | "flame"; weaponId: string; evolutionId: string | null; instanceId: string; hardpointIndex: number; origin: Point; angle: number; damage: number; speed: number; radius: number; life: number; penetrations: number; explosionRadius: number; range: number; coneDegrees: number };',
    'export type FireShot = { kind: "projectile" | "flame"; weaponId: string; evolutionId: string | null; salvoIndex: number; instanceId: string; hardpointIndex: number; origin: Point; angle: number; damage: number; speed: number; radius: number; life: number; penetrations: number; explosionRadius: number; range: number; coneDegrees: number };',
)
replace_once(
    "app/rift-run/weapon-fire.ts",
    '      const volleySpread=(shotIndex-(count-1)/2)*.045;\n      const spinSpread=definition.id === "minigun" ? ((state.shotsFired % 5) - 2) * 0.012 : 0;\n      shots.push({ kind: definition.id === "flamethrower" ? "flame" : "projectile", weaponId: definition.id, evolutionId, instanceId: point.weapon.instanceId, hardpointIndex: point.index, origin: mountOrigin(center, angle, hardpoints.length, point.index), angle: angle + volleySpread + spinSpread, damage: definition.damage * point.weapon.modifiers.damage, speed: definition.projectileSpeed * point.weapon.modifiers.projectileSpeed, radius: definition.projectileRadius * (evolution?.modifiers.projectileScale ?? 1), life: definition.lifetimeTicks, penetrations: definition.penetration + point.weapon.modifiers.penetration, explosionRadius: definition.explosionRadius + point.weapon.modifiers.explosionRadius, range: definition.range + point.weapon.modifiers.range, coneDegrees: definition.coneDegrees + point.weapon.modifiers.coneWidth });',
    '      const spreadStep = evolutionId === "mirv-battery" ? .09 : .045;\n      const volleySpread=(shotIndex-(count-1)/2)*spreadStep;\n      const spinSpread=definition.id === "minigun" ? ((state.shotsFired % 5) - 2) * 0.012 : 0;\n      shots.push({ kind: definition.id === "flamethrower" ? "flame" : "projectile", weaponId: definition.id, evolutionId, salvoIndex: shotIndex, instanceId: point.weapon.instanceId, hardpointIndex: point.index, origin: mountOrigin(center, angle, hardpoints.length, point.index), angle: angle + volleySpread + spinSpread, damage: definition.damage * point.weapon.modifiers.damage, speed: definition.projectileSpeed * point.weapon.modifiers.projectileSpeed, radius: definition.projectileRadius * (evolution?.modifiers.projectileScale ?? 1), life: definition.lifetimeTicks, penetrations: definition.penetration + point.weapon.modifiers.penetration, explosionRadius: definition.explosionRadius + point.weapon.modifiers.explosionRadius, range: definition.range + point.weapon.modifiers.range, coneDegrees: definition.coneDegrees + point.weapon.modifiers.coneWidth });',
)

# MIRV targeting is wider, farther, deterministic, and distributed by salvo index.
replace_once(
    "app/rift-run/weapon-projectiles.ts",
    '  evolutionId: string | null;\n  instanceId: string;',
    '  evolutionId: string | null;\n  salvoIndex: number;\n  instanceId: string;',
)
replace_once(
    "app/rift-run/weapon-projectiles.ts",
    '      weaponId: shot.weaponId as RiftProjectileState["weaponId"], evolutionId: shot.evolutionId ?? null, instanceId: shot.instanceId,',
    '      weaponId: shot.weaponId as RiftProjectileState["weaponId"], evolutionId: shot.evolutionId ?? null, salvoIndex: shot.salvoIndex ?? 0, instanceId: shot.instanceId,',
)
replace_once(
    "app/rift-run/weapon-projectiles.ts",
    'export function selectMissileTarget(origin: Point, angle: number, range: number, coneDegrees: number, targets: readonly (CombatTarget & { hostile: boolean })[]): EntityId | null {\n  const candidates = targetsInFlameCone(origin, angle, range, coneDegrees, targets.filter(({ hostile }) => hostile));\n  return candidates.sort((a,b) => String(a).localeCompare(String(b)))[0] ?? null;\n}',
    'export function selectMissileTarget(origin: Point, angle: number, range: number, coneDegrees: number, targets: readonly (CombatTarget & { hostile: boolean })[], targetOffset = 0): EntityId | null {\n  const candidates = targetsInFlameCone(origin, angle, range, coneDegrees, targets.filter(({ hostile }) => hostile))\n    .sort((a,b) => String(a).localeCompare(String(b)));\n  return candidates.length > 0 ? candidates[Math.abs(targetOffset) % candidates.length] : null;\n}',
)
replace_once(
    "app/rift-run/weapon-projectiles.ts",
    '    const angle = Math.atan2(projectile.vy, projectile.vx), definition = RIFT_WEAPON_BY_ID["missile-pod"];\n    const id = selectMissileTarget(projectile, angle, definition.range, definition.coneDegrees, targets);',
    '    const angle = Math.atan2(projectile.vy, projectile.vx), definition = RIFT_WEAPON_BY_ID["missile-pod"];\n    const mirv = projectile.state.evolutionId === "mirv-battery";\n    const acquisitionRange = mirv ? definition.range * 1.35 : definition.range;\n    const acquisitionCone = mirv ? Math.min(180, definition.coneDegrees + 35) : definition.coneDegrees;\n    const id = selectMissileTarget(projectile, angle, acquisitionRange, acquisitionCone, targets, mirv ? projectile.state.salvoIndex : 0);',
)

# Live game integration: centralized breach, authoritative pause, Inferno Scorched.
replace_once(
    "app/game.tsx",
    'import { admitsProjectile, detonateMissile, evolutionRadialHit, penetrate, projectileFromShot, steerMissile, targetsInFlameCone, type RiftProjectile } from "./rift-run/weapon-projectiles";\nimport { awardRiftEnergy, enemyKillEnergy, riftDamaged, riftEnergyRequiredForLevel } from "./rift-run/progression";\nimport { applyRiftRunHullWeaponDamage, RIFT_RUN_BASE_INTEGRITY, RIFT_RUN_BREACH_REWARDS, RIFT_RUN_REFORM_DELAY_MS, riftIntegrityForBreach } from "./rift-run/rift-damage";',
    'import { admitsProjectile, applyScorched, detonateMissile, evolutionRadialHit, penetrate, projectileFromShot, SCORCHED_DAMAGE, steerMissile, targetsInFlameCone, tickScorched, type EntityId, type RiftProjectile, type ScorchedState } from "./rift-run/weapon-projectiles";\nimport { awardRiftEnergy, enemyKillEnergy, riftDamaged, riftEnergyRequiredForLevel } from "./rift-run/progression";\nimport { applyRiftRunHullWeaponDamage, RIFT_RUN_BASE_INTEGRITY } from "./rift-run/rift-damage";\nimport { breachRiftRun, tickRiftReform } from "./rift-run/breach";',
)
replace_once(
    "app/game.tsx",
    '  riftProjectiles: RiftProjectile[];\n  riftFlames: RiftFlameFx[];\n  /** Rift Run-only invulnerability/reform countdown; zero in standard modes. */',
    '  riftProjectiles: RiftProjectile[];\n  riftFlames: RiftFlameFx[];\n  /** Inferno-only damage-over-time state, keyed by stable enemy identity. */\n  riftScorched: Map<EntityId, ScorchedState>;\n  /** Rift Run-only invulnerability/reform countdown; zero in standard modes. */',
)
replace_once(
    "app/game.tsx",
    '    riftProjectiles: [],\n    riftFlames: [],\n    riftReformTicks: 0,',
    '    riftProjectiles: [],\n    riftFlames: [],\n    riftScorched: new Map(),\n    riftReformTicks: 0,',
)
replace_once(
    "app/game.tsx",
    '      if (run && game.rivalHealth <= 0 && game.riftReformTicks <= 0 && !game.result) {\n        const breaches=run.riftBreaches+1;\n        const next=awardRiftEnergy({...riftRunRef.current!,riftBreaches:breaches,score:riftRunRef.current!.score+RIFT_RUN_BREACH_REWARDS.score},RIFT_RUN_BREACH_REWARDS.energy);\n        riftRunRef.current=next; setRiftRun(next); game.score+=RIFT_RUN_BREACH_REWARDS.score;\n        game.riftReformTicks=Math.ceil(RIFT_RUN_REFORM_DELAY_MS/TICK_MS); game.notice=`RIFT BREACHED // DEPTH ${breaches}`; game.noticeLife=game.riftReformTicks;\n        burst(game,game.portalX,game.portalY,"#ffffff",40,10); playCue("wormhole-explosion",.18);\n      }',
    '      if (run && game.rivalHealth <= 0 && game.riftReformTicks <= 0 && !game.result) {\n        const breached = breachRiftRun(run, {\n          integrity: game.rivalHealth,\n          maximumIntegrity: game.rivalMaxHealth,\n          reformRemainingMs: 0,\n          breached: false,\n        });\n        const scoreDelta = breached.state.score - run.score;\n        riftRunRef.current = breached.state;\n        setRiftRun(breached.state);\n        game.score += scoreDelta;\n        game.rivalHealth = breached.runtime.integrity;\n        game.rivalMaxHealth = breached.runtime.maximumIntegrity;\n        game.riftReformTicks = Math.ceil(breached.runtime.reformRemainingMs / TICK_MS);\n        game.notice = `RIFT BREACHED // DEPTH ${breached.state.riftBreaches}`;\n        game.noticeLife = game.riftReformTicks;\n        if (breached.state.pendingLevels > 0) game.paused = true;\n        burst(game, game.portalX, game.portalY, "#ffffff", 40, 10);\n        playCue("wormhole-explosion", .18);\n      }',
)
replace_once(
    "app/game.tsx",
    '        if (game.riftReformTicks>0 && --game.riftReformTicks===0) { game.rivalMaxHealth=riftIntegrityForBreach(RIFT_RUN_BASE_INTEGRITY,activeRiftRun.riftBreaches); game.rivalHealth=game.rivalMaxHealth; game.notice=`RIFT REFORMED // DEPTH ${activeRiftRun.riftBreaches}`; game.noticeLife=90; }',
    '        if (game.riftReformTicks > 0) {\n          const reformed = tickRiftReform({\n            integrity: game.rivalHealth,\n            maximumIntegrity: game.rivalMaxHealth,\n            reformRemainingMs: game.riftReformTicks * TICK_MS,\n            breached: true,\n          }, TICK_MS, RIFT_RUN_BASE_INTEGRITY, activeRiftRun.riftBreaches);\n          game.riftReformTicks = Math.ceil(reformed.reformRemainingMs / TICK_MS);\n          game.rivalHealth = reformed.integrity;\n          game.rivalMaxHealth = reformed.maximumIntegrity;\n          if (!reformed.breached) {\n            game.notice = `RIFT REFORMED // DEPTH ${activeRiftRun.riftBreaches}`;\n            game.noticeLife = 90;\n          }\n        }',
)
replace_once(
    "app/game.tsx",
    '            const hit = new Set(targetsInFlameCone(mounted.origin, mounted.angle, mounted.range, mounted.coneDegrees, targets));\n            for (const enemy of game.enemies) if (enemy.hp > 0 && hit.has(enemyIdentity(game, enemy))) damageEnemy(game, enemy, mounted.damage);',
    '            const hit = new Set(targetsInFlameCone(mounted.origin, mounted.angle, mounted.range, mounted.coneDegrees, targets));\n            for (const enemy of game.enemies) {\n              const id = enemyIdentity(game, enemy);\n              if (enemy.hp <= 0 || !hit.has(id)) continue;\n              damageEnemy(game, enemy, mounted.damage);\n              if (mounted.evolutionId === "inferno-projector" && enemy.hp > 0) applyScorched(game.riftScorched, id);\n            }',
)
replace_once(
    "app/game.tsx",
    '      }\n\n      game.bullets.forEach((bullet) => {',
    '      }\n\n      if (activeRiftRun && game.riftScorched.size > 0) {\n        const liveScorched = new Map<EntityId, Enemy>();\n        for (const enemy of game.enemies) {\n          if (enemy.hp > 0) liveScorched.set(enemyIdentity(game, enemy), enemy);\n        }\n        for (const id of tickScorched(game.riftScorched)) {\n          const enemy = liveScorched.get(id);\n          if (enemy?.hp > 0) damageEnemy(game, enemy, SCORCHED_DAMAGE);\n        }\n        for (const id of game.riftScorched.keys()) {\n          if (!liveScorched.has(id)) game.riftScorched.delete(id);\n        }\n      }\n\n      game.bullets.forEach((bullet) => {',
)

# Focused Phase 3B regression tests.
replace_once(
    "tests/rift-run.test.mjs",
    'import { admitsProjectile, detonateMissile, projectileFromShot, penetrate, selectMissileTarget, steerMissile, targetsInExplosion, targetsInFlameCone } from "../app/rift-run/weapon-projectiles.ts";\nimport { awardRiftEnergy, enemyKillEnergy, riftDamaged, riftEnergyRequiredForLevel } from "../app/rift-run/progression.ts";\nimport { applyRiftRunHullWeaponDamage, RIFT_RUN_RIFT_DAMAGE_SCALE } from "../app/rift-run/rift-damage.ts";\nimport { eligibleUpgradeChoices, rollUpgradeChoices } from "../app/rift-run/upgrade-pool.ts";\nimport { applyUpgrade, mountUnlockedWeapon } from "../app/rift-run/upgrade-apply.ts";',
    'import { admitsProjectile, applyScorched, detonateMissile, evolutionRadialHit, projectileFromShot, penetrate, SCORCHED_DURATION_TICKS, SCORCHED_TICK_CADENCE, selectMissileTarget, steerMissile, targetsInExplosion, targetsInFlameCone, tickScorched } from "../app/rift-run/weapon-projectiles.ts";\nimport { awardRiftEnergy, enemyKillEnergy, riftDamaged, riftEnergyRequiredForLevel } from "../app/rift-run/progression.ts";\nimport { applyRiftRunHullWeaponDamage, RIFT_RUN_BASE_INTEGRITY, RIFT_RUN_BREACH_REWARDS, RIFT_RUN_REFORM_DELAY_MS, RIFT_RUN_RIFT_DAMAGE_SCALE, riftIntegrityForBreach } from "../app/rift-run/rift-damage.ts";\nimport { breachRiftRun, tickRiftReform } from "../app/rift-run/breach.ts";\nimport { RIFT_EVOLUTIONS, eligibleEvolutions } from "../app/rift-run/evolutions.ts";\nimport { eligibleUpgradeChoices, rollUpgradeChoices } from "../app/rift-run/upgrade-pool.ts";\nimport { applyUpgrade, mountUnlockedWeapon } from "../app/rift-run/upgrade-apply.ts";',
)

append = r'''

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

test("breach energy can queue a level-up and live integration pauses it", async () => {
  const run = createRiftRun("tank", "breach-level");
  run.riftEnergy = riftEnergyRequiredForLevel(run.level) - 1;
  const breached = breachRiftRun(run, { integrity: 0, maximumIntegrity: RIFT_RUN_BASE_INTEGRITY, reformRemainingMs: 0, breached: false });
  assert.ok(breached.state.pendingLevels > 0);
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/game.tsx", import.meta.url), "utf8"));
  assert.match(source, /breachRiftRun\(run,/);
  assert.match(source, /if \(breached\.state\.pendingLevels > 0\) game\.paused = true;/);
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
    const run = qualifyForEvolution(createRiftRun("tank", `evo-${evolution.id}`, evolution.sourceWeapon), evolution);
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
  let run = createRiftRun("tank", "duplicate-rails", "railgun");
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
  assert.equal(run.hardpoints[1].weapon.evolution.id, null);
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
  const normal = createRiftRun("tank", "normal-missiles", "missile-pod");
  normal.hardpoints[0].weapon.modifiers.projectileCount = 2;
  const normalShots = processHardpointFire(normal.hardpoints, createWeaponRuntime(normal), true, { x: 0, y: 0 }, 0);
  const mirv = createRiftRun("tank", "mirv-missiles", "missile-pod");
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
'''

test_path = Path("tests/rift-run.test.mjs")
text = test_path.read_text(encoding="utf-8")
if 'test("Phase 3B breach rewards once' in text:
    raise RuntimeError("Phase 3B tests already present")
test_path.write_text(text.rstrip() + append + "\n", encoding="utf-8")
