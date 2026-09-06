import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [game, globalCss, arenaCss] = await Promise.all([
  readFile(new URL("../app/game.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../app/arena-hud.css", import.meta.url), "utf8"),
]);

test("arena uses an inset, high-contrast DOM perimeter on every input profile", () => {
  assert.match(game, /className="arena-boundary" aria-hidden="true"/);
  assert.doesNotMatch(game, /if \(!viewProfileRef\.current\.touch\)[\s\S]{0,160}strokeRect/);
  assert.match(globalCss, /--arena-frame-inset:\s*clamp\(12px, 1\.5vmin, 20px\)/);
  assert.match(globalCss, /\.arena-boundary\s*\{[\s\S]*inset:\s*var\(--arena-frame-inset\);[\s\S]*border:\s*3px solid rgba\(137, 241, 255, \.94\)/);
  assert.match(globalCss, /\.arena-boundary\s*\{[\s\S]*outline-offset:\s*4px;[\s\S]*0 0 16px rgba\(74, 220, 255, \.38\)/);
  assert.match(globalCss, /\.arena-boundary\s*\{[\s\S]*pointer-events:\s*none/);
  assert.match(game, /ctx\.strokeRect\(0, 0, game\.worldWidth, game\.worldHeight\)/);
});

test("immersive and portrait perimeters begin at their measured playfield top", () => {
  assert.match(globalCss, /\.modern-hud\[data-immersive="true"\] \.arena-boundary\s*\{\s*top:\s*calc\(var\(--arena-playfield-top, 0px\) \+ var\(--arena-frame-inset\)\)/);
  assert.match(arenaCss, /\[data-orientation="portrait"\] \.arena-boundary\s*\{\s*top:\s*calc\(var\(--portrait-arena-top\) \+ var\(--arena-frame-inset\)\)/);
});
