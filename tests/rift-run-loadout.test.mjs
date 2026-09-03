/**
 * The earned loadout has to reach the simulation.
 *
 * The upgrade screen is the visible half of Rift Run's build loop; this is the
 * half that decides whether taking a card changes anything. A payload slot that
 * does not raise the bin's ceiling, a cannon tier that does not move the mark,
 * a thruster tier that leaves the frame at mark zero, or a Special that stays
 * dispatched off the hull id would each look correct on screen and do nothing
 * in the arena.
 *
 * The pure halves are exercised directly. The wiring inside `app/game.tsx` is
 * checked as text, because that file is a `.tsx` Node cannot import — so the
 * rule here is that the *logic* lives in modules this file can call, and only
 * the single line that hands it to the loop is asserted by shape.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PUP_INVENTORY_CAPACITY, pupInventoryLayout } from "../app/pup-inventory.js";
import { SHIP_SPECIALS } from "../app/game-data.ts";
import { createRiftRun } from "../app/rift-run/state.ts";
import { applyUpgrade, chooseRiftRunSpecial } from "../app/rift-run/upgrade-apply.ts";
import { choicesForSystem } from "../app/rift-run/upgrade-pool.ts";
import { RIFT_RUN_SPECIALS } from "../app/rift-run/specials.ts";
import {
  RIFT_RUN_MAX_CANNON_MARK,
  RIFT_RUN_MAX_CANNON_TIER,
  RIFT_RUN_MAX_PAYLOAD_SLOTS,
  RIFT_RUN_MAX_THRUSTER_MARK,
  RIFT_RUN_MAX_THRUSTER_TIER,
  RIFT_RUN_SPECIAL_COOLDOWN_SCALE,
  RIFT_SYSTEM_LABELS,
  cannonMarkForTier,
  retrosForTier,
  thrusterMarkForTier,
  tierNumeral,
} from "../app/rift-run/loadout.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

/** Take the one ladder card a system is offering. */
function advance(run, system) {
  const card = choicesForSystem({ ...run, pendingLevels: 1 }, system).find(({ track }) => track);
  assert.ok(card, `${system} had no ladder card to take`);
  return applyUpgrade({ ...run, pendingLevels: 1 }, card);
}

test("payload capacity climbs one slot at a time to the ceiling every other mode starts on", () => {
  let run = createRiftRun("payload");
  const seen = [run.loadout.payloadSlots];
  while (run.loadout.payloadSlots < RIFT_RUN_MAX_PAYLOAD_SLOTS) {
    run = advance(run, "payload");
    seen.push(run.loadout.payloadSlots);
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  assert.equal(RIFT_RUN_MAX_PAYLOAD_SLOTS, PUP_INVENTORY_CAPACITY);

  // Capacity counts the loaded payload, so one slot means one loaded and
  // nothing stored — the same arithmetic every other mode uses.
  const one = pupInventoryLayout(["loaded"], 1);
  assert.equal(one.loaded, "loaded");
  assert.deepEqual(one.stored, []);
  const five = pupInventoryLayout(["a", "b", "c", "d", "e"], RIFT_RUN_MAX_PAYLOAD_SLOTS);
  assert.equal(five.loaded, "e");
  assert.equal(five.stored.length, RIFT_RUN_MAX_PAYLOAD_SLOTS - 1);
});

test("cannon and thruster tiers move the marks the loop actually reads", () => {
  // Tier one is mark zero on both, and the ladders run one step past the mark
  // ceiling so the final step still pays out.
  assert.deepEqual([1, 2, 3, 4, 5].map(cannonMarkForTier), [0, 1, 2, 3, RIFT_RUN_MAX_CANNON_MARK]);
  assert.deepEqual([1, 2, 3, 4, 5].map(thrusterMarkForTier), [0, 1, 2, 3, RIFT_RUN_MAX_THRUSTER_MARK]);

  let run = createRiftRun("marks");
  const before = { ...run.shipModifiers };
  run = advance(run, "cannon");
  assert.equal(cannonMarkForTier(run.loadout.cannonTier), 1);
  assert.ok(run.shipModifiers.cannonDamage > before.cannonDamage, "a cannon tier is felt even before the mark lands");
  assert.ok(run.shipModifiers.cannonFireRate > before.cannonFireRate);

  // Reverse thrust is the starter's most obvious absence and the first
  // thruster tier is what returns it.
  assert.equal(retrosForTier(1), 0);
  run = advance(run, "thrusters");
  assert.equal(thrusterMarkForTier(run.loadout.thrusterTier), 1);
  assert.equal(retrosForTier(run.loadout.thrusterTier), 1);
  assert.ok(run.shipModifiers.movement > before.movement);
  assert.ok(run.shipModifiers.handling > before.handling);

  // The last tier of each ladder still lands, as stats.
  while (run.loadout.cannonTier < RIFT_RUN_MAX_CANNON_TIER) run = advance(run, "cannon");
  while (run.loadout.thrusterTier < RIFT_RUN_MAX_THRUSTER_TIER) run = advance(run, "thrusters");
  assert.equal(cannonMarkForTier(run.loadout.cannonTier), RIFT_RUN_MAX_CANNON_MARK);
  assert.ok(run.shipModifiers.cannonDamage > 1.4);
});

test("a Special tier is a real, monotonic cooldown cut on whatever was installed", () => {
  let run = createRiftRun("special-cooldown");
  run = advance(run, "special");
  run = chooseRiftRunSpecial(run, "warden");
  assert.deepEqual(run.loadout.special, { shipId: "warden", tier: 1 });

  const base = SHIP_SPECIALS.warden.cooldownSeconds;
  const at = (tier) => base * RIFT_RUN_SPECIAL_COOLDOWN_SCALE[tier];
  assert.equal(at(1), base, "tier one is the ability exactly as the fleet flies it");
  assert.ok(at(2) < at(1));
  assert.ok(at(3) < at(2));

  run = advance(run, "special");
  assert.equal(run.loadout.special.tier, 2);
  assert.equal(run.loadout.special.shipId, "warden", "tiering must not swap the ability");
});

test("the loop dispatches abilities off the installed Special, never the hull", () => {
  // The starter frame wears an existing hull for its art. If ability dispatch
  // read that hull id, a Rift Run would fly Starling's SWARM OVERCHARGE from
  // the first tick and installing a Special would do nothing.
  assert.match(game, /specialShip: ShipId \| null;/);
  assert.match(game, /specialShip: riftRun \? null : ship\.id/);
  assert.match(game, /const spec = SHIP_SPECIALS\[game\.specialShip\]/);
  assert.match(game, /if \(!game\.specialShip\) \{/);
  assert.match(game, /NO SPECIAL INSTALLED/);
  assert.match(game, /const ship = game\.specialShip;/);
  // Every ability-gated combat read moved across with it.
  for (const gated of [
    /game\.specialShip === "warden" && player\.suppressionBarrage > 0/,
    /salvageLinked: game\.specialShip === "kestrel" && player\.salvageLink > 0/,
    /const homing = game\.specialShip === "rabbit" && player\.viperGuidance > 0/,
    /salvageLinkHitsPup\(game\.specialShip \?\? game\.ship\.id, bullet, item\)/,
  ]) assert.match(game, gated);
  // Hull geometry still comes from the hull that is actually drawn.
  assert.match(game, /drawShipModel\(ctx, game\.ship\.id, 1\.15\)/);
  assert.match(game, /shipMuzzleWorldPoint\(game\.ship\.id, player, aimAngle, 1\.15\)/);
  // And the HUD says so plainly when nothing is installed.
  assert.match(game, /game\.specialShip \? SHIP_SPECIALS\[game\.specialShip\]\.name : "NO SPECIAL"/);
});

test("the earned loadout is pushed into the live game after every pick", () => {
  const sync = game.slice(game.indexOf("const applyRiftRunLoadout = useCallback"), game.indexOf("const riftRunSettled"));
  assert.match(sync, /game\.payloadCapacity = next\.loadout\.payloadSlots/);
  assert.match(sync, /game\.player\.gun = cannonMarkForTier\(next\.loadout\.cannonTier\)/);
  assert.match(sync, /game\.player\.thrust = thrusterMarkForTier\(next\.loadout\.thrusterTier\)/);
  assert.match(sync, /retrosForTier\(next\.loadout\.thrusterTier\)/);
  assert.match(sync, /game\.specialShip = next\.loadout\.special\?\.shipId \?\? null/);
  // Both pickers run it, so a Special installed mid-run is armed immediately.
  assert.match(game, /const next=applyUpgrade\(\{\.\.\.current,rollIndex:upgradeRoll\.nextRollIndex\},choice\);[\s\S]{0,600}applyRiftRunLoadout\(next\)/);
  assert.match(game, /const next=chooseRiftRunSpecial\(current, shipId\);[\s\S]{0,400}applyRiftRunLoadout\(next\)/);
});

test("a run's own capacity is the bin's ceiling, and unearned slots read as locked", () => {
  assert.match(game, /payloadCapacity: riftRun \? RIFT_RUN_STARTING_PAYLOAD_SLOTS : STOCK_LIMIT/);
  assert.match(game, /game\.stock\.length >= game\.payloadCapacity/);
  assert.match(game, /const wasBelowCapacity = game\.stock\.length === game\.payloadCapacity - 1/);
  // The frame stays a fixed five wide in every mode — the compact HUD's
  // geometry depends on it — so the unearned slots are drawn shut instead.
  assert.match(game, /const lockedSlots = STOCK_LIMIT - hud\.payloadCapacity/);
  assert.match(game, /const locked = index >= hud\.payloadCapacity/);
  assert.match(game, /style=\{\{ "--compact-slots": STOCK_LIMIT \}/);
});

test("an unspent follow-up choice holds the pause and blocks the next roll", () => {
  // Unlocking a socket or a Special hands the pilot a second decision. Rolling
  // the next upgrade screen over the top of it, or letting the run resume,
  // would lose the reward.
  assert.match(game, /!riftRun\.pendingHullGunReward && !riftRun\.pendingSpecialChoice && riftRun\.pendingLevels > 0/);
  assert.match(game, /pendingHullGunReward\(riftRunRef\.current\) \|\| riftRunRef\.current\.pendingSpecialChoice/);
  assert.match(game, /!state\.pendingLevels && !pendingHullGunReward\(state\) && !state\.pendingSpecialChoice/);
});

test("the upgrade card names the ship system it belongs to", () => {
  assert.match(game, /<small>\{RIFT_SYSTEM_LABELS\[choice\.system\]\}<\/small>/);
  for (const label of Object.values(RIFT_SYSTEM_LABELS)) assert.equal(typeof label, "string");
  assert.deepEqual(Object.keys(RIFT_SYSTEM_LABELS), ["payload", "cannon", "thrusters", "special", "hull"]);
  assert.deepEqual([1, 2, 3, 4, 5].map(tierNumeral), ["I", "II", "III", "IV", "V"]);
});

test("the Special picker offers the shipped roster and nothing that needs a specific hull", () => {
  assert.match(game, /RIFT_RUN_SPECIALS\.map\(option=>/);
  assert.match(game, /chooseSpecial\(option\.shipId\)/);
  assert.match(game, /CHOOSE YOUR SPECIAL/);
  assert.ok(!RIFT_RUN_SPECIALS.some(({ shipId }) => shipId === "flash"), "FORM SHIFT only means anything on Switchback");
  assert.equal(new Set(RIFT_RUN_SPECIALS.map(({ shipId }) => shipId)).size, RIFT_RUN_SPECIALS.length);
});
