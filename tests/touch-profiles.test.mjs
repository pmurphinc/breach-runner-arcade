/**
 * The named touch-layout model.
 *
 * The load-bearing guarantee is the first test: M-Sticks is the default and
 * nothing in this module may change how it behaves. Everything else is about
 * surviving untrusted input, because an imported layout is arbitrary text and a
 * layout that places a control off-screen is unrecoverable without wiping
 * settings.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOM_TOUCH_LAYOUT_VERSION,
  TOUCH_ELEMENT_IDS,
  TOUCH_ELEMENT_RANGES,
  TOUCH_PROFILE_IDS,
  clampTouchElement,
  customTouchLayoutVariables,
  defaultCustomTouchLayout,
  isTouchProfileId,
  isTouchStick,
  mirrorCustomTouchLayout,
  normalizeCustomTouchLayout,
  parseCustomTouchLayout,
  serializeCustomTouchLayout,
  touchElementEdge,
} from "../app/touch-profiles.ts";
import { DEFAULT_SETTINGS, migrateSettings } from "../app/view-settings.ts";

test("M-Sticks is the default and stays the shipped behaviour", () => {
  assert.deepEqual([...TOUCH_PROFILE_IDS], ["m-sticks", "custom"]);
  assert.equal(DEFAULT_SETTINGS.touchProfile, "m-sticks");
  // The size and height presets belong to M-Sticks and are untouched.
  assert.equal(DEFAULT_SETTINGS.touchControlSize, "medium");
  assert.equal(DEFAULT_SETTINGS.touchControlHeight, "middle");
});

test("an unknown profile id falls back rather than stranding the player", () => {
  assert.equal(migrateSettings({ touchProfile: "custom" }).touchProfile, "custom");
  assert.equal(migrateSettings({ touchProfile: "cszz" }).touchProfile, "m-sticks");
  assert.equal(migrateSettings({}).touchProfile, "m-sticks");
  assert.ok(isTouchProfileId("custom"));
  assert.ok(!isTouchProfileId("CUSTOM"));
});

test("every element is clamped into its own range", () => {
  for (const id of TOUCH_ELEMENT_IDS) {
    const [min, max] = TOUCH_ELEMENT_RANGES.size[id];
    assert.equal(clampTouchElement(id, { size: -999, x: 0, y: 0, deadzone: 0 }).size, min);
    assert.equal(clampTouchElement(id, { size: 9999, x: 0, y: 0, deadzone: 0 }).size, max);
    const wild = clampTouchElement(id, { size: 100, x: 99999, y: -99999, deadzone: 0 });
    assert.equal(wild.x, TOUCH_ELEMENT_RANGES.x[1]);
    assert.equal(wild.y, TOUCH_ELEMENT_RANGES.y[0]);
  }
});

test("a dead zone can never swallow its own stick", () => {
  // Absolute bounds are not enough: a 96px dead zone on an 88px stick would
  // leave a control with no live travel at all.
  const tight = clampTouchElement("move", { size: 88, x: 0, y: 0, deadzone: 96 });
  assert.ok(tight.deadzone < tight.size, "dead zone must stay inside the stick");
  assert.equal(tight.deadzone, Math.floor(88 * 0.6));
  const roomy = clampTouchElement("move", { size: 300, x: 0, y: 0, deadzone: 96 });
  assert.equal(roomy.deadzone, 96, "a large stick still honours the absolute ceiling");
});

test("only sticks carry a dead zone", () => {
  for (const id of TOUCH_ELEMENT_IDS) {
    const geometry = clampTouchElement(id, { size: 120, x: 0, y: 0, deadzone: 40 });
    if (isTouchStick(id)) assert.equal(geometry.deadzone, 40);
    else assert.equal(geometry.deadzone, 0, `${id} is not a stick and must not keep a dead zone`);
  }
});

test("NaN takes the low bound; an infinity clamps to the bound it is reaching for", () => {
  // These are different failures. A too-large number still means "as far right
  // as this goes"; snapping it to the low bound would fling the control across
  // the screen. NaN carries no such intent, so it takes the floor.
  const broken = clampTouchElement("aim", { size: NaN, x: Infinity, y: -Infinity, deadzone: NaN });
  assert.equal(broken.size, TOUCH_ELEMENT_RANGES.size.aim[0], "NaN size falls to the floor");
  assert.equal(broken.x, TOUCH_ELEMENT_RANGES.x[1], "Infinity clamps to the high bound");
  assert.equal(broken.y, TOUCH_ELEMENT_RANGES.y[0], "-Infinity clamps to the low bound");
  assert.ok(Number.isFinite(broken.deadzone));
});

test("steering sits opposite the dominant hand", () => {
  assert.equal(touchElementEdge("move", "right"), "left", "right-handed steers on the left");
  assert.equal(touchElementEdge("aim", "right"), "right");
  for (const id of ["pup", "spec", "pause"]) assert.equal(touchElementEdge(id, "right"), "right");
  // Mirrored, every element swaps sides.
  for (const id of TOUCH_ELEMENT_IDS) {
    assert.notEqual(touchElementEdge(id, "right"), touchElementEdge(id, "left"));
  }
});

test("mirroring is one field, because x is measured from each element's own edge", () => {
  const layout = defaultCustomTouchLayout();
  const mirrored = mirrorCustomTouchLayout(layout);
  assert.equal(mirrored.handed, "left");
  assert.deepEqual(mirrored.elements, layout.elements, "no coordinate should move");
  assert.deepEqual(mirrorCustomTouchLayout(mirrored), layout, "mirroring twice is identity");
});

test("normalising survives partial, hostile and absent payloads", () => {
  const base = defaultCustomTouchLayout();
  assert.deepEqual(normalizeCustomTouchLayout(null), base);
  assert.deepEqual(normalizeCustomTouchLayout("nonsense"), base);
  assert.deepEqual(normalizeCustomTouchLayout({ elements: null }), base);
  // A single valid field is kept; its siblings fall back rather than vanishing.
  const partial = normalizeCustomTouchLayout({ elements: { move: { size: 200 } } });
  assert.equal(partial.elements.move.size, 200);
  assert.equal(partial.elements.move.x, base.elements.move.x);
  assert.equal(partial.elements.aim.size, base.elements.aim.size);
  for (const id of TOUCH_ELEMENT_IDS) assert.ok(partial.elements[id], `${id} must always be present`);
});

test("an out-of-range import is clamped, never rejected", () => {
  const layout = normalizeCustomTouchLayout({
    handed: "left",
    elements: { move: { size: 5000, x: -5000, y: 5000, deadzone: 5000 } },
  });
  assert.equal(layout.handed, "left");
  assert.equal(layout.elements.move.size, TOUCH_ELEMENT_RANGES.size.move[1]);
  assert.equal(layout.elements.move.x, TOUCH_ELEMENT_RANGES.x[0]);
  assert.ok(layout.elements.move.deadzone < layout.elements.move.size);
});

test("export and import round-trip", () => {
  const layout = mirrorCustomTouchLayout(defaultCustomTouchLayout());
  layout.elements.pup.size = 120;
  const text = serializeCustomTouchLayout(layout);
  assert.deepEqual(parseCustomTouchLayout(text), normalizeCustomTouchLayout(layout));
  assert.match(text, /\n/, "pretty-printed so a player can read it");
  // Malformed text is a defaulted layout, not a crash.
  assert.deepEqual(parseCustomTouchLayout("{not json"), defaultCustomTouchLayout());
  assert.deepEqual(parseCustomTouchLayout(""), defaultCustomTouchLayout());
});

test("the version is stamped on everything that comes out", () => {
  assert.equal(defaultCustomTouchLayout().version, CUSTOM_TOUCH_LAYOUT_VERSION);
  assert.equal(normalizeCustomTouchLayout({ version: 99 }).version, CUSTOM_TOUCH_LAYOUT_VERSION);
});

test("CSS variables cover every element and carry the anchored edge", () => {
  const variables = customTouchLayoutVariables(defaultCustomTouchLayout());
  for (const id of TOUCH_ELEMENT_IDS) {
    assert.match(variables[`--touch-${id}-size`], /^\d+px$/);
    assert.match(variables[`--touch-${id}-x`], /^-?\d+px$/);
    assert.match(variables[`--touch-${id}-y`], /^-?\d+px$/);
    assert.ok(["left", "right"].includes(variables[`--touch-${id}-edge`]));
    // Only sticks publish a dead zone, so the stylesheet cannot read one for a button.
    if (isTouchStick(id)) assert.match(variables[`--touch-${id}-deadzone`], /^\d+px$/);
    else assert.equal(variables[`--touch-${id}-deadzone`], undefined);
  }
});

test("variables reflect handedness", () => {
  const right = customTouchLayoutVariables(defaultCustomTouchLayout());
  const left = customTouchLayoutVariables(mirrorCustomTouchLayout(defaultCustomTouchLayout()));
  assert.equal(right["--touch-move-edge"], "left");
  assert.equal(left["--touch-move-edge"], "right");
  assert.equal(right["--touch-move-x"], left["--touch-move-x"], "only the edge changes");
});
