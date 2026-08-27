import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { AUTO_GUN_DAMAGE, AUTO_GUN_FIRE_RATE, AUTO_GUN_PROJECTILE_TICKS, AUTO_GUN_RANGE, OVERDRIVE_FIRE_RATE, OVERDRIVE_RANGE, autoGunDelayTicks, effectiveAutoGunTuning, selectAutoGunTarget } from "../app/auto-gun.ts";
import { SHIPS, SHIP_SPECIALS, SHOT_LEVELS } from "../app/game-data.ts";
import { SHIP_ORDER, isSelectable } from "../app/ship-data.ts";
import { shipBalanceBreakdown, isShipWithinBudget } from "../app/ship-balance.ts";

const at = (id, kind, x, hp = 100, hostile = true) => ({ id, kind, x, y: 0, hp, hostile });

test("Warden is a selectable, balanced canonical Medium gunship", () => {
  const ship = SHIPS.find(({ id }) => id === "warden");
  assert.deepEqual(ship, { id: "warden", name: "Warden", role: "Medium / Gunship", turn: 6, maxSpeed: 3, acceleration: 0.09, health: 200, gun: 1, thrust: 1, special: "Q: Overdrives the hull-mounted cannon for 5 seconds, doubling its fire rate and increasing engagement range.", unlock: "OPEN" });
  assert.ok(SHIP_ORDER.includes("warden"));
  assert.equal(isSelectable("warden"), true);
  assert.deepEqual(SHIP_SPECIALS.warden, { name: "SENTRY OVERDRIVE", cooldownSeconds: 22, activeSeconds: 5, balancePoints: 20 });
  assert.equal(isShipWithinBudget(ship), true);
  assert.equal(shipBalanceBreakdown(ship).total, 92);
});

test("priority is Core Bomb, Plasma Bloom, then nearest hostile", () => {
  const origin = { x: 0, y: 0 };
  assert.equal(selectAutoGunTarget(origin, [at(1, "gunship", 5), at(2, "inflator", 200), at(3, "nuke", 290)])?.id, 3);
  assert.equal(selectAutoGunTarget(origin, [at(1, "gunship", 5), at(2, "inflator", 200)])?.id, 2);
  assert.equal(selectAutoGunTarget(origin, [at(1, "gunship", 100), at(2, "heatseeker", 40)])?.id, 2);
});

test("stable ids break ties and invalid, friendly, dead, phased, and distant targets are ignored", () => {
  const origin = { x: 0, y: 0 };
  assert.equal(selectAutoGunTarget(origin, [at("b", "gunship", 40), at("a", "ufo", -40)])?.id, "a");
  assert.equal(selectAutoGunTarget(origin, [at(1, "nuke", 301), at(2, "ghost", 10), at(3, "gunship", 20, 0), at(4, "ufo", 30, 100, false)]), null);
  assert.equal(selectAutoGunTarget(origin, [at(1, "nuke", 20, 0), at(2, "inflator", 25)])?.id, 2);
});

test("fixed tuning is conservative and simulation-tick based", () => {
  assert.equal(AUTO_GUN_RANGE, 300);
  assert.equal(AUTO_GUN_FIRE_RATE, 3);
  assert.equal(AUTO_GUN_DAMAGE, SHOT_LEVELS[0].damage * 0.4);
  assert.equal(AUTO_GUN_DAMAGE, 4);
  assert.equal(autoGunDelayTicks(1000 / 30), 10);
  assert.equal(autoGunDelayTicks(1000 / 60), 20);
  assert.equal(AUTO_GUN_PROJECTILE_TICKS, 30);
});

test("Sentry Overdrive only changes range, rate, and projectile travel budget", () => {
  const normal = effectiveAutoGunTuning(false);
  const active = effectiveAutoGunTuning(true);
  assert.deepEqual(normal, { range: 300, fireRate: 3, damage: 4, projectileTicks: 30 });
  assert.deepEqual(active, { range: 375, fireRate: 6, damage: 4, projectileTicks: 38 });
  assert.equal(OVERDRIVE_RANGE, 375);
  assert.equal(OVERDRIVE_FIRE_RATE, 6);
  assert.equal(autoGunDelayTicks(1000 / 30, active.fireRate), 5);
  assert.deepEqual(effectiveAutoGunTuning(false), normal, "expiration returns the shared normal tuning");
  assert.equal(SHOT_LEVELS[1].damage, 14, "the fitted cannon remains independently tuned");
  assert.equal(SHOT_LEVELS[1].delay, 6, "the fitted cannon fire rate remains independently tuned");
});

test("the overdrive engagement band is eligible only while active", () => {
  const target = at(1, "gunship", 350);
  assert.equal(selectAutoGunTarget({ x: 0, y: 0 }, [target], effectiveAutoGunTuning(false).range), null);
  assert.equal(selectAutoGunTarget({ x: 0, y: 0 }, [target], effectiveAutoGunTuning(true).range)?.id, 1);
});

test("PvP opponents remain hostile while allies, the Rift, and loose PUP-like entries do not qualify", () => {
  const origin = { x: 0, y: 0 };
  assert.equal(selectAutoGunTarget(origin, [at("opponent", "hostile-player", 350)], OVERDRIVE_RANGE)?.id, "opponent");
  assert.equal(selectAutoGunTarget(origin, [at("ally", "hostile-player", 20, 100, false)], OVERDRIVE_RANGE), null);
  assert.equal(selectAutoGunTarget(origin, [at("rift", "ghost", 20)], OVERDRIVE_RANGE), null);
  assert.equal(selectAutoGunTarget(origin, [at("pup", "ghost", 20)], OVERDRIVE_RANGE), null);
});

test("integration leaves cannon, Rift, PUP, and multiplayer authority paths separate", () => {
  const game = fs.readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
  assert.match(game, /if \(!bullet\.autoGun && dist\(bullet, \{ x: game\.portalX/);
  assert.match(game, /bullet\.salvageLinked && !bullet\.autoGun/);
  assert.match(game, /!item\.autoGun && countsTowardShotBudget/);
  assert.match(game, /bullet\.autoGun \? "projectile" : bullet\.special \? "overcharge" : "cannon"/);
  assert.match(game, /damageEnemy\(game, enemy, bullet\.damage\)/);
  assert.match(game, /reportEnemyHit\(enemyIdentity\(game, enemy\), bullet\.damage, bullet\.autoGun \? "projectile"/);
  assert.match(game, /effectiveAutoGunTuning\(player\.sentryOverdrive > 0\)/);
  assert.match(game, /activateSpecial\(game, controller\.special\);[\s\S]*effectiveAutoGunTuning/);
  assert.doesNotMatch(game, /player\.gun[^\n]*AUTO_GUN_DAMAGE|AUTO_GUN_DAMAGE[^\n]*player\.gun/);
});

test("other ships do not receive the passive", () => {
  assert.deepEqual(SHIPS.filter(({ id }) => id === "warden").map(({ id }) => id), ["warden"]);
});
