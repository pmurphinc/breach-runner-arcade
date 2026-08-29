import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const menu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
const models = readFileSync(new URL("../app/ship-models.ts", import.meta.url), "utf8");
const shipData = readFileSync(new URL("../app/ship-data.ts", import.meta.url), "utf8");
const gameData = readFileSync(new URL("../app/game-data.ts", import.meta.url), "utf8");
const shared = menu.slice(menu.indexOf("export function GameInfoContent"), menu.indexOf("export type MenuCallbacks"));
const pupPreview = menu.slice(menu.indexOf("export function MenuPupPreview"), menu.indexOf("export function GameInfoContent"));
const shipPreview = menu.slice(menu.indexOf("export function MenuShipPreview"), menu.indexOf("function SelectedShipPreview"));

test("every canonical PUP receives the shared gameplay glyph preview and keeps its text", () => {
  assert.match(shared, /Object\.values\(WEAPONS\)\.map/);
  assert.match(shared, /<MenuPupPreview pup=\{pup\.id\}/);
  assert.match(pupPreview, /drawWeaponGlyph\(context, pup,/);
  assert.match(shared, /pup\.name/);
  assert.match(shared, /pup\.summary/);
  assert.match(shared, /pup\.role/);
});

test("Game Info renders the complete fleet through the canonical ship preview", () => {
  assert.match(shipData, /SHIP_ORDER: ShipId\[\] = SHIPS\.map\(\(spec\) => spec\.id\)/);
  assert.match(gameData, /id: "kestrel"/);
  assert.match(gameData, /id: "warden"/);
  assert.match(shared, /SHIP_ORDER\.map/);
  assert.match(shared, /<MenuShipPreview ship=\{id\}/);
  assert.match(shipPreview, /drawShipModel\(context, ship,/);
  assert.match(models, /export const SHIP_MODEL_ASSETS/);
  assert.equal((models.match(/export const SHIP_MODEL_ASSETS/g) ?? []).length, 1);
  assert.match(shared, /ship\.special\.description/);
});

test("card previews avoid multiplying animation loops and reduced motion stays static", () => {
  assert.match(shared, /animated=\{false\}/);
  assert.match(shipPreview, /!animated \|\| window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  assert.doesNotMatch(pupPreview, /requestAnimationFrame/);
});
