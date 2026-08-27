import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GAMEPAD_BINDINGS, readStandardGamepad } from "../app/gamepad.ts";

const menu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const pad = (axes = [0, 0, 0, 0], pressed = []) => ({ axes, connected: true, mapping: "standard", buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index) })) });

test("Settings always renders controller controls from canonical bindings", () => {
  assert.match(menu, /<MenuSection title="Controls">[\s\S]*Controller Controls/);
  for (const reference of ["axes.move.label", "axes.aim.label", "buttons.firePup.label", "buttons.special.label", "buttons.previousPup.label", "buttons.nextPup.label", "buttons.pause.label", "menuNavigation.label", "buttons.confirm.label", "buttons.cancel.label"]) {
    assert.ok(menu.includes(`GAMEPAD_BINDINGS.${reference}`));
  }
});

test("documented gameplay buttons remain the buttons consumed by the adapter", () => {
  for (const [action, binding] of Object.entries(GAMEPAD_BINDINGS.buttons)) {
    assert.equal(readStandardGamepad(pad(undefined, [...binding.indices]))[action], true, `${action} should use its documented canonical indices`);
  }
  assert.equal(readStandardGamepad(pad([0, 0, 1, 0])).fireMain, true);
});

test("menu navigation, Select, and Back are documented", () => {
  assert.match(menu, /<dt>Navigate<\/dt><dd>\{GAMEPAD_BINDINGS\.menuNavigation\.label\}/);
  assert.match(menu, /<dt>Select<\/dt><dd>\{GAMEPAD_BINDINGS\.buttons\.confirm\.label\}/);
  assert.match(menu, /<dt>Back<\/dt><dd>\{GAMEPAD_BINDINGS\.buttons\.cancel\.label\}/);
});

test("existing keyboard and touch settings remain intact", () => {
  for (const text of ["Mouse & Keys", "Thumbsticks", "Touch control size", "Touch stick height"]) assert.match(menu, new RegExp(text));
});

test("reference stays inside the existing responsive Settings layout", () => {
  assert.match(menu, /<MenuScreen route="settings"[\s\S]*<MenuSection title="Controls">[\s\S]*className="controller-controls"/);
  assert.match(styles, /\.controller-controls \{[^}]*grid-template-columns: repeat\(2/);
  assert.match(styles, /@media \(max-width: 520px\)[^{]*\{[\s\S]*?\.controller-controls \{[^}]*grid-template-columns: 1fr/);
});
