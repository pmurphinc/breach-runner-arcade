import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { DEFAULT_SETTINGS, migrateSettings } from "../app/view-settings.ts";
import { PUP_INVENTORY_CAPACITY } from "../app/pup-inventory.js";

const game = await readFile(new URL("../app/game.tsx", import.meta.url), "utf8");
const hudCss = await readFile(new URL("../app/arena-hud.css", import.meta.url), "utf8");
const menu = await readFile(new URL("../app/main-menu.tsx", import.meta.url), "utf8");

test("compact HUD is an opt-in device setting that survives a bad payload", () => {
  assert.equal(DEFAULT_SETTINGS.compactHud, false, "the wide rails stay the default");
  assert.equal(migrateSettings({}).compactHud, false);
  assert.equal(migrateSettings({ compactHud: true }).compactHud, true);
  assert.equal(migrateSettings({ compactHud: "yes" }).compactHud, false, "non-boolean must fall back");
  assert.equal(migrateSettings(null).compactHud, false);
});

test("the toggle lives in the HUD settings tab", () => {
  const hudTab = menu.slice(menu.indexOf('activeTab === "hud"'), menu.indexOf('activeTab === "gameInfo"'));
  assert.match(hudTab, /label="Compact HUD"/);
  assert.match(hudTab, /value=\{compactHud\}/);
  assert.match(hudTab, /onChange=\{onCompactHud\}/);
  assert.match(game, /compactHud=\{settings\.compactHud\}/);
  assert.match(game, /onCompactHud=\{\(next\) => setSetting\("compactHud", next\)\}/);
});

test("compact mode replaces the wide rails rather than stacking on them", () => {
  assert.match(game, /viewProfile\.modernHud && !settings\.compactHud \? <div className="health-rails"/);
  assert.match(game, /\{settings\.compactHud \? \(\(\) => \{/);
  // The horizontal strip is hidden in compact mode, but its spawn notices are not.
  assert.match(game, /data-compact=\{settings\.compactHud \? "on" : "off"\}/);
  assert.match(hudCss, /\.touch-powerup-hud\[data-compact="on"\] > \.touch-powerup-slots/);
  assert.match(hudCss, /\.touch-powerup-hud\[data-compact="on"\] > \.touch-powerup-loaded/);
  assert.doesNotMatch(hudCss, /\.touch-powerup-hud\[data-compact="on"\] > \.pup-notice-stack/);
});

test("the compact HUD is available in every mode, not gated on one", () => {
  const block = game.slice(game.indexOf("{settings.compactHud ? (() => {"), game.indexOf('className="touch-powerup-hud"'));
  for (const gate of ["mode ===", "mode !==", 'riftRun', "difficulty ==="]) {
    assert.ok(!block.includes(gate), `compact HUD must not branch on ${gate}`);
  }
});

test("the payload frame draws one cell per slot the run has earned", () => {
  // Not one per slot of the shared ceiling. A Rift Run opens on a single slot,
  // and drawing five with four shut showed the pilot four things they could not
  // use; the frame grows instead as capacity is bought.
  assert.ok(game.includes("const capacity = Math.max(1, hud.payloadCapacity)"));
  assert.ok(game.includes("\"--compact-slots\": capacity"));
  assert.ok(game.includes("pupInventoryLayout(hud.stock, capacity)"));
  assert.ok(hudCss.includes("grid-template-rows: repeat(var(--compact-slots, 5), var(--compact-cell))"));
  // Five remains the ceiling every other mode opens at.
  assert.equal(PUP_INVENTORY_CAPACITY, 5);
});

test("the loaded payload is distinguishable from stored ones", () => {
  const block = game.slice(game.indexOf("{settings.compactHud ? (() => {"), game.indexOf('className="touch-powerup-hud"'));
  assert.match(block, /const slots = \[\.\.\.compact\.stored, compact\.loaded\]/, "loaded sits last, nearest the ship");
  assert.match(block, /const isLoaded = index === slots\.length - 1/);
  assert.match(block, /isLoaded \? ", fires next" : ""/, "screen readers need the firing order too");
  assert.match(hudCss, /\.compact-pup\.loaded \{/);
});

test("hull and shield read as separate vertical gauges beside the ship", () => {
  assert.match(game, /className="compact-gauge compact-hull"/);
  assert.match(game, /className="compact-gauge compact-shield"/);
  assert.match(game, /height: `\$\{healthPct\}%`/);
  assert.match(game, /height: `\$\{hud\.shield\}%`/);
  // Offset from the arena centre so neither gauge touches the ship model.
  assert.match(hudCss, /--compact-offset:/);
  assert.match(hudCss, /\.compact-gauges \{[^}]*transform: translate\(calc\(-100% - var\(--compact-offset\)\), -50%\)/s);
  assert.match(hudCss, /\.compact-pups \{[^}]*transform: translate\(var\(--compact-offset\), -50%\)/s);
});

test("the compact overlay never eats pointer input meant for the arena", () => {
  assert.match(hudCss, /\.compact-hud \{[^}]*pointer-events: none/s);
});

test("the compact gauges stay legible in forced-colors mode", () => {
  const forced = hudCss.slice(hudCss.lastIndexOf("@media (forced-colors: active)"));
  assert.match(forced, /\.compact-gauge \{ border-color: CanvasText/);
  assert.match(forced, /\.compact-pups \{ border-color: CanvasText/);
});
