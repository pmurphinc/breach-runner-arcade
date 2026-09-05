import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const ui = readFileSync(new URL("../app/ui-system.tsx", import.meta.url), "utf8");

test("shared menu owns the viewport and the single outer scroll region", () => {
  assert.match(css, /\.menu-screen \{ width: 100%; height: 100%; height: 100dvh; overflow: hidden; \}/);
  assert.match(css, /\.menu-content \{ overflow-x: hidden; scrollbar-gutter: stable; touch-action: pan-y; \}/);
  assert.match(ui, /grid-template-rows: auto minmax\(0, 1fr\) auto/);
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
