import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [game, globalCss, arenaCss] = await Promise.all([
  readFile(new URL("../app/game.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../app/arena-hud.css", import.meta.url), "utf8"),
]);

test("arena uses one continuous DOM perimeter on every input profile", () => {
  assert.match(game, /className="arena-boundary" aria-hidden="true"/);
  assert.doesNotMatch(game, /if \(!viewProfileRef\.current\.touch\)[\s\S]{0,160}strokeRect/);
  assert.match(globalCss, /\.arena-boundary\s*\{[\s\S]*inset:\s*0;[\s\S]*border:\s*2px solid rgba\(101, 232, 255, \.72\)/);
  assert.match(globalCss, /\.arena-boundary\s*\{[\s\S]*pointer-events:\s*none/);
});

test("immersive and portrait perimeters begin at their measured playfield top", () => {
  assert.match(globalCss, /\.modern-hud\[data-immersive="true"\] \.arena-boundary\s*\{\s*top:\s*var\(--arena-playfield-top, 0\)/);
  assert.match(arenaCss, /\[data-orientation="portrait"\] \.arena-boundary\s*\{\s*top:\s*var\(--portrait-arena-top\)/);
});
