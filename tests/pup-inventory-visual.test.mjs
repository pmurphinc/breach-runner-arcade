import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { WEAPONS, SENDABLE_POWERUPS } from "../app/game-data.ts";
import { inventoryPupVisual } from "../app/pup-inventory-visual.ts";
import { PUP_FRAME_COLORS, pupFrameColor } from "../app/pup-world.ts";

const game = await readFile(new URL("../app/game.tsx", import.meta.url), "utf8");
const hudCss = await readFile(new URL("../app/arena-hud.css", import.meta.url), "utf8");

test("stored payload visuals use the canonical Payload triangle and color", () => {
  for (const id of SENDABLE_POWERUPS) {
    const visual = inventoryPupVisual(id);
    assert.equal(visual.shape, "triangle", `${id} must use the Payload silhouette`);
    assert.equal(visual.color, PUP_FRAME_COLORS.payload);
    assert.equal(visual.color, pupFrameColor(WEAPONS[id].pupClass));
  }
});

test("the frame never replaces individual center-glyph identity", () => {
  for (const id of SENDABLE_POWERUPS) assert.equal(inventoryPupVisual(id).glyphId, id);
  assert.notEqual(inventoryPupVisual("nuke").glyphId, inventoryPupVisual("beam").glyphId);
  assert.match(game, /drawWeaponGlyph\(ctx, id, size \* 0\.37/);
});

test("mobile, desktop, and loaded renderers share the framed inventory icon", () => {
  assert.equal((game.match(/<WeaponIcon[^>]+inventoryFrame/g) ?? []).length, 3);
  assert.match(game, /const visual = inventoryPupVisual\(queued\)/);
  assert.match(game, /drawPupFrame\(ctx, visual\.pupClass, chipH \* 0\.39, 0\)/);
});

test("inventory framing does not alter mobile HUD geometry", () => {
  assert.match(hudCss, /grid-template-columns: repeat\(9, var\(--pup-slot\)\)/);
  assert.match(hudCss, /height: 44px/);
});

test("immediate pickups remain outside the sendable stored inventory", () => {
  for (const id of ["gun", "thrust", "retros", "shield", "health", "clear", "ricochet"]) {
    assert.equal(WEAPONS[id].sendable, false);
    assert.ok(!SENDABLE_POWERUPS.includes(id));
  }
});

test("arena world rendering still uses its established class frame path", () => {
  assert.match(game, /drawLooseArenaPup\(ctx, \{/);
  assert.match(game, /pupClass: WEAPONS\[pickup\.type\]\.pupClass/);
  assert.match(game, /drawWeaponGlyph\(ctx, pickup\.type, PUP_GLYPH_RADIUS, time/);
});
