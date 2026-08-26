import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { controllerStateForPads, EMPTY_GAMEPAD, headingDegrees, pressedOnce, readStandardGamepad, GAMEPAD_DEAD_ZONE } from "../app/gamepad.ts";

const pad = (axes = [0, 0, 0, 0], pressed = [], connected = true) => ({
  axes, connected, mapping: "standard",
  buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index) })),
});
const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

test("standard controller axes use a drift dead zone", () => {
  const actions = readStandardGamepad(pad([GAMEPAD_DEAD_ZONE / 2, 0, .8, 0]));
  assert.equal(actions.moveX, 0);
  assert.ok(actions.aimX > 0);
  assert.equal(actions.fireMain, true);
});

test("stick cardinal directions use gameplay degrees", () => {
  assert.equal(headingDegrees(1, 0), 0);
  assert.equal(headingDegrees(0, 1), 90);
  assert.ok(Math.abs(headingDegrees(-1, 0)) === 180);
  assert.equal(headingDegrees(0, -1), -90);
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

test("connect and disconnect update controller state without touching other sources", () => {
  const keyboard = { Space: true, KeyE: true };
  const touch = { moveHeading: 90, aimHeading: -90 };
  assert.equal(controllerStateForPads([]), EMPTY_GAMEPAD);
  assert.equal(controllerStateForPads([pad(undefined, [7])]).firePup, true);
  assert.equal(controllerStateForPads([pad(undefined, [7], false)]), EMPTY_GAMEPAD);
  assert.deepEqual(keyboard, { Space: true, KeyE: true });
  assert.deepEqual(touch, { moveHeading: 90, aimHeading: -90 });
  const effect = game.slice(game.indexOf("// Controllers are optional"), game.indexOf("const canvas = canvasRef.current"));
  assert.doesNotMatch(effect, /keys\.current\.(?:Space|KeyE|KeyQ)\s*=/);
  assert.doesNotMatch(effect, /(?:moveHeading|aimHeading)\.current\s*=/);
});

test("right-stick heading drives facing and cannon projectile direction", () => {
  assert.match(game, /controllerAimHeading = headingDegrees\(controller\.aimX, controller\.aimY\)/);
  assert.match(game, /firingHeading = controllerAimHeading \?\? aimHeading\.current/);
  assert.match(game, /player\.angle \* DEG \+ offset/);
  for (const [x, y, expectedX, expectedY] of [[1, 0, 1, 0], [0, 1, 0, 1], [-1, 0, -1, 0], [0, -1, 0, -1]]) {
    const radians = headingDegrees(x, y) * Math.PI / 180;
    assert.ok(Math.abs(Math.cos(radians) - expectedX) < 1e-10);
    assert.ok(Math.abs(Math.sin(radians) - expectedY) < 1e-10);
  }
});

test("shoulders advance once per physical press", () => {
  assert.equal(pressedOnce(true, false), true);
  assert.equal(pressedOnce(true, true), false);
  assert.equal(pressedOnce(false, true), false);
  assert.match(game, /pressedOnce\(action\.nextPup, previous\.nextPup\)/);
  const effect = game.slice(game.indexOf("// Controllers are optional"), game.indexOf("const canvas = canvasRef.current"));
  assert.doesNotMatch(effect, /\[back, inspect,/);
});
