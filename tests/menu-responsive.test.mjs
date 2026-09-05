import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const ui = readFileSync(new URL("../app/ui-system.tsx", import.meta.url), "utf8");
const mainMenu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");

test("shared menu owns the viewport and the single outer scroll region", () => {
  assert.match(css, /\.menu-screen \{ width: 100%; height: 100%; height: 100dvh; overflow: hidden; \}/);
  assert.match(css, /\.menu-content \{ overflow-x: hidden; scrollbar-gutter: stable; touch-action: pan-y; \}/);
  assert.match(ui, /grid-template-rows: auto minmax\(0, 1fr\) auto/);
});

test("home utility navigation occupies the panel footer outside the scroll region", () => {
  const home = mainMenu.slice(mainMenu.indexOf("export function HomeScreen"), mainMenu.indexOf("/* ----------------------------------------------------------------- modes -- */"));
  assert.match(home, /footer=\{[\s\S]*?<nav className="home-command-deck"/);
  assert.doesNotMatch(home, /<div className="main-menu-stage">[\s\S]*?<nav className="home-command-deck"/);
  assert.match(css, /\.menu-screen\[data-route="home"\] \.menu-footer \{[\s\S]*?padding:/);
});

test("launch deck is a bounded no-scroll composition with every primary control", () => {
  const home = mainMenu.slice(mainMenu.indexOf("export function HomeScreen"), mainMenu.indexOf("/* ----------------------------------------------------------------- modes -- */"));

  // Assert the rendered composition, not merely the presence of an overflow
  // declaration: Home fills the panel's remaining row, its stage consumes that
  // definite height, and its functional controls all remain in normal flow.
  assert.match(css, /\.menu-screen\[data-route="home"\] \.menu-panel \{ height: 100%; \}/);
  assert.match(css, /\.menu-screen\[data-route="home"\] \.main-menu-stage \{[\s\S]*?height: 100%;[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(css, /Launch Deck no-scroll contract[\s\S]*?\.menu-screen\[data-route="home"\] \.menu-content \{[\s\S]*?overflow: hidden;/);
  assert.match(css, /\.menu-screen\[data-route="home"\] \.home-command-deck \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(home, /aria-label="Open settings"|onOpenSettings=\{openSettings\}/);
  assert.match(home, /className="launch-command"/);
  for (const label of ["Ships", "Leaderboard", "Game Info"]) assert.match(home, new RegExp(`label="${label}"`));
});

test("launch branding and spacing spend viewport height progressively", () => {
  assert.match(css, /\.menu-screen\[data-route="home"\] \.main-menu-brand-lockup \.launch-brand-logo \{\s*width: clamp\(120px, min\(42cqw, 48dvh\), 510px\)/);
  assert.match(css, /@media \(max-height: 620px\)[\s\S]*?width: clamp\(100px, min\(28cqw, 34dvh\), 320px\)/);
  assert.match(css, /@media \(orientation: landscape\) and \(max-height: 560px\)[\s\S]*?width: clamp\(76px, min\(22cqw, 22dvh\), 230px\)/);
  assert.match(css, /@media \(max-height: 620px\)[\s\S]*?\.launch-console \{ gap: var\(--space-2\); padding: var\(--space-2\) var\(--space-3\); \}/);
  assert.match(css, /Launch Deck no-scroll contract[\s\S]*?@media \(orientation: landscape\) and \(max-height: 560px\)[\s\S]*?\.launch-command \{ min-height: var\(--touch-target\); \}/);
});

test("menu layout responds independently to narrow and short viewports", () => {
  assert.match(css, /@container menu \(max-width: 720px\)[\s\S]*?\.settings-console \{ height: 100%; grid-template-rows: auto minmax\(0, 1fr\)/);
  assert.match(css, /@media \(orientation: landscape\) and \(max-height: 560px\)[\s\S]*?\.mode-card-matrix \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /@container menu \(max-height:/);
  assert.doesNotMatch(css, /@container menu[^}]*\.menu-screen/s);
});

test("menu and shared dialogs reserve all safe-area insets", () => {
  for (const side of ["top", "right", "bottom", "left"]) {
    assert.match(css, new RegExp(`padding-${side}: max\\(var\\(--space-2\\), var\\(--safe-${side}\\)\\)`));
  }
  assert.match(css, /\.codex, \.multiplayer-lobby-panel \{ max-width: 100%; max-height: 100%; \}/);
  assert.match(css, /\.result-command-panel \{ max-height: 100%; overflow-y: auto;/);
});
