import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mineVisualState, MINE_BLINK_PERIOD_MS } from "../app/mine-visual.js";

test("mine blink is bounded, deterministic, and phase-varied", () => {
  const first = mineVisualState(575, 0, true);
  assert.deepEqual(first, mineVisualState(575, 0, true));
  assert.ok(first.blink >= 0.22 && first.blink <= 1);
  assert.notEqual(first.blink, mineVisualState(575, Math.PI / 2, true).blink);
  assert.equal(mineVisualState(0, 0, false).blink, 0.28);
  assert.equal(mineVisualState(Number.NaN, Number.NaN, true).blink, 0.61);
  assert.equal(MINE_BLINK_PERIOD_MS, 1150);
});

test("multiple sea mines use the shared, phase-varied rendering path", () => {
  const art = readFileSync(new URL("../app/weapon-art.ts", import.meta.url), "utf8");
  const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
  assert.match(art, /const mines: GlyphFn = \(ctx, \{ r, t, detail, phase \}\)/);
  assert.match(art, /const spikes = CANONICAL_GLYPH_GEOMETRY\.mineSpikes/);
  assert.match(game, /phase: enemy\.kind === "mines" \? enemy\.phase : undefined/);
});

test("mine visual pass leaves gameplay damage, collision radius, and spawning intact", () => {
  const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
  const data = readFileSync(new URL("../app/game-data.ts", import.meta.url), "utf8");
  assert.match(data, /mines:\s*\{ hp: 5, radius: 15 \}/);
  assert.match(game, /damageCollision\(game, enemy\.kind === "mines" \? 20/);
  assert.match(game, /if \(enemy\.age >= 40\) \{ enemy\.vx = 0; enemy\.vy = 0; enemy\.armed = true; \}/);
  assert.match(game, /makeEnemy\("mines", enemy\.x, enemy\.y, 0, 1\)/);
  assert.match(game, /drawWeaponGlyph\(ctx, enemy\.kind, enemy\.radius, time/);
});
