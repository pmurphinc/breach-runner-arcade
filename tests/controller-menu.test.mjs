import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONTROLLER_FOCUSABLE, controllerCancelTarget, isControllerControlVisible, moveControllerFocus } from "../app/controller-navigation.ts";
import { GAMEPAD_BINDINGS, pressedOnce } from "../app/gamepad.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const ui = readFileSync(new URL("../app/ui-system.tsx", import.meta.url), "utf8");
const navigation = readFileSync(new URL("../app/controller-navigation.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function radioNavigationHarness(values, selectedValue) {
  const originalDocument = globalThis.document;
  const originalSelect = globalThis.HTMLSelectElement;
  let selected = selectedValue;
  let activations = 0;
  const group = { querySelectorAll: () => radios };
  const radios = values.map((value) => ({
    offsetParent: {},
    getAttribute: (name) => name === "role" ? "radio" : null,
    closest: (selector) => selector === '[role="radiogroup"]' ? group : null,
    matches: () => false,
    focus() { globalThis.document.activeElement = this; },
    click() { activations += 1; selected = value; },
    setAttribute() {},
    removeAttribute() {},
  }));
  globalThis.HTMLSelectElement = class {};
  globalThis.document = {
    activeElement: radios[values.indexOf(selectedValue)],
    querySelectorAll: () => radios,
  };
  return {
    radios,
    activations: () => activations,
    selected: () => selected,
    restore() {
      globalThis.document = originalDocument;
      globalThis.HTMLSelectElement = originalSelect;
    },
  };
}

test("one controller surface query covers complete interactive dialogs", () => {
  for (const control of ["button", "input", "select", "a[href]"]) assert.ok(CONTROLLER_FOCUSABLE.includes(control));
  assert.match(ui, /className="menu-panel"[\s\S]*data-controller-surface/);
  assert.match(game, /className="codex board"[\s\S]*data-controller-surface/);
  assert.match(game, /className="codex lobby"[\s\S]*data-controller-surface/);
  assert.match(game, /className="run-summary" data-controller-surface/);
});

test("multiplayer controls and controller select changes are reachable", () => {
  for (const label of ["QUICK MATCH", "CREATE PRIVATE MATCH", "JOIN WITH CODE", "READY UP", "READY ✓", "LEAVE MATCH", "BACK"]) assert.match(game, new RegExp(label));
  assert.match(game, /<select[\s\S]*onChange=\{\(event\) => onShip\(event\.target\.value\)\}/);
  assert.match(game, /aria-label="Previous ship"/);
  assert.match(game, /aria-label="Next ship"/);
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
  assert.deepEqual(GAMEPAD_BINDINGS.buttons.cancel.indices, [1]);
  assert.equal(pressedOnce(true, false), true);
  assert.equal(pressedOnce(true, true), false);
  assert.match(game, /pressedOnce\(action\.cancel, previous\.cancel\)/);
  assert.match(game, /\}, \[controllerCancel, toggleMenu\]\);/);
});

test("D-pad and left stick both feed the existing shared menu navigator", () => {
  assert.match(game, /menuX = action\.menuX \|\| action\.moveX/);
  assert.match(game, /menuY = action\.menuY \|\| action\.moveY/);
  assert.match(game, /moveControllerFocus\(controls, horizontal, vertical\)/);
  assert.match(navigation, /current \+ Math\.sign\(direction\) \+ controls\.length/);
});

test("D-pad or stick horizontal input highlights a game mode without selecting it", () => {
  const harness = radioNavigationHarness(["pve", "coop", "pvp"], "pve");
  try {
    const highlighted = moveControllerFocus(harness.radios, 1, 0);
    assert.equal(highlighted, harness.radios[1]);
    assert.equal(globalThis.document.activeElement, harness.radios[1]);
    assert.equal(harness.selected(), "pve");
    assert.equal(harness.activations(), 0);

    const highlightedAgain = moveControllerFocus(harness.radios, -1, 0);
    assert.equal(highlightedAgain, harness.radios[0]);
    assert.equal(harness.selected(), "pve");
    assert.equal(harness.activations(), 0);
  } finally {
    harness.restore();
  }
});

test("A or Cross confirms the highlighted game mode", () => {
  const harness = radioNavigationHarness(["pve", "coop", "pvp"], "pve");
  try {
    moveControllerFocus(harness.radios, 1, 0);
    assert.deepEqual(GAMEPAD_BINDINGS.buttons.confirm.indices, [0]);
    globalThis.document.activeElement.click();
    assert.equal(harness.selected(), "coop");
    assert.equal(harness.activations(), 1);
    assert.match(game, /pressedOnce\(action\.confirm, previous\.confirm\)[^\n]*document\.activeElement[^\n]*\.click/);
  } finally {
    harness.restore();
  }
});

test("difficulty cards highlight first and select only after confirmation", () => {
  const harness = radioNavigationHarness(["practice", "easy", "difficult", "hard"], "easy");
  try {
    moveControllerFocus(harness.radios, 1, 0);
    assert.equal(globalThis.document.activeElement, harness.radios[2]);
    assert.equal(harness.selected(), "easy");
    assert.equal(harness.activations(), 0);
    globalThis.document.activeElement.click();
    assert.equal(harness.selected(), "difficult");
    assert.equal(harness.activations(), 1);
  } finally {
    harness.restore();
  }
});

test("mouse or touch clicking a radio card still selects it", () => {
  const harness = radioNavigationHarness(["pve", "coop"], "pve");
  try {
    harness.radios[1].click();
    assert.equal(harness.selected(), "coop");
  } finally {
    harness.restore();
  }
});

test("B or Circle cancels without activating the focused radio card", () => {
  const harness = radioNavigationHarness(["pve", "coop", "pvp"], "pve");
  try {
    moveControllerFocus(harness.radios, 1, 0);
    assert.deepEqual(GAMEPAD_BINDINGS.buttons.cancel.indices, [1]);
    assert.equal(controllerCancelTarget({ codex: false, summary: false, route: "modes" }), "back");
    assert.match(game, /pressedOnce\(action\.cancel, previous\.cancel\)\) controllerCancel\(\)/);
    assert.equal(harness.selected(), "pve");
    assert.equal(harness.activations(), 0);
  } finally {
    harness.restore();
  }
});

test("hidden and disabled controls are skipped", () => {
  const control = (overrides = {}) => ({
    offsetParent: {}, tabIndex: 0,
    matches: () => false, closest: () => null, ...overrides,
  });
  assert.equal(isControllerControlVisible(control()), true);
  assert.equal(isControllerControlVisible(control({ offsetParent: null })), false);
  assert.equal(isControllerControlVisible(control({ matches: () => true })), false);
  assert.equal(isControllerControlVisible(control({ closest: () => ({}) })), false);
});

test("controller focus has one shared, reduced-motion-safe visual state", () => {
  assert.match(navigation, /clearControllerFocus\(root\)/);
  assert.match(navigation, /setAttribute\(CONTROLLER_FOCUS_ATTRIBUTE, "true"\)/);
  assert.match(game, /pointerdown[\s\S]*pointermove[\s\S]*leaveControllerMode/);
  assert.match(css, /\[data-controller-focused="true"\][\s\S]*outline: 4px[\s\S]*controller-focus-pulse/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*data-controller-focused/);
});

test("controller focus treatment is paint-only and leaves touch geometry unchanged", () => {
  const rule = css.slice(css.indexOf('[data-controller-focused="true"]'), css.indexOf('@media (prefers-reduced-motion', css.indexOf('[data-controller-focused="true"]')));
  assert.doesNotMatch(rule, /(?:width|height|padding|margin|transform)\s*:/);
  assert.match(rule, /outline:/);
  assert.match(rule, /box-shadow:/);
});

test("Settings uses Pause as the live-run origin without pausing network simulation", () => {
  assert.match(game, /setPaused\(true\);\s*setMenu\(\["pause", "settings"\]\)/);
  assert.match(game, /if \(game\.mode !== "pve"\)[\s\S]*MATCH CONTINUES/);
  assert.match(game, /target === "resume"[\s\S]*resumeOrClose/);
});
