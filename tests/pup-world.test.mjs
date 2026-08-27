/**
 * Loose power-ups: how big they are, and where they are allowed to go.
 *
 * A PUP used to have no relationship with the arena at all — it drifted from
 * wherever it was shed and expired wherever that took it, including well
 * outside the playfield. These assertions are what stop that coming back, and
 * they check containment the way it actually fails: not one bounce off one
 * wall, but thousands of ticks of drift with no chance to escape.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PUP_GLYPH_RADIUS,
  PUP_PICKUP_RADIUS,
  PUP_RADIUS,
  PUP_WALL_BOUNCE,
  advancePup,
  pupCollected,
} from "../app/pup-world.ts";

const game = await readFile(new URL("../app/game.tsx", import.meta.url), "utf8");
const hudCss = await readFile(new URL("../app/arena-hud.css", import.meta.url), "utf8");
const inventory = await readFile(new URL("../app/pup-inventory.js", import.meta.url), "utf8");

/** The arena the game loop actually runs. */
const ARENA = { width: 1504, height: 940 };

const pup = (partial) => ({ x: 700, y: 470, vx: 0, vy: 0, ...partial });

test("a PUP is visibly bigger than it was, without dominating the arena", () => {
  // The hexagonal cradle used to be drawn at 19.
  assert.ok(PUP_RADIUS > 19, "the whole point of the change is a bigger badge");
  assert.ok(PUP_RADIUS >= 24, "and bigger by enough to notice on a phone");
  // A Raider Drone's hull is 25 and the arena is 1504 across: a loose power-up
  // has to stay smaller than the things hunting the player, and a handful of
  // them must not be able to wall off a lane.
  assert.ok(PUP_RADIUS <= 34, "a power-up must not read as a hostile hull");
  assert.ok(PUP_RADIUS * 2 < ARENA.height / 8);
});

test("the pickup radius grows with the badge instead of being written twice", () => {
  // The old pair was a 19-unit badge with a flat 25-unit pickup test: six
  // units of grace. The grace is what should have stayed constant.
  assert.equal(PUP_PICKUP_RADIUS, PUP_RADIUS + 6);
  assert.ok(PUP_PICKUP_RADIUS > 25, "collection reach has to follow the art");
  // Touching the badge collects it; a ship's width away from the badge does
  // not turn into a vacuum.
  assert.ok(pupCollected(pup(), { x: 700 + PUP_RADIUS, y: 470 }));
  assert.ok(!pupCollected(pup(), { x: 700 + PUP_PICKUP_RADIUS + 1, y: 470 }));
});

test("the icon keeps its share of a bigger badge", () => {
  assert.ok(PUP_GLYPH_RADIUS > 11, "the glyph was 11 inside a 19-unit cradle");
  const share = PUP_GLYPH_RADIUS / PUP_RADIUS;
  assert.ok(share > 0.45 && share < 0.7, `glyph should stay proportional, got ${share}`);
});

test("a PUP bounces off each of the four walls", () => {
  const cases = [
    { name: "left", start: { x: PUP_RADIUS + 1, y: 470, vx: -3, vy: 0 }, axis: "vx" },
    { name: "right", start: { x: ARENA.width - PUP_RADIUS - 1, y: 470, vx: 3, vy: 0 }, axis: "vx" },
    { name: "top", start: { x: 700, y: PUP_RADIUS + 1, vx: 0, vy: -3 }, axis: "vy" },
    { name: "bottom", start: { x: 700, y: ARENA.height - PUP_RADIUS - 1, vx: 0, vy: 3 }, axis: "vy" },
  ];

  for (const { name, start, axis } of cases) {
    const item = pup(start);
    const before = item[axis];
    const hit = advancePup(item, ARENA);
    assert.equal(hit, true, `${name} wall should report a bounce`);
    assert.ok(item[axis] * before < 0, `${name} wall should reverse the ${axis} sign`);
    assert.ok(Math.abs(item[axis]) < Math.abs(before), `${name} bounce should shed some speed`);
    assert.ok(Math.abs(item[axis]) > Math.abs(before) * 0.5, `${name} bounce must not read as dead`);
  }
});

test("the bounce is measured from the PUP's edge, not its centre point", () => {
  // Aimed so the centre stops short of the wall but the body would be halfway
  // through it. A centre-point test lets this through; the edge test does not.
  const item = pup({ x: ARENA.width - PUP_RADIUS + 4, y: 470, vx: 6, vy: 0 });
  advancePup(item, ARENA);
  assert.ok(item.x + PUP_RADIUS <= ARENA.width, "no part of the badge may leave the arena");
  assert.ok(item.vx < 0, "and it must be heading back inside");
});

test("a corner reflects both axes on the same tick", () => {
  const item = pup({ x: PUP_RADIUS + 1, y: PUP_RADIUS + 1, vx: -4, vy: -4 });
  const hit = advancePup(item, ARENA);
  assert.equal(hit, true);
  assert.ok(item.vx > 0 && item.vy > 0, "both axes must turn around, not just the first");
  assert.ok(item.x >= PUP_RADIUS && item.y >= PUP_RADIUS);
});

test("no drift escapes the arena over a long run", () => {
  // Every heading, at speeds well past anything the game sheds a PUP with,
  // simulated for far longer than a PUP's 900-tick life.
  for (let degrees = 0; degrees < 360; degrees += 7) {
    const radians = (degrees * Math.PI) / 180;
    for (const speed of [0.4, 3, 9]) {
      const item = pup({
        x: 700,
        y: 470,
        vx: Math.cos(radians) * speed,
        vy: Math.sin(radians) * speed,
      });
      for (let tick = 0; tick < 1200; tick += 1) {
        advancePup(item, ARENA);
        assert.ok(
          item.x >= PUP_RADIUS && item.x <= ARENA.width - PUP_RADIUS
          && item.y >= PUP_RADIUS && item.y <= ARENA.height - PUP_RADIUS,
          `escaped at ${degrees}° speed ${speed}: ${item.x}, ${item.y}`,
        );
        assert.ok(Number.isFinite(item.vx) && Number.isFinite(item.vy));
      }
    }
  }
});

test("a PUP pinned against a wall settles instead of jittering", () => {
  const item = pup({ x: PUP_RADIUS, y: 470, vx: -0.03, vy: 0 });
  for (let tick = 0; tick < 40; tick += 1) advancePup(item, ARENA);
  assert.equal(item.vx, 0, "a bounce below the stop threshold parks the axis");
  assert.ok(item.x >= PUP_RADIUS);
});

test("the float the PUP always had is preserved", () => {
  assert.ok(PUP_WALL_BOUNCE > 0.6 && PUP_WALL_BOUNCE < 1, "arcade bounce: lively, not perfectly elastic");
  const item = pup({ vx: 2, vy: -1 });
  advancePup(item, ARENA);
  // Drift still decays gently, and nothing about mid-arena motion changed.
  assert.ok(item.vx < 2 && item.vx > 1.98);
  assert.equal(item.x, 702);
});

test("an arena narrower than a PUP parks it rather than producing nonsense", () => {
  const item = pup({ x: 5, y: 5, vx: 4, vy: 4 });
  advancePup(item, { width: 10, height: 10 });
  assert.ok(Number.isFinite(item.x) && Number.isFinite(item.y));
});

test("the game loop moves PUPs through this module rather than inline", () => {
  // The regression this guards is a second copy of the motion: an inline
  // `pickup.x += pickup.vx` in the loop would drift out of the arena again
  // however correct this module is.
  assert.match(game, /advancePup\(pickup, \{ width: game\.worldWidth, height: game\.worldHeight \}\)/);
  assert.match(game, /pupCollected\(pickup, player\)/);
  assert.doesNotMatch(game, /pickup\.x \+= pickup\.vx/);
  assert.doesNotMatch(game, /dist\(pickup, player\) < 25/);
  // The badge and the glyph are drawn from the shared constants, so the thing
  // the player aims at is the thing the collision test uses.
  assert.match(game, /Math\.cos\(a\) \* PUP_RADIUS/);
  assert.match(game, /drawWeaponGlyph\(ctx, pickup\.type, PUP_GLYPH_RADIUS/);
});

test("the HUD inventory icons are untouched by the arena badge", () => {
  // PUP 2.0 owns the inventory redesign; this pass is the world badge only.
  // The arena constants must not have leaked into the HUD's own sizing.
  assert.ok(!hudCss.includes("PUP_RADIUS"));
  assert.ok(!inventory.includes("PUP_RADIUS"));
});
