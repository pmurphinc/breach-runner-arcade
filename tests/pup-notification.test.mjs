/**
 * One notification for one event, attached to the PUP inventory.
 *
 * The arena used to announce a wave twice: a thin `▸INCOMING // RAIDERS` bar
 * hanging off the inventory, and a second, larger `RAIDERS ×3` plate painted
 * on the canvas in the middle of the arena. These lock in the consolidation —
 * the canvas plate's presentation, rendered once, as a child of the inventory
 * panel so it shares that panel's coordinate system.
 *
 * Source-level rather than browser-level on purpose: the geometry assertions
 * live in `preflight.test.mjs`, which needs a dev server and skips without
 * one. These run on a bare checkout, which is where a regression would
 * otherwise slip back in unnoticed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const arenaHud = readFileSync(new URL("../app/arena-hud.css", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/** The markup between the inventory panel's opening tag and its closing tag. */
function inventoryMarkup() {
  const start = game.indexOf('className="touch-powerup-hud"');
  assert.notEqual(start, -1, "the PUP inventory panel must still exist");
  const end = game.indexOf('<div className="pilot-health">', start);
  assert.notEqual(end, -1, "the pilot health block should follow the inventory");
  return game.slice(start, end);
}

test("the thin INCOMING bar is gone from markup and styling", () => {
  assert.doesNotMatch(game, /pup-notification/, "the thin notification bar must not be rendered");
  assert.doesNotMatch(arenaHud, /pup-notification/, "its styling must not survive the markup");
  assert.doesNotMatch(globals, /pup-notification/);
});

test("the spawn notice is a child of the PUP inventory panel", () => {
  const inventory = inventoryMarkup();
  assert.match(inventory, /className="pup-notice-stack"/,
    "the notice stack must be mounted inside the inventory, not beside it");
  assert.match(inventory, /hud\.spawnNotices\.map/);
});

test("the notice keeps the RAIDERS ×3 presentation", () => {
  const inventory = inventoryMarkup();
  // Short name, an ×count only when more than one arrived, then the threat badge.
  assert.match(inventory, /\$\{meta\.short\}\$\{plate\.count > 1 \? ` ×\$\{plate\.count\}` : ""\}\s+\$\{threatBadge\(meta\)\}/);
  assert.match(inventory, /<WeaponIcon id=\{plate\.type\} size=\{18\}/, "the glyph stays part of the plate");
  assert.match(inventory, /plate\.kind === "hostile" \? "#ff6a80"/, "the hostile accent colour is unchanged");
});

test("one event renders exactly one notification", () => {
  // The canvas half of the pair is gone: no second plate, drawn or measured.
  assert.doesNotMatch(game, /Spawn nameplates/);
  assert.doesNotMatch(game, /plateX|plateY|plateW|plateH/);
  assert.doesNotMatch(game, /hudInsetRef/, "the canvas inset only existed to keep the plate clear of the inventory");
  // `MAX_NAMEPLATES` now bounds the HUD list instead of a canvas loop.
  assert.match(game, /spawnNotices: game\.spawns\.slice\(-MAX_NAMEPLATES\)/);
});

test("the notice is positioned from the inventory rather than the viewport", () => {
  const start = arenaHud.indexOf(".pup-notice-stack {");
  assert.notEqual(start, -1, "the notice stack must be styled");
  const rule = arenaHud.slice(start, arenaHud.indexOf("}", start));
  assert.match(rule, /position: absolute/);
  // `top: 100%` of the inventory is the anchor; a small margin is the gap.
  assert.match(rule, /top: 100%/);
  assert.match(rule, /margin-top: \d+px/);
  assert.doesNotMatch(rule, /vh|vw|env\(safe-area/,
    "the notice must inherit the inventory's placement, not carry viewport offsets");
});

test("plate identity is stable so the HUD only re-renders on a real change", () => {
  assert.match(game, /type SpawnNotice = \{ id: number;/);
  assert.match(game, /a\.spawnNotices\.every\(\(plate, index\) => plate\.id === b\.spawnNotices\[index\]\.id\)/);
});

test("temporary notice content is excluded from arena resize observation", () => {
  const observerStart = game.indexOf("const observer = new ResizeObserver(measure)");
  const observerEnd = game.indexOf("return () => observer.disconnect()", observerStart);
  const observedGeometry = game.slice(observerStart, observerEnd);
  assert.doesNotMatch(observedGeometry, /pup-notice-stack/);
  assert.match(observedGeometry, /touch-powerup-hud/,
    "the permanent inventory remains part of the stable HUD measurement");
});
