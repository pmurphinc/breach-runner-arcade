import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { WEAPONS, SENDABLE_POWERUPS } from "../app/game-data.ts";
import {
  INVENTORY_GLYPH_SCALE,
  INVENTORY_PUP_ROTATION,
  inventoryPayloadIconLayout,
  inventoryPupVisual,
} from "../app/pup-inventory-visual.ts";
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
  assert.match(game, /drawWeaponGlyph\(ctx, visual\.glyphId, layout\.glyphRadius, 0/);
});

test("every inventory renderer shares one icon path, and none of them draw a frame", () => {
  // Three horizontal-HUD sites plus the compact HUD's vertical frame.
  assert.equal((game.match(/<WeaponIcon[^>]+inventoryFrame/g) ?? []).length, 4);
  assert.match(game, /const visual = inventoryPupVisual\(id\)/);
  // The triangle around the glyph is gone: it capped the symbol at 46% of the
  // icon, which is unreadable at the ~18-22px the HUD renders these at. Payload
  // class identity now comes from the slot's own coloured border and fill.
  const start = game.indexOf("if (inventoryFrame) {");
  const iconPath = game.slice(start, game.indexOf("} else {", start));
  assert.doesNotMatch(iconPath, /drawPupFrame/, "the inventory icon must not stroke a class frame");
  assert.match(iconPath, /drawWeaponGlyph\(ctx, visual\.glyphId, layout\.glyphRadius, 0/);
});

test("inventory glyphs are static, centred, and fill the icon box", () => {
  const layout = inventoryPayloadIconLayout({ width: 32, height: 24 });
  assert.equal(INVENTORY_PUP_ROTATION, 0);
  assert.equal(layout.rotation, 0);
  assert.equal(layout.centerX, 16);
  assert.equal(layout.centerY, 12);
  // This was capped below frameRadius / 2 by the triangle that used to enclose it.
  assert.equal(INVENTORY_GLYPH_SCALE, 0.92);
  assert.ok(layout.glyphRadius > layout.frameRadius * 0.8, "the symbol must fill the slot, not hide in it");
  assert.ok(layout.glyphRadius <= layout.frameRadius, "but never overflow the slot");
  assert.match(game, /ctx\.translate\(layout\.centerX, layout\.centerY\)/);
});

test("icon sizing follows the smallest available icon bound", () => {
  const compact = inventoryPayloadIconLayout({ width: 20, height: 40 });
  const large = inventoryPayloadIconLayout({ width: 30, height: 40 });
  assert.ok(large.frameRadius > compact.frameRadius);
  assert.ok(large.glyphRadius > compact.glyphRadius);
  assert.ok(large.frameRadius <= 15);
});

test("the stored-slot grid follows the shared ceiling instead of a fixed count", () => {
  // This used to pin 9 columns — capacity minus one, back when capacity was 10.
  // Retuning PUP_INVENTORY_CAPACITY then left the HUD laying out columns for
  // slots that no longer existed, and nothing caught it. The grid reads the count.
  assert.doesNotMatch(hudCss, /grid-template-columns: repeat\(\d+, var\(--pup-slot\)\)/);
  assert.match(hudCss, /grid-template-columns: repeat\(var\(--pup-stored-slots, 4\), var\(--pup-slot\)\)/);
  assert.match(hudCss, /grid-template-columns: repeat\(var\(--pup-stored-slots, 4\), minmax\(0, 1fr\)\)/);
  assert.match(game, /"--pup-stored-slots": STOCK_LIMIT - 1/);
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
