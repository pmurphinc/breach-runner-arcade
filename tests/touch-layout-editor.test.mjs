/**
 * The Custom layout editor and the wiring that makes the profile real.
 *
 * Source-level: the editor is React over a pure model, and the model's own
 * behaviour is covered in touch-profiles.test.mjs. What these hold is the part
 * that cannot live in the model — that Save is the only thing that commits, that
 * M-Sticks is untouched by any of it, and that the stylesheet reads the geometry
 * the shell publishes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { TOUCH_ELEMENT_IDS, isTouchStick } from "../app/touch-profiles.ts";

const editor = readFileSync(new URL("../app/touch-layout-editor.tsx", import.meta.url), "utf8");
const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const menu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/mirrored-touch-actions.css", import.meta.url), "utf8");

test("edits run against a working copy that only Save commits", () => {
  assert.match(editor, /const \[draft, setDraft\] = useState<CustomTouchLayout>\(layout\)/);
  assert.match(editor, /onClick=\{\(\) => onSave\(draft\)\}/);
  // Close and Escape both discard: a half-finished layout can put a control
  // somewhere unreachable, and the way out must not be reconstructing it.
  assert.match(editor, /onClick=\{onClose\}/);
  assert.match(editor, /if \(event\.key === "Escape"\) onClose\(\)/);
  assert.doesNotMatch(editor, /onSave\(.*\)[\s\S]{0,40}Escape/);
  assert.match(game, /onSave=\{\(next\) => \{[\s\S]{0,120}setSetting\("customTouchLayout", next\)/);
});

test("every control is editable and only sticks offer a dead zone", () => {
  for (const id of TOUCH_ELEMENT_IDS) {
    assert.match(editor, new RegExp(`TOUCH_ELEMENT_LABELS\\[`), `${id} comes from the shared label map`);
  }
  assert.match(editor, /return isTouchStick\(element\) \? \["size", "deadzone", "x", "y"\] : \["size", "x", "y"\]/);
  assert.equal(TOUCH_ELEMENT_IDS.filter(isTouchStick).length, 2);
});

test("each field shows its own valid range, as the reference layout does", () => {
  assert.match(editor, /const \[min, max\] = fieldRange\(selected, field\)/);
  assert.match(editor, /<em>\{min\}…\{max\}<\/em>/);
  assert.match(editor, /min=\{min\}/);
  assert.match(editor, /max=\{max\}/);
});

test("drag moves, and the handle resizes, with the finger", () => {
  assert.match(editor, /target\.setPointerCapture\(event\.pointerId\)/, "a fast drag must keep tracking");
  assert.match(editor, /lostpointercapture/, "a stolen pointer must end the gesture, not strand it");
  // x is measured inward from each element's own edge, so a right-anchored
  // control has to invert or it would run away from the finger.
  assert.match(editor, /const inward = touchElementEdge\(selected, draft\.handed\) === "right" \? -1 : 1/);
  assert.match(editor, /x: start\.x \+ dx \* inward/);
  assert.match(editor, /size: start\.size \+ delta \* 2/, "resizing from the centre moves both edges");
  assert.match(css, /\.touch-editor-ghost \{[^}]*touch-action: none/s, "the browser must not pan the page mid-drag");
});

test("resizing is reachable without a pointer", () => {
  assert.match(editor, /role="slider"/);
  assert.match(editor, /aria-valuenow=\{element\.size\}/);
  assert.match(editor, /onKeyDown=/);
  assert.match(editor, /ArrowUp" \|\| event\.key === "ArrowRight"/);
});

test("handedness is one control and one field", () => {
  assert.match(editor, /setDraft\(mirrorCustomTouchLayout\(draft\)\)/);
  assert.match(editor, /Right-handed, steering on the left/);
  assert.match(editor, /Left-handed, steering on the right/);
});

test("import cannot break the layout, and export is readable", () => {
  assert.match(editor, /setDraft\(parseCustomTouchLayout\(transferText\)\)/, "imported text goes through normalisation");
  assert.match(editor, /setTransferText\(serializeCustomTouchLayout\(draft\)\)/);
  assert.match(editor, /setDraft\(defaultCustomTouchLayout\(\)\)/, "Reset returns to defaults");
});

test("the shell publishes the geometry the stylesheet reads", () => {
  assert.match(game, /data-touch-profile=\{settings\.touchProfile\}/);
  assert.match(game, /\.\.\.customTouchLayoutVariables\(settings\.customTouchLayout\)/);
  // A custom property cannot select a property name, so the anchored edge has
  // to be an attribute for the stylesheet to switch left: against right:.
  assert.match(game, /data-touch-move-edge=\{touchElementEdge\("move", settings\.customTouchLayout\.handed\)\}/);
  assert.match(game, /data-touch-aim-edge=\{touchElementEdge\("aim", settings\.customTouchLayout\.handed\)\}/);
  assert.match(css, /\[data-touch-profile="custom"\]\[data-immersive="true"\] \.touch-flight/);
  assert.match(css, /\[data-touch-move-edge="right"\] \.touch-flight \{ left: auto; right: var\(--touch-move-x\); \}/);
});

test("M-Sticks is untouched by any custom rule", () => {
  // Every custom positioning rule is gated on the profile attribute, so the
  // responsive data-sticks layout keeps working exactly as before.
  const customBlock = css.slice(css.indexOf("Custom profile"));
  for (const line of customBlock.split("\n")) {
    const selector = line.trim();
    if (!selector.startsWith("[data-touch-profile")) continue;
    assert.match(selector, /^\[data-touch-profile="custom"\]/, `unscoped custom rule: ${selector}`);
  }
  assert.doesNotMatch(css, /\[data-touch-profile="m-sticks"\]/, "M-Sticks needs no rules of its own");
});

test("the profile selector sits in the Controls tab and gates the editor", () => {
  const controls = menu.slice(menu.indexOf('activeTab === "controls"'), menu.indexOf('activeTab === "audio"'));
  assert.match(controls, /label="Touch profile"/);
  assert.match(controls, /value=\{touchProfile\}/);
  assert.match(controls, /touchProfile === "custom" \?/, "the editor is only offered for the profile it edits");
  assert.match(controls, /onClick=\{onEditTouchLayout\}/);
  assert.match(game, /onTouchProfile=\{\(next\) => setSetting\("touchProfile", next\)\}/);
});
