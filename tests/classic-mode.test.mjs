/**
 * Classic Wormhole's mode plumbing and ruleset.
 *
 * The mode is a peer of PvE, co-op and PvP rather than a difficulty, because it
 * pins its own physics instead of scaling an existing ruleset. These hold that
 * distinction — and, more importantly, hold Classic apart from Easy, which it
 * would be very easy to quietly re-alias during a future balance pass.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CLASSIC_RULES, DIFFICULTIES, PVP_RULES, rulesFor } from "../app/difficulty.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const menu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");

test("classic is a mode, not a difficulty", () => {
  for (const difficulty of ["easy", "difficult", "hard", "practice", "survival"]) {
    assert.equal(rulesFor("classic", difficulty), CLASSIC_RULES, "the difficulty selector cannot move Classic");
  }
});

test("the mode id is stable in code, saves and payloads", () => {
  // The player-facing string is one label in MODE_INFO and can change without a
  // migration; the id must not.
  assert.match(game, /\["pve", "coop", "pvp", "classic"\]/, "the remembered mode accepts it");
  assert.match(menu, /export const MODE_ORDER: GameMode\[\] = \["pve", "coop", "pvp", "classic"\]/);
  assert.match(menu, /classic: \{\s*label: "Classic Wormhole"/);
});

test("Classic keeps none of the modern safety systems", () => {
  assert.equal(CLASSIC_RULES.collisionShield.enabled, false);
  assert.equal(CLASSIC_RULES.contactHazard.enabled, false);
  assert.equal(CLASSIC_RULES.wormholeEnrage.enabled, false);
  assert.equal(CLASSIC_RULES.unlimitedHull, false, "Classic is not a practice mode");
});

test("the rift orbits at the reference rate", () => {
  assert.equal(CLASSIC_RULES.wormhole.kind, "orbit");
  assert.equal(CLASSIC_RULES.wormhole.degreesPerTick, 0.5);
});

test("walls rebound at the reference coefficient and cost nothing", () => {
  assert.equal(CLASSIC_RULES.wall.bounce, -0.5);
  assert.equal(CLASSIC_RULES.wall.damage, 0, "a wall costs speed in Classic, not hull");
  // Every other ruleset keeps what Breach Runner has always done.
  for (const id of ["practice", "easy", "difficult", "hard", "survival"]) {
    assert.equal(DIFFICULTIES[id].wall.bounce, -0.55);
    assert.equal(DIFFICULTIES[id].wall.damage, 2);
  }
});

test("wall behaviour is read from the rules, not hardcoded in the loop", () => {
  assert.match(game, /player\.vx \*= game\.rules\.wall\.bounce/);
  assert.match(game, /player\.vy \*= game\.rules\.wall\.bounce/);
  assert.doesNotMatch(game, /player\.v[xy] \*= -0\.55/, "the old constant must be gone");
  // A zero-damage wall must not report a hit at all, or Classic would log
  // collisions the pilot never took.
  assert.match(game, /if \(game\.rules\.wall\.damage > 0\) damageCollision\(game, game\.rules\.wall\.damage, "wall"\)/);
});

test("Classic is its own object, so retuning Easy cannot move it", () => {
  assert.notEqual(CLASSIC_RULES, DIFFICULTIES.easy);
  assert.notEqual(CLASSIC_RULES, PVP_RULES);
  // Easy locks its rift and shields the pilot; Classic does neither. If these
  // ever agree, someone has re-aliased Classic.
  assert.notEqual(CLASSIC_RULES.wormhole.kind, DIFFICULTIES.easy.wormhole.kind);
  assert.notEqual(CLASSIC_RULES.collisionShield.enabled, DIFFICULTIES.easy.collisionShield.enabled);
});

test("solo Classic launches straight, skipping the difficulty screen", () => {
  // There is nothing for that screen to choose: Classic pins its own rules.
  assert.match(game, /if \(next === "classic"\) start\(undefined, "classic"\)/);
  assert.match(menu, /data-mode="classic"/);
  assert.match(menu, /onMode: \(mode: "pve" \| "coop" \| "classic"\) => void/);
});
