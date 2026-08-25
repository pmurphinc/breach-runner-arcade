import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settings = readFileSync(new URL("../app/view-settings.ts", import.meta.url), "utf8");
const menu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const difficulty = readFileSync(new URL("../app/difficulty.ts", import.meta.url), "utf8");

test("zoom settings migrate safely and expose four camera scales", () => {
  assert.match(settings, /zoom: "standard"/);
  assert.match(settings, /wide: 0\.85/);
  assert.match(settings, /close: 1\.15/);
  assert.match(settings, /closer: 1\.3/);
  assert.match(settings, /isZoom\(candidate\.zoom\) \? candidate\.zoom : "standard"/);
});

test("settings expose Perspective rather than the old Camera lock toggle", () => {
  assert.match(menu, /label="Perspective"/);
  assert.match(menu, /Follow Ship/);
  assert.match(menu, /Full Arena/);
  assert.doesNotMatch(menu, /label="Camera lock"/);
});

test("camera zoom is shared by rendering and pointer-to-world transforms", () => {
  assert.equal((game.match(/ZOOM_SCALE\[zoomRef\.current\]/g) ?? []).length, 2);
  assert.match(game, /player\.x \* camScale/);
  assert.match(game, /player\.y \* camScale/);
});

test("arena ships are visually larger without changing collision constants", () => {
  assert.equal((game.match(/\* 1\.15/g) ?? []).length, 2);
});

test("difficulty ladder uses Breach Runner themed names", () => {
  for (const label of ["SIMULATION", "STABLE", "VOLATILE", "CRITICAL"]) assert.match(difficulty, new RegExp(label));
});
