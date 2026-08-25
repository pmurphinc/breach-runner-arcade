import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settings = readFileSync(new URL("../app/view-settings.ts", import.meta.url), "utf8");
const menu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const rules = readFileSync(new URL("../app/combat-feedback.ts", import.meta.url), "utf8");

test("combat vibration and hit-sound settings persist with safe defaults", () => {
  assert.match(settings, /combatHaptics: "both"/);
  assert.match(settings, /cannonHitSound: true/);
  assert.match(settings, /isCombatHaptics\(candidate\.combatHaptics\)/);
  assert.match(menu, /label="Vibration"/);
  assert.match(menu, /Gun Feedback/);
  assert.match(menu, /Hull Feedback/);
  assert.match(menu, /label="Cannon Hit Sound"/);
});

test("cannon mark pitch ladder keeps one fire sound identity", () => {
  for (const rate of ["1", "1.08", "1.17", "1.28", "1.4"]) assert.match(rules, new RegExp(rate.replace('.', '\\.')));
  assert.match(game, /play\("fire", 0\.12, cannonPlaybackRate\(player\.gun\)\)/);
});

test("normal cannon impacts drive hit feedback while specials are excluded", () => {
  assert.match(game, /bullet\.enemy \|\| bullet\.special/);
  assert.equal((game.match(/cannonImpactFeedback\(game, bullet\)/g) ?? []).length, 2);
  assert.match(game, /cannonHitSoundRef\.current/);
});

test("hull feedback is emitted only after unlimited-hull guard", () => {
  const start = game.indexOf("const applyHullDamage");
  const block = game.slice(start, start + 900);
  assert.ok(block.indexOf("unlimitedHull") < block.indexOf('vibrateCombat("hull")'));
});

test("EMP remains 150 ticks but gains edge-triggered audio and persistent status", () => {
  assert.match(game, /const newlyScrambled = player\.emp <= 0/);
  assert.match(game, /player\.emp = 150/);
  assert.match(game, /if \(newlyScrambled\)/);
  assert.match(game, /SCRAMBLED \/\/ CONTROLS REVERSED/);
  assert.match(game, /SCRAMBLED \$\{\(player\.emp \* TICK_MS \/ 1000\)\.toFixed\(1\)\}s/);
});
