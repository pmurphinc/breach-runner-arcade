/**
 * Classic Wormhole's drop table.
 *
 * A probability table is only as good as its ability to be run deterministically,
 * so the RNG and the clock are injected and these drive both directly. The
 * scripted-RNG cases pin the exact branches; the statistical ones catch a table
 * that is correct in structure but wrong in weight.
 */
import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

import { INSTANT_PICKUPS, SENDABLE_POWERUPS } from "../app/game-data.ts";
import {
  CLASSIC_DROP_GATES,
  CLASSIC_SELF_BUFF_CHANCE,
  classicDropCatalogue,
  rollClassicDrop,
} from "../app/classic-drops.ts";

const fresh = { gunMaxed: false, thrustMaxed: false, retrosMaxed: false, elapsedMs: 0 };

/** An RNG that returns a scripted sequence, then holds its last value. */
function scripted(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

/** Deterministic, well-spread source for statistical checks. */
function seeded(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test("the catalogue is the reference ordering, self-buffs then attacks", () => {
  assert.deepEqual(INSTANT_PICKUPS.slice(0, 6), ["gun", "thrust", "retros", "shield", "clear", "health"]);
  assert.equal(SENDABLE_POWERUPS[0], "heatseeker");
  assert.equal(SENDABLE_POWERUPS[8], "nuke", "the nuke must sit at reference index 14");
  assert.equal(classicDropCatalogue().length, 20);
  assert.equal(classicDropCatalogue(false).length, 17, "the reduced table withholds the last three");
});

test("one in three drops is a self-buff", () => {
  // Just under the gate picks a buff, just over picks an attack.
  assert.ok(INSTANT_PICKUPS.includes(rollClassicDrop(fresh, scripted(0.1, 0))));
  assert.ok(SENDABLE_POWERUPS.includes(rollClassicDrop(fresh, scripted(0.9, 0))));
  assert.equal(CLASSIC_SELF_BUFF_CHANCE, 1 / 3);
});

test("a maxed upgrade is re-rolled rather than wasted", () => {
  const maxed = { ...fresh, gunMaxed: true, thrustMaxed: true, retrosMaxed: true };
  // Every roll asks for the gun slot; with it maxed the table must move on.
  for (let i = 0; i < 40; i += 1) {
    const drop = rollClassicDrop(maxed, seeded(i + 1));
    assert.ok(drop !== "gun" && drop !== "thrust" && drop !== "retros", `rolled a maxed upgrade: ${drop}`);
  }
  // With nothing maxed, those upgrades are reachable again.
  const seen = new Set();
  for (let i = 0; i < 400; i += 1) seen.add(rollClassicDrop(fresh, seeded(i + 1)));
  assert.ok(seen.has("gun") || seen.has("thrust") || seen.has("retros"));
});

test("an all-maxed pilot still gets a drop instead of a hang", () => {
  // The bounded re-roll matters here: a pathological RNG that only ever returns
  // a maxed slot must still terminate.
  const maxed = { ...fresh, gunMaxed: true, thrustMaxed: true, retrosMaxed: true };
  const drop = rollClassicDrop(maxed, scripted(0.1, 0));
  assert.ok(typeof drop === "string" && drop.length > 0);
  assert.equal(drop, "health", "the fallback is the one slot that is never maxed");
});

test("late on, invulnerability becomes ordnance", () => {
  const late = { ...fresh, elapsedMs: CLASSIC_DROP_GATES.lateGame + 1 };
  // buff branch, then the invulnerability slot (index 3 of 6).
  assert.equal(rollClassicDrop(late, scripted(0.1, 3 / 6)), "heatseeker");
  // The zap slot becomes a turret at the same gate.
  assert.equal(rollClassicDrop(late, scripted(0.1, 4 / 6)), "turret");
});

test("invulnerability becomes a nuke three times in four at the middle gate", () => {
  const mid = { ...fresh, elapsedMs: CLASSIC_DROP_GATES.invulnerability + 1 };
  // The fourth value is the quarter-roll: non-zero substitutes the nuke.
  assert.equal(rollClassicDrop(mid, scripted(0.1, 3 / 6, 0.5)), "nuke");
  // A zero quarter-roll leaves invulnerability alone — the one case in four.
  assert.equal(rollClassicDrop(mid, scripted(0.1, 3 / 6, 0.1)), "shield");
  // Before the gate it is never substituted.
  assert.equal(rollClassicDrop(fresh, scripted(0.1, 3 / 6, 0.5)), "shield");
});

test("health becomes a nuke at its own, earlier gate", () => {
  const past = { ...fresh, elapsedMs: CLASSIC_DROP_GATES.health + 1 };
  assert.equal(rollClassicDrop(past, scripted(0.1, 5 / 6)), "nuke");
  assert.equal(rollClassicDrop(fresh, scripted(0.1, 5 / 6)), "health");
  // The gates are ordered: health flips first, then invulnerability, then late.
  assert.ok(CLASSIC_DROP_GATES.health < CLASSIC_DROP_GATES.invulnerability);
  assert.ok(CLASSIC_DROP_GATES.invulnerability < CLASSIC_DROP_GATES.lateGame);
});

test("a rolled nuke is re-rolled on a coin flip, halving its rate", () => {
  // attack branch, nuke (index 8 of 14), then a losing flip, then heatseeker.
  assert.equal(rollClassicDrop(fresh, scripted(0.9, 8 / 14, 0, 0)), "heatseeker");
  // A winning flip keeps it.
  assert.equal(rollClassicDrop(fresh, scripted(0.9, 8 / 14, 0.9)), "nuke");
});

test("the reduced table cannot produce the withheld attacks", () => {
  const reduced = { ...fresh, allPowerups: false };
  const withheld = new Set(SENDABLE_POWERUPS.slice(11));
  assert.equal(withheld.size, 3);
  for (let i = 0; i < 600; i += 1) {
    assert.ok(!withheld.has(rollClassicDrop(reduced, seeded(i + 1))), "the reduced table leaked a withheld attack");
  }
  // The full table does reach them.
  const seen = new Set();
  for (let i = 0; i < 600; i += 1) seen.add(rollClassicDrop(fresh, seeded(i + 1)));
  assert.ok([...withheld].some((id) => seen.has(id)));
});

test("attacks outweigh self-buffs about two to one", () => {
  const random = seeded(20260901);
  let attacks = 0;
  const runs = 6000;
  for (let i = 0; i < runs; i += 1) {
    if (SENDABLE_POWERUPS.includes(rollClassicDrop(fresh, random))) attacks += 1;
  }
  const share = attacks / runs;
  // Two-thirds, with room for sampling noise. This is the ratio that makes the
  // early game feel like the original rather than like a buff dispenser.
  assert.ok(share > 0.6 && share < 0.73, `attack share was ${share.toFixed(3)}`);
});

test("every drop is a real pickup id", () => {
  const catalogue = new Set(classicDropCatalogue());
  const random = seeded(7);
  for (let i = 0; i < 2000; i += 1) {
    assert.ok(catalogue.has(rollClassicDrop(fresh, random)));
  }
  // Ricochet is Breach Runner's own and is not part of the Classic table.
  assert.ok(!catalogue.has("ricochet"));
});

test("only Classic uses the Classic table", () => {
  const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
  assert.match(game, /if \(game\.mode !== "classic"\) return randomPower\(\)/);
  // Both places a portal or a kill sheds a pickup go through one decision, so
  // the two tables cannot drift apart at different call sites.
  assert.doesNotMatch(game, /type: randomPower\(\)/);
  assert.equal((game.match(/dropForGame\(game\)/g) ?? []).length, 2);
});

test("the drop clock is simulation time, not wall time", () => {
  const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
  // A paused run must not age its way past the substitution gates.
  assert.match(game, /elapsedMs: game\.cycles \* TICK_MS/);
  assert.doesNotMatch(game, /elapsedMs: Date\.now\(\)/);
});
