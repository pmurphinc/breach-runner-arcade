import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GAMEPAD_BINDINGS, readStandardGamepad } from "../app/gamepad.ts";

const menu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const navigation = readFileSync(new URL("../app/controller-navigation.ts", import.meta.url), "utf8");
const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
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

test("Settings defines five semantic tabs with a single active panel", () => {
  for (const tab of ["Controls", "Audio", "Video", "HUD", "Game Info"]) {
    assert.match(menu, new RegExp(`id: "[^"]+", label: "${tab}"`));
  }
  assert.match(menu, /role="tablist"/);
  assert.match(menu, /role="tab"[\s\S]*aria-selected=\{activeTab === tab\.id\}/);
  assert.match(menu, /role="tabpanel"/);
  assert.match(menu, /const \[activeTab, setActiveTab\] = useState<SettingsTab>\("controls"\)/);
  // Controls now begins with Arcade Identity before the controls themselves.
  // Both sections share the one active panel and are unmounted with it.
  assert.match(menu, /\{activeTab === "controls" \? <>[\s\S]*<MenuSection title="Arcade identity"[\s\S]*<MenuSection title="Controls">[\s\S]*<\/> : null\}/);
  assert.doesNotMatch(menu, /hidden=\{activeTab/);
});

test("tab selection supports pointer, touch, and keyboard activation", () => {
  assert.match(menu, /type="button"[\s\S]*onClick=\{\(\) => setActiveTab\(tab\.id\)\}/);
  assert.match(menu, /event\.key !== "ArrowLeft" && event\.key !== "ArrowRight"/);
  assert.match(menu, /selectAdjacentTab\(tab, event\.key === "ArrowRight" \? 1 : -1\)/);
});

test("controller navigation changes tabs in the shared navigation system", () => {
  assert.match(navigation, /active\?\.getAttribute\("role"\) === "tab"[\s\S]*next\?\.click\(\)/);
  assert.match(game, /const tabShoulder = activeControl\?\.getAttribute\("role"\) === "tab"/);
  assert.match(game, /moveControllerFocus\(controls, tabShoulder, 0\)/);
  assert.match(navigation, /closest\('\[aria-hidden="true"\], \[inert\]'\)/);
});

test("existing settings remain unique and retain their handlers", () => {
  for (const [label, handler] of [
    ["Thumbsticks", "onThumbsticks"], ["Sound", "onSound"],
    ["Cannon Hit Sound", "onCannonHitSound"], ["Perspective", "onCameraLock"],
    ["Zoom", "onZoom"], ["Initials", "onInitials"],
  ]) {
    assert.equal(menu.split(`label="${label}"`).length - 1, label === "Initials" ? 0 : 1, `${label} should not be duplicated`);
    assert.match(menu, new RegExp(handler));
  }
  assert.equal(menu.split('id="menu-player-initials"').length - 1, 1);
});

test("Arcade identity renders only at the top of Controls without changing initials behavior", () => {
  const settingsScreen = menu.slice(menu.indexOf("export function SettingsScreen"), menu.indexOf("export function InfoScreen"));
  const tabs = settingsScreen.indexOf('className="settings-tabs"');
  const identity = settingsScreen.indexOf('title="Arcade identity"');
  const controls = settingsScreen.indexOf('title="Controls"');
  assert.ok(tabs < identity && identity < controls);
  const controlsBranch = settingsScreen.slice(settingsScreen.indexOf('{activeTab === "controls"'), settingsScreen.indexOf('{activeTab === "audio"'));
  assert.match(controlsBranch, /title="Arcade identity"[\s\S]*title="Controls"/);
  for (const tab of ["audio", "video", "hud", "gameInfo"]) {
    const start = settingsScreen.indexOf(`{activeTab === "${tab}"`);
    const next = settingsScreen.indexOf('{activeTab === "', start + 1);
    const branch = settingsScreen.slice(start, next < 0 ? settingsScreen.length : next);
    assert.doesNotMatch(branch, /Arcade identity|menu-player-initials/, `${tab} must not expose Arcade identity`);
  }
  assert.match(settingsScreen, /id="menu-player-initials"[\s\S]*maxLength=\{3\}[\s\S]*onChange=\{\(event\) => onInitials\(event\.target\.value\)\}/);
  assert.match(game, /onInitials=\{\(next\) => setSetting\("playerInitials", normalizeInitials\(next\)\)\}/);
  assert.doesNotMatch(menu, /hidden=\{activeTab[^}]*\}[\s\S]*menu-player-initials/);
});

test("five tabs wrap on narrow settings panels without horizontal scrolling", () => {
  assert.match(styles, /\.settings-tabs \{[\s\S]*grid-template-columns: repeat\(5/);
  assert.match(styles, /@container menu \(max-width: 480px\)[\s\S]*\.settings-tabs \{ grid-template-columns: repeat\(3/);
  assert.doesNotMatch(styles, /\.settings-tabs[^}]*overflow-x:\s*(auto|scroll)/);
});
