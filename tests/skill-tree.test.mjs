import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CAPSTONE_REQUIRED_BRANCHES,
  PHASE_ROUNDS_ID,
  branchProgress,
  capstoneChoice,
  capstoneUnlocked,
  completedBranches,
  hasPhaseRounds,
} from "../app/rift-run/skill-tree.ts";
import {
  RIFT_RUN_MAX_CANNON_TIER,
  RIFT_RUN_MAX_PAYLOAD_SLOTS,
  RIFT_RUN_MAX_SOCKETS,
  RIFT_RUN_MAX_SPECIAL_TIER,
  RIFT_RUN_MAX_THRUSTER_TIER,
} from "../app/rift-run/loadout.ts";
import { createRiftRun } from "../app/rift-run/state.ts";
import { applyUpgrade } from "../app/rift-run/upgrade-apply.ts";
import { rollUpgradeChoices } from "../app/rift-run/upgrade-pool.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

/** A run with the named ladders topped out. */
function withLadders(...ladders) {
  const state = structuredClone(createRiftRun("seed"));
  if (ladders.includes("payload")) state.loadout.payloadSlots = RIFT_RUN_MAX_PAYLOAD_SLOTS;
  if (ladders.includes("cannon")) state.loadout.cannonTier = RIFT_RUN_MAX_CANNON_TIER;
  if (ladders.includes("thrusters")) state.loadout.thrusterTier = RIFT_RUN_MAX_THRUSTER_TIER;
  if (ladders.includes("special")) state.loadout.special = { shipId: "tank", tier: RIFT_RUN_MAX_SPECIAL_TIER };
  if (ladders.includes("sockets")) {
    state.hardpoints = Array.from({ length: RIFT_RUN_MAX_SOCKETS }, (_, index) => ({ index, status: "available" }));
  }
  return state;
}

test("a fresh run has started none of its five ladders' tops", () => {
  const progress = branchProgress(createRiftRun("seed"));
  assert.equal(progress.length, 5, "five ladders, one per ship system");
  assert.equal(progress.filter((branch) => branch.complete).length, 0);
  // A locked Special reads as zero rather than one: it is a ladder not yet
  // started, not one already on its first rung.
  assert.equal(progress.find((branch) => branch.id === "special").current, 0);
});

test("progress is read off the loadout, so it cannot drift from the build", () => {
  const state = withLadders("cannon");
  const cannon = branchProgress(state).find((branch) => branch.id === "cannon");
  assert.equal(cannon.current, RIFT_RUN_MAX_CANNON_TIER);
  assert.ok(cannon.complete);
  assert.equal(completedBranches(state), 1);
});

test("a cut socket counts whether or not a gun is in it", () => {
  // An empty socket is progress the pilot paid for; only a locked one is not.
  const state = structuredClone(createRiftRun("seed"));
  state.hardpoints = [
    { index: 0, status: "occupied", weapon: { instanceId: "w1", weaponId: "pulse-cannon" } },
    { index: 1, status: "empty" },
    { index: 2, status: "locked" },
  ];
  assert.equal(branchProgress(state).find((branch) => branch.id === "sockets").current, 2);
});

/* --------------------------------------------------------- the capstone */

test("the capstone needs three ladders, and two is not enough", () => {
  assert.equal(CAPSTONE_REQUIRED_BRANCHES, 3);
  assert.ok(!capstoneUnlocked(withLadders("payload", "cannon")), "two ladders is short");
  assert.ok(capstoneUnlocked(withLadders("payload", "cannon", "thrusters")));
});

/**
 * Which three is free.
 *
 * A gun build and a mobility build must reach the same capstone by different
 * routes, or it is a track with extra steps rather than a tree.
 */
test("any three ladders will do", () => {
  const routes = [
    ["payload", "cannon", "thrusters"],
    ["special", "sockets", "cannon"],
    ["thrusters", "special", "payload"],
  ];
  for (const route of routes) {
    assert.ok(capstoneUnlocked(withLadders(...route)), route.join(" + "));
  }
});

test("the capstone is offered once, then never again", () => {
  const state = withLadders("payload", "cannon", "thrusters");
  const offered = capstoneChoice(state);
  assert.ok(offered, "unlocked runs are offered it");
  assert.equal(offered.track, PHASE_ROUNDS_ID);
  assert.match(offered.target, /3 \/ 3 LADDERS COMPLETE/);

  const taken = applyUpgrade(state, offered);
  assert.ok(hasPhaseRounds(taken), "taking it is recorded in the history");
  assert.equal(capstoneChoice(taken), null, "and it leaves the pool for good");
});

test("a locked run is never offered it", () => {
  assert.equal(capstoneChoice(withLadders("payload")), null);
  assert.equal(capstoneChoice(createRiftRun("seed")), null);
});

/**
 * A stale card cannot smuggle the capstone in.
 *
 * Every other ladder step guards against being applied twice or out of order;
 * this one has to as well, or a card rolled before a respec-like change could
 * grant the run's largest perk for free.
 */
test("applying it without the ladders changes nothing", () => {
  const short = withLadders("payload");
  const card = { key: PHASE_ROUNDS_ID, upgradeId: PHASE_ROUNDS_ID, system: "cannon", gameplayCategory: "offensive", track: PHASE_ROUNDS_ID, title: "PHASE ROUNDS", target: "", description: "" };
  assert.equal(applyUpgrade(short, card), short, "the state is returned untouched");
  assert.ok(!hasPhaseRounds(short));
});

test("it cannot be taken twice", () => {
  const state = withLadders("payload", "cannon", "thrusters");
  const once = applyUpgrade(state, capstoneChoice(state));
  const card = { key: PHASE_ROUNDS_ID, upgradeId: PHASE_ROUNDS_ID, system: "cannon", gameplayCategory: "offensive", track: PHASE_ROUNDS_ID, title: "PHASE ROUNDS", target: "", description: "" };
  assert.equal(applyUpgrade(once, card), once);
});

/**
 * The end of a tree must not be hidden by a shuffle.
 *
 * Three of five systems appear per screen. A capstone left in the ordinary
 * roll could sit unoffered for screens on end, and a pilot would simply never
 * learn it existed.
 */
test("the capstone takes the first slot on the screen after it unlocks", () => {
  const state = withLadders("payload", "cannon", "thrusters");
  const { choices } = rollUpgradeChoices(state);
  assert.equal(choices[0].track, PHASE_ROUNDS_ID, "first card, not left to chance");
  assert.equal(choices.filter((choice) => choice.track === PHASE_ROUNDS_ID).length, 1, "and only once");
  assert.ok(choices.length > 1, "the rest of the screen still fills");
});

test("an ordinary screen is unchanged by the tree existing", () => {
  const { choices } = rollUpgradeChoices(createRiftRun("seed"));
  assert.ok(choices.length > 0);
  assert.ok(!choices.some((choice) => choice.track === PHASE_ROUNDS_ID));
});

/* ------------------------------------------------------------ the effect */

test("shots pass through loose power-ups once the capstone is held", () => {
  // Derived from the run rather than stored, so it cannot drift from the
  // history that granted it and needs no migration for an older save.
  assert.match(game, /const phaseRounds = activeRiftRun \? hasPhaseRounds\(activeRiftRun\) : false;/);
  assert.match(game, /if \(bullet\.life > 0 && !bullet\.salvageLinked && !phaseRounds\) \{/);
});

test("the rail shows where the tree is heading", () => {
  // Without a visible destination, finishing a ladder and abandoning one look
  // identical from the cockpit.
  assert.match(game, /TREE \$\{ladders\}\/\$\{CAPSTONE_REQUIRED_BRANCHES\}/);
  assert.match(game, /phaseRounds \? "PHASE ROUNDS"/, "and names the capstone once it is held");
});
