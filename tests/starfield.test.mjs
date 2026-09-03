import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  NEBULA_ALPHA,
  NEBULA_TINTS,
  PARALLAX_DEPTH,
  STARFIELD_MAX,
  STAR_TINTS,
  VIGNETTE,
  backdropKey,
  createMotes,
  createNebulae,
  createStars,
  moteAt,
  nebulaTints,
  parallaxPoint,
  rgba,
  starfieldBudget,
  twinkleAlpha,
  wrapSpan,
} from "../app/starfield.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const survival = readFileSync(new URL("../app/survival.ts", import.meta.url), "utf8");

test("the arena no longer draws a grid", () => {
  assert.ok(!game.includes('ctx.strokeStyle = "rgba(86, 176, 200, .055)"'), "grid stroke colour is gone");
  assert.ok(!game.includes("One batched path for the whole grid"), "grid batching loop is gone");
  assert.ok(!game.includes("for (let x = 30; x < VIEW_WIDTH; x += 30)"), "vertical grid rules are gone");
  assert.ok(!game.includes("for (let y = 30; y < renderViewHeight; y += 30)"), "horizontal grid rules are gone");
});

test("the arena draws the parallax backdrop against the live camera", () => {
  assert.ok(game.includes("drawBackdrop(paletteKey, time, detail, camX, camY, renderViewHeight)"),
    "the backdrop is drawn with the camera it parallaxes against");
  const drawCall = game.indexOf("drawBackdrop(paletteKey, time, detail, camX, camY, renderViewHeight)");
  const camera = game.indexOf("const camX = followed?.camX");
  assert.ok(camera > 0 && camera < drawCall, "camX exists before the backdrop consumes it");
});

test("the backdrop honours the shared quality scalar and particle ceiling", () => {
  assert.ok(game.includes("starfieldBudget(profile.detail, reducedMotionRef.current, profile.maxParticles)"),
    "the budget is fed profile.detail, the reduced-motion ref and profile.maxParticles");
});

test("budgets scale with the quality scalar and never exceed their ceilings", () => {
  const high = starfieldBudget(1, false, 600);
  const low = starfieldBudget(0.2, false, 240);
  assert.ok(high.far <= STARFIELD_MAX.far && high.mid <= STARFIELD_MAX.mid && high.near <= STARFIELD_MAX.near);
  assert.ok(high.nebulae <= STARFIELD_MAX.nebulae && high.motes <= STARFIELD_MAX.motes);
  assert.ok(low.far < high.far, "a weak device gets fewer far stars");
  assert.ok(low.mid < high.mid, "a weak device gets fewer mid stars");
  assert.equal(low.near, 0, "the most expensive layer is cut entirely on low detail");
  assert.equal(low.motes, 0, "dust is cut entirely on low detail");
  assert.ok(low.nebulae >= 2, "even the cheapest profile keeps some sky");
});

test("a nonsense quality scalar still yields a drawable field", () => {
  for (const value of [Number.NaN, -3, 12, Infinity]) {
    const budget = starfieldBudget(value, false, 600);
    assert.ok(budget.far >= 0 && budget.far <= STARFIELD_MAX.far, `far stays in range for ${value}`);
    assert.ok(budget.motes >= 0 && budget.motes <= STARFIELD_MAX.motes, `motes stay in range for ${value}`);
  }
});

test("motes are budgeted as a slice of the arena particle ceiling, not a free number", () => {
  const generous = starfieldBudget(1, false, 600);
  const frugal = starfieldBudget(1, false, 150);
  assert.ok(frugal.motes < generous.motes, "a tighter particle ceiling means less dust");
  assert.equal(starfieldBudget(1, false, 0).motes, 0, "no particle budget means no dust");
});

test("reduced motion keeps the field but freezes it", () => {
  const quiet = starfieldBudget(1, true, 600);
  assert.equal(quiet.twinkle, false, "stars hold a constant alpha");
  assert.equal(quiet.drift, false, "dust holds position");
  assert.equal(quiet.motes, 0, "no drifting dust is spawned at all");
  assert.ok(quiet.far > 0 && quiet.mid > 0, "the sky itself is not taken away");
});

test("a frozen star keeps exactly its authored alpha", () => {
  const [star] = createStars(1, 900, 600, "near", 7);
  assert.equal(twinkleAlpha(star, 12345, false), star.alpha);
  const lit = twinkleAlpha(star, 12345, true);
  assert.ok(lit > 0 && lit <= star.alpha * 1.001, "twinkle only ever dims a star, never over-brightens it");
});

test("a frozen mote never leaves its authored position", () => {
  const [mote] = createMotes(1, 900, 600, 3);
  const early = moteAt(mote, 0, 900, 600, false);
  const late = moteAt(mote, 900000, 900, 600, false);
  assert.deepEqual(early, late);
  const drifted = moteAt(mote, 900000, 900, 600, true);
  assert.ok(drifted.x !== early.x || drifted.y !== early.y, "drift actually moves a mote");
  assert.ok(drifted.x >= 0 && drifted.x < 900 && drifted.y >= 0 && drifted.y < 600, "drift stays inside the tile");
});

test("star layers are deterministic, bounded by the tile, and capped", () => {
  const first = createStars(40, 800, 500, "mid", 5);
  const second = createStars(40, 800, 500, "mid", 5);
  assert.deepEqual(first, second, "the same seed builds the same sky every session");
  assert.equal(first.length, 40);
  for (const star of first) {
    assert.ok(star.x >= 0 && star.x < 800 && star.y >= 0 && star.y < 500, "stars sit inside the tile");
    assert.ok(star.size > 0 && star.alpha > 0 && star.alpha <= 1, "stars are visible but not opaque plates");
    assert.ok(star.tint >= 0 && star.tint < STAR_TINTS.length, "every tint indexes a real colour");
  }
  assert.equal(createStars(9999, 800, 500, "near", 1).length, STARFIELD_MAX.near, "the cap is a real cap");
  assert.equal(createStars(-4, 800, 500, "far", 1).length, 0, "a negative count is not an error");
});

test("layers get visibly different depth, size and brightness", () => {
  assert.ok(PARALLAX_DEPTH.far < PARALLAX_DEPTH.mid && PARALLAX_DEPTH.mid < PARALLAX_DEPTH.near,
    "nearer layers slide further");
  assert.ok(PARALLAX_DEPTH.near < 0.5, "nothing in the backdrop outruns the world it sits behind");
  const far = createStars(30, 800, 500, "far", 1);
  const near = createStars(30, 800, 500, "near", 1);
  const mean = (stars) => stars.reduce((total, star) => total + star.alpha, 0) / stars.length;
  assert.ok(mean(near) > mean(far), "the near layer is the brighter one");
});

test("parallax wraps rather than running the field off the edge", () => {
  const point = parallaxPoint(10, 10, -4000, -4000, PARALLAX_DEPTH.near, 800, 500);
  assert.ok(point.x >= 0 && point.x < 800, "x wraps into the viewport");
  assert.ok(point.y >= 0 && point.y < 500, "y wraps into the viewport");
  assert.deepEqual(parallaxPoint(10, 20, 0, 0, PARALLAX_DEPTH.mid, 800, 500), { x: 10, y: 20 },
    "a still camera leaves the field where it was authored");
});

test("wrapSpan folds negatives forward and survives a degenerate span", () => {
  assert.equal(wrapSpan(-1, 100), 99);
  assert.equal(wrapSpan(250, 100), 50);
  assert.equal(wrapSpan(0, 100), 0);
  assert.equal(wrapSpan(5, 0), 0);
  assert.equal(wrapSpan(Number.NaN, 100), 0);
});

test("clouds stay faint enough for combat to win the pixel", () => {
  assert.ok(NEBULA_ALPHA <= 0.2, "peak cloud opacity stays under a fifth");
  const clouds = createNebulae(5, 900, 600, 2);
  assert.equal(clouds.length, 5);
  for (const cloud of clouds) {
    assert.ok(cloud.lobes.length >= 3, "a cloud is built from overlapping lobes, not one flat disc");
    for (const lobe of cloud.lobes) {
      assert.ok(NEBULA_ALPHA * lobe.alpha <= NEBULA_ALPHA, "no lobe exceeds the peak");
      assert.ok(lobe.radius > 0);
    }
  }
  assert.equal(createNebulae(99, 900, 600, 2).length, STARFIELD_MAX.nebulae);
});

test("the vignette darkens the edges without touching the middle", () => {
  assert.ok(VIGNETTE.innerRatio > 0 && VIGNETTE.innerRatio < VIGNETTE.outerRatio,
    "there is a clear untouched centre");
  assert.ok(VIGNETTE.alpha > 0 && VIGNETTE.alpha < 1);
  const draw = game.indexOf("ctx.fillStyle = vignetteGradient");
  const world = game.indexOf("ctx.translate(camX + shakeX, camY + shakeY)");
  assert.ok(draw > 0 && world > draw, "the vignette is spent on the backdrop, before the world is drawn");
});

test("every arena and escalation stage has its own cloud colours", () => {
  for (const id of ["practice", "easy", "difficult", "hard", "survival"]) {
    assert.ok(NEBULA_TINTS[id], `difficulty ${id} has cloud colours`);
  }
  for (const match of survival.matchAll(/^\s{2}(\w+): \["#/gm)) {
    assert.ok(NEBULA_TINTS[match[1]], `escalation stage ${match[1]} has cloud colours`);
  }
  assert.deepEqual(nebulaTints("no-such-arena"), NEBULA_TINTS.stable, "an unknown key falls back rather than throwing");
});

test("the backdrop bake is keyed on everything that can invalidate it", () => {
  const base = backdropKey("stable", 5, 130, 1048, 655);
  assert.notEqual(base, backdropKey("collapse", 5, 130, 1048, 655), "a new escalation stage repaints");
  assert.notEqual(base, backdropKey("stable", 3, 130, 1048, 655), "a changed quality setting repaints");
  assert.notEqual(base, backdropKey("stable", 5, 52, 1048, 655), "a changed star budget repaints");
  assert.notEqual(base, backdropKey("stable", 5, 130, 1048, 480), "a resized viewport repaints");
  assert.equal(base, backdropKey("stable", 5, 130, 1048, 655), "nothing else does");
});

test("hex tints convert to canvas colours", () => {
  assert.equal(rgba("#12666e", 0.5), "rgba(18,102,110,0.5)");
  assert.equal(rgba("12666e", 1), "rgba(18,102,110,1)");
  assert.equal(rgba("#fff", 0.25), "rgba(255,255,255,0.25)");
  assert.equal(rgba("#12666e", 4), "rgba(18,102,110,1)", "alpha is clamped");
  assert.equal(rgba("#12666e", -1), "rgba(18,102,110,0)", "alpha is clamped at both ends");
  assert.ok(rgba("nonsense", 0.5).startsWith("rgba(255,255,255"), "a bad colour degrades to white, not to a crash");
});
