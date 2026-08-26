import test from "node:test";
import assert from "node:assert/strict";
import { readStandardGamepad, GAMEPAD_DEAD_ZONE } from "../app/gamepad.ts";

const pad = (axes = [0, 0, 0, 0], pressed = []) => ({
  axes,
  buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index) })),
});

test("standard controller axes use a drift dead zone", () => {
  const actions = readStandardGamepad(pad([GAMEPAD_DEAD_ZONE / 2, 0, .8, 0]));
  assert.equal(actions.moveX, 0);
  assert.ok(actions.aimX > 0);
  assert.equal(actions.fireMain, true);
});

test("standard triggers, shoulders, face and menu buttons map to actions", () => {
  const actions = readStandardGamepad(pad(undefined, [0, 1, 4, 5, 6, 7, 9]));
  assert.equal(actions.confirm, true);
  assert.equal(actions.cancel, true);
  assert.equal(actions.previousPup, true);
  assert.equal(actions.nextPup, true);
  assert.equal(actions.special, true);
  assert.equal(actions.firePup, true);
  assert.equal(actions.pause, true);
});
