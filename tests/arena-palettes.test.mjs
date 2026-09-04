/**
 * One colour table, two readers.
 *
 * The difficulty cards are meant to look like the arena they launch — picking
 * CRITICAL should show the red you are about to fly in. That only stays true if
 * the cards and the canvas read the same table. A second copy would drift the
 * first time either was tuned, and the drift would be invisible until someone
 * compared a menu screenshot to a gameplay screenshot.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ARENA_PALETTES, DIFFICULTY_ACCENTS, difficultyCardStyle } from "../app/arena-palettes.ts";
import { SURVIVAL_PALETTES } from "../app/survival.ts";
import { DIFFICULTIES } from "../app/difficulty.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const menu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("every difficulty has a palette and an accent", () => {
  // Driven off the shipped difficulty list, so adding one and forgetting its
  // colours fails here rather than rendering an untinted card.
  for (const id of Object.keys(DIFFICULTIES)) {
    assert.ok(ARENA_PALETTES[id], `no palette for ${id}`);
    assert.equal(ARENA_PALETTES[id].length, 3, `${id} needs three stops`);
    assert.ok(DIFFICULTY_ACCENTS[id], `no accent for ${id}`);
  }
});

test("the arena and the cards read the same table", () => {
  // game.tsx must not keep its own copy.
  assert.ok(game.includes('import { ARENA_PALETTES } from "./arena-palettes";'));
  assert.ok(!game.includes("const ARENA_PALETTES:"), "the canvas must not redeclare the table");
  assert.ok(game.includes("ARENA_PALETTES[game.rules.id]"), "the canvas still paints from it");
  // And the menu styles its cards from the same module.
  assert.ok(menu.includes('import { difficultyCardStyle } from "./arena-palettes";'));
  assert.ok(menu.includes("style={difficultyCardStyle(id) as React.CSSProperties}"));
  assert.ok(menu.includes('style={difficultyCardStyle("practice") as React.CSSProperties}'));
});

test("Survival opens on its own first stage rather than a hand-copied colour", () => {
  // Restating the stage colour here would let the arena and the stage table
  // disagree about what the opening of a Survival run looks like.
  assert.deepEqual(ARENA_PALETTES.survival, SURVIVAL_PALETTES.stable);
});

test("a card style carries the palette and the accent", () => {
  const style = difficultyCardStyle("hard");
  const [near, mid, far] = ARENA_PALETTES.hard;
  assert.equal(style["--card-near"], near);
  assert.equal(style["--card-mid"], mid);
  assert.equal(style["--card-far"], far);
  assert.equal(style["--card-accent"], DIFFICULTY_ACCENTS.hard);
});

test("accents are distinct, so three dark cards are tellable apart", () => {
  const accents = Object.values(DIFFICULTY_ACCENTS);
  assert.equal(new Set(accents).size, accents.length, "two difficulties share an accent");
  // Bright enough to read against a near-black card. The arena colours are
  // deliberately almost black, which is exactly why the accent is authored
  // separately rather than derived from them.
  for (const [id, hex] of Object.entries(DIFFICULTY_ACCENTS)) {
    const value = parseInt(hex.slice(1), 16);
    const brightest = Math.max((value >> 16) & 255, (value >> 8) & 255, value & 255);
    assert.ok(brightest > 180, `${id}'s accent is too dark to read on its own card`);
  }
});

test("the card paints from the properties, and falls back without them", () => {
  assert.match(css, /--card-near, #051119/, "a card rendered without properties still has a background");
  assert.match(css, /--card-accent, var\(--cyan\)/, "and still has an accent");
  // The selected card glows in its own colour rather than one shared cyan.
  assert.ok(css.includes("border-color: var(--card-accent, var(--cyan));"));
  assert.ok(!css.includes(".difficulty-card.active { border-color: var(--cyan); box-shadow: var(--glow-active); }"));
});
