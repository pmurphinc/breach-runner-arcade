import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { SHIPS, SHIP_SPECIALS, SHOT_LEVELS } from "../app/game-data.ts";
import { cannonShotBudgetUsed } from "../app/overcharge.ts";
import { shipMuzzleWorldPoint } from "../app/ship-models.ts";
import {
  SUPPRESSION_BARRAGE_DAMAGE_MULTIPLIER,
  SUPPRESSION_BARRAGE_SPREAD_DEGREES,
  suppressionBarrageRounds,
} from "../app/suppression-barrage.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

test("Warden keeps its canonical frame but exposes Suppression Barrage", () => {
  const ship = SHIPS.find(({ id }) => id === "warden");
  assert.deepEqual(ship, { id: "warden", name: "Warden", role: "Medium / Gunship", turn: 6, maxSpeed: 3, acceleration: 0.09, health: 200, gun: 1, thrust: 1, special: "Q: For 5 seconds, the primary cannon fires a tight three-shot barrage.", unlock: "OPEN" });
  assert.deepEqual(SHIP_SPECIALS.warden, { name: "SUPPRESSION BARRAGE", cooldownSeconds: 20, activeSeconds: 5, balancePoints: 20 });
});

test("one aimed trigger resolves a tight symmetric three-round barrage", () => {
  const aim = 1.2;
  const rounds = suppressionBarrageRounds(aim, SHOT_LEVELS[1].damage);
  assert.equal(SUPPRESSION_BARRAGE_SPREAD_DEGREES, 7);
  assert.equal(SUPPRESSION_BARRAGE_DAMAGE_MULTIPLIER, 0.65);
  assert.equal(rounds.length, 3);
  assert.deepEqual(rounds.map(({ supplemental }) => supplemental), [true, false, true]);
  assert.deepEqual(rounds.map(({ damage }) => damage), [9.1, 9.1, 9.1]);
  assert.deepEqual(rounds.map(({ angle }) => Math.round((angle - aim) * 180 / Math.PI)), [-7, 0, 7]);
});

test("barrage damage inherits every current cannon level", () => {
  for (const shot of SHOT_LEVELS) {
    assert.deepEqual(suppressionBarrageRounds(0, shot.damage).map(({ damage }) => damage), Array(3).fill(shot.damage * 0.65));
  }
});

test("supplemental rounds preserve one-trigger live-shot accounting", () => {
  const bullets = suppressionBarrageRounds(0, 14).map(({ supplemental }) => ({ enemy: false, supplemental }));
  assert.equal(cannonShotBudgetUsed(bullets), 1);
});

test("live barrage uses normal speed, lifetime, collision, network cause, and primary muzzle", () => {
  assert.match(game, /const muzzle = shipMuzzleWorldPoint\(game\.ship\.id, player, aimAngle, 1\.15\)/);
  assert.match(game, /shipForwardVelocity\(round\.angle, 10,/);
  assert.match(game, /damage: round\.damage, life: 110, enemy: false/);
  assert.match(game, /bullet\.special \? "overcharge" : "cannon"/);
  assert.match(game, /if \(!round\.supplemental\) game\.playerShots \+= 1/);
  assert.match(game, /game\.ship\.id === "warden" && player\.suppressionBarrage > 0/);
  assert.doesNotMatch(game, /selectAutoGunTarget|autoGun|sentryOverdrive/i);

  const player = { x: 50, y: 80 };
  assert.deepEqual(shipMuzzleWorldPoint("warden", player, 0, 1.15), shipMuzzleWorldPoint("warden", player, 0, 1.15));
});

test("mounted Rift Run fire stays separate from primary barrage resolution", () => {
  const mounted = game.indexOf("const mountedShots = processHardpointFire");
  const primary = game.indexOf("const rounds = game.ship.id", mounted);
  assert.ok(mounted >= 0 && primary > mounted);
  const mountedBlock = game.slice(mounted, primary);
  assert.doesNotMatch(mountedBlock, /suppressionBarrage|SUPPRESSION_BARRAGE/i);
});
