/**
 * The shop: prices, ownership, the basket, and the money that fills it.
 *
 * Every rule here is arithmetic over a plain record, which is the point of
 * keeping the wallet out of React: a balance change is a failing assertion
 * rather than a click-through.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SHOP_PUPS,
  STARTER_UNLOCKS,
  STARTING_CREDITS,
  bankCredits,
  clearLoadout,
  consumeLoadout,
  isPupUnlocked,
  loadPup,
  loadoutSpace,
  loadoutValue,
  newPilotWallet,
  normalizeWallet,
  pupLoadCost,
  pupUnlockCost,
  unloadPup,
  unlockPup,
} from "../app/armory.ts";
import { WEAPONS } from "../app/game-data.ts";
import { PUP_INVENTORY_CAPACITY } from "../app/pup-inventory.js";
import {
  CREDIT_AWARDS,
  creditsForRiftCharge,
  creditsForRiftDamage,
  enemyBounty,
  formatCredits,
  formatCreditsCompact,
  settleRunCredits,
} from "../app/currency.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

const rich = () => ({ ...newPilotWallet(), credits: 100_000 });

test("the catalog is exactly the payloads that can sit in the inventory", () => {
  // Upgrades, the repair and the rare drops apply themselves on contact and
  // never enter the stock, so there is no slot for a bought one to occupy.
  for (const id of SHOP_PUPS) assert.equal(WEAPONS[id].sendable, true, `${id} must be sendable`);
  const missing = Object.keys(WEAPONS).filter((id) => WEAPONS[id].sendable && !SHOP_PUPS.includes(id));
  assert.deepEqual(missing, [], "every sendable payload is stocked");
});

test("price follows the catalog's own threat rating", () => {
  for (const id of SHOP_PUPS) {
    assert.ok(pupUnlockCost(id) > 0 && pupLoadCost(id) > 0, `${id} is priced`);
    assert.ok(pupLoadCost(id) < pupUnlockCost(id), "a copy costs far less than the right to buy copies");
  }
  const light = SHOP_PUPS.find((id) => WEAPONS[id].threat === 2);
  const heavy = SHOP_PUPS.find((id) => WEAPONS[id].threat === 3);
  assert.ok(pupUnlockCost(heavy) > pupUnlockCost(light), "the dangerous payloads cost more");
});

test("a new pilot can afford to play without being able to afford everything", () => {
  const wallet = newPilotWallet();
  assert.equal(wallet.credits, STARTING_CREDITS);
  for (const id of STARTER_UNLOCKS) assert.ok(isPupUnlocked(wallet, id), `${id} is granted`);
  assert.ok(wallet.credits < Math.min(...SHOP_PUPS.map(pupUnlockCost)), "the first unlock has to be earned");
  assert.ok(wallet.credits >= Math.min(...STARTER_UNLOCKS.map(pupLoadCost)), "but a round can still be stocked");
});

test("unlocking is permanent, charged once, and refused when it cannot be paid", () => {
  const broke = unlockPup(newPilotWallet(), "nuke");
  assert.equal(broke.ok, false);
  assert.equal(broke.wallet.credits, STARTING_CREDITS, "a refused purchase costs nothing");

  const first = unlockPup(rich(), "nuke");
  assert.equal(first.ok, true);
  assert.equal(first.wallet.credits, 100_000 - pupUnlockCost("nuke"));
  assert.ok(isPupUnlocked(first.wallet, "nuke"));

  const again = unlockPup(first.wallet, "nuke");
  assert.equal(again.ok, false, "already owned");
  assert.equal(again.wallet.credits, first.wallet.credits, "and not charged twice");
});

test("loading needs the unlock, the money, and a free slot", () => {
  let wallet = rich();
  assert.equal(loadPup(wallet, "nuke").ok, false, "locked payloads cannot be bought into the round");

  wallet = unlockPup(wallet, "nuke").wallet;
  for (let bought = 0; bought < PUP_INVENTORY_CAPACITY; bought += 1) {
    const result = loadPup(wallet, "nuke");
    assert.equal(result.ok, true, `slot ${bought + 1} accepted`);
    wallet = result.wallet;
  }
  assert.equal(loadoutSpace(wallet), 0);
  const overflow = loadPup(wallet, "nuke");
  assert.equal(overflow.ok, false, "the inventory ceiling is the arena's, not a separate one");
  assert.equal(overflow.wallet.credits, wallet.credits, "and a full bin is not charged for");
});

test("a basket is refundable in full until the round takes it", () => {
  let wallet = rich();
  const before = wallet.credits;
  wallet = loadPup(wallet, "heatseeker").wallet;
  wallet = loadPup(wallet, "mines").wallet;
  assert.equal(loadoutValue(wallet), pupLoadCost("heatseeker") + pupLoadCost("mines"));

  const oneBack = unloadPup(wallet, 0);
  assert.equal(oneBack.ok, true);
  assert.equal(oneBack.wallet.credits, wallet.credits + pupLoadCost("heatseeker"));

  assert.equal(clearLoadout(wallet).wallet.credits, before, "clearing returns the pilot to where they started");
  assert.deepEqual(clearLoadout(wallet).wallet.loadout, []);
});

test("launching takes only what the run has room for, and keeps the rest", () => {
  let wallet = rich();
  for (let bought = 0; bought < PUP_INVENTORY_CAPACITY; bought += 1) wallet = loadPup(wallet, "mines").wallet;

  const full = consumeLoadout(wallet, PUP_INVENTORY_CAPACITY);
  assert.equal(full.stock.length, PUP_INVENTORY_CAPACITY);
  assert.deepEqual(full.wallet.loadout, [], "the wallet lets go of what the arena took");

  // A Rift Run opens with one payload slot. The other four stay bought.
  const stripped = consumeLoadout(wallet, 1);
  assert.equal(stripped.stock.length, 1);
  assert.equal(stripped.wallet.loadout.length, PUP_INVENTORY_CAPACITY - 1, "nothing is destroyed by the wrong mode");
  assert.deepEqual(consumeLoadout(wallet, 0).stock, [], "and a run with no slots takes nothing");
});

test("a corrupted wallet is repaired rather than trusted", () => {
  const wallet = normalizeWallet({
    credits: -500,
    lifetimeEarned: "nonsense",
    unlocked: ["nuke", "gun", "not-a-pup"],
    loadout: Array(50).fill("nuke"),
  });
  assert.equal(wallet.credits, 0, "a negative balance is not a balance");
  assert.equal(wallet.lifetimeEarned, 0);
  assert.ok(!wallet.unlocked.includes("gun"), "only stocked payloads can be owned");
  assert.ok(wallet.unlocked.includes("nuke"));
  for (const id of STARTER_UNLOCKS) assert.ok(wallet.unlocked.includes(id), "the starter grants are re-applied");
  assert.ok(wallet.loadout.length <= PUP_INVENTORY_CAPACITY, "the basket cannot exceed the arena's ceiling");
});

test("money is earned from doing things, and only in whole dollars once banked", () => {
  assert.ok(creditsForRiftCharge(10) > 0, "hitting the rift pays");
  assert.ok(creditsForRiftDamage(10) > creditsForRiftCharge(10), "landing a payload pays more");
  assert.equal(creditsForRiftDamage(0), 0, "a hit an enrage shield swallowed pays nothing");
  assert.equal(creditsForRiftDamage(-5), 0);
  assert.ok(enemyBounty("nuke") > enemyBounty("heatseeker"), "the heavy hostiles are worth more");
  assert.ok(CREDIT_AWARDS.breach > CREDIT_AWARDS.pupCollected);

  assert.equal(settleRunCredits(1200.9), 1200, "fractions of a dollar never reach the wallet");
  assert.equal(settleRunCredits(-4), 0);

  const banked = bankCredits(newPilotWallet(), 2000.7);
  assert.equal(banked.credits, STARTING_CREDITS + 2000);
  assert.equal(banked.lifetimeEarned, 2000, "both totals move together");
  assert.equal(bankCredits(banked, 0), banked, "nothing earned is nothing written");
});

test("a balance reads the same everywhere", () => {
  assert.equal(formatCredits(1250), "$1,250");
  assert.equal(formatCredits(-10), "$0", "a wallet cannot go under, so it is never drawn that way");
  assert.equal(formatCreditsCompact(9999), "$9,999");
  assert.equal(formatCreditsCompact(12_500), "$12.5k", "the live HUD is already fighting for room");
});

test("the arena is paid from the events that already exist", () => {
  // Beside the score at each site rather than derived from it: score and money
  // are ranked and spent differently and must be free to move apart.
  assert.match(game, /game\.credits \+= enemyBounty\(enemy\.kind\);/);
  assert.match(game, /game\.credits \+= creditsForRiftDamage\(damage\);/);
  assert.match(game, /game\.credits \+= creditsForRiftCharge\(nominalDamage\);/);
  assert.match(game, /game\.credits \+= CREDIT_AWARDS\.pupCollected;/);
  assert.equal((game.match(/game\.credits \+= CREDIT_AWARDS\.breach;/g) ?? []).length, 2, "both breach paths pay");
});

test("a purchased inventory is carried into the round the server also knows about", () => {
  assert.match(game, /const banked = consumeLoadout\(accountStore\.getSnapshot\(\)\.wallet, game\.payloadCapacity\);/);
  // The server owns the LIFO ledger in a network match, so a seeded payload is
  // reported as an ordinary collect. A local-only seed would let the pilot fire
  // payloads the server has no record of.
  assert.match(game, /for \(const payload of banked\.stock\) netRef\.current\?\.reportInventory\("collect", payload\);/);
});
