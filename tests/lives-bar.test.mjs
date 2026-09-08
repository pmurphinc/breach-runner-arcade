import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { shipGlyphPath, shipGlyphViewBox } from "../app/ship-glyph.ts";
import { SHIP_SHAPES } from "../app/weapon-art.ts";
import { SHIPS } from "../app/game-data.ts";
import { RIFT_RUN_MAX_LIVES, RIFT_RUN_STARTING_LIVES } from "../app/rift-run/extra-lives.ts";
import { RIFT_RUN_STARTER_HULL } from "../app/rift-run/starter-ship.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("every hull has a glyph, closed and non-empty", () => {
  for (const ship of SHIPS) {
    const path = shipGlyphPath(ship.id);
    assert.match(path, /^M-?[\d.]+ -?[\d.]+/, `${ship.id}: must start with a move`);
    assert.match(path, /Z$/, `${ship.id}: must be closed, these are solid silhouettes`);
    // One line per point after the first.
    assert.equal((path.match(/L/g) ?? []).length, SHIP_SHAPES[ship.id].length - 1, ship.id);
  }
});

test("the glyph is the same outline the arena draws", () => {
  // Not a redrawn approximation: a hull whose silhouette is retouched must
  // change in the rail too, or the glyph starts naming a ship that no longer
  // looks like that.
  const [first] = SHIP_SHAPES.wing;
  assert.ok(shipGlyphPath("wing").startsWith(`M${first[0]} ${first[1]}`));
});

test("each hull gets a viewBox that fits it", () => {
  for (const ship of SHIPS) {
    const [minX, minY, width, height] = shipGlyphViewBox(ship.id).split(" ").map(Number);
    const xs = SHIP_SHAPES[ship.id].map((point) => point[0]);
    const ys = SHIP_SHAPES[ship.id].map((point) => point[1]);
    assert.ok(minX < Math.min(...xs), `${ship.id}: padded on the left`);
    assert.ok(minY < Math.min(...ys), `${ship.id}: padded on the top`);
    assert.ok(minX + width > Math.max(...xs), `${ship.id}: fits to the right`);
    assert.ok(minY + height > Math.max(...ys), `${ship.id}: fits to the bottom`);
  }
});

/**
 * Per hull rather than one shared box.
 *
 * The frames genuinely differ in size — the command vessel is half again the
 * length of the interceptor — and a single shared box would render the small
 * ones as specks. A glyph has to read as *a ship* first.
 */
test("a small hull is not rendered as a speck", () => {
  const widthOf = (id) => Number(shipGlyphViewBox(id).split(" ")[2]);
  const widths = SHIPS.map((ship) => widthOf(ship.id));
  assert.ok(Math.max(...widths) / Math.min(...widths) < 2, "the glyphs stay comparable in size");
});

/* ------------------------------------------------------------- the rail */

test("lives are drawn as an inventory, not counted", () => {
  assert.ok(!game.includes("LIVES {riftRun.lives}"), "the bare count is gone");
  // A berth per life the run could hold, so "two of three" is one glance
  // rather than a number plus a memory of the ceiling.
  assert.ok(game.includes("Array.from({ length: RIFT_RUN_MAX_LIVES }, (_, index) => ("));
  assert.ok(game.includes('className={index < riftRun.lives ? "life-pip held" : "life-pip spent"}'));
  assert.ok(game.includes("<path d={shipGlyphPath(livesShip)} />"));
});

test("the glyph is the hull a Rift Run actually flies", () => {
  // Read from the starter module rather than named here, so a change of issued
  // hull moves the symbol with it.
  assert.ok(game.includes("const livesShip = RIFT_RUN_STARTER_HULL;"));
  assert.ok(SHIPS.some((ship) => ship.id === RIFT_RUN_STARTER_HULL), "and it is a real hull");
});

test("the bar is hidden from screen readers, which are told the count instead", () => {
  // A row of three identical SVGs is noise read aloud; the badge's own label
  // already says "2 extra lives" in words.
  assert.ok(game.includes('<span className="rule-rift-lives" aria-hidden="true">'));
  assert.match(game, /\$\{riftRun\.lives\} extra \$\{riftRun\.lives === 1 \? "life" : "lives"\}/);
});

test("a held berth is filled and an empty one is hollow", () => {
  assert.match(css, /\.life-pip\.held path \{ fill: #75ffd0; stroke: none; \}/);
  assert.match(css, /\.life-pip\.spent path \{\s*\n\s*fill: none;/);
  // Tied to the rail's text size so the row cannot grow the badge that the
  // layout budget already measures.
  assert.match(css, /\.life-pip \{ height: 1em;/);
});

test("the cap the bar draws is the cap the rules enforce", () => {
  assert.equal(RIFT_RUN_MAX_LIVES, 3);
  assert.ok(RIFT_RUN_STARTING_LIVES < RIFT_RUN_MAX_LIVES, "a run must open with a berth to earn");
});
