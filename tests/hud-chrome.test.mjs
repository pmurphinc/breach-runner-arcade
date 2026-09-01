/**
 * Two HUD-chrome regressions, both caused by something being owned in the wrong
 * place rather than by the CSS that showed the symptom.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const menu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const mirrored = readFileSync(new URL("../app/mirrored-touch-actions.css", import.meta.url), "utf8");

test("the left-side action buttons are revealed by an attribute the shell owns", () => {
  // The buttons are display:none until html[data-mirror-touch-actions="on"], so
  // whoever writes that attribute decides whether they ever appear.
  assert.match(mirrored, /\.touch-utility-mirrored \{ display: none !important; \}/);
  assert.match(mirrored, /html\[data-mirror-touch-actions="on"\]/);

  // The shell is always mounted, so the attribute is applied on the first frame
  // of every session regardless of which screen the app opens on.
  assert.match(game, /document\.documentElement\.dataset\.mirrorTouchActions = settings\.mirrorTouchActions \? "on" : "off"/);
  assert.match(game, /\}, \[settings\.mirrorTouchActions\]\);/);
});

test("no menu screen writes that attribute any more", () => {
  // This is the actual bug: the effect lived in a hook called only by Home and
  // Settings. The app opens on Ships, so a pilot with the setting on launched
  // with the buttons hidden until they opened Settings or toggled the option.
  assert.doesNotMatch(menu, /dataset\.mirrorTouchActions/);
  // And the hook is no longer invoked purely for a side effect it lost.
  assert.doesNotMatch(menu, /^\s*useMirroredTouchActionsSetting\(\);\s*$/m);
  // It still exists as the settings row's value and setter.
  assert.match(menu, /const \[mirrorTouchActions, onMirrorTouchActions\] = useMirroredTouchActionsSetting\(\)/);
});

test("the rules rail is inset to clear the fixed system controls", () => {
  assert.match(globals, /\.difficulty-badge \{[^}]*right: calc\(8px \+ var\(--system-controls-width, 0px\)\)/s);
  // Menu and Fullscreen are fixed and sit at the top of the z-index scale, which
  // is why a full-width rail ran underneath them.
  assert.match(globals, /\.system-controls \{[^}]*position: fixed/s);
  assert.match(globals, /\.system-controls \{[^}]*z-index: var\(--z-system\)/s);
});

test("the reserved width is measured, not guessed", () => {
  // "Fullscreen" and "Exit Fullscreen" are different widths, so a fixed reserve
  // would be wrong in one state or the other.
  assert.match(game, /document\.querySelector<HTMLElement>\("\.system-controls"\)/);
  assert.match(game, /Math\.max\(0, wrapRect\.right - systemRect\.left\)/, "reserve the real overlap, not the control's own width");
  assert.match(game, /setProperty\("--system-controls-width"/);
  // Fixed positioning puts it outside the wrap, so the ResizeObserver has to
  // pick it up separately or a label change would not re-inset the rail.
  assert.match(game, /const systemControlsEl = document\.querySelector\("\.system-controls"\)/);
  assert.match(game, /if \(systemControlsEl\) observer\.observe\(systemControlsEl\)/);
});

test("a missing or collapsed control bar reserves nothing", () => {
  // The controls are absent on some surfaces; the rail must not inherit a stale
  // inset or NaN when they are.
  assert.match(game, /systemRect && systemRect\.width > 0/);
  assert.match(globals, /var\(--system-controls-width, 0px\)/, "the fallback is a plain gutter");
});
