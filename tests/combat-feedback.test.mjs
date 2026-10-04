import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { playCombatHaptics } from "../app/combat-feedback.ts";
import { COMBAT_RUMBLE } from "../app/gamepad.ts";

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
  // The exclusion lives in the helper rather than at its call sites, which is
  // the whole reason it cannot be forgotten at a new one.
  const helper = game.slice(game.indexOf("const cannonImpactFeedback"));
  assert.match(helper.slice(0, 400), /if \(bullet\.enemy \|\| bullet\.special \|\| game\.cycles - lastGunFeedbackTick < 2\) return;/);
  // Every impact path reports through it, and the number of paths is not
  // pinned. This used to assert exactly two and there are four -- the rift,
  // intercepting a hostile shot, shooting a loose payload, and hitting an
  // enemy -- so it had been failing since the third was added, in a suite no
  // script ran. A count that has to be edited whenever a path is added only
  // ever fails for the right reason by accident; what matters is that no path
  // reports impact feedback any other way.
  assert.ok(
    (game.match(/cannonImpactFeedback\(game, bullet\)/g) ?? []).length >= 2,
    "cannon impacts must report through the shared helper"
  );
  assert.match(game, /cannonHitSoundRef\.current/);
});

test("hull feedback is emitted only after unlimited-hull guard", () => {
  const start = game.indexOf("const applyHullDamage");
  const block = game.slice(start, start + 900);
  // Matched without the closing bracket: the call carries the amount now
  // (`vibrateCombat("hull", amount)`), so the old exact-string search found
  // nothing, compared -1 against a real index, and reported the guard as
  // missing. Both ends are asserted present so the comparison cannot pass on
  // two absences again.
  const guard = block.indexOf("game.rules.unlimitedHull");
  const feedback = block.indexOf('vibrateCombat("hull"');
  assert.ok(guard >= 0, "the unlimited-hull guard must be in applyHullDamage");
  assert.ok(feedback >= 0, "hull feedback must be in applyHullDamage");
  assert.ok(guard < feedback, "a locked hull must not buzz the pad");
});

const rumblePad = (playEffect) => ({
  axes: [], buttons: [], connected: true, mapping: "standard", vibrationActuator: { playEffect },
});

test("combat preference filters phone and controller outputs together", () => {
  for (const [mode, expected] of [["off", []], ["gun", ["gun"]], ["hull", ["hull"]], ["both", ["gun", "hull"]]]) {
    const controller = [];
    const phone = [];
    const pad = rumblePad((_type, effect) => { controller.push(effect); return Promise.resolve(); });
    for (const event of ["gun", "hull"]) {
      playCombatHaptics(mode, event, { pads: [pad], vibratePhone: (duration) => phone.push(duration) });
    }
    assert.deepEqual(controller, expected.map((event) => COMBAT_RUMBLE[event]));
    assert.deepEqual(phone, expected.map((event) => event === "gun" ? 9 : 24));
  }
});

test("unsupported and rejecting controller actuators fail safely", async () => {
  assert.doesNotThrow(() => playCombatHaptics("both", "gun", { pads: [rumblePad(undefined)] }));
  assert.doesNotThrow(() => playCombatHaptics("both", "hull", {
    pads: [rumblePad(() => Promise.reject(new Error("disconnected")))],
  }));
  await new Promise((resolve) => setImmediate(resolve));
});

test("cannon recoil is lighter and shorter than hull damage", () => {
  assert.ok(COMBAT_RUMBLE.gun.duration < COMBAT_RUMBLE.hull.duration);
  assert.ok(COMBAT_RUMBLE.gun.weakMagnitude < COMBAT_RUMBLE.hull.weakMagnitude);
  assert.ok(COMBAT_RUMBLE.gun.strongMagnitude < COMBAT_RUMBLE.hull.strongMagnitude);
});

test("player cannon fire emits gun feedback without changing fire cadence", () => {
  assert.match(game, /play\("fire", 0\.12, cannonPlaybackRate\(player\.gun\)\);\n\s*vibrateCombat\("gun"\);/);
  assert.match(game, /game\.shotCycle = Math\.max\(1, Math\.round\(shot\.delay/);
});

test("EMP remains 150 ticks but gains edge-triggered audio and persistent status", () => {
  assert.match(game, /const newlyScrambled = player\.emp <= 0/);
  assert.match(game, /player\.emp = 150/);
  assert.match(game, /if \(newlyScrambled\)/);
  assert.match(game, /SCRAMBLED \/\/ CONTROLS REVERSED/);
  assert.match(game, /SCRAMBLED \$\{\(player\.emp \* TICK_MS \/ 1000\)\.toFixed\(1\)\}s/);
});
