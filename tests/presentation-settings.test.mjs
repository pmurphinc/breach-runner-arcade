import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settings = readFileSync(new URL("../app/view-settings.ts", import.meta.url), "utf8");
const menu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const difficulty = readFileSync(new URL("../app/difficulty.ts", import.meta.url), "utf8");

test("zoom settings migrate safely and expose four camera scales", () => {
  assert.match(settings, /zoom: "standard"/);
  assert.match(settings, /wide: 0\.85/);
  assert.match(settings, /close: 1\.15/);
  assert.match(settings, /closer: 1\.3/);
  assert.match(settings, /isZoom\(candidate\.zoom\) \? candidate\.zoom : "standard"/);
});

test("settings expose Perspective rather than the old Camera lock toggle", () => {
  assert.match(menu, /label="Perspective"/);
  assert.match(menu, /Follow Ship/);
  assert.match(menu, /Full Arena/);
  assert.doesNotMatch(menu, /label="Camera lock"/);
});

test("camera zoom is shared by rendering and pointer-to-world transforms", () => {
  assert.equal((game.match(/ZOOM_SCALE\[zoomRef\.current\]/g) ?? []).length, 2);
  assert.match(game, /player\.x \* camScale/);
  assert.match(game, /player\.y \* camScale/);
});

test("arena ships are visually larger without changing collision constants", () => {
  // The 1.15 used to be written as two bare multiplications and counted as
  // such, which stopped matching the moment the scale became an argument the
  // geometry helpers take -- so this read zero and had been failing silently in
  // a suite no script ran.
  //
  // Asserted as the guarantee instead: the hull is drawn at 1.15, and every
  // resolver that places something *on* the hull is handed the same 1.15, so
  // muzzles, thrusters and hardpoints cannot drift off a model that grew
  // without them.
  assert.match(game, /drawShipModel\(ctx, game\.ship\.id, 1\.15\)/);
  for (const resolver of [
    "shipMuzzleWorldPoint",
    "shipThrusterWorldPoints",
    "shipHardpointResolver",
    "shipHardpointOffset",
  ]) {
    assert.match(
      game,
      new RegExp(`${resolver}\\([^)]*1\\.15`),
      `${resolver} must be given the same visual scale as the model`
    );
  }
  // And nothing in the collision maths is scaled by it: a bigger drawing is a
  // drawing, not a bigger hitbox.
  assert.doesNotMatch(game, /(?:sweptHit|hitRadius|collide)[^\n]*1\.15/);
});

test("difficulty ladder uses Breach Runner themed names", () => {
  for (const label of ["SIMULATION", "STABLE", "VOLATILE", "CRITICAL"]) assert.match(difficulty, new RegExp(label));
});
