import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CAPSTONE_IDS,
  HULL_REGEN_PER_TICK,
  RIFT_BRANCHES,
  RIFT_BRANCH_BY_CAPSTONE,
  SLIPSTREAM_SPEED_FRACTION,
  TRACTOR_FIELD_PULL,
  TRACTOR_FIELD_RADIUS,
  availableCapstones,
  branchProgress,
  capstoneChoices,
  hasCapstone,
  hasPhaseRounds,
  hasRegenerativePlating,
  hasSlipstream,
  hasTractorField,
  takenCapstone,
} from "../app/rift-run/skill-tree.ts";
import {
  RIFT_RUN_MAX_CANNON_TIER,
  RIFT_RUN_MAX_PAYLOAD_SLOTS,
  RIFT_RUN_MAX_SOCKETS,
  RIFT_RUN_MAX_THRUSTER_TIER,
  RIFT_SYSTEMS,
} from "../app/rift-run/loadout.ts";
import { createRiftRun } from "../app/rift-run/state.ts";
import { applyUpgrade } from "../app/rift-run/upgrade-apply.ts";
import { rollUpgradeChoices, RIFT_UPGRADE_CARDS } from "../app/rift-run/upgrade-pool.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

/** A run with the named branches topped out. */
function topped(...branches) {
  const state = structuredClone(createRiftRun("seed"));
  if (branches.includes("cannon")) state.loadout.cannonTier = RIFT_RUN_MAX_CANNON_TIER;
  if (branches.includes("thrusters")) state.loadout.thrusterTier = RIFT_RUN_MAX_THRUSTER_TIER;
  if (branches.includes("payload")) state.loadout.payloadSlots = RIFT_RUN_MAX_PAYLOAD_SLOTS;
  if (branches.includes("hull")) {
    state.hardpoints = Array.from({ length: RIFT_RUN_MAX_SOCKETS }, (_, index) => ({ index, status: "available" }));
  }
  return state;
}

const cardFor = (id) => ({
  key: id, upgradeId: id, system: RIFT_BRANCH_BY_CAPSTONE[id].system,
  gameplayCategory: "offensive", track: id, title: "", target: "", description: "",
});

/* ------------------------------------------------------------- the shape */

test("four branches, each ending in its own capstone", () => {
  assert.equal(RIFT_BRANCHES.length, 4);
  assert.equal(CAPSTONE_IDS.length, 4);
  assert.deepEqual(
    RIFT_BRANCHES.map((branch) => branch.id).sort(),
    ["cannon", "hull", "payload", "thrusters"],
  );
  // Every branch's ending is distinct, and every capstone belongs to a branch.
  assert.equal(new Set(RIFT_BRANCHES.map((branch) => branch.capstoneId)).size, 4);
  for (const id of CAPSTONE_IDS) assert.ok(RIFT_BRANCH_BY_CAPSTONE[id], id);
});

test("the main gun's branch ends in PHASE ROUNDS", () => {
  const cannon = RIFT_BRANCHES.find((branch) => branch.id === "cannon");
  assert.equal(cannon.capstoneId, "phase-rounds");
  assert.equal(cannon.capstoneName, "PHASE ROUNDS");
  assert.match(cannon.capstoneDescription, /pass through loose power-ups/);
});

test("each branch sits on a real ship system", () => {
  for (const branch of RIFT_BRANCHES) {
    assert.ok(RIFT_SYSTEMS.includes(branch.system), `${branch.id} → ${branch.system}`);
  }
  // Distinct systems, so two branches can never contend for one card slot.
  assert.equal(new Set(RIFT_BRANCHES.map((branch) => branch.system)).size, 4);
});

/**
 * The Special is not a branch.
 *
 * It has a ladder, but it is an *active* the pilot fires and these four are
 * passives. Mixing them would make "which capstone" also mean "active or
 * passive", which is a different and worse question.
 */
test("the Special keeps its ladder and gains no capstone", () => {
  assert.ok(!RIFT_BRANCHES.some((branch) => branch.system === "special"));
});

/* ---------------------------------------------------------- the climbing */

test("a fresh run has topped nothing", () => {
  const progress = branchProgress(createRiftRun("seed"));
  assert.equal(progress.length, 4);
  assert.equal(progress.filter((branch) => branch.complete).length, 0);
  assert.equal(availableCapstones(createRiftRun("seed")).length, 0);
});

test("progress is read off the loadout, so it cannot drift from the build", () => {
  const cannon = branchProgress(topped("cannon")).find((branch) => branch.id === "cannon");
  assert.equal(cannon.current, RIFT_RUN_MAX_CANNON_TIER);
  assert.ok(cannon.complete);
});

test("a cut socket counts whether or not a gun is in it", () => {
  // An empty socket is progress the pilot paid for; only a locked one is not.
  const state = structuredClone(createRiftRun("seed"));
  state.hardpoints = [
    { index: 0, status: "occupied", weapon: { instanceId: "w1", weaponId: "pulse-cannon" } },
    { index: 1, status: "empty" },
    { index: 2, status: "locked" },
  ];
  assert.equal(branchProgress(state).find((branch) => branch.id === "hull").current, 2);
});

/* ------------------------------------------------------- one, and only one */

test("topping a branch offers exactly that branch's ending", () => {
  const offers = capstoneChoices(topped("thrusters"));
  assert.equal(offers.length, 1);
  assert.equal(offers[0].track, "slipstream");
  assert.match(offers[0].target, /THRUSTERS BRANCH COMPLETE/);
});

/**
 * The heart of the design: these are alternatives, not a collection.
 *
 * A run that tops two branches before spending the pick genuinely chooses; a
 * run that tops all four still ends with one.
 */
test("two finished branches means a real choice, on one screen", () => {
  const state = topped("cannon", "payload");
  const offers = capstoneChoices(state);
  assert.equal(offers.length, 2);
  const { choices } = rollUpgradeChoices(state);
  const shown = choices.filter((choice) => CAPSTONE_IDS.includes(choice.track));
  assert.equal(shown.length, 2, "both endings must be on the same screen to be a choice");
});

test("taking one closes the other three for good", () => {
  const state = topped("cannon", "payload", "thrusters", "hull");
  assert.equal(capstoneChoices(state).length, 4, "all four are on offer first");

  const taken = applyUpgrade(state, capstoneChoices(state).find((c) => c.track === "slipstream"));
  assert.equal(takenCapstone(taken), "slipstream");
  assert.ok(hasSlipstream(taken));
  assert.ok(!hasPhaseRounds(taken) && !hasTractorField(taken) && !hasRegenerativePlating(taken));
  assert.equal(capstoneChoices(taken).length, 0, "a run keeps exactly one");
  assert.equal(availableCapstones(taken).length, 0);
});

test("a second capstone cannot be applied even from a stale card", () => {
  const state = topped("cannon", "thrusters");
  const once = applyUpgrade(state, cardFor("phase-rounds"));
  assert.equal(takenCapstone(once), "phase-rounds");
  // A slipstream card rolled on the same screen must not also land.
  assert.equal(applyUpgrade(once, cardFor("slipstream")), once, "the state is returned untouched");
  assert.equal(takenCapstone(once), "phase-rounds");
});

test("a capstone cannot be taken before its branch is topped", () => {
  const short = topped("cannon");
  // The cannon is topped, so slipstream's own branch is not.
  assert.equal(applyUpgrade(short, cardFor("slipstream")), short);
  assert.equal(takenCapstone(short), null);
  // And the one that is earned still works.
  assert.equal(takenCapstone(applyUpgrade(short, cardFor("phase-rounds"))), "phase-rounds");
});

test("hasCapstone answers for exactly the one held", () => {
  const held = applyUpgrade(topped("hull"), cardFor("regenerative-plating"));
  assert.ok(hasCapstone(held, "regenerative-plating"));
  for (const id of CAPSTONE_IDS) {
    if (id !== "regenerative-plating") assert.ok(!hasCapstone(held, id), id);
  }
});

/* ------------------------------------------------------------- the screen */

test("an ending is never left to the shuffle", () => {
  const state = topped("payload");
  const { choices } = rollUpgradeChoices(state);
  assert.equal(choices[0].track, "tractor-field", "first card, not left to chance");
  assert.ok(choices.length > 1, "and the rest of the screen still fills");
});

test("a screen still shows one card per ship system", () => {
  for (const combination of [["cannon"], ["cannon", "payload"], ["thrusters", "hull"]]) {
    const { choices } = rollUpgradeChoices(topped(...combination));
    assert.equal(new Set(choices.map((choice) => choice.system)).size, choices.length, combination.join("+"));
    assert.ok(choices.length <= RIFT_UPGRADE_CARDS);
  }
});

test("an ordinary screen is unchanged by the tree existing", () => {
  const { choices } = rollUpgradeChoices(createRiftRun("seed"));
  assert.equal(choices.length, RIFT_UPGRADE_CARDS);
  assert.ok(!choices.some((choice) => CAPSTONE_IDS.includes(choice.track)));
});

/* ------------------------------------------------------------ the effects */

test("PHASE ROUNDS lets shots pass through loose power-ups", () => {
  assert.match(game, /const phaseRounds = activeRiftRun \? hasPhaseRounds\(activeRiftRun\) : false;/);
  assert.match(game, /if \(bullet\.life > 0 && !bullet\.salvageLinked && !phaseRounds\) \{/);
});

test("SLIPSTREAM turns contact damage off while the pilot is moving", () => {
  // Conditional rather than blanket immunity: it rewards the thing the branch
  // is about, and a hull sitting still in a crowd is still in trouble.
  assert.match(game, /if \(slipstreamActive\(game\)\) return;/);
  assert.match(game, /Math\.hypot\(player\.vx, player\.vy\) >= game\.ship\.maxSpeed \* SLIPSTREAM_SPEED_FRACTION/);
  assert.equal(SLIPSTREAM_SPEED_FRACTION, 0.5);
});

test("REGENERATIVE PLATING repairs slowly, and never past full", () => {
  assert.match(game, /game\.player\.health = Math\.min\(game\.player\.maxHealth, game\.player\.health \+ HULL_REGEN_PER_TICK\);/);
  // Useless inside a fight, decisive between them: it must never out-heal
  // incoming fire. About 1.3 hull a second at the 15ms tick.
  assert.ok(HULL_REGEN_PER_TICK > 0 && HULL_REGEN_PER_TICK < 0.05);
  assert.ok((HULL_REGEN_PER_TICK * 1000) / 15 < 2, "under two hull a second");
});

test("TRACTOR FIELD steers drops in rather than snatching them", () => {
  assert.match(game, /if \(d <= TRACTOR_FIELD_RADIUS\) \{/);
  assert.match(game, /const pull = TRACTOR_FIELD_PULL \* \(1 - d \/ TRACTOR_FIELD_RADIUS\);/);
  // Weaker than GRAVITY PULSE's 0.12-to-0.40, because this one is always on.
  assert.ok(TRACTOR_FIELD_PULL < 0.12, "an always-on pull must be gentler than a three-second special");
  assert.ok(TRACTOR_FIELD_RADIUS > 400, "but it should reach across a fight");
});

test("the rail shows the climb, then the run's identity", () => {
  // Without a visible destination, finishing a branch and abandoning one look
  // identical from the cockpit.
  assert.match(game, /\$\{leadBranch\.label\} \$\{leadBranch\.current\}\/\$\{leadBranch\.max\} → \$\{leadBranch\.capstoneName\}/);
  assert.match(game, /branches\.find\(\(branch\) => branch\.capstoneId === heldCapstone\)\?\.capstoneName/);
});
