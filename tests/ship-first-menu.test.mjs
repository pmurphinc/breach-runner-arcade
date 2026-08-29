import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const menu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");

test("play flow is Ship then Modes while the chosen ship preference is retained", () => {
  assert.match(game, /beginPlayFlow[\s\S]*resetRoute\("ships"\)/);
  assert.match(game, /confirmShip[\s\S]*resetRoute\("modes"\)/);
  assert.match(game, /<HomeScreen[\s\S]*onLaunch=\{beginPlayFlow\}/);
  assert.match(game, /<ShipsScreen[\s\S]*onLaunch=\{confirmShip\}/);
  assert.doesNotMatch(game, /chooseMode[\s\S]{0,300}setShipId/);
});

test("Home and Modes share the canonical selected PNG ship preview and change action", () => {
  assert.match(menu, /function SelectedShipPreview/);
  assert.match(menu, /renderShip\(ship, 104\)/);
  assert.match(menu, /Change Ship/);
  assert.equal((menu.match(/<SelectedShipPreview/g) ?? []).length, 2);
});

test("difficulty ladder precedes challenges and is hidden for PvP and Survival", () => {
  assert.ok(menu.indexOf('title="PvE Difficulty"') < menu.indexOf('title="Challenges"'));
  assert.match(menu, /mode === "pvp" \|\| survival \? null/);
  assert.match(menu, /disabled=\{!unlocked\}/);
  assert.match(menu, /Complete \$\{prerequisite\} to unlock/);
});
