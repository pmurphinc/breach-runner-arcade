import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

test("live player draw starts from an explicit visible canvas state", () => {
  const sceneStart = source.indexOf("const drawScene");
  assert.notEqual(sceneStart, -1);
  const start = source.indexOf("if (player.health > 0)", sceneStart);
  assert.notEqual(start, -1);
  const draw = source.slice(start, start + 2200);
  assert.match(draw, /ctx\.globalAlpha = 1/);
  assert.match(draw, /ctx\.globalCompositeOperation = "source-over"/);
  assert.match(draw, /ctx\.setLineDash\(\[\]\)/);
  assert.match(draw, /drawShipShape\(ctx, game\.ship\.id/);
});

test("Switchback Form Shift remains a handling-only state toggle", () => {
  const start = source.indexOf('ship === "flash"');
  assert.notEqual(start, -1);
  const branch = source.slice(start, start + 420);
  assert.match(branch, /player\.flashMode = player\.flashMode === "tank" \? "squid" : "tank"/);
  assert.doesNotMatch(branch, /globalAlpha|opacity|visible|health\s*=|game\.ship\s*=/);
});
