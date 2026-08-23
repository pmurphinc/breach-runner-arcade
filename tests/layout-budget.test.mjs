/**
 * The one layout calculation, exercised at every viewport that matters.
 *
 * The rule these all come back to: fixed chrome is subtracted first, touch
 * controls next, and the arena takes what is left. A control is never pushed
 * off screen to make the arena bigger.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CHROME,
  DEFAULT_PRESET,
  MIN_ARENA,
  SCREEN_PRESETS,
  budgetFor,
  budgetsEqual,
  isScreenPreset,
  normalizePreset,
  resolveTouchControls,
} from "../app/layout-budget.ts";

const viewport = (partial = {}) => ({
  width: 1920,
  height: 1080,
  scale: 1,
  dpr: 1,
  safeTop: 0,
  safeRight: 0,
  safeBottom: 0,
  safeLeft: 0,
  touch: false,
  coarse: false,
  touchControls: "auto",
  stickScale: 1,
  ...partial,
});

/** The vertical strips the arena may never eat into. */
const requiredChrome = CHROME.top + CHROME.dock;

const DEVICES = {
  "2048x1152 desktop": viewport({ width: 2048, height: 1152 }),
  "2048x1152 touch desktop": viewport({ width: 2048, height: 1152, touch: true }),
  "1920x1080 desktop": viewport({ width: 1920, height: 1080 }),
  "1366x768 laptop": viewport({ width: 1366, height: 768 }),
  "ultrawide": viewport({ width: 3440, height: 1440 }),
  "tablet landscape": viewport({ width: 1280, height: 800, touch: true, coarse: true }),
  "tablet portrait": viewport({ width: 800, height: 1280, touch: true, coarse: true }),
  "fire tablet landscape": viewport({ width: 1280, height: 800, touch: true }),
  "fire tablet portrait": viewport({ width: 800, height: 1280, touch: true }),
  "phone portrait": viewport({ width: 390, height: 844, touch: true, coarse: true, safeTop: 47, safeBottom: 34 }),
  "phone landscape": viewport({ width: 844, height: 390, touch: true, coarse: true, safeLeft: 47, safeRight: 34 }),
  "fold cover": viewport({ width: 344, height: 882, touch: true, coarse: true }),
  "fold unfolded": viewport({ width: 900, height: 1010, touch: true, coarse: true }),
};

test("presets are exactly the three replacements", () => {
  assert.deepEqual(SCREEN_PRESETS, ["fit", "balanced", "arena"]);
  for (const gone of ["compact", "standard", "wide"]) {
    assert.equal(isScreenPreset(gone), false, `${gone} should no longer be a preset`);
  }
});

test("an invalid or missing stored preset falls back to Fit Screen", () => {
  assert.equal(DEFAULT_PRESET, "fit");
  for (const bad of [undefined, null, "", "wide", "WIDE", 3, {}, []]) {
    assert.equal(normalizePreset(bad), "fit", `${JSON.stringify(bad)} should fall back`);
  }
  for (const good of SCREEN_PRESETS) assert.equal(normalizePreset(good), good);
});

test("the arena never claims space the fixed chrome needs, on any device", () => {
  for (const [name, input] of Object.entries(DEVICES)) {
    for (const preset of SCREEN_PRESETS) {
      const budget = budgetFor(input, preset);
      const usedVertically = budget.arena + requiredChrome;
      assert.ok(
        usedVertically <= budget.usableHeight || budget.arena === MIN_ARENA,
        `${name} / ${preset}: arena ${budget.arena} + chrome ${requiredChrome} exceeds ${budget.usableHeight}`
      );
      assert.ok(
        budget.arena <= budget.usableWidth,
        `${name} / ${preset}: arena ${budget.arena} is wider than the viewport ${budget.usableWidth}`
      );
      assert.ok(budget.arena >= MIN_ARENA, `${name} / ${preset}: arena below the playable minimum`);
    }
  }
});

test("Fit Screen fits everything, everywhere", () => {
  for (const [name, input] of Object.entries(DEVICES)) {
    const budget = budgetFor(input, "fit");
    const ceiling = budget.usableHeight - (CHROME.top + CHROME.dock + CHROME.gap * 3);
    assert.ok(
      budget.arena <= Math.max(ceiling, MIN_ARENA) + 1,
      `${name}: Fit Screen arena ${budget.arena} exceeds its ceiling ${ceiling}`
    );
  }
});

test("Arena Focus is never smaller than Fit Screen", () => {
  for (const [name, input] of Object.entries(DEVICES)) {
    const fit = budgetFor(input, "fit").arena;
    const arena = budgetFor(input, "arena").arena;
    assert.ok(arena >= fit, `${name}: Arena Focus (${arena}) should not be smaller than Fit (${fit})`);
  }
});

test("regression: the old Wide failure at 2048x1152 cannot recur", () => {
  // Wide gave the cockpit a fixed 2040px on a 2048px screen and pushed
  // controls off the edge. Every preset must now keep the whole interface
  // inside the viewport at that exact size, with and without touch.
  for (const key of ["2048x1152 desktop", "2048x1152 touch desktop"]) {
    for (const preset of SCREEN_PRESETS) {
      const budget = budgetFor(DEVICES[key], preset);
      assert.ok(
        budget.arena + requiredChrome <= budget.usableHeight,
        `${key} / ${preset}: interface does not fit vertically`
      );
      assert.ok(
        budget.arena <= budget.usableWidth,
        `${key} / ${preset}: interface overflows horizontally`
      );
    }
  }

  // And Arena Focus, the preset that maximizes the arena, must still leave
  // room for the dock rather than overlaying it off-screen.
  const focus = budgetFor(DEVICES["2048x1152 touch desktop"], "arena");
  assert.ok(focus.showTouchControls, "a touch-capable desktop keeps its touch controls");
  assert.ok(focus.arena + requiredChrome <= focus.usableHeight);
});

test("safe-area insets come out of the budget, not out of a control", () => {
  const plain = budgetFor(viewport({ width: 390, height: 844, touch: true, coarse: true }), "fit");
  const notched = budgetFor(
    viewport({ width: 390, height: 844, touch: true, coarse: true, safeTop: 47, safeBottom: 34 }),
    "fit"
  );
  assert.equal(notched.usableHeight, plain.usableHeight - 81);
  assert.ok(notched.arena <= plain.arena, "a notch must cost the arena, not a control");
});

test("touch capability is separate from layout mode", () => {
  // A touchscreen laptop gets touch controls without becoming a phone.
  const laptop = budgetFor(viewport({ width: 2048, height: 1152, touch: true }), "balanced");
  assert.equal(laptop.showTouchControls, true, "touch hardware should offer touch controls");
  assert.equal(laptop.handheld, false, "a big touchscreen is not a handheld");
  assert.equal(laptop.form, "tablet", "it is touch-capable, but not a phone shell");

  const desktop = budgetFor(viewport({ width: 2048, height: 1152 }), "balanced");
  assert.equal(desktop.showTouchControls, false, "no touch hardware, no thumbsticks");
  assert.equal(desktop.form, "desktop");
});

test("explicit thumbstick choice is authoritative", () => {
  const coarse = viewport({ width: 390, height: 844, touch: true, coarse: true });
  const laptop = viewport({ width: 1920, height: 1080, touch: true });

  assert.equal(resolveTouchControls({ ...laptop, touchControls: "show" }), true);
  assert.equal(resolveTouchControls({ ...laptop, touchControls: "hide" }), false);
  assert.equal(resolveTouchControls({ ...laptop, touchControls: "auto" }), true);

  assert.equal(
    resolveTouchControls({ ...coarse, touchControls: "hide" }),
    false,
    "Thumbsticks OFF removes the controls and their pointer hit areas"
  );
});

test("hiding the sticks gives their space back to the arena", () => {
  const shown = budgetFor(viewport({ width: 1280, height: 800, touch: true, touchControls: "show" }), "balanced");
  const hidden = budgetFor(viewport({ width: 1280, height: 800, touch: true, touchControls: "hide" }), "balanced");
  assert.equal(hidden.stick, 0);
  assert.ok(hidden.arena >= shown.arena, "space freed by hiding sticks should go to the arena");
});

test("larger thumbsticks cost arena rather than overflowing", () => {
  const base = viewport({ width: 800, height: 1280, touch: true, coarse: true });
  const small = budgetFor({ ...base, stickScale: 0.8 }, "fit");
  const large = budgetFor({ ...base, stickScale: 1.3 }, "fit");
  assert.ok(large.stick > small.stick, "the preference should change the stick size");
  assert.ok(
    large.arena + requiredChrome <= large.usableHeight,
    "bigger sticks must not push the interface off screen"
  );
});

test("Arena Focus turns panels into drawers; the others keep them", () => {
  const wide = viewport({ width: 1920, height: 1080 });
  assert.equal(budgetFor(wide, "arena").panels, "drawer");
  assert.equal(budgetFor(wide, "balanced").panels, "scroll");
  assert.equal(budgetFor(wide, "fit").panels, "scroll");
  // Narrow screens have no room for a permanent panel under any preset.
  const phone = viewport({ width: 390, height: 844, touch: true, coarse: true });
  for (const preset of SCREEN_PRESETS) {
    assert.equal(budgetFor(phone, preset).panels, "drawer", preset);
  }
});

test("thumbsticks land in the arrangement each orientation expects", () => {
  const portrait = budgetFor(viewport({ width: 390, height: 844, touch: true, coarse: true }), "fit");
  assert.ok(["docked", "overlay"].includes(portrait.sticks), portrait.sticks);

  const landscape = budgetFor(viewport({ width: 1024, height: 768, touch: true, coarse: true }), "fit");
  assert.ok(["gutter", "overlay"].includes(landscape.sticks), landscape.sticks);

  // Arena Focus always overlays, so the arena keeps the full width.
  const focus = budgetFor(viewport({ width: 1024, height: 768, touch: true, coarse: true }), "arena");
  assert.equal(focus.sticks, "overlay");
});

test("a viewport too small for everything holds the arena at its minimum", () => {
  const tiny = budgetFor(viewport({ width: 300, height: 260, touch: true, coarse: true }), "fit");
  assert.equal(tiny.arena, MIN_ARENA);
  assert.equal(tiny.trimmed, true, "the shell needs to know it had to compromise");
});

test("the same viewport always produces the same budget", () => {
  for (const [name, input] of Object.entries(DEVICES)) {
    for (const preset of SCREEN_PRESETS) {
      assert.ok(
        budgetsEqual(budgetFor(input, preset), budgetFor(input, preset)),
        `${name} / ${preset} is not deterministic`
      );
    }
  }
});

test("changing preset changes the budget, so equality can gate re-renders", () => {
  const input = viewport({ width: 1920, height: 1080 });
  assert.equal(budgetsEqual(budgetFor(input, "fit"), budgetFor(input, "arena")), false);
});

test("browser zoom is respected through the reported viewport size", () => {
  // visualViewport already reports the zoomed size; the budget must simply
  // work with the smaller numbers rather than assuming a 1:1 CSS pixel.
  const zoomed = budgetFor(viewport({ width: 1024, height: 576, scale: 2, dpr: 2 }), "fit");
  assert.ok(zoomed.arena + requiredChrome <= zoomed.usableHeight);
  assert.ok(zoomed.arena >= MIN_ARENA);
});
