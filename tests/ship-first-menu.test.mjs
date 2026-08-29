import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const menu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const routes = readFileSync(new URL("../app/menu-routes.ts", import.meta.url), "utf8");

test("launch starts at Ships and confirm enters the hierarchy without Home", () => {
  assert.match(routes, /INITIAL_STACK: MenuStack = \["ships"\]/);
  assert.match(game, /confirmShip[\s\S]*\["ships", "modes"\]/);
  assert.match(game, /<ShipsScreen[\s\S]*onLaunch=\{confirmShip\}/);
});

test("root selection contains only PvP and PvE categories", () => {
  const screen = menu.slice(menu.indexOf("export function GameTypeScreen"), menu.indexOf("export function PvpModesScreen"));
  assert.equal((screen.match(/className="mode-card"/g) ?? []).length, 2);
  assert.match(screen, />PvP</); assert.match(screen, />PvE</);
  for (const forbidden of ["Solo PvE", "PvE Co-op", "Rift Survival", "Rift Run"]) assert.doesNotMatch(screen, new RegExp(forbidden));
});

test("PvP and PvE branches expose only their own modes", () => {
  const pvp = menu.slice(menu.indexOf("export function PvpModesScreen"), menu.indexOf("export function PveModesScreen"));
  assert.match(pvp, />1v1</); assert.doesNotMatch(pvp, /Solo PvE|Co-op|Survival|RIFT_RUN_TITLE/);
  const pve = menu.slice(menu.indexOf("export function PveModesScreen"), menu.indexOf("export function DifficultyScreen"));
  for (const choice of ["Solo PvE", "PvE Co-op", "Rift Survival", "RIFT_RUN_TITLE"]) assert.match(pve, new RegExp(choice));
  assert.doesNotMatch(pve, />PvP</);
});

test("canonical preview animates, honors reduced motion, and cleans up", () => {
  assert.match(menu, /function MenuShipPreview/);
  assert.match(menu, /drawShipModel\(context, ship/);
  assert.match(menu, /requestAnimationFrame\(paint\)/);
  assert.match(menu, /prefers-reduced-motion: reduce/);
  assert.match(menu, /cancelAnimationFrame\(frame\)/);
});

test("selected ship and selected mode are complete semantic buttons with no Change controls", () => {
  assert.match(menu, /<button type="button" className="selected-ship-preview"[\s\S]*onClick=\{onChange\}/);
  assert.match(menu, /className="selected-mode-card"[\s\S]*go\("pve-modes"\)/);
  assert.doesNotMatch(menu.slice(menu.indexOf("function SelectedShipPreview"), menu.indexOf("\/\* -------------------------------------------------------------- settings")), />Change(?: Ship)?</);
});

test("all ships use a compact, non-scrolling responsive grid", () => {
  assert.match(menu, /SHIP_ORDER\.map/);
  assert.match(css, /data-route="ships"\] \.menu-content \{ overflow: hidden/);
  assert.match(css, /grid-template-columns: repeat\(5/);
  assert.match(css, /@container menu \(max-width: 390px\)/);
  assert.match(menu, /footer=\{[\s\S]*Confirm \{profile\.name\}/);
});
