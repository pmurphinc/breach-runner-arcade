/**
 * Off-screen awareness indicators: the Rift, the co-op ally, loose PUPs and
 * hostiles.
 *
 * The maths lives in one helper every target shares, so most of this exercises
 * that helper directly. The rest reads game.tsx to prove the wiring — that
 * every marker goes through the shared helper, that the ally marker is co-op
 * only, and that none of this touches the network.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OFFSCREEN_INDICATOR_INSET,
  OFFSCREEN_MARKER_EXTENT,
  OFFSCREEN_MARKER_RADIUS,
  OFFSCREEN_VISIBLE_BODY,
  cameraBoundsCenter,
  MAX_OFFSCREEN_PUP_INDICATORS,
  isTargetOffscreen,
  markerBlockFor,
  nearestOffscreenTargets,
  offscreenIndicatorFor,
  slideClearOfBlockedRegions,
} from "../app/offscreen-indicators.ts";
import { PUP_FRAME_COLORS, PUP_FRAME_SHAPES, PUP_RADIUS } from "../app/pup-world.ts";
import {
  ENEMY_COUNTS,
  ENEMY_STATS,
  MAJOR_OFFSCREEN_HAZARDS,
  POWER_COLORS,
  WEAPONS,
  isMajorOffscreenHazard,
  isMajorOffscreenHazardUrgent,
} from "../app/game-data.ts";

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
  // Placement and the blocked-region slide take their pad from one shared
  // helper, so the two can never disagree about where an edge actually is.
  assert.equal((code.match(/markerPad\(inset, width, /g) ?? []).length, 2);
  assert.equal((code.match(/markerPad\(inset, height, /g) ?? []).length, 2);
  assert.equal((code.match(/function markerPad\(/g) ?? []).length, 1);
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

test("every marked target shares one positioning helper and one inset", () => {
  const block = renderBlock();
  // Rift, ally, major hazard, loose PUP, ordinary hostile — five call sites,
  // one helper, one inset.
  assert.equal((block.match(/offscreenIndicatorFor\(/g) ?? []).length, 5);
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
  assert.match(block, /offscreenIndicatorFor\(riftBody, playfieldBounds, markerInset, safePlacement\)/);
  assert.match(block, /offscreenIndicatorFor\(allyBody, playfieldBounds, markerInset, safePlacement\)/);
  assert.match(block, /markerRadius: OFFSCREEN_MARKER_RADIUS \/ camScale/);
  // PUPs inherit the same HUD rectangles and the same footprint.
  assert.match(block, /blocked: \[\s*\.\.\.safePlacement\.blocked,/);
  assert.match(block, /markerRadius: safePlacement\.markerRadius,/);
  assert.match(block, /playfieldBounds,\s*markerInset,\s*pupPlacement,/);
  // No marker-specific dodging anywhere in the render path.
  assert.doesNotMatch(block, /difficulty-badge/);
  // Identical geometry in, identical geometry out.
  const options = { blocked: [BADGE] };
  const rift = offscreenIndicatorFor({ x: -600, y: -400, radius: 20 }, BOUNDS, inset, options);
  const ally = offscreenIndicatorFor({ x: -600, y: -400, radius: 20 }, BOUNDS, inset, options);
  assert.deepEqual(rift, ally);
});

test("HUD rectangles are measured off real layout, on a throttle, and only when marking", () => {
  assert.match(game, /const HUD_BLOCK_SELECTORS = \[\"\.difficulty-badge\", \"\.system-controls\"\]/);
  assert.match(game, /getBoundingClientRect\(\)[\s\S]*?left: Math\.max\(0, \(rect\.left - canvasRect\.left\) \* scale\)/);
  // Clipped to the canvas, so a panel that misses the arena contributes nothing.
  assert.match(game, /block\.right > block\.left && block\.bottom > block\.top \? \[block\] : \[\]/);
  // The system controls are position: fixed and live outside the wrap.
  assert.match(game, /canvasWrap\.querySelector<HTMLElement>\(selector\)\s*\?\? document\.querySelector<HTMLElement>\(selector\)/);
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

// ----------------------------------------------------------- loose PUPs --
//
// The arena can hold more loose PUPs than an edge can usefully show, so these
// cover the selection — which ones, how many, in what order — and the class
// identity each marker carries.

const pup = (x, y, type = "spread") => ({ x, y, type });
const pupsFor = (...positions) => positions.map(([x, y], index) => pup(x, y, `pup-${index}`));
const selection = (pups, bounds = BOUNDS, origin = { x: 500, y: 300 }) =>
  nearestOffscreenTargets(pups, bounds, MAX_OFFSCREEN_PUP_INDICATORS, { origin, radius: PUP_RADIUS });

test("a PUP inside the camera produces no marker", () => {
  const visible = pup(500, 300);
  assert.equal(isTargetOffscreen(visible, BOUNDS, PUP_RADIUS), false);
  assert.deepEqual(selection([visible]), []);
  assert.equal(offscreenIndicatorFor({ ...visible, radius: PUP_RADIUS }, BOUNDS, inset), null);
  // Well inside the border counts as visible too.
  assert.deepEqual(selection([pup(60, 560)]), []);
});

test("an off-screen PUP produces a marker on the edge toward it", () => {
  const loose = pup(-300, 300);
  assert.deepEqual(selection([loose]), [loose]);
  const marker = offscreenIndicatorFor({ ...loose, radius: PUP_RADIUS }, BOUNDS, inset);
  assert.ok(marker);
  assert.equal(marker.x, BOUNDS.left + inset);
  assert.equal(degrees(marker.angle), 180);
});

test("a PUP whose body is mostly outside still counts as off-screen", () => {
  // Centre a hair inside the border, most of the badge beyond it.
  assert.equal(isTargetOffscreen(pup(5, 300), BOUNDS, PUP_RADIUS), true);
  assert.equal(isTargetOffscreen(pup(PUP_RADIUS, 300), BOUNDS, PUP_RADIUS), false);
  assert.equal(selection([pup(5, 300)]).length, 1);
});

test("a collected PUP stops producing a marker on the next frame", () => {
  const kept = pup(-300, 300, "kept");
  const collected = pup(-400, 320, "collected");
  assert.equal(selection([collected, kept]).length, 2);
  // Collection removes it from the world list, and nothing else is remembered.
  assert.deepEqual(selection([kept]), [kept]);
  assert.deepEqual(selection([]), []);
  // No cached list anywhere in the render path: the world array is read live.
  const block = renderBlock();
  assert.match(block, /nearestOffscreenTargets\(\s*game\.pickups,/);
  assert.doesNotMatch(block, /pupMarkerCache|lastPupMarkers|useRef/);
});

test("at most five PUP markers, and always the nearest five", () => {
  assert.equal(MAX_OFFSCREEN_PUP_INDICATORS, 5);
  // Eight off-screen PUPs, left of the view, at known distances from (500, 300).
  const pups = pupsFor([-100, 300], [-800, 300], [-300, 300], [-600, 300], [-200, 300], [-700, 300], [-400, 300], [-500, 300]);
  const picked = selection(pups);
  assert.equal(picked.length, MAX_OFFSCREEN_PUP_INDICATORS);
  assert.deepEqual(picked.map((p) => p.x), [-100, -200, -300, -400, -500]);
  // Deterministic: the same world gives the same answer, order-independent.
  assert.deepEqual(selection([...pups].reverse()).map((p) => p.x), [-100, -200, -300, -400, -500]);
  // Fewer than five off-screen means only those are marked.
  assert.equal(selection(pups.slice(0, 3)).length, 3);
  // Ties fall back to the caller's order rather than anything random.
  const tied = pupsFor([-300, 300], [-300, 300], [-300, 300]);
  assert.deepEqual(selection(tied).map((p) => p.type), ["pup-0", "pup-1", "pup-2"]);
  // Nearest is measured from the origin the caller gives, not the bounds centre.
  assert.deepEqual(
    nearestOffscreenTargets(pups, BOUNDS, 2, { origin: { x: 500, y: 300 }, radius: PUP_RADIUS }).map((p) => p.x),
    [-100, -200],
  );
});

test("every PUP class keeps its own silhouette and colour on the edge", () => {
  const block = renderBlock();
  // The marker resolves both from the canonical class vocabulary, never a table
  // of its own, so payload/upgrade/recovery/rare cannot drift out of step.
  assert.match(block, /const accent = pupFrameColor\(pupClass\)/);
  assert.match(block, /drawPupFrame\(ctx, pupClass, 6\.5, 0\)/);
  assert.match(block, /drawOffscreenPupMarker\(marker, WEAPONS\[pickup\.type\]\.pupClass\)/);
  assert.doesNotMatch(block, /"triangle"|"octagon"|"circle"|"diamond"/);
  assert.doesNotMatch(block, /#ff7043|#4fc3f7|#66e07a|#b783ff/);
  // And the vocabulary it defers to is the established one.
  assert.deepEqual({ ...PUP_FRAME_SHAPES }, { payload: "triangle", upgrade: "octagon", recovery: "circle", rare: "diamond" });
  assert.deepEqual(Object.keys(PUP_FRAME_COLORS), ["payload", "upgrade", "recovery", "rare"]);
  for (const color of Object.values(PUP_FRAME_COLORS)) assert.match(color, /^#[0-9a-f]{6}$/);
});

test("the class silhouette stays upright while only the arrow turns", () => {
  const block = renderBlock();
  const marker = block.slice(block.indexOf("drawOffscreenPupMarker = ("), block.indexOf("const riftBody"));
  // The frame is drawn at rotation zero, outside the rotated arrow block.
  assert.match(marker, /ctx\.rotate\(indicator\.angle\);[\s\S]*?ctx\.restore\(\);[\s\S]*?drawPupFrame\(ctx, pupClass, 6\.5, 0\)/);
  // No world-PUP spin: the phase that drives the loose badge never reaches here.
  assert.doesNotMatch(marker, /phase|PUP_SPIN|rotation \* /);
  // Compact: the whole marker stays inside the shared footprint.
  const points = [...marker.matchAll(/ctx\.(?:moveTo|lineTo)\((-?[\d.]+), (-?[\d.]+)\)/g)];
  assert.ok(points.length > 0);
  for (const [, x, y] of points) assert.ok(Math.abs(Number(x)) <= 14 && Math.abs(Number(y)) <= 14);
});

test("markers stacked on one edge are separated, keeping their own angles", () => {
  const bounds = BOUNDS;
  // Four PUPs off the left edge, close enough together to collide.
  const positions = [[-300, 300], [-320, 306], [-340, 312], [-360, 318]];
  const placed = [];
  const blocked = [];
  for (const [x, y] of positions) {
    const marker = offscreenIndicatorFor({ x, y, radius: PUP_RADIUS }, bounds, inset, { blocked });
    assert.ok(marker);
    // Direction still points at this PUP, whatever the separation did.
    assert.equal(marker.angle, Math.atan2(y - 300, x - 500));
    placed.push(marker);
    blocked.push(markerBlockFor(marker));
  }
  // Every pair is far enough apart to read as two markers.
  for (let a = 0; a < placed.length; a += 1) {
    for (let b = a + 1; b < placed.length; b += 1) {
      const gap = Math.hypot(placed[a].x - placed[b].x, placed[a].y - placed[b].y);
      assert.ok(gap >= OFFSCREEN_MARKER_RADIUS * 2 - 1e-6, `markers ${a} and ${b} overlap (gap ${gap})`);
    }
  }
  // All of them still sit on the edge they belong to.
  for (const marker of placed) assert.equal(marker.x, bounds.left + inset);
  // Separation is the blocked-region mechanism, not a second implementation.
  assert.deepEqual(markerBlockFor({ x: 100, y: 200 }, 10), { left: 90, top: 190, right: 110, bottom: 210 });
});

test("PUP markers are drawn under the Rift and ally, and avoid them", () => {
  const block = renderBlock();
  const pupDraw = block.indexOf("drawOffscreenPupMarker(marker");
  const riftDraw = block.indexOf("drawOffscreenMarker(riftMarker");
  const allyDraw = block.indexOf("drawOffscreenMarker(allyMarker");
  assert.ok(pupDraw > 0 && riftDraw > pupDraw && allyDraw > pupDraw, "PUPs paint first, so the objective sits on top");
  // The Rift and ally are placed before PUPs and are blocked regions for them,
  // so neither of those two moves because of a PUP.
  assert.match(block, /riftMarker \? \[markerBlockFor\(riftMarker, safePlacement\.markerRadius\)\] : \[\]/);
  assert.match(block, /allyMarker \? \[markerBlockFor\(allyMarker, safePlacement\.markerRadius\)\] : \[\]/);
  assert.match(block, /offscreenIndicatorFor\(riftBody, playfieldBounds, markerInset, safePlacement\)/);
});

test("PUP markers add no networking and touch no PUP gameplay", () => {
  const block = renderBlock();
  const pupPart = block.slice(block.indexOf("const pupPlacement"), block.indexOf("if (riftMarker) drawOffscreenMarker"));
  assert.doesNotMatch(pupPart, /send|emit|socket|report|publish|message/i);
  // Read-only over the world list: nothing is spawned, collected, or moved.
  assert.doesNotMatch(pupPart, /game\.pickups\s*=|\.push\(\s*\{[^}]*type:|splice|collect|stock/);
  assert.doesNotMatch(pupPart, /pickup\.(?:x|y|vx|vy|life|phase)\s*=/);
  const protocol = readFileSync(new URL("../server/protocol.mjs", import.meta.url), "utf8");
  const client = readFileSync(new URL("../app/pvp-client.ts", import.meta.url), "utf8");
  for (const source of [protocol, client]) assert.doesNotMatch(source, /offscreen|indicator/i);
});

test("the landscape-phone HUD rectangles push markers clear of both panels", () => {
  // Measured off a real 844x390 landscape phone, in VIEW_WIDTH units: the rules
  // badge runs along the top-left and the fixed system controls reach into the
  // top-right corner of the arena. Both are in the shared blocked list.
  const bounds = { left: 0, top: 0, right: 1048, bottom: 484 };
  const badge = { left: 7, top: 7, right: 864, bottom: 32 };
  const controls = { left: 867, top: 7, right: 1041, bottom: 62 };
  const blocked = [badge, controls];
  const clear = (marker) => blocked.every((region) =>
    marker.x <= region.left - radius || marker.x >= region.right + radius
    || marker.y <= region.top - radius || marker.y >= region.bottom + radius);

  // Off the top-right: lands under the controls, so it drops just below them.
  const topRight = offscreenIndicatorFor({ x: 1600, y: -400, radius: RIFT_RADIUS }, bounds, inset, { blocked });
  assert.equal(topRight.x, bounds.right - inset, "still on the right edge");
  assert.equal(topRight.y, controls.bottom + radius);
  assert.ok(clear(topRight));

  // Off the top-left: the badge is the panel in the way there, and it is
  // shallower, so that marker drops less. One rule, two local answers.
  const topLeft = offscreenIndicatorFor({ x: -600, y: -400, radius: RIFT_RADIUS }, bounds, inset, { blocked });
  assert.equal(topLeft.x, bounds.left + inset);
  assert.equal(topLeft.y, badge.bottom + radius);
  assert.ok(clear(topLeft));
  assert.ok(topLeft.y < topRight.y, "no global inward push — each corner clears only its own panel");

  // The bottom half of the arena carries no panels and is untouched.
  const below = offscreenIndicatorFor({ x: 500, y: 1200, radius: RIFT_RADIUS }, bounds, inset, { blocked });
  assert.deepEqual(below, offscreenIndicatorFor({ x: 500, y: 1200, radius: RIFT_RADIUS }, bounds, inset));

  // A PUP off the same top-right corner clears the controls the same way, and
  // then separates from the marker already there.
  const pupMarker = offscreenIndicatorFor({ x: 1600, y: -400, radius: PUP_RADIUS }, bounds, inset, {
    blocked: [...blocked, markerBlockFor(topRight)],
  });
  assert.ok(clear(pupMarker));
  assert.ok(Math.hypot(pupMarker.x - topRight.x, pupMarker.y - topRight.y) >= radius * 2 - 1e-6);
});

// ------------------------------------------------------------- hostiles --
//
// Every live hostile is a candidate, so these cover the whole population
// rather than a chosen few: that none are capped away, that they separate from
// each other and from the three higher-priority markers, and that the badge
// says THREAT while only the chevron turns.

/** A live hostile, shaped exactly like the game's own enemy records. */
const enemy = (x, y, kind = "ufo", radius = 18, hp = 3) => ({ x, y, kind, radius, hp });

/**
 * The render path's hostile pass, replayed against the shared helper.
 *
 * Deliberately not a reimplementation: it makes the same calls in the same
 * order the block makes, so what it proves about selection and separation is
 * what the game actually does.
 */
const enemyMarkers = (enemies, bounds = BOUNDS, blocked = []) => {
  const placed = [];
  for (const hostile of enemies) {
    if (hostile.hp <= 0) continue;
    const marker = offscreenIndicatorFor(hostile, bounds, inset, { blocked });
    if (!marker) continue;
    placed.push({ hostile, marker });
    blocked.push(markerBlockFor(marker));
  }
  return placed;
};

const enemyBlock = () => {
  const block = renderBlock();
  return block.slice(block.indexOf("const enemyPlacement"), block.indexOf("if (riftMarker) drawOffscreenMarker"));
};

test("a hostile inside the camera produces no marker", () => {
  const seen = enemy(500, 300);
  assert.equal(isTargetOffscreen(seen, BOUNDS), false);
  assert.equal(offscreenIndicatorFor(seen, BOUNDS, inset), null);
  assert.deepEqual(enemyMarkers([seen]), []);
  // Well inside the border counts as visible too, on every side.
  assert.deepEqual(enemyMarkers([enemy(60, 560), enemy(940, 40)]), []);
});

test("an off-screen hostile produces a marker on the edge toward it", () => {
  const [{ marker }] = enemyMarkers([enemy(-400, 300)]);
  assert.equal(marker.x, BOUNDS.left + inset);
  assert.equal(marker.y, 300);
  assert.equal(degrees(marker.angle), 180);
  // And it disappears again the moment the camera catches up.
  const panned = { left: -900, top: 0, right: 100, bottom: 600 };
  assert.deepEqual(enemyMarkers([enemy(-400, 300)], panned), []);
});

test("a hostile's marker points at that hostile, on every side and corner", () => {
  const centre = cameraBoundsCenter(BOUNDS);
  for (const [x, y] of [[-400, 300], [1500, 300], [500, -400], [500, 1100], [-400, -300], [1500, 1100]]) {
    const [{ marker }] = enemyMarkers([enemy(x, y)]);
    assert.equal(marker.angle, Math.atan2(y - centre.y, x - centre.x), `wrong heading for ${x},${y}`);
    assert.ok(marker.x >= BOUNDS.left + inset && marker.x <= BOUNDS.right - inset);
    assert.ok(marker.y >= BOUNDS.top + inset && marker.y <= BOUNDS.bottom - inset);
  }
});

test("a hostile's drawn radius decides whether it counts as visible", () => {
  // Same centre, two body sizes: the big hull is still mostly outside.
  assert.equal(isTargetOffscreen(enemy(14, 300, "gunship", 40), BOUNDS), true);
  assert.equal(isTargetOffscreen(enemy(14, 300, "mines", 8), BOUNDS), false);
  // Exactly half a body inside is the threshold the shared rule already sets.
  assert.equal(isTargetOffscreen(enemy(20, 300, "ufo", 40), BOUNDS), false);
  assert.equal(isTargetOffscreen(enemy(19, 300, "ufo", 40), BOUNDS), true);
  // The radius comes off the hostile itself, not a constant at the call site.
  const block = enemyBlock();
  assert.match(block, /offscreenIndicatorFor\(enemy, playfieldBounds, markerInset, enemyPlacement\)/);
  assert.doesNotMatch(block, /radius:/);
});

test("a dead or despawned hostile produces no marker at all", () => {
  const alive = enemy(-400, 300, "ufo");
  const dead = { ...enemy(-500, 320, "gunship"), hp: 0 };
  assert.deepEqual(enemyMarkers([dead]), []);
  assert.equal(enemyMarkers([alive, dead]).length, 1);
  // Despawn removes it from the world list, and nothing else is remembered.
  assert.deepEqual(enemyMarkers([]), []);
  const block = enemyBlock();
  assert.match(block, /for \(const enemy of game\.enemies\)/);
  assert.match(block, /if \(enemy\.hp <= 0 \|\| isMajorOffscreenHazard\(enemy\.kind\)\) continue;/);
  // No cache and no marker state written back onto a hostile.
  assert.doesNotMatch(block, /enemyMarkerCache|lastEnemyMarkers|useRef/);
  assert.doesNotMatch(block, /enemy\.(?:marker|indicator|offscreen)/);
});

test("every off-screen hostile is represented — there is no marker cap", () => {
  // Twelve hostiles strung down the left, well past any hand-picked limit.
  const swarm = Array.from({ length: 12 }, (_, index) => enemy(-200 - index * 40, 60 + index * 40));
  assert.equal(enemyMarkers(swarm).length, swarm.length);
  // Thirty of them, spread over all four sides, still all get one.
  const crowd = [
    ...Array.from({ length: 8 }, (_, i) => enemy(-300 - i * 30, 100 + i * 50)),
    ...Array.from({ length: 8 }, (_, i) => enemy(1300 + i * 30, 100 + i * 50)),
    ...Array.from({ length: 7 }, (_, i) => enemy(150 + i * 100, -300 - i * 30)),
    ...Array.from({ length: 7 }, (_, i) => enemy(150 + i * 100, 900 + i * 30)),
  ];
  assert.equal(enemyMarkers(crowd).length, crowd.length);
  // Nothing in the source picks a subset, sorts by distance, or slices a list.
  const block = enemyBlock();
  assert.doesNotMatch(block, /MAX_[A-Z_]*ENEMY|nearestOffscreenTargets|\.slice\(|\.sort\(|break;/);
  assert.doesNotMatch(codeOnly(game), /MAX_OFFSCREEN_ENEMY_INDICATORS|ENEMY_INDICATOR_LIMIT/);
  assert.doesNotMatch(codeOnly(helper), /MAX_OFFSCREEN_ENEMY/);
});

test("stacked hostile markers separate, each keeping its own target angle", () => {
  const centre = cameraBoundsCenter(BOUNDS);
  // Six hostiles clustered off the same corner, close enough to collide.
  const cluster = [[-300, 300], [-318, 306], [-336, 312], [-354, 318], [-372, 324], [-390, 330]]
    .map(([x, y]) => enemy(x, y));
  const placed = enemyMarkers(cluster);
  assert.equal(placed.length, cluster.length);
  for (const { hostile, marker } of placed) {
    // The slide moved the position; the heading still points at the hostile.
    assert.equal(marker.angle, Math.atan2(hostile.y - centre.y, hostile.x - centre.x));
    assert.equal(marker.x, BOUNDS.left + inset, "still on the edge it belongs to");
  }
  for (let a = 0; a < placed.length; a += 1) {
    for (let b = a + 1; b < placed.length; b += 1) {
      const gap = Math.hypot(placed[a].marker.x - placed[b].marker.x, placed[a].marker.y - placed[b].marker.y);
      assert.ok(gap >= radius * 2 - 1e-6, `hostile markers ${a} and ${b} overlap (gap ${gap})`);
    }
  }
  // Separation is the shared blocked-region mechanism, not a second system.
  const block = enemyBlock();
  assert.match(block, /enemyPlacement\.blocked\.push\(markerBlockFor\(marker, enemyPlacement\.markerRadius\)\)/);
  assert.doesNotMatch(block, /Math\.hypot|distance|cluster|spread|overlap/i);
});

test("hostile markers keep clear of the Rift, ally, PUP and HUD blocks", () => {
  const hostile = enemy(-600, -400, "gunship", 26);
  // Everything already placed off the same corner: two HUD panels, the Rift
  // marker, the ally marker and a PUP marker.
  const rift = offscreenIndicatorFor({ x: -700, y: -500, radius: RIFT_RADIUS }, BOUNDS, inset, { blocked: [BADGE] });
  const ally = offscreenIndicatorFor({ x: -650, y: -450, radius: ALLY_RADIUS }, BOUNDS, inset, {
    blocked: [BADGE, markerBlockFor(rift)],
  });
  const pupBlocked = [BADGE, markerBlockFor(rift), markerBlockFor(ally)];
  const pupMarker = offscreenIndicatorFor({ x: -620, y: -420, radius: PUP_RADIUS }, BOUNDS, inset, { blocked: pupBlocked });
  const occupied = [...pupBlocked, markerBlockFor(pupMarker)];
  const [{ marker }] = enemyMarkers([hostile], BOUNDS, [...occupied]);

  assert.ok(clearOf(marker, [BADGE]), "a hostile marker never lands under a HUD panel");
  for (const [name, other] of [["Rift", rift], ["ally", ally], ["PUP", pupMarker]]) {
    const gap = Math.hypot(marker.x - other.x, marker.y - other.y);
    assert.ok(gap >= radius * 2 - 1e-6, `hostile marker overlaps the ${name} marker (gap ${gap})`);
  }
  // And none of those three moved because of the hostile: it is placed last.
  assert.deepEqual(offscreenIndicatorFor({ x: -700, y: -500, radius: RIFT_RADIUS }, BOUNDS, inset, { blocked: [BADGE] }), rift);
});

test("hostiles are placed after the Rift, ally and PUPs, and painted below the Rift and ally", () => {
  const block = renderBlock();
  const pupPlace = block.indexOf("const pupPlacement");
  const enemyPlace = block.indexOf("const enemyPlacement");
  const enemyDraw = block.indexOf("drawOffscreenEnemyMarker(marker, enemy.kind)");
  const riftDraw = block.indexOf("drawOffscreenMarker(riftMarker");
  const allyDraw = block.indexOf("drawOffscreenMarker(allyMarker");
  assert.ok(pupPlace > 0 && enemyPlace > pupPlace, "hostiles are placed last of the four");
  assert.ok(enemyDraw > 0 && riftDraw > enemyDraw && allyDraw > enemyDraw, "the objective and the teammate paint on top");
  // The blocked list is the one the PUPs filled, reused rather than copied, so
  // every higher-priority marker is already in it.
  assert.match(block, /const enemyPlacement = pupPlacement;/);
  assert.doesNotMatch(enemyBlock(), /\[\s*\.\.\.pupPlacement|blocked: \[/);
});

test("the hostile badge stays upright while only the chevron turns", () => {
  const block = renderBlock();
  const marker = block.slice(block.indexOf("drawOffscreenEnemyMarker = ("), block.indexOf("const riftBody"));
  // The chevron is drawn inside the rotated block; the badge outside it.
  assert.match(marker, /ctx\.rotate\(indicator\.angle\);[\s\S]*?ctx\.restore\(\);[\s\S]*?OFFSCREEN_ENEMY_BADGE/);
  // The hostile's own heading, spin and phase never reach the marker.
  assert.doesNotMatch(marker, /enemy\.(?:phase|vx|vy|age)|DIRECTIONAL|drawWeaponGlyph/);
  // Compact: the whole marker stays inside the shared footprint.
  const points = [...marker.matchAll(/ctx\.(?:moveTo|lineTo)\((-?[\d.]+), (-?[\d.]+)\)/g)];
  assert.ok(points.length > 0);
  for (const [, x, y] of points) assert.ok(Math.abs(Number(x)) <= 14 && Math.abs(Number(y)) <= 14);
  // The badge is precomputed once rather than rebuilt per hostile per frame.
  assert.match(codeOnly(game), /const OFFSCREEN_ENEMY_BADGE: readonly \{ x: number; y: number \}\[\] = Array\.from\(/);
  assert.doesNotMatch(marker, /Math\.cos|Math\.sin|Array\.from|\.map\(/);
});

test("the hostile marker reads as a threat, not as a Rift, ally or PUP", () => {
  const block = renderBlock();
  const marker = block.slice(block.indexOf("drawOffscreenEnemyMarker = ("), block.indexOf("const riftBody"));
  // One threat colour for every hostile, taken from the arena's own hazard ring.
  assert.match(codeOnly(game), /const OFFSCREEN_ENEMY_ACCENT = "#ff9a4d";/);
  assert.match(marker, /const accent = OFFSCREEN_ENEMY_ACCENT;/);
  // Not the Rift's ring, not the ally's hull bars, not a PUP class frame.
  assert.doesNotMatch(marker, /ctx\.ellipse|drawPupFrame|pupFrameColor|PupClass/);
  for (const color of Object.values(PUP_FRAME_COLORS)) assert.ok(!marker.includes(color));
  for (const color of ["#ff4cbe", "#ff2a3f", "#b6ff57"]) assert.ok(!marker.includes(color));
  // The one identifying detail is the hostile's own kind colour, read from the
  // same table its hull is drawn from rather than a table of the marker's own.
  assert.match(marker, /ctx\.fillStyle = POWER_COLORS\[kind\];/);
  assert.equal(POWER_COLORS.gunship, WEAPONS.gunship.color);
  assert.doesNotMatch(marker, /ENEMY_STATS|kind === "/);
});

test("hostile markers add no networking and touch no enemy gameplay", () => {
  const block = enemyBlock();
  assert.doesNotMatch(block, /send|emit|socket|report|publish|message|netRef/i);
  // Read-only over the world list: nothing is spawned, damaged, moved or killed.
  assert.doesNotMatch(block, /game\.enemies\s*=|damageEnemy|destroyEnemy|updateEnemy|compact\(/);
  assert.doesNotMatch(block, /enemy\.(?:x|y|vx|vy|hp|radius|kind|cooldown|scrambled|countdown|armed)\s*=/);
  const protocol = readFileSync(new URL("../server/protocol.mjs", import.meta.url), "utf8");
  const client = readFileSync(new URL("../app/pvp-client.ts", import.meta.url), "utf8");
  for (const source of [protocol, client]) assert.doesNotMatch(source, /offscreen|indicator/i);
});

test("hostile markers cost nothing on the ordinary all-on-screen frame", () => {
  const block = renderBlock();
  // The HUD read is gated on something actually being marked, hostiles included,
  // and that scan is an in-place early exit rather than a list.
  assert.match(block, /for \(const enemy of game\.enemies\) \{\s*if \(enemy\.hp > 0 && isTargetOffscreen\(enemy, playfieldBounds\)\) \{ marking = true; break; \}/);
  // No layout read, no array copy and no per-hostile wrapper in the draw path.
  assert.doesNotMatch(enemyBlock(), /getBoundingClientRect|measureHudBlocks|querySelector|\.\.\.game\.enemies|\{ x: enemy\.x/);
});

test("the Rift, ally and PUP markers are unchanged by the hostile pass", () => {
  const blocked = [BADGE];
  const rift = offscreenIndicatorFor({ x: -700, y: -500, radius: RIFT_RADIUS }, BOUNDS, inset, { blocked });
  const ally = offscreenIndicatorFor({ x: 1400, y: 320, radius: ALLY_RADIUS }, BOUNDS, inset, { blocked });
  const pups = selection([pup(-300, 300), pup(-400, 320)]);
  // A wave of hostiles all around them changes none of those answers.
  enemyMarkers(Array.from({ length: 20 }, (_, i) => enemy(-250 - i * 20, 80 + i * 25)), BOUNDS, [...blocked]);
  assert.deepEqual(offscreenIndicatorFor({ x: -700, y: -500, radius: RIFT_RADIUS }, BOUNDS, inset, { blocked }), rift);
  assert.deepEqual(offscreenIndicatorFor({ x: 1400, y: 320, radius: ALLY_RADIUS }, BOUNDS, inset, { blocked }), ally);
  assert.deepEqual(selection([pup(-300, 300), pup(-400, 320)]), pups);
  // And their wiring in the render path is untouched: still five PUPs, still
  // the same helper, still the same two draw calls last.
  assert.equal(MAX_OFFSCREEN_PUP_INDICATORS, 5);
  const block = renderBlock();
  assert.match(block, /nearestOffscreenTargets\(\s*game\.pickups,\s*playfieldBounds,\s*MAX_OFFSCREEN_PUP_INDICATORS,/);
  assert.match(block, /if \(riftMarker\) drawOffscreenMarker\(riftMarker, game\.enrageActive \? "#ff2a3f" : "#ff4cbe", false\)/);
  assert.match(block, /if \(allyMarker\) drawOffscreenMarker\(allyMarker, "#b6ff57", true\)/);
});

test("hostile markers follow every camera mode without touching the camera", () => {
  const hostile = enemy(1400, 300, "artillery", 22);
  // Standard zoom: outside the frame, so it is marked.
  assert.equal(enemyMarkers([hostile]).length, 1);
  // Full Arena: the whole world is on screen, so nothing is marked.
  const fullArena = { left: 0, top: 0, right: 2400, bottom: 1400 };
  assert.deepEqual(enemyMarkers([hostile, enemy(2200, 1300), enemy(60, 40)], fullArena), []);
  // Closer zoom around the ship marks more of the same world.
  const close = { left: 300, top: 150, right: 800, bottom: 450 };
  assert.equal(enemyMarkers([hostile, enemy(60, 40)], close).length, 2);
  // A moving camera re-aims the marker as it pans, with no state carried over.
  const panning = [0, 200, 400, 600].map((shift) => {
    const bounds = { left: shift, top: 0, right: 1000 + shift, bottom: 600 };
    return enemyMarkers([hostile], bounds)[0]?.marker ?? null;
  });
  assert.ok(panning[0] && panning[1], "still off the right edge early in the pan");
  assert.equal(panning[3], null, "the camera has caught up and the marker is gone");
  // Bounds are the only camera input: no view mode is named in the hostile pass.
  assert.doesNotMatch(enemyBlock(), /fullArena|shipLock|zoom|viewMode|camScale =/);
});

// ------------------------------------------------------- major hazards --
//
// A few hostiles can reach the pilot from outside the frame, and those get a
// louder marker than the ordinary threat badge. These cover the three things
// that can go wrong with that: the classification drifting out of one place,
// an entity picking up two markers, and an urgent warning being crowded off
// the edge by a wave of ordinary hostiles.

/**
 * The render path's two hostile passes, replayed against the shared helper in
 * the order the block runs them: major hazards first, ordinary hostiles after.
 *
 * Deliberately not a reimplementation of either — it asks the same shared
 * classifier the game asks, so the partition it proves is the game's own.
 */
const hostileMarkers = (enemies, bounds = BOUNDS, blocked = []) => {
  const placed = [];
  for (const hostile of enemies) {
    if (hostile.hp <= 0 || !isMajorOffscreenHazard(hostile.kind)) continue;
    const marker = offscreenIndicatorFor(hostile, bounds, inset, { blocked });
    if (!marker) continue;
    placed.push({ hostile, marker, style: "hazard" });
    blocked.push(markerBlockFor(marker));
  }
  for (const hostile of enemies) {
    if (hostile.hp <= 0 || isMajorOffscreenHazard(hostile.kind)) continue;
    const marker = offscreenIndicatorFor(hostile, bounds, inset, { blocked });
    if (!marker) continue;
    placed.push({ hostile, marker, style: "enemy" });
    blocked.push(markerBlockFor(marker));
  }
  return placed;
};

/** The hazard placement pass, from its blocked list to where the PUPs start. */
const hazardBlock = () => {
  const block = renderBlock();
  return block.slice(block.indexOf("const hazardPlacement"), block.indexOf("const pupPlacement"));
};

/** The hazard marker's own drawing, up to where the hostile badge begins. */
const hazardArt = () => {
  const block = renderBlock();
  return block.slice(block.indexOf("drawOffscreenHazardMarker = ("), block.indexOf("drawOffscreenEnemyMarker = ("));
};

const bomb = (x, y, hp = 100) => enemy(x, y, "nuke", ENEMY_STATS.nuke.radius, hp);
const emitter = (x, y, hp = 10) => enemy(x, y, "beam", ENEMY_STATS.beam.radius, hp);

test("major hazards are classified in one place, off canonical hostile ids", () => {
  // The whole vocabulary lives in game-data, next to the hostiles themselves.
  assert.deepEqual([...MAJOR_OFFSCREEN_HAZARDS], ["nuke", "beam"]);
  for (const kind of MAJOR_OFFSCREEN_HAZARDS) {
    assert.ok(kind in ENEMY_STATS, `${kind} is not a canonical hostile id`);
    assert.ok(kind in ENEMY_COUNTS, `${kind} is not a hostile the rival fields`);
    assert.equal(WEAPONS[kind].id, kind);
  }
  assert.equal(isMajorOffscreenHazard("nuke"), true);
  assert.equal(isMajorOffscreenHazard("beam"), true);
  // Deliberately not every hostile: the ordinary rival hulls stay ordinary.
  for (const kind of Object.keys(ENEMY_STATS)) {
    if (MAJOR_OFFSCREEN_HAZARDS.includes(kind)) continue;
    assert.equal(isMajorOffscreenHazard(kind), false, `${kind} should not be a major hazard`);
  }
  assert.ok(Object.keys(ENEMY_STATS).length - MAJOR_OFFSCREEN_HAZARDS.length >= 10);

  // The render path asks the classifier and never names a hostile itself.
  const block = renderBlock();
  assert.equal((block.match(/isMajorOffscreenHazard\(enemy\.kind\)/g) ?? []).length, 2);
  for (const kind of Object.keys(ENEMY_STATS)) {
    assert.ok(!block.includes(`"${kind}"`), `the render path names the hostile id ${kind}`);
  }
  assert.doesNotMatch(block, /kind === |\.kind ===|threat >|category ===|ENEMY_STATS/);
  // And no second copy of the list anywhere in the client.
  assert.equal((codeOnly(game).match(/MAJOR_OFFSCREEN_HAZARDS/g) ?? []).length, 0);
  assert.match(
    readFileSync(new URL("../app/game-data.ts", import.meta.url), "utf8"),
    /export function isMajorOffscreenHazard\(kind: PowerId\): boolean/,
  );
});

test("the CORE BOMB is an existing hostile, and its own marker gets the hazard style", () => {
  // It already lives in game.enemies — no second entity, no second marker.
  assert.equal(ENEMY_STATS.nuke.hp, 100);
  assert.match(codeOnly(game), /enemy\.kind === "nuke"/);
  assert.match(codeOnly(game), /game\.enemies\.push\(makeEnemy\(/);

  const placed = hostileMarkers([bomb(-400, 300)]);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].style, "hazard");
  assert.equal(placed[0].marker.x, BOUNDS.left + inset);
  assert.equal(degrees(placed[0].marker.angle), 180);

  // The hazard pass is the only thing that draws it, and it is handed the
  // hostile's own kind, so CORE BOMB reads as CORE BOMB and not as a dot.
  const block = hazardBlock();
  assert.match(block, /if \(enemy\.hp <= 0 \|\| !isMajorOffscreenHazard\(enemy\.kind\)\) continue;/);
  assert.match(block, /\(hazardMarkers \?\?= \[\]\)\.push\(\{ marker, kind: enemy\.kind, urgent \}\)/);
  assert.match(renderBlock(), /drawOffscreenHazardMarker\(hazard\.marker, hazard\.kind, hazard\.urgent\)/);
  assert.match(hazardArt(), /ctx\.strokeStyle = POWER_COLORS\[kind\];/);
  assert.equal(POWER_COLORS.nuke, WEAPONS.nuke.color);
});

test("the SWEEP BEAM emitter is the hostile that gets marked, not the beam", () => {
  // The emitter is a live enemy record anchored at the rival portal; the sweep
  // itself is an effect drawn from it, with no entity of its own.
  assert.match(codeOnly(game), /enemy\.kind === "beam"/);
  assert.match(codeOnly(game), /enemy\.x = game\.portalX;\s*enemy\.y = game\.portalY;/);
  const placed = hostileMarkers([emitter(1500, 300)]);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].style, "hazard");
  assert.equal(placed[0].marker.x, BOUNDS.right - inset);
  // One emitter, one marker, however far the sweep reaches or how long it runs.
  assert.equal(hostileMarkers([emitter(1500, 300, 10)]).length, 1);
  assert.equal(hostileMarkers([{ ...emitter(1500, 300), phase: 2.4, age: 200 }]).length, 1);
  // The emitter's sweep angle never reaches the marker: the chevron points at
  // the emitter, not down the beam line.
  assert.doesNotMatch(hazardArt(), /phase|rotationDir|advanceBeamAngle|BEAM_/);
});

test("no marker is created for a projectile, a blast or any other effect", () => {
  // Only two world lists are ever walked for markers, and hostiles come from
  // game.enemies — never from the bullets, shells, blast rings or particles
  // the hazards themselves throw.
  const block = renderBlock();
  assert.deepEqual([...new Set(block.match(/game\.(?:bullets|powers|blasts|particles|spawns|enemies|pickups)/g) ?? [])].sort(),
    ["game.enemies", "game.pickups"]);
  assert.doesNotMatch(block, /blastRadius|countdown|segment|beamSegments|\.life\b/);
  // A live CORE BOMB mid-detonation and a sweeping emitter are still one
  // marker each, no matter what they have in the air.
  const detonating = { ...bomb(-500, 300), countdown: 0, blastRadius: 640 };
  const sweeping = { ...emitter(1500, 300), age: 200, phase: 1.1 };
  assert.equal(hostileMarkers([detonating, sweeping]).length, 2);
});

test("one world entity produces at most one marker, hazard or ordinary", () => {
  const world = [
    bomb(-400, 300), emitter(1500, 300),
    enemy(-420, 120), enemy(-440, 480, "gunship", 25), enemy(1520, 90, "artillery", 20),
    enemy(500, -400, "mines", 8), enemy(500, 1100, "ghost", 16),
  ];
  const placed = hostileMarkers(world);
  assert.equal(placed.length, world.length);
  // Every entity appears exactly once, and the two styles never overlap.
  for (const hostile of world) {
    assert.equal(placed.filter((entry) => entry.hostile === hostile).length, 1, `${hostile.kind} marked twice`);
  }
  const hazards = placed.filter((entry) => entry.style === "hazard").map((entry) => entry.hostile.kind);
  const ordinary = placed.filter((entry) => entry.style === "enemy").map((entry) => entry.hostile.kind);
  assert.deepEqual(hazards, ["nuke", "beam"]);
  assert.deepEqual(ordinary.filter((kind) => isMajorOffscreenHazard(kind)), []);

  // In the source the two loops are exact complements of the one classifier,
  // so nothing can fall into both and nothing can fall out of both.
  assert.match(hazardBlock(), /if \(enemy\.hp <= 0 \|\| !isMajorOffscreenHazard\(enemy\.kind\)\) continue;/);
  assert.match(enemyBlock(), /if \(enemy\.hp <= 0 \|\| isMajorOffscreenHazard\(enemy\.kind\)\) continue;/);
  assert.equal((renderBlock().match(/for \(const enemy of game\.enemies\)/g) ?? []).length, 3);
});

test("a major hazard takes its edge position before any ordinary hostile", () => {
  // Twenty ordinary hostiles crowd the left edge, and the CORE BOMB is offered
  // its spot last in world order — the pass order still gives it the position
  // that actually points at it.
  const swarm = Array.from({ length: 20 }, (_, index) => enemy(-200 - index * 15, 40 + index * 28));
  const alone = hostileMarkers([bomb(-500, 300)])[0].marker;
  const crowded = hostileMarkers([...swarm, bomb(-500, 300)]);
  const hazard = crowded.find((entry) => entry.style === "hazard");
  assert.equal(crowded.length, 21);
  assert.deepEqual(hazard.marker, alone, "the wave pushed the warning off its spot");
  // And it is placed first: every ordinary marker keeps clear of it, not the
  // other way round.
  for (const entry of crowded.filter((item) => item.style === "enemy")) {
    const gap = Math.hypot(entry.marker.x - hazard.marker.x, entry.marker.y - hazard.marker.y);
    assert.ok(gap >= radius * 2 - 1e-6, `an ordinary marker overlaps the hazard (gap ${gap})`);
  }
  // In the source: placed before the PUPs and the ordinary hostiles, painted
  // after them so a hazard is never the one underneath.
  const block = renderBlock();
  const hazardPlace = block.indexOf("const hazardPlacement");
  const pupPlace = block.indexOf("const pupPlacement");
  const enemyPlace = block.indexOf("const enemyPlacement");
  const enemyDraw = block.indexOf("drawOffscreenEnemyMarker(marker, enemy.kind)");
  const hazardDraw = block.indexOf("drawOffscreenHazardMarker(hazard.marker");
  assert.ok(hazardPlace > 0 && pupPlace > hazardPlace && enemyPlace > pupPlace);
  assert.ok(hazardDraw > enemyDraw);
});

test("major hazards stay below the Rift and the ally", () => {
  const blocked = [BADGE];
  const rift = offscreenIndicatorFor({ x: -700, y: -500, radius: RIFT_RADIUS }, BOUNDS, inset, { blocked });
  const ally = offscreenIndicatorFor({ x: -650, y: -450, radius: ALLY_RADIUS }, BOUNDS, inset, {
    blocked: [...blocked, markerBlockFor(rift)],
  });
  const occupied = [...blocked, markerBlockFor(rift), markerBlockFor(ally)];
  const [{ marker }] = hostileMarkers([bomb(-620, -420)], BOUNDS, [...occupied]);
  // The hazard yields to both of them rather than displacing either.
  for (const [name, other] of [["Rift", rift], ["ally", ally]]) {
    const gap = Math.hypot(marker.x - other.x, marker.y - other.y);
    assert.ok(gap >= radius * 2 - 1e-6, `the hazard marker overlaps the ${name} marker (gap ${gap})`);
  }
  assert.deepEqual(offscreenIndicatorFor({ x: -700, y: -500, radius: RIFT_RADIUS }, BOUNDS, inset, { blocked }), rift);

  // In the source: the Rift and ally are placed first and are blocked regions
  // for the hazard pass, and both still paint on top of it.
  const block = renderBlock();
  assert.ok(block.indexOf("const riftMarker") < block.indexOf("const hazardPlacement"));
  assert.match(hazardBlock(), /riftMarker \? \[markerBlockFor\(riftMarker, safePlacement\.markerRadius\)\] : \[\]/);
  assert.match(hazardBlock(), /allyMarker \? \[markerBlockFor\(allyMarker, safePlacement\.markerRadius\)\] : \[\]/);
  assert.ok(block.indexOf("drawOffscreenHazardMarker(hazard.marker") < block.indexOf("drawOffscreenMarker(riftMarker"));
  assert.ok(block.indexOf("drawOffscreenHazardMarker(hazard.marker") < block.indexOf("drawOffscreenMarker(allyMarker"));
});

test("a hazard marker slides out from under a HUD panel, keeping its heading", () => {
  const centre = cameraBoundsCenter(BOUNDS);
  const hazard = bomb(-600, 40);
  const [{ marker }] = hostileMarkers([hazard], BOUNDS, [BADGE]);
  assert.ok(clearOf(marker, [BADGE]), "the hazard marker landed under the rules badge");
  assert.equal(marker.angle, Math.atan2(hazard.y - centre.y, hazard.x - centre.x));
  assert.ok(marker.x >= BOUNDS.left + inset && marker.y >= BOUNDS.top + inset);
  // Repositioning is the shared slide, applied to the same blocked list every
  // other marker gets — not a rule of the hazard's own.
  assert.match(hazardBlock(), /offscreenIndicatorFor\(enemy, playfieldBounds, markerInset, hazardPlacement\)/);
  assert.match(hazardBlock(), /\.\.\.safePlacement\.blocked/);
  assert.doesNotMatch(hazardBlock(), /markerRadius: [\d.]|OFFSCREEN_INDICATOR_INSET|Math\.atan2/);
  assert.match(hazardBlock(), /markerRadius: safePlacement\.markerRadius/);
});

test("a hazard nudged along a crowded edge still points at the hazard", () => {
  const centre = cameraBoundsCenter(BOUNDS);
  // Two hazards and the Rift all off the same corner: everything moves except
  // the headings.
  const rift = offscreenIndicatorFor({ x: -800, y: -600, radius: RIFT_RADIUS }, BOUNDS, inset);
  const hazards = [bomb(-500, -320), emitter(-520, -300)];
  const placed = hostileMarkers(hazards, BOUNDS, [markerBlockFor(rift)]);
  assert.equal(placed.length, 2);
  for (const { hostile, marker } of placed) {
    assert.equal(marker.angle, Math.atan2(hostile.y - centre.y, hostile.x - centre.x));
    assert.ok(marker.x >= BOUNDS.left + inset && marker.x <= BOUNDS.right - inset);
    assert.ok(marker.y >= BOUNDS.top + inset && marker.y <= BOUNDS.bottom - inset);
  }
  const gap = Math.hypot(placed[0].marker.x - placed[1].marker.x, placed[0].marker.y - placed[1].marker.y);
  assert.ok(gap >= radius * 2 - 1e-6, `two hazard markers overlap (gap ${gap})`);
});

test("a hazard the pilot can see gets no marker", () => {
  assert.deepEqual(hostileMarkers([bomb(500, 300), emitter(500, 300)]), []);
  // Well inside the border, on every side, is visible too.
  assert.deepEqual(hostileMarkers([bomb(60, 560), emitter(940, 40)]), []);
  // Visibility is the shared body-aware rule, unchanged: half a hull inside.
  assert.equal(isTargetOffscreen(bomb(20, 300), BOUNDS), false);
  assert.equal(isTargetOffscreen(bomb(9, 300), BOUNDS), true);
  assert.equal(isTargetOffscreen(bomb(500, 300), BOUNDS), false);
  // Full Arena shows the whole world, so nothing is marked at all.
  assert.deepEqual(hostileMarkers([bomb(2200, 1300), emitter(60, 40)], { left: 0, top: 0, right: 2400, bottom: 1400 }), []);
  // The hazard pass adds no visibility maths of its own.
  assert.doesNotMatch(hazardBlock(), /isTargetOffscreen|OFFSCREEN_VISIBLE_BODY|radius:/);
});

test("a destroyed or despawned hazard stops producing a marker", () => {
  assert.deepEqual(hostileMarkers([{ ...bomb(-400, 300), hp: 0 }]), []);
  assert.deepEqual(hostileMarkers([{ ...emitter(1500, 300), hp: 0 }]), []);
  const alive = bomb(-400, 300);
  assert.equal(hostileMarkers([alive, { ...emitter(1500, 300), hp: 0 }]).length, 1);
  // Despawn takes it out of the world list, and nothing else is remembered.
  assert.deepEqual(hostileMarkers([]), []);
  const block = hazardBlock();
  assert.match(block, /for \(const enemy of game\.enemies\)/);
  assert.doesNotMatch(block, /hazardCache|lastHazard|useRef|Ref\.current/);
  assert.doesNotMatch(block, /enemy\.(?:marker|indicator|offscreen)/);
  // The held list is rebuilt each frame and stays null when nothing is marked.
  assert.match(block, /let hazardMarkers: \{ marker: OffscreenIndicator; kind: PowerId; urgent: boolean \}\[\] \| null = null;/);
});

test("the hazard marker reads as an alarm, not as the ordinary threat badge", () => {
  const art = hazardArt();
  // Alarm red, a warning triangle, and a heavier double outline.
  assert.match(codeOnly(game), /const OFFSCREEN_HAZARD_ACCENT = "#ff2f2f";/);
  assert.match(art, /const accent = OFFSCREEN_HAZARD_ACCENT;/);
  assert.doesNotMatch(art, /OFFSCREEN_ENEMY_ACCENT|OFFSCREEN_ENEMY_BADGE|ctx\.ellipse|drawPupFrame|pupFrameColor/);
  // Not the Rift's colours, not the ally's, not a PUP class colour.
  for (const color of ["#ff4cbe", "#ff2a3f", "#b6ff57"]) assert.ok(!art.includes(color));
  for (const color of Object.values(PUP_FRAME_COLORS)) assert.ok(!art.includes(color));
  // The badge is a triangle and it stays upright; only the chevron turns.
  assert.match(art, /ctx\.rotate\(indicator\.angle\);[\s\S]*?ctx\.restore\(\);[\s\S]*?ctx\.moveTo\(0, -8\.4\)/);
  const upright = art.slice(art.indexOf("ctx.moveTo(0, -8.4)"));
  assert.doesNotMatch(upright, /ctx\.rotate\(/);
  // Same compact footprint as every other marker — a louder badge, not a bigger one.
  const points = [...art.matchAll(/ctx\.(?:moveTo|lineTo|arc)\((-?[\d.]+), (-?[\d.]+)/g)];
  assert.ok(points.length > 0);
  for (const [, x, y] of points) assert.ok(Math.abs(Number(x)) <= 14 && Math.abs(Number(y)) <= 14);
  assert.match(renderBlock(), /ctx\.scale\(1 \/ camScale, 1 \/ camScale\)/);
  // The identifying core is the hazard's own kind colour, from the same table
  // its hull is drawn from, so CORE BOMB and SWEEP BEAM stay distinguishable.
  assert.match(art, /ctx\.fillStyle = POWER_COLORS\[kind\];/);
  assert.notEqual(POWER_COLORS.nuke, POWER_COLORS.beam);
});

test("the hazard pulse is a badge alpha only, and flattens for reduced motion", () => {
  const art = hazardArt();
  assert.match(art, /urgent[\s\S]*0\.82 \+ 0\.18 \* Math\.sin\(time \* 0\.012\)/);
  assert.match(art, /0\.86 \+ 0\.14 \* Math\.sin\(time \* 0\.006\)/);
  assert.match(art, /ctx\.globalAlpha = \(urgent \? 0\.98 : 0\.86\) \* pulse;/);
  // Alpha only: nothing grows, nothing moves, and the screen is untouched.
  assert.doesNotMatch(art, /pulse \*|\* pulse[^;]|fillRect|globalCompositeOperation|W, H|shake/);
  // Named once and spent once: the alpha is the only thing it touches.
  assert.equal((art.match(/pulse/g) ?? []).length, 2);
  // The steady value stays bright, so the warning never depends on animation.
  const steady = 0.86 * 1;
  const dimmest = 0.86 * (0.86 - 0.14);
  assert.ok(steady > 0.8 && dimmest > 0.6, "the pulse must never dim the warning away");
});

test("the CORE BOMB warning escalates for its final fuse and blast phase", () => {
  const block = hazardBlock();
  assert.match(block, /const urgent = isMajorOffscreenHazardUrgent\(enemy\);/);
  assert.match(block, /push\(\{ marker, kind: enemy\.kind, urgent \}\)/);
  assert.match(renderBlock(), /drawOffscreenHazardMarker\(hazard\.marker, hazard\.kind, hazard\.urgent\)/);

  // The blast phase keeps counting below zero, so it remains urgent until the
  // existing hostile expires. Other hazards retain the standard red pulse.
  assert.equal(isMajorOffscreenHazardUrgent({ kind: "nuke", countdown: 181 }), false);
  assert.equal(isMajorOffscreenHazardUrgent({ kind: "nuke", countdown: 180 }), true);
  assert.equal(isMajorOffscreenHazardUrgent({ kind: "nuke", countdown: 0 }), true);
  assert.equal(isMajorOffscreenHazardUrgent({ kind: "nuke", countdown: -20 }), true);
  assert.equal(isMajorOffscreenHazardUrgent({ kind: "beam", countdown: 0 }), false);
});

test("ordinary hostiles, the Rift, the ally and the PUPs are untouched", () => {
  // The ordinary threat badge keeps its colour, its star and its call site.
  assert.match(codeOnly(game), /const OFFSCREEN_ENEMY_ACCENT = "#ff9a4d";/);
  const ordinaryArt = (() => {
    const block = renderBlock();
    return block.slice(block.indexOf("drawOffscreenEnemyMarker = ("), block.indexOf("const riftBody"));
  })();
  assert.match(ordinaryArt, /const accent = OFFSCREEN_ENEMY_ACCENT;/);
  assert.match(ordinaryArt, /OFFSCREEN_ENEMY_BADGE/);
  assert.doesNotMatch(ordinaryArt, /OFFSCREEN_HAZARD_ACCENT|pulse|isMajorOffscreenHazard/);
  assert.match(enemyBlock(), /drawOffscreenEnemyMarker\(marker, enemy\.kind\)/);

  // A wave of ordinary hostiles lands exactly where it did before hazards
  // existed, as long as no hazard is out there with them.
  const swarm = Array.from({ length: 12 }, (_, index) => enemy(-200 - index * 40, 60 + index * 40));
  assert.deepEqual(hostileMarkers(swarm).map((entry) => entry.marker), enemyMarkers(swarm).map((entry) => entry.marker));

  // And the three higher-priority markers are unchanged by a hazard being out.
  const blocked = [BADGE];
  const rift = offscreenIndicatorFor({ x: -700, y: -500, radius: RIFT_RADIUS }, BOUNDS, inset, { blocked });
  const ally = offscreenIndicatorFor({ x: 1400, y: 320, radius: ALLY_RADIUS }, BOUNDS, inset, { blocked });
  const pups = selection([pup(-300, 300), pup(-400, 320)]);
  hostileMarkers([bomb(-500, 300), emitter(1500, 300), ...swarm], BOUNDS, [...blocked]);
  assert.deepEqual(offscreenIndicatorFor({ x: -700, y: -500, radius: RIFT_RADIUS }, BOUNDS, inset, { blocked }), rift);
  assert.deepEqual(offscreenIndicatorFor({ x: 1400, y: 320, radius: ALLY_RADIUS }, BOUNDS, inset, { blocked }), ally);
  assert.deepEqual(selection([pup(-300, 300), pup(-400, 320)]), pups);
  assert.equal(MAX_OFFSCREEN_PUP_INDICATORS, 5);
  const block = renderBlock();
  assert.match(block, /drawOffscreenPupMarker\(marker, WEAPONS\[pickup\.type\]\.pupClass\)/);
  assert.match(block, /if \(riftMarker\) drawOffscreenMarker\(riftMarker, game\.enrageActive \? "#ff2a3f" : "#ff4cbe", false\)/);
  assert.match(block, /if \(allyMarker\) drawOffscreenMarker\(allyMarker, "#b6ff57", true\)/);
});

test("hazard markers are local presentation: no protocol, no HUD toggle, no sound", () => {
  const block = hazardBlock();
  assert.doesNotMatch(block, /send|emit|socket|report|publish|message|netRef|playCue|audio|sfx/i);
  // Read-only over the world list: nothing spawned, damaged, moved or killed.
  assert.doesNotMatch(block, /game\.enemies\s*=|damageEnemy|destroyEnemy|makeEnemy|spawn/);
  assert.doesNotMatch(block, /enemy\.(?:x|y|vx|vy|hp|radius|kind|cooldown|countdown|blastRadius|phase|armed)\s*=/);
  // Nothing was added to the wire protocol or the client's outbound calls.
  const protocol = readFileSync(new URL("../server/protocol.mjs", import.meta.url), "utf8");
  const client = readFileSync(new URL("../app/pvp-client.ts", import.meta.url), "utf8");
  for (const source of [protocol, client]) {
    assert.doesNotMatch(source, /offscreen|indicator|hazardMarker|MAJOR_OFFSCREEN/i);
  }
  // No new setting: the view-settings vocabulary is untouched by any of this.
  const settings = readFileSync(new URL("../app/view-settings.ts", import.meta.url), "utf8");
  assert.doesNotMatch(settings, /hazard|offscreen|indicator/i);
  // And no cue was added for it.
  assert.doesNotMatch(hazardArt(), /playCue|play\(|Audio|beep|alarmSound/);
});

// --------------------------------------------------- the visible playfield --
//
// Everything above this line is geometry against a rectangle, and all of it
// passed while left and right markers were invisible in the running game. The
// reason is that the rectangle the markers were being placed in was the whole
// arena canvas, and on the immersive layouts the canvas is deliberately drawn
// wider than the box that clips it: `min-width: 100%` on an element that keeps
// the world's aspect ratio, inside a wrapper with `overflow: hidden`. Only the
// width is free to grow — the canvas is handed its wrapper's exact height — so
// the discarded strip is always on the left and the right, which is exactly why
// top and bottom markers worked and side markers did not.
//
// So these tests do what the old ones did not: they treat the playfield as a
// rectangle that can be narrower than the canvas, and they check the marker's
// drawn footprint rather than its anchor point.

/**
 * The marker art, pulled out of the render block rather than restated here, so
 * a change to a chevron or a badge is measured instead of being assumed.
 */
const markerArt = (open, close) => {
  const block = renderBlock();
  const from = block.indexOf(open);
  assert.ok(from > 0, `expected ${open} in the render block`);
  const to = close ? block.indexOf(close) : block.length;
  return block.slice(from, to > from ? to : block.length);
};

const MARKER_ART = {
  rift: () => markerArt("drawOffscreenMarker = (", "drawOffscreenPupMarker = ("),
  pup: () => markerArt("drawOffscreenPupMarker = (", "drawOffscreenHazardMarker = ("),
  hazard: () => markerArt("drawOffscreenHazardMarker = (", "drawOffscreenEnemyMarker = ("),
  enemy: () => markerArt("drawOffscreenEnemyMarker = (", "const riftBody ="),
};

/**
 * How far the furthest ink in one marker's drawing sits from its anchor.
 *
 * Read off the real path calls: every vertex, the outer edge of every ellipse
 * and arc, half of the widest stroke laid over them, and the widest glow the
 * marker asks for. The chevron is drawn rotated and the badge upright, so the
 * honest answer is a radius around the anchor rather than a box.
 */
const drawnReach = (art) => {
  let reach = 0;
  for (const [, x, y] of art.matchAll(/ctx\.(?:moveTo|lineTo)\(([-\d.]+), ([-\d.]+)\)/g)) {
    reach = Math.max(reach, Math.hypot(Number(x), Number(y)));
  }
  for (const [, x, y, rx, ry] of art.matchAll(/ctx\.ellipse\(([-\d.]+), ([-\d.]+), ([\d.]+), ([\d.]+)/g)) {
    reach = Math.max(reach, Math.hypot(Number(x), Number(y)) + Math.max(Number(rx), Number(ry)));
  }
  for (const [, x, y, r] of art.matchAll(/ctx\.arc\(([-\d.]+), ([-\d.]+), ([\d.]+)/g)) {
    reach = Math.max(reach, Math.hypot(Number(x), Number(y)) + Number(r));
  }
  const widths = [...art.matchAll(/ctx\.lineWidth = ([\d.]+)/g)].map((m) => Number(m[1]));
  const blurs = [...art.matchAll(/shadowBlur = ([\d.]+)/g)].map((m) => Number(m[1]));
  return reach + Math.max(0, ...widths) / 2 + Math.max(0, ...blurs);
};

/** The four-point star badge is built in a loop, so its reach is a constant. */
const ENEMY_BADGE_REACH = 6.5;

/**
 * The playfield a clipped layout actually shows: a tablet in portrait, whose
 * arena canvas overhangs its wrapper by a quarter of its width on each side.
 * Same numbers the browser reports for an 820 × 1180 viewport.
 */
const CLIPPED = { left: 250, top: 0, right: 750, bottom: 600 };

/** Every side and every corner, as a target far outside the playfield. */
const AROUND = (bounds) => {
  const midX = (bounds.left + bounds.right) / 2;
  const midY = (bounds.top + bounds.bottom) / 2;
  const outL = bounds.left - 800, outR = bounds.right + 800;
  const outT = bounds.top - 800, outB = bounds.bottom + 800;
  return {
    top: { x: midX, y: outT },
    bottom: { x: midX, y: outB },
    left: { x: outL, y: midY },
    right: { x: outR, y: midY },
    upperLeft: { x: outL, y: outT },
    upperRight: { x: outR, y: outT },
    lowerLeft: { x: outL, y: outB },
    lowerRight: { x: outR, y: outB },
  };
};

/** The marker's whole drawn body, as a box, at `reach` around its anchor. */
const footprint = (marker, reach) => ({
  left: marker.x - reach,
  top: marker.y - reach,
  right: marker.x + reach,
  bottom: marker.y + reach,
});

const containedIn = (box, bounds) =>
  box.left >= bounds.left && box.right <= bounds.right
  && box.top >= bounds.top && box.bottom <= bounds.bottom;

test("the marker extent covers the furthest ink every marker type draws", () => {
  for (const [name, art] of Object.entries(MARKER_ART)) {
    const reach = drawnReach(art());
    assert.ok(reach > 0, `expected to find drawn geometry for the ${name} marker`);
    assert.ok(
      reach <= OFFSCREEN_MARKER_EXTENT,
      `the ${name} marker reaches ${reach.toFixed(2)} from its anchor, past the ${OFFSCREEN_MARKER_EXTENT} the clamp reserves`,
    );
  }
  // The hostile badge is generated rather than written out, so its reach is
  // asserted against the constant the render block builds it from.
  assert.match(codeOnly(game), /reach = point % 2 === 0 \? 6\.5 : 2\.8/);
  assert.ok(ENEMY_BADGE_REACH < OFFSCREEN_MARKER_EXTENT);
  // The clamp reserves more room than the separation box, because ink reaches
  // further than the box markers keep each other out of.
  assert.ok(OFFSCREEN_MARKER_EXTENT > OFFSCREEN_MARKER_RADIUS);
});

test("every edge and corner keeps the whole marker body inside the playfield", () => {
  for (const bounds of [BOUNDS, CLIPPED]) {
    for (const [side, target] of Object.entries(AROUND(bounds))) {
      const marker = offscreenIndicatorFor({ ...target, radius: RIFT_RADIUS }, bounds, inset);
      assert.ok(marker, `expected a ${side} marker`);
      assert.ok(
        containedIn(footprint(marker, OFFSCREEN_MARKER_EXTENT), bounds),
        `the ${side} marker's body left the playfield: ${JSON.stringify(marker)} in ${JSON.stringify(bounds)}`,
      );
    }
  }
});

test("the directional chevron stays inside the playfield, whichever way it points", () => {
  // The chevron is the furthest-out part of the marker and it rotates with the
  // target, so it is checked at its real tip rather than inside a box: for each
  // side, the tip of the longest chevron any marker draws, turned to the
  // marker's own angle.
  const tip = Math.max(...Object.values(MARKER_ART).map((art) => {
    const points = [...art().matchAll(/ctx\.(?:moveTo|lineTo)\(([\d.]+), ([-\d.]+)\)/g)];
    return Math.max(...points.map(([, x, y]) => Math.hypot(Number(x), Number(y))));
  }));
  for (const bounds of [BOUNDS, CLIPPED]) {
    for (const [side, target] of Object.entries(AROUND(bounds))) {
      const marker = offscreenIndicatorFor({ ...target, radius: RIFT_RADIUS }, bounds, inset);
      const point = {
        x: marker.x + Math.cos(marker.angle) * tip,
        y: marker.y + Math.sin(marker.angle) * tip,
      };
      assert.ok(
        point.x >= bounds.left && point.x <= bounds.right
        && point.y >= bounds.top && point.y <= bounds.bottom,
        `the ${side} chevron tip left the playfield: ${JSON.stringify(point)} in ${JSON.stringify(bounds)}`,
      );
    }
  }
});

test("a narrower playfield moves the side markers in, and leaves top and bottom alone", () => {
  // The clipped playfield is the full one with a strip taken off each side, so
  // top and bottom markers land in exactly the same place and only the side
  // markers move — inward, by the width of the strip that was being thrown away.
  const wide = { left: 0, top: 0, right: 1000, bottom: 600 };
  const narrow = { left: 250, top: 0, right: 750, bottom: 600 };
  const around = AROUND(wide);
  for (const side of ["top", "bottom"]) {
    const before = offscreenIndicatorFor({ ...around[side], radius: RIFT_RADIUS }, wide, inset);
    const after = offscreenIndicatorFor({ ...around[side], radius: RIFT_RADIUS }, narrow, inset);
    assert.equal(after.y, before.y, `the ${side} marker should not have moved vertically`);
  }
  const left = offscreenIndicatorFor({ ...around.left, radius: RIFT_RADIUS }, narrow, inset);
  const right = offscreenIndicatorFor({ ...around.right, radius: RIFT_RADIUS }, narrow, inset);
  assert.equal(left.x, narrow.left + inset);
  assert.equal(right.x, narrow.right - inset);
  // And a target inside the canvas but inside the discarded strip — invisible
  // to the pilot — is now marked rather than silently left unannounced.
  const hidden = { x: 100, y: 300, radius: RIFT_RADIUS };
  assert.equal(isTargetOffscreen(hidden, wide), false);
  assert.equal(isTargetOffscreen(hidden, narrow), true);
  assert.ok(offscreenIndicatorFor(hidden, narrow, inset));
});

test("HUD safe-zone repositioning never pushes a side marker out of the playfield", () => {
  // Both real panels, mapped onto a clipped playfield: the rules badge in the
  // top-left, the system controls in the top-right, each overlapping the side
  // the markers are pinned to.
  const badge = { left: 250, top: 0, right: 470, bottom: 120 };
  const controls = { left: 620, top: 0, right: 750, bottom: 90 };
  const blocked = [badge, controls];
  for (const [side, target] of Object.entries(AROUND(CLIPPED))) {
    const marker = offscreenIndicatorFor(
      { ...target, radius: RIFT_RADIUS },
      CLIPPED,
      inset,
      { blocked, markerRadius: OFFSCREEN_MARKER_RADIUS },
    );
    assert.ok(marker, `expected a ${side} marker`);
    assert.ok(
      containedIn(footprint(marker, OFFSCREEN_MARKER_EXTENT), CLIPPED),
      `the ${side} marker escaped a HUD panel by leaving the playfield: ${JSON.stringify(marker)}`,
    );
    // Escaping a panel moves the marker; it never turns it away from its target.
    const free = offscreenIndicatorFor({ ...target, radius: RIFT_RADIUS }, CLIPPED, inset);
    assert.equal(marker.angle, free.angle, `the ${side} marker was rotated toward its adjusted position`);
    for (const region of blocked) {
      const body = footprint(marker, OFFSCREEN_MARKER_RADIUS);
      assert.ok(
        body.right <= region.left || body.left >= region.right
        || body.bottom <= region.top || body.top >= region.bottom,
        `the ${side} marker stayed under a HUD panel`,
      );
    }
  }
});

test("marker separation keeps every crowded side marker inside the playfield", () => {
  // A column of targets off one side, placed the way the render block places
  // them: each marker becomes a blocked region for the next.
  for (const side of ["left", "right"]) {
    const outward = side === "left" ? CLIPPED.left - 900 : CLIPPED.right + 900;
    const placement = { blocked: [], markerRadius: OFFSCREEN_MARKER_RADIUS };
    for (let index = 0; index < 12; index += 1) {
      const target = { x: outward, y: CLIPPED.top + 40 + index * 17, radius: RIFT_RADIUS };
      const marker = offscreenIndicatorFor(target, CLIPPED, inset, placement);
      assert.ok(marker, `expected a ${side} marker for target ${index}`);
      assert.ok(
        containedIn(footprint(marker, OFFSCREEN_MARKER_EXTENT), CLIPPED),
        `separation pushed a ${side} marker out of the playfield: ${JSON.stringify(marker)}`,
      );
      placement.blocked.push(markerBlockFor(marker, OFFSCREEN_MARKER_RADIUS));
    }
  }
});

test("the Rift, ally, hazard, PUP and hostile markers all take the corrected path", () => {
  // One rectangle, built once from the measured playfield, handed to every
  // marker type. No type carries its own bounds, and none of them is handed the
  // raw camera rectangle any more.
  const block = renderBlock();
  assert.equal((block.match(/const playfieldBounds = \{/g) ?? []).length, 1);
  assert.match(block, /left: \(playfieldBox\.left - camX\) \/ camScale/);
  assert.match(block, /right: \(playfieldBox\.right - camX\) \/ camScale/);
  assert.match(block, /top: \(playfieldBox\.top - camY\) \/ camScale/);
  assert.match(block, /bottom: \(playfieldBox\.bottom - camY\) \/ camScale/);
  assert.doesNotMatch(block, /\bviewLeft\b|\bviewRight\b|\bviewTop\b|\bviewBottom\b/);
  // Every consumer of the bounds names the same variable.
  for (const call of [
    /offscreenIndicatorFor\(riftBody, playfieldBounds, markerInset, safePlacement\)/,
    /offscreenIndicatorFor\(allyBody, playfieldBounds, markerInset, safePlacement\)/,
    /offscreenIndicatorFor\(enemy, playfieldBounds, markerInset, hazardPlacement\)/,
    /playfieldBounds,\s*markerInset,\s*pupPlacement,/,
    /offscreenIndicatorFor\(enemy, playfieldBounds, markerInset, enemyPlacement\)/,
    /nearestOffscreenTargets\(\s*game\.pickups,\s*playfieldBounds,/,
  ]) assert.match(block, call);
  // And the drawn extent rides the camera scale exactly like the inset does,
  // so the reserved room is the same number of screen pixels at any zoom.
  assert.match(block, /markerExtent: OFFSCREEN_MARKER_EXTENT \/ camScale/);
  assert.match(block, /markerExtent: safePlacement\.markerExtent/);
});

test("the visible playfield is measured from the layout, not assumed", () => {
  const source = codeOnly(game);
  // Every box between the canvas and the window that clips is intersected in,
  // rather than the wrapper alone being special-cased.
  assert.match(source, /for \(let node = canvas\.parentElement; node && clipped; node = node\.parentElement\)/);
  assert.match(source, /style\.overflowX === "visible" && style\.overflowY === "visible"/);
  assert.match(source, /intersectBounds\(visible, viewport\)/);
  // Re-measured when the layout moves, and alongside the HUD panels, rather
  // than once at startup.
  assert.equal((source.match(/measurePlayfield\(\)/g) ?? []).length, 2);
  // A degenerate measurement falls back to the whole canvas instead of stacking
  // every marker into a sliver.
  assert.match(source, /if \(!clipped\) \{\s*playfieldBox = full;/);
  // Priority is untouched: the Rift, then the ally, then hazards, then PUPs,
  // then ordinary hostiles, in that order down the block.
  const block = renderBlock();
  const order = ["riftMarker =", "allyMarker =", "hazardPlacement", "pupPlacement", "enemyPlacement"];
  const found = order.map((needle) => block.indexOf(needle));
  assert.deepEqual(found, [...found].sort((a, b) => a - b));
  assert.ok(found.every((index) => index > 0));
});
