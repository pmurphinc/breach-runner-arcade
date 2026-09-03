/**
 * The menu's navigation rules.
 *
 * `menuButtonTarget` is the whole contract for what the global Menu button
 * does, so it is worth testing as a truth table rather than through a browser:
 * every combination is covered here in milliseconds, and a regression shows up
 * as a named failing case instead of a mysterious click that went nowhere.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOSED,
  INITIAL_STACK,
  activeRoute,
  isOpen,
  isPauseRoot,
  menuButtonTarget,
  pop,
  push,
  reset,
} from "../app/menu-routes.ts";

const RUNNING = true;
const IDLE = false;

test("with no run, Menu always resolves to Home", () => {
  // Home is the root state when no run exists. Closing the menu here used to
  // leave the player in an inert cockpit with no game and no way back.
  assert.deepEqual(menuButtonTarget(["home"], IDLE), ["home"], "Home stays Home");
  assert.deepEqual(menuButtonTarget(["home", "ships"], IDLE), ["home"], "Ships returns Home");
  assert.deepEqual(menuButtonTarget(["home", "settings"], IDLE), ["home"], "Settings returns Home");
  assert.deepEqual(menuButtonTarget(["home", "modes"], IDLE), ["home"], "Modes returns Home");
  assert.deepEqual(menuButtonTarget(["leaderboard"], IDLE), ["home"], "Leaderboard returns Home");
  assert.deepEqual(menuButtonTarget(CLOSED, IDLE), ["home"], "a closed menu opens Home");
});

test("with no run, Menu never resolves to a closed menu", () => {
  // The regression this file exists for: not "is the button visible", but
  // "can the button ever strand the player outside the menu with no game".
  const stacks = [
    CLOSED,
    ["home"],
    ["home", "ships"],
    ["home", "modes"],
    ["home", "settings"],
    ["home", "info"],
    ["home", "leaderboard"],
    ["home", "ships", "settings"],
    ["lobby"],
  ];
  for (const stack of stacks) {
    const next = menuButtonTarget(stack, IDLE);
    assert.ok(isOpen(next), `Menu closed the menu from ${JSON.stringify(stack)} with no run`);
    assert.equal(activeRoute(next), "home", `Menu should land on Home from ${JSON.stringify(stack)}`);
  }
});

test("with a run, Menu toggles Pause against the game", () => {
  assert.deepEqual(menuButtonTarget(CLOSED, RUNNING), ["pause"], "no menu opens Pause");
  assert.deepEqual(menuButtonTarget(["pause"], RUNNING), CLOSED, "Pause closes back into the game");
  assert.deepEqual(
    menuButtonTarget(["pause", "settings"], RUNNING),
    CLOSED,
    "a screen above Pause closes back into the game"
  );
});

test("a fresh session starts on Home, not on the ship picker", () => {
  // Ship choice belongs to each mode's pre-round lobby, so the first question
  // the game asks is what to play rather than what to fly. Rift Run's lobby
  // asks nothing about ships at all, which only works if the picker is not
  // standing in front of every launch.
  assert.deepEqual(INITIAL_STACK, ["home"]);
  assert.equal(activeRoute(INITIAL_STACK), "home");
  assert.ok(isOpen(INITIAL_STACK));
});

test("the stack behaves like a stack", () => {
  assert.deepEqual(push(["home"], "ships"), ["home", "ships"]);
  assert.deepEqual(push(["home", "modes"], "rift-run"), ["home", "modes", "rift-run"]);
  // Re-entering the top route is a no-op, so a double tap cannot build a stack
  // the player has to unwind twice.
  assert.deepEqual(push(["home", "ships"], "ships"), ["home", "ships"]);
  assert.deepEqual(pop(["home", "ships"]), ["home"]);
  assert.deepEqual(pop(["home"]), CLOSED);
  assert.deepEqual(reset("modes"), ["modes"]);
  assert.equal(activeRoute(CLOSED), null);
  assert.equal(isOpen(CLOSED), false);
});

test("Pause is only a root when it is the only entry", () => {
  assert.equal(isPauseRoot(["pause"]), true);
  assert.equal(isPauseRoot(["pause", "settings"]), false);
  assert.equal(isPauseRoot(["home"]), false);
  assert.equal(isPauseRoot(CLOSED), false);
});
