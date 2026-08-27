/**
 * Off-screen awareness indicators: the Rift and the co-op ally.
 *
 * The maths lives in one helper both targets share, so most of this exercises
 * that helper directly. The rest reads game.tsx to prove the wiring — that both
 * markers go through the shared helper, that the ally marker is co-op only, and
 * that none of this touches the network.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OFFSCREEN_INDICATOR_INSET,
  OFFSCREEN_VISIBLE_BODY,
  cameraBoundsCenter,
  isTargetOffscreen,
  offscreenIndicatorFor,
} from "../app/offscreen-indicators.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const helper = readFileSync(new URL("../app/offscreen-indicators.ts", import.meta.url), "utf8");

/** Prose in a doc comment is not behaviour, so assertions read code only. */
const codeOnly = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const renderBlock = () => {
  const anchor = game.indexOf("Off-screen awareness");
  assert.ok(anchor > 0, "expected the off-screen indicator render block");
  return codeOnly(game.slice(game.lastIndexOf("/**", anchor), game.indexOf("return { camScale, camX, camY }")));
};

/** A camera showing 1000 × 600 of world, centred on (500, 300). */
const BOUNDS = { left: 0, top: 0, right: 1000, bottom: 600 };
const RIFT_RADIUS = 55;
const ALLY_RADIUS = 34;
const inset = OFFSCREEN_INDICATOR_INSET;
const DEG = 180 / Math.PI;
const degrees = (radians) => Math.round(radians * DEG);

test("a Rift inside the camera produces no marker", () => {
  assert.equal(offscreenIndicatorFor({ x: 500, y: 300, radius: RIFT_RADIUS }, BOUNDS, inset), null);
  assert.equal(isTargetOffscreen({ x: 500, y: 300, radius: RIFT_RADIUS }, BOUNDS), false);
  // Comfortably inside the border still counts as visible.
  assert.equal(offscreenIndicatorFor({ x: 60, y: 560, radius: RIFT_RADIUS }, BOUNDS, inset), null);
});

test("a Rift past the left edge gets a left-edge marker pointing left", () => {
  const marker = offscreenIndicatorFor({ x: -220, y: 300, radius: RIFT_RADIUS }, BOUNDS, inset);
  assert.ok(marker);
  assert.equal(marker.x, BOUNDS.left + inset);
  assert.equal(marker.y, 300);
  assert.equal(degrees(marker.angle), 180);
});

test("a Rift past the right edge gets a right-edge marker pointing right", () => {
  const marker = offscreenIndicatorFor({ x: 1400, y: 300, radius: RIFT_RADIUS }, BOUNDS, inset);
  assert.ok(marker);
  assert.equal(marker.x, BOUNDS.right - inset);
  assert.equal(marker.y, 300);
  assert.equal(degrees(marker.angle), 0);
});

test("a Rift above or below gets a top or bottom marker pointing that way", () => {
  const above = offscreenIndicatorFor({ x: 500, y: -180, radius: RIFT_RADIUS }, BOUNDS, inset);
  assert.ok(above);
  assert.equal(above.y, BOUNDS.top + inset);
  assert.equal(above.x, 500);
  assert.equal(degrees(above.angle), -90); // canvas Y grows downward

  const below = offscreenIndicatorFor({ x: 500, y: 900, radius: RIFT_RADIUS }, BOUNDS, inset);
  assert.ok(below);
  assert.equal(below.y, BOUNDS.bottom - inset);
  assert.equal(below.x, 500);
  assert.equal(degrees(below.angle), 90);
});

test("a diagonal target points diagonally rather than snapping to an axis", () => {
  const marker = offscreenIndicatorFor({ x: -300, y: -200, radius: RIFT_RADIUS }, BOUNDS, inset);
  assert.ok(marker);
  assert.equal(marker.x, BOUNDS.left + inset);
  assert.equal(marker.y, BOUNDS.top + inset);
  // Both components carry real weight, so the chevron reads as up-and-left.
  assert.ok(Math.abs(Math.cos(marker.angle)) > 0.2);
  assert.ok(Math.abs(Math.sin(marker.angle)) > 0.2);
  assert.equal(degrees(marker.angle), degrees(Math.atan2(-200 - 300, -300 - 500)));

  // Rotation is continuous, not four-way: nudging the target moves the angle.
  const nudged = offscreenIndicatorFor({ x: -300, y: -260, radius: RIFT_RADIUS }, BOUNDS, inset);
  assert.notEqual(nudged.angle, marker.angle);
});

test("markers stay inset and fully inside the playfield on every side", () => {
  const targets = [
    { x: -9000, y: -9000 }, { x: 9000, y: -9000 }, { x: -9000, y: 9000 }, { x: 9000, y: 9000 },
    { x: 500, y: -4000 }, { x: 500, y: 4000 }, { x: -4000, y: 300 }, { x: 4000, y: 300 },
    { x: -40, y: 590 }, { x: 1040, y: 5 },
  ];
  for (const target of targets) {
    const marker = offscreenIndicatorFor({ ...target, radius: RIFT_RADIUS }, BOUNDS, inset);
    assert.ok(marker, `expected a marker for ${JSON.stringify(target)}`);
    assert.ok(marker.x >= BOUNDS.left + inset && marker.x <= BOUNDS.right - inset);
    assert.ok(marker.y >= BOUNDS.top + inset && marker.y <= BOUNDS.bottom - inset);
  }
  // One inset feeds every edge: the constant and its default, nothing per-side.
  assert.equal((codeOnly(helper).match(/OFFSCREEN_INDICATOR_INSET/g) ?? []).length, 2);
  assert.match(helper, /padX = clamp\(inset, 0, width \/ 2\)/);
  assert.match(helper, /padY = clamp\(inset, 0, height \/ 2\)/);
});

test("visibility uses the drawn body, not just the centre", () => {
  // Centre barely inside the left border with most of the body outside.
  const barely = { x: 10, y: 300, radius: RIFT_RADIUS };
  assert.equal(isTargetOffscreen(barely, BOUNDS), true);
  assert.ok(offscreenIndicatorFor(barely, BOUNDS, inset));
  // Clear of the border by more than half a body: plainly visible, no marker.
  const clear = { x: RIFT_RADIUS, y: 300, radius: RIFT_RADIUS };
  assert.equal(isTargetOffscreen(clear, BOUNDS), false);
  assert.equal(OFFSCREEN_VISIBLE_BODY, 0.5);
  // A target with no declared body falls back to its centre.
  assert.equal(isTargetOffscreen({ x: 1, y: 300 }, BOUNDS), false);
});

test("an ally inside the camera produces no ally marker", () => {
  assert.equal(offscreenIndicatorFor({ x: 480, y: 320, radius: ALLY_RADIUS }, BOUNDS, inset), null);
});

test("an off-screen ally produces a marker on the edge toward the ally", () => {
  const marker = offscreenIndicatorFor({ x: 1200, y: 5, radius: ALLY_RADIUS }, BOUNDS, inset);
  assert.ok(marker);
  assert.equal(marker.x, BOUNDS.right - inset);
  assert.equal(marker.y, BOUNDS.top + inset);
  assert.ok(marker.angle < 0 && marker.angle > -Math.PI / 2);

  // An ally only a little past the side keeps the marker level with them.
  const level = offscreenIndicatorFor({ x: 1200, y: 320, radius: ALLY_RADIUS }, BOUNDS, inset);
  assert.equal(level.y, 320);
});

test("the ally marker is co-op only — never solo PvE, Survival, or a PvP rival", () => {
  assert.match(game, /game\.mode === "coop" \? netRef\.current\?\.renderedTeammate\(time\) : null/);
  const block = renderBlock();
  assert.doesNotMatch(block, /opponentCombat|game\.rival|game\.survival|mode === "pvp"/);
  // A missing ally renders nothing at all.
  assert.match(block, /allyTarget\s*\?[\s\S]*?:\s*null;/);
  assert.match(block, /if \(allyMarker\) drawOffscreenMarker/);
});

test("Rift and ally share one positioning helper and one inset", () => {
  const block = renderBlock();
  assert.equal((block.match(/offscreenIndicatorFor\(/g) ?? []).length, 2);
  assert.equal((block.match(/OFFSCREEN_INDICATOR_INSET/g) ?? []).length, 1);
  assert.match(block, /const markerInset = OFFSCREEN_INDICATOR_INSET \/ camScale/);
  // No second implementation of the maths anywhere in the render path.
  assert.doesNotMatch(block, /Math\.atan2/);
  // Identical geometry in, identical geometry out, whatever is being pointed at.
  const rift = offscreenIndicatorFor({ x: 1400, y: 900, radius: 20 }, BOUNDS, inset);
  const ally = offscreenIndicatorFor({ x: 1400, y: 900, radius: 20 }, BOUNDS, inset);
  assert.deepEqual(rift, ally);
});

test("moving the camera moves the marker and re-aims it", () => {
  const rift = { x: 1200, y: 300, radius: RIFT_RADIUS };
  const start = offscreenIndicatorFor(rift, BOUNDS, inset);
  assert.ok(start);
  assert.equal(degrees(start.angle), 0);

  // Camera pans right until the Rift is comfortably on screen.
  const panned = { left: 800, top: 0, right: 1800, bottom: 600 };
  assert.equal(offscreenIndicatorFor(rift, panned, inset), null);
  assert.equal(cameraBoundsCenter(panned).x, 1300);

  // Panning past it flips the marker to the opposite edge.
  const past = { left: 1400, top: 0, right: 2400, bottom: 600 };
  const behind = offscreenIndicatorFor(rift, past, inset);
  assert.ok(behind);
  assert.equal(behind.x, past.left + inset);
  assert.equal(degrees(behind.angle), 180);

  // Zooming in (a smaller visible rectangle) re-clamps to the new edges.
  const zoomed = { left: 300, top: 150, right: 700, bottom: 450 };
  const close = offscreenIndicatorFor(rift, zoomed, inset);
  assert.ok(close);
  assert.equal(close.x, zoomed.right - inset);
});

test("indicators are local presentation and add no network traffic", () => {
  const block = renderBlock();
  assert.doesNotMatch(block, /send|emit|socket|report|publish|message/i);
  const code = codeOnly(helper);
  assert.doesNotMatch(code, /send|socket|fetch|net|report|WebSocket/i);
  // The helper is geometry only: no canvas, no DOM, no simulation state.
  assert.doesNotMatch(code, /document|window|ctx\.|canvas|localStorage/i);
  // Nothing was added to the wire protocol or the client's outbound calls.
  const protocol = readFileSync(new URL("../server/protocol.mjs", import.meta.url), "utf8");
  const client = readFileSync(new URL("../app/pvp-client.ts", import.meta.url), "utf8");
  for (const source of [protocol, client]) {
    assert.doesNotMatch(source, /offscreen|indicator/i);
  }
});

test("markers draw inside the arena canvas, not as floating DOM HUD", () => {
  const block = renderBlock();
  assert.doesNotMatch(block, /createElement|className|style\./);
  // Drawn in the camera's world transform, then counter-scaled so the marker
  // keeps a constant on-screen size at any zoom.
  assert.match(block, /ctx\.scale\(1 \/ camScale, 1 \/ camScale\)/);
  assert.match(game, /ctx\.translate\(camX \+ shakeX, camY \+ shakeY\);\s*ctx\.scale\(camScale, camScale\);[\s\S]*Off-screen awareness/);
  // Compact: the chevron and its silhouette stay inside a ~28px box.
  const sizes = [...block.matchAll(/ctx\.(?:moveTo|lineTo)\((-?[\d.]+), (-?[\d.]+)\)/g)];
  assert.ok(sizes.length > 0);
  for (const [, x, y] of sizes) assert.ok(Math.abs(Number(x)) <= 14 && Math.abs(Number(y)) <= 14);
});

test("the Rift marker keeps the rift's own colour language, including enrage", () => {
  const block = renderBlock();
  assert.match(block, /game\.enrageActive \? "#ff2a3f" : "#ff4cbe"/);
  assert.match(block, /drawOffscreenMarker\(allyMarker, "#b6ff57", true\)/);
  // A compact directional marker, not a second full rift at the edge.
  assert.doesNotMatch(block, /drawPortal|createRadialGradient/);
});
