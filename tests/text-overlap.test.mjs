/**
 * Two text-overlap regressions, and the CSS mistakes behind them.
 *
 * Both were reported from real devices — a phone in portrait and a folding
 * screen — and both were reproduced in a browser at those widths before being
 * fixed, so the numbers quoted in the comments are measured rather than
 * guessed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const arenaCss = readFileSync(new URL("../app/arena-hud.css", import.meta.url), "utf8");

/* -------------------------------------------------- the mode select cards */

/**
 * A mode card's title was clipped through the middle of its letters.
 *
 * `overflow: hidden` on a grid item removes its automatic minimum size, so the
 * title's row was free to shrink below one line. Measured at a 710px viewport:
 * the title box was 11px tall against a 21px line, cutting the text in half
 * and leaving it sitting in the description underneath.
 */
test("the mode card title keeps its own height", () => {
  const rule = css.match(/\.mode-card-copy b \{[^}]*\}/)?.[0];
  assert.ok(rule, "the title rule must exist");
  assert.ok(!/overflow:\s*hidden/.test(rule), "overflow:hidden lets the row shrink below one line");
  // text-overflow needs white-space: nowrap to do anything, and these titles
  // are meant to wrap — it was never doing what it looked like it was doing.
  assert.ok(!/text-overflow/.test(rule) || /nowrap/.test(rule), "ellipsis without nowrap is a no-op");
  assert.match(rule, /overflow-wrap:\s*anywhere/, "a long title wraps rather than overflowing");
});

/**
 * Headroom for a title that takes two lines.
 *
 * At 124px the description was pushed 1px into the ENTER row once the copy
 * block grew. 136px was the first value that measured clean at every width
 * tested.
 */
test("a mode card has room for a wrapped title", () => {
  const rule = css.match(/\.mode-launch-card \{[^}]*\}/)?.[0];
  assert.ok(rule);
  const minHeight = Number(rule.match(/min-height:\s*(\d+)px/)?.[1]);
  assert.ok(minHeight >= 136, `min-height ${minHeight}px is not enough for a two-line title`);
});

/* ------------------------------------------------------------ the debrief */

/**
 * The debrief was dealing its own report across both of the panel's columns.
 *
 * `.run-report` is `display: contents` by default, which was right when the
 * card was a single column. A `display: contents` element is not a grid item,
 * so once the panel became a two-column named-area grid its `grid-area` went
 * inert and its seven children were auto-placed left, right, left, right —
 * putting the pilot's result on top of the rank readout.
 */
test("the report and command groups are real grid items in the debrief panel", () => {
  // The default that caused it is still there, and still correct for the old
  // single-column card, so the fix has to out-specify it rather than remove it.
  assert.match(arenaCss, /\.run-report,\s*\n\.run-continue \{\s*\n\s*display: contents;/);

  const rule = css.match(/\.result-command-panel > \.result-report-column,[\s\S]{0,220}?\}/)?.[0];
  assert.ok(rule, "the panel must claim its two groups as grid items");
  assert.match(rule, /\.result-command-panel > \.result-command-column/);
  assert.match(rule, /display:\s*grid/);
  // Two class selectors beats the one-class default wherever both apply.
  assert.ok(rule.indexOf(".result-command-panel >") === 0, "specificity is what makes this win");
});

/**
 * And below two columns' worth of room, one column.
 *
 * This panel is drawn over the arena rather than inside the menu shell, so the
 * `@container menu` rules never matched it. The two-column template survived
 * to a 412px phone, where the command column held its 260px floor and left the
 * report 91px to wrap an entire telemetry readout into.
 */
test("the debrief collapses to one column on a phone", () => {
  const query = css.match(/@media \(max-width: 760px\) \{[\s\S]{0,400}?\n\}/)?.[0];
  assert.ok(query, "a width query, because this panel's container is the viewport");
  assert.match(query, /\.result-command-panel/);
  assert.match(query, /grid-template-areas:\s*"header"\s*"report"\s*"commands"/);
  assert.match(query, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test("the two-column template is still there for screens with the room", () => {
  const rule = css.match(/\.result-command-panel \{[^}]*\}/)?.[0];
  assert.ok(rule);
  assert.match(rule, /grid-template-areas:\s*"header header"\s*"report commands"/);
  // The floor that crushed the report column on a phone is fine once the
  // collapse above takes over below 760px.
  assert.match(rule, /minmax\(260px,\s*\.85fr\)/);
});
