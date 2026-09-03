import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  RAILGUN_FIRE_CUE,
  RAILGUN_IMPACT_CUE,
  RAILGUN_IMPACT_PARTICLES,
  RAILGUN_MUZZLE_PARTICLES,
  RAILGUN_PALETTE,
  RAIL_TRACE_ALPHA,
  RAIL_TRACE_FADE_TICKS,
  RAIL_TRACE_TICKS,
  railTrace,
  railgunSlugGeometry,
} from "../app/rift-run/railgun-fx.ts";
import { RIFT_WEAPON_BY_ID } from "../app/rift-run/weapons.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

test("the rail round is a needle, not a pulse", () => {
  const slug = railgunSlugGeometry(RIFT_WEAPON_BY_ID.railgun.projectileRadius);
  const length = slug.noseLength + slug.bodyLength;
  assert.ok(length / (slug.halfWidth * 2) > 15, "the slug is more than fifteen times longer than it is wide");
  assert.ok(slug.tailLength > slug.bodyLength, "the motion streak reaches past the body");
  assert.ok(slug.coreHalfWidth < slug.halfWidth, "the white-hot core sits inside the sheath");
  assert.ok(slug.noseLength > 0, "the slug has a point, not a flat face");
});

test("an evolved rail round grows into a visibly heavier slug", () => {
  const base = railgunSlugGeometry(RIFT_WEAPON_BY_ID.railgun.projectileRadius);
  // Seismic Rail multiplies projectile scale by 1.7.
  const seismic = railgunSlugGeometry(RIFT_WEAPON_BY_ID.railgun.projectileRadius * 1.7);
  assert.ok(seismic.bodyLength > base.bodyLength, "it gets longer");
  assert.ok(seismic.halfWidth > base.halfWidth, "it gets thicker");
});

test("degenerate radii still produce a drawable slug", () => {
  for (const radius of [0, -5, Number.NaN, Infinity]) {
    const slug = railgunSlugGeometry(radius);
    assert.ok(slug.halfWidth > 0 && slug.bodyLength > 0 && Number.isFinite(slug.bodyLength),
      `radius ${radius} still draws`);
  }
});

test("the ionised channel is reconstructed exactly from velocity and age", () => {
  const life = RIFT_WEAPON_BY_ID.railgun.lifetimeTicks;
  // Fired at (100, 100) travelling +10/tick in x, now four ticks old.
  const trace = railTrace(140, 100, 10, 0, life - 4, life);
  assert.ok(trace);
  assert.equal(trace.fromX, 100, "the channel starts where the round was fired");
  assert.equal(trace.fromY, 100);
});

test("the channel grows to its span, then stops growing", () => {
  const life = RIFT_WEAPON_BY_ID.railgun.lifetimeTicks;
  const young = railTrace(50, 0, 10, 0, life - 5, life);
  const grown = railTrace(300, 0, 10, 0, life - 30, life);
  assert.equal(50 - young.fromX, 50, "at five ticks old the channel is five ticks long");
  assert.equal(300 - grown.fromX, RAIL_TRACE_TICKS * 10, "past the span it holds a fixed length");
});

test("the channel fades out rather than hanging in the arena", () => {
  const life = RIFT_WEAPON_BY_ID.railgun.lifetimeTicks;
  assert.equal(railTrace(0, 0, 22, 0, life, life), null, "nothing to trace on the frame it was fired");
  const early = railTrace(220, 0, 22, 0, life - 10, life);
  const late = railTrace(660, 0, 22, 0, life - 30, life);
  assert.ok(early.alpha > late.alpha, "the channel dims with age");
  assert.ok(early.alpha <= RAIL_TRACE_ALPHA, "it never exceeds its peak");
  assert.equal(railTrace(0, 0, 22, 0, life - RAIL_TRACE_FADE_TICKS, life), null, "it is gone by the fade deadline");
  assert.ok(RAIL_TRACE_FADE_TICKS < RIFT_WEAPON_BY_ID.railgun.lifetimeTicks,
    "the channel is gone well before the round itself expires");
});

test("the railgun owns a hue no other projectile uses", () => {
  // Every other rift projectile draws cyan, amber or orange.
  for (const other of ["#69ecff", "#ffe67b", "#ff9b58", "#ff5b39"]) {
    assert.notEqual(RAILGUN_PALETTE.edge, other);
    assert.notEqual(RAILGUN_PALETTE.plasma, other);
  }
  assert.ok(game.includes("RAILGUN_PALETTE.edge"), "the sheath colour is actually drawn");
  assert.ok(game.includes("RAILGUN_PALETTE.core"), "the white-hot core is actually drawn");
  assert.ok(!game.includes('id === "railgun" ? 15 : 8'), "the old shared shadow branch is gone");
  assert.ok(!game.includes('id === "railgun" ? -24 : -8'), "the old shared rectangle is gone");
});

test("the railgun's cues are its own, and are not the cannon's sample", () => {
  assert.notEqual(RAILGUN_FIRE_CUE.id, RAILGUN_IMPACT_CUE.id);
  assert.notDeepEqual(RAILGUN_FIRE_CUE.frequencies, RAILGUN_IMPACT_CUE.frequencies);
  for (const cue of [RAILGUN_FIRE_CUE, RAILGUN_IMPACT_CUE]) {
    assert.ok(cue.frequencies.length >= 2, `${cue.id} is more than one tone`);
    assert.ok(cue.sweep > 0 && cue.sweep < 1, `${cue.id} bends downward like a discharge`);
    assert.ok(cue.gap < cue.duration / cue.frequencies.length,
      `${cue.id} overlaps its notes into one sound instead of a sequence of beeps`);
    assert.ok(cue.volume > 0 && cue.volume <= 0.3, `${cue.id} is mixed sanely`);
  }
  assert.ok(RAILGUN_FIRE_CUE.duration > RAILGUN_IMPACT_CUE.duration, "the shot is the longer of the two");
});

test("the arena plays the railgun cues instead of routing it to the shared wav", () => {
  assert.ok(game.includes("playCue(RAILGUN_FIRE_CUE"), "firing plays the rail crack");
  assert.ok(game.includes("playCue(RAILGUN_IMPACT_CUE"), "striking plays the rail impact");
  assert.ok(!game.includes('id === "railgun" ? 0.6 :'), "the pitched-down cannon sample is gone");
});

test("the railgun's muzzle flash and impact go through the shared particle budget", () => {
  assert.ok(RAILGUN_MUZZLE_PARTICLES > 0 && RAILGUN_MUZZLE_PARTICLES < 16,
    "the muzzle flash stays under the explosion threshold");
  assert.ok(RAILGUN_IMPACT_PARTICLES > RAILGUN_MUZZLE_PARTICLES, "a hit is heavier than a shot");
  assert.ok(game.includes("burst(game, shot.origin.x, shot.origin.y, RAILGUN_PALETTE.glow, RAILGUN_MUZZLE_PARTICLES, 4)"),
    "the muzzle flash uses burst(), which is what the particle ceiling clamps");
  assert.ok(game.includes("RAILGUN_PALETTE.spark, RAILGUN_IMPACT_PARTICLES, 5"),
    "the impact sparks use burst() too");
});

test("a cue may ask its notes to bend, and the old named cues keep theirs", () => {
  assert.ok(game.includes("(special as { sweep?: number }).sweep"), "the cue player reads the sweep flag");
  assert.ok(game.includes('cueName === "wormhole-explosion" || cueName === "overcharge:core" ? 0.45 : 0'),
    "the two cues that always bent still bend by the same amount");
});
