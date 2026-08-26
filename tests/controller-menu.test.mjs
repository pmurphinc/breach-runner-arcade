import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONTROLLER_FOCUSABLE, controllerCancelTarget } from "../app/controller-navigation.ts";
import { pressedOnce } from "../app/gamepad.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const ui = readFileSync(new URL("../app/ui-system.tsx", import.meta.url), "utf8");
const navigation = readFileSync(new URL("../app/controller-navigation.ts", import.meta.url), "utf8");

test("one controller surface query covers complete interactive dialogs", () => {
  for (const control of ["button", "input", "select", "a[href]"]) assert.ok(CONTROLLER_FOCUSABLE.includes(control));
  assert.match(ui, /className="menu-panel"[\s\S]*data-controller-surface/);
  assert.match(game, /className="codex board"[\s\S]*data-controller-surface/);
  assert.match(game, /className="codex lobby"[\s\S]*data-controller-surface/);
  assert.match(game, /className="run-summary" data-controller-surface/);
});

test("multiplayer controls and controller select changes are reachable", () => {
  for (const label of ["QUICK MATCH", "CREATE PRIVATE MATCH", "JOIN WITH CODE", "READY", "CANCEL READY", "LEAVE MATCH", "BACK"]) assert.match(game, new RegExp(label));
  assert.match(game, /<select[\s\S]*onChange=\{\(event\) => onShip\(event\.target\.value\)\}/);
  assert.match(navigation, /active\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
});

test("Cancel resolves to the visible surface action", () => {
  assert.equal(controllerCancelTarget({ codex: true, summary: false, route: "info" }), "close-codex");
  assert.equal(controllerCancelTarget({ codex: false, summary: false, route: "leaderboard" }), "back");
  assert.equal(controllerCancelTarget({ codex: false, summary: false, route: "lobby" }), "back");
  assert.equal(controllerCancelTarget({ codex: false, summary: false, route: "settings" }), "back");
  assert.equal(controllerCancelTarget({ codex: false, summary: false, route: "pause" }), "resume");
  assert.equal(controllerCancelTarget({ codex: false, summary: false, route: "home" }), "resume");
  assert.equal(controllerCancelTarget({ codex: false, summary: true, route: null }), "hold-summary");
  assert.equal(controllerCancelTarget({ codex: false, summary: false, route: null }), "none");
});

test("held Cancel is edge-triggered and polling stays mounted across routes", () => {
  assert.equal(pressedOnce(true, false), true);
  assert.equal(pressedOnce(true, true), false);
  assert.match(game, /pressedOnce\(action\.cancel, previous\.cancel\)/);
  assert.match(game, /\}, \[controllerCancel, toggleMenu\]\);/);
});

test("Settings uses Pause as the live-run origin without pausing network simulation", () => {
  assert.match(game, /setPaused\(true\);\s*setMenu\(\["pause", "settings"\]\)/);
  assert.match(game, /if \(game\.mode !== "pve"\)[\s\S]*MATCH CONTINUES/);
  assert.match(game, /target === "resume"[\s\S]*resumeOrClose/);
});
