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
  OFFSCREEN_MARKER_RADIUS,
  OFFSCREEN_VISIBLE_BODY,
  cameraBoundsCenter,
  isTargetOffscreen,
  offscreenIndicatorFor,
  slideClearOfBlockedRegions,
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
  // One inset feeds every edge: the constant plus the defaults that pass it
  // through, and no per-side value anywhere.
  const code = codeOnly(helper);
  assert.equal((code.match(/OFFSCREEN_INDICATOR_INSET/g) ?? []).length, 3);
  assert.equal((code.match(/inset: number = OFFSCREEN_INDICATOR_INSET/g) ?? []).length, 2);
  assert.doesNotMatch(code, /inset(?:Top|Bottom|Left|Right)/i);
  assert.equal((code.match(/padX = clamp\(inset, 0, width \/ 2\)/g) ?? []).length, 2);
  assert.equal((code.match(/padY = clamp\(inset, 0, height \/ 2\)/g) ?? []).length, 2);
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

// ------------------------------------------------------- blocked regions --
//
// HUD panels are painted over the arena by the DOM, so a marker clamped
// beneath one is simply invisible. These cover the nudge that gets it out from
// under the panel without disturbing any edge the panel does not touch.

const radius = OFFSCREEN_MARKER_RADIUS;
/** The rules badge as it actually renders: pinned to the arena's top-left. */
const BADGE = { left: 10, top: 10, right: 250, bottom: 96 };
const clearOf = (marker, regions) => regions.every((region) =>
  marker.x <= region.left - radius || marker.x >= region.right + radius
  || marker.y <= region.top - radius || marker.y >= region.bottom + radius);
const onEdge = (marker) =>
  Math.abs(marker.x - (BOUNDS.left + inset)) < 1e-6
  || Math.abs(marker.x - (BOUNDS.right - inset)) < 1e-6
  || Math.abs(marker.y - (BOUNDS.top + inset)) < 1e-6
  || Math.abs(marker.y - (BOUNDS.bottom - inset)) < 1e-6;

test("with nothing blocked, every marker lands exactly where it always did", () => {
  const targets = [
    { x: -400, y: 300 }, { x: 1400, y: 300 }, { x: 500, y: -300 }, { x: 500, y: 1200 },
    { x: -400, y: -300 }, { x: 1400, y: 1200 }, { x: -40, y: 590 },
  ];
  for (const target of targets) {
    const body = { ...target, radius: RIFT_RADIUS };
    const plain = offscreenIndicatorFor(body, BOUNDS, inset);
    assert.deepEqual(offscreenIndicatorFor(body, BOUNDS, inset, {}), plain);
    assert.deepEqual(offscreenIndicatorFor(body, BOUNDS, inset, { blocked: [] }), plain);
    // A region nowhere near the marker changes nothing either.
    assert.deepEqual(
      offscreenIndicatorFor(body, BOUNDS, inset, { blocked: [{ left: 480, top: 280, right: 520, bottom: 320 }] }),
      plain,
    );
  }
});

test("the top-left rules badge pushes the marker out from under itself", () => {
  const rift = { x: -600, y: -400, radius: RIFT_RADIUS };
  const plain = offscreenIndicatorFor(rift, BOUNDS, inset);
  assert.deepEqual({ x: plain.x, y: plain.y }, { x: BOUNDS.left + inset, y: BOUNDS.top + inset });
  assert.ok(!clearOf(plain, [BADGE]), "the corner marker really is under the badge");

  const safe = offscreenIndicatorFor(rift, BOUNDS, inset, { blocked: [BADGE] });
  assert.ok(clearOf(safe, [BADGE]), "the marker must clear the badge footprint");
  assert.ok(onEdge(safe), "and must still sit on an arena edge");
  // Down the left edge is the shorter escape from a top-left badge.
  assert.equal(safe.x, BOUNDS.left + inset);
  assert.equal(safe.y, BADGE.bottom + radius);
});

test("a nudged marker keeps pointing at the real target", () => {
  const rift = { x: -600, y: -400, radius: RIFT_RADIUS };
  const plain = offscreenIndicatorFor(rift, BOUNDS, inset);
  const safe = offscreenIndicatorFor(rift, BOUNDS, inset, { blocked: [BADGE] });
  assert.equal(safe.angle, plain.angle);
  assert.equal(safe.distance, plain.distance);
  assert.equal(safe.angle, Math.atan2(-400 - 300, -600 - 500));
});

test("a nudged marker stays fully inside the playfield", () => {
  const wide = { left: 0, top: 0, right: 400, bottom: 200 };
  const tall = { left: 0, top: 0, right: 200, bottom: 400 };
  for (const bounds of [wide, tall]) {
    for (const target of [{ x: -900, y: -900 }, { x: 900, y: -900 }, { x: -900, y: 900 }, { x: 900, y: 900 }]) {
      const marker = offscreenIndicatorFor({ ...target, radius: RIFT_RADIUS }, bounds, inset, {
        blocked: [{ left: 5, top: 5, right: 120, bottom: 70 }],
      });
      assert.ok(marker);
      assert.ok(marker.x >= bounds.left && marker.x <= bounds.right);
      assert.ok(marker.y >= bounds.top && marker.y <= bounds.bottom);
    }
  }
});

test("edges the badge does not touch are left alone", () => {
  for (const target of [{ x: 1400, y: 300 }, { x: 500, y: 1200 }, { x: 1400, y: 1200 }, { x: 500, y: -300 }]) {
    const body = { ...target, radius: RIFT_RADIUS };
    assert.deepEqual(
      offscreenIndicatorFor(body, BOUNDS, inset, { blocked: [BADGE] }),
      offscreenIndicatorFor(body, BOUNDS, inset),
      `${JSON.stringify(target)} is nowhere near the badge`,
    );
  }
});

test("the marker's footprint decides obstruction, not its centre point", () => {
  // A centre just past the badge's edge whose chevron still reaches under it.
  const grazing = { left: 10, top: 10, right: 250, bottom: 40 };
  const marker = { x: BOUNDS.left + inset, y: 46, angle: 0, distance: 100 };
  assert.ok(marker.y > grazing.bottom, "the centre alone is already clear");
  const safe = slideClearOfBlockedRegions(marker, BOUNDS, inset, { blocked: [grazing] });
  assert.equal(safe.y, grazing.bottom + radius);
  assert.ok(clearOf(safe, [grazing]));
  // A smaller marker with the same centre needs no move at all.
  assert.deepEqual(slideClearOfBlockedRegions(marker, BOUNDS, inset, { blocked: [grazing], markerRadius: 2 }), marker);
});

test("several blocked rectangles are escaped in one move", () => {
  const stacked = [
    { left: 10, top: 10, right: 250, bottom: 96 },
    { left: 20, top: 100, right: 200, bottom: 180 },
    { left: 900, top: 10, right: 990, bottom: 90 },
  ];
  const safe = offscreenIndicatorFor({ x: -600, y: -400, radius: RIFT_RADIUS }, BOUNDS, inset, { blocked: stacked });
  assert.ok(clearOf(safe, stacked), "the marker must clear every region, not just the first");
  assert.equal(safe.x, BOUNDS.left + inset);
  assert.equal(safe.y, 180 + radius, "the two touching panels are cleared as one span");

  // The far-corner panel still only affects its own corner.
  const farCorner = offscreenIndicatorFor({ x: 1400, y: -400, radius: RIFT_RADIUS }, BOUNDS, inset, { blocked: stacked });
  assert.ok(clearOf(farCorner, stacked));
  assert.equal(farCorner.x, BOUNDS.right - inset);
});

test("a panel spanning the whole edge pushes the marker inward instead", () => {
  // A status strip across the top: no point on the top edge is ever clear.
  const strip = { left: -50, top: 8, right: 1050, bottom: 46 };
  const above = offscreenIndicatorFor({ x: 500, y: -400, radius: RIFT_RADIUS }, BOUNDS, inset, { blocked: [strip] });
  assert.ok(above);
  assert.equal(above.x, 500, "it does not wander sideways along an edge it cannot use");
  assert.equal(above.y, strip.bottom + radius);
  assert.ok(clearOf(above, [strip]));
  assert.ok(above.y >= BOUNDS.top + inset && above.y <= BOUNDS.bottom - inset);
  assert.equal(above.angle, Math.atan2(-400 - 300, 500 - 500));

  // The corner case resolves the same way, down the one edge still usable.
  const corner = offscreenIndicatorFor({ x: -600, y: -400, radius: RIFT_RADIUS }, BOUNDS, inset, { blocked: [strip] });
  assert.equal(corner.x, BOUNDS.left + inset, "still pinned to the left edge");
  assert.equal(corner.y, strip.bottom + radius);
  assert.ok(clearOf(corner, [strip]));

  // The bottom edge is untouched by a strip along the top.
  assert.deepEqual(
    offscreenIndicatorFor({ x: 500, y: 1200, radius: RIFT_RADIUS }, BOUNDS, inset, { blocked: [strip] }),
    offscreenIndicatorFor({ x: 500, y: 1200, radius: RIFT_RADIUS }, BOUNDS, inset),
  );
});

test("an edge with nowhere clear leaves the marker where it was", () => {
  const wall = { left: -5000, top: -5000, right: 5000, bottom: 5000 };
  const plain = offscreenIndicatorFor({ x: -600, y: -400, radius: RIFT_RADIUS }, BOUNDS, inset);
  const safe = offscreenIndicatorFor({ x: -600, y: -400, radius: RIFT_RADIUS }, BOUNDS, inset, { blocked: [wall] });
  assert.deepEqual(safe, plain);
});

test("Rift and ally get the same safe placement from the same call site", () => {
  const block = renderBlock();
  // One options object, built once, handed to both markers.
  assert.match(block, /const safePlacement = \{/);
  assert.equal((block.match(/safePlacement/g) ?? []).length, 3);
  assert.match(block, /offscreenIndicatorFor\(riftBody, cameraBounds, markerInset, safePlacement\)/);
  assert.match(block, /offscreenIndicatorFor\(allyBody, cameraBounds, markerInset, safePlacement\)/);
  assert.match(block, /markerRadius: OFFSCREEN_MARKER_RADIUS \/ camScale/);
  // No marker-specific dodging anywhere in the render path.
  assert.doesNotMatch(block, /difficulty-badge/);
  // Identical geometry in, identical geometry out.
  const options = { blocked: [BADGE] };
  const rift = offscreenIndicatorFor({ x: -600, y: -400, radius: 20 }, BOUNDS, inset, options);
  const ally = offscreenIndicatorFor({ x: -600, y: -400, radius: 20 }, BOUNDS, inset, options);
  assert.deepEqual(rift, ally);
});

test("HUD rectangles are measured off real layout, on a throttle, and only when marking", () => {
  assert.match(game, /const HUD_BLOCK_SELECTORS = \[\"\.difficulty-badge\"\]/);
  assert.match(game, /getBoundingClientRect\(\)[\s\S]*?left: \(rect\.left - canvasRect\.left\) \* scale/);
  const block = renderBlock();
  assert.match(block, /if \(marking && time - hudBlocksMeasuredAt >= HUD_BLOCK_REFRESH_MS\)/);
  // Nothing about the badge is assumed: no fixed pixel rectangle stands in for it.
  const measure = game.slice(game.indexOf("const measureHudBlocks"), game.indexOf("const applyResize"));
  assert.doesNotMatch(measure, /\b(?:\d{2,})\b/, "the badge's size must come from layout, not a constant");
  // A resize invalidates the cache rather than waiting out the throttle.
  assert.match(game, /cameraSafeTop = safeTopCss \* VIEW_WIDTH \/ cssWidth;\s*hudBlocksMeasuredAt = -Infinity;/);
});

test("blocked regions change presentation only", () => {
  const code = codeOnly(readFileSync(new URL("../app/offscreen-indicators.ts", import.meta.url), "utf8"));
  assert.doesNotMatch(code, /send|socket|fetch|report|WebSocket|document|window|localStorage/i);
  const block = renderBlock();
  assert.doesNotMatch(block, /game\.(bullets|enemies|powers|health|score|portalCharge)\s*=/);
  assert.doesNotMatch(block, /netRef\.current\.(send|report)/);
});
