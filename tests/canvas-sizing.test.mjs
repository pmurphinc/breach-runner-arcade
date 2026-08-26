import assert from "node:assert/strict";
import test from "node:test";
import { canvasBackingSize, damageVignette, VIEWPORT_WIDTH } from "../app/canvas-sizing.ts";

for (const [name, width, height, dpr] of [
  ["short portrait browser", 390, 410, 3],
  ["tall portrait fullscreen", 430, 650, 3],
  ["phone landscape", 844, 390, 2],
  ["short phone landscape", 740, 320, 2],
]) {
  test(`${name} backing store matches its CSS aspect`, () => {
    const result = canvasBackingSize(width, height, dpr, 2048);
    assert.ok(Math.abs(result.width / result.height - width / height) < 0.002);
    assert.ok(Math.abs(result.logicalHeight - VIEWPORT_WIDTH * height / width) < 1);
    assert.ok(result.width <= 2048);
  });
}

test("DPR changes update both backing dimensions without changing the camera aspect", () => {
  const one = canvasBackingSize(390, 600, 1, 4096);
  const two = canvasBackingSize(390, 600, 2, 4096);
  assert.equal(two.width, one.width * 2);
  assert.equal(two.height, one.height * 2);
  assert.equal(two.logicalHeight, one.logicalHeight);
});

/** Alpha of the hit rim at a canvas point, mirroring the radial gradient. */
function rimAlpha(width, height, x, y) {
  const rim = damageVignette(width, height);
  const dx = (x - rim.centerX) / rim.scaleX;
  const dy = (y - rim.centerY) / rim.scaleY;
  const distance = Math.hypot(dx, dy);
  const span = rim.outerRadius - rim.innerRadius;
  return Math.max(0, Math.min(1, (distance - rim.innerRadius) / span));
}

for (const [name, width, height] of [
  ["short portrait browser", 390, 410],
  ["tall portrait fullscreen", 430, 900],
  ["phone landscape", 844, 390],
  ["desktop square arena", 700, 700],
]) {
  test(`${name} hit rim reaches every edge of the arena`, () => {
    const rim = damageVignette(width, height);
    // The painted square, drawn in the rim's own scaled space, covers the canvas.
    assert.ok(rim.extent / 2 * rim.scaleX >= width / 2 - 0.001);
    assert.ok(rim.extent / 2 * rim.scaleY >= height / 2 - 0.001);
    assert.equal(rimAlpha(width, height, Math.round(width / 2), Math.round(height / 2)), 0);
    for (const [edgeX, edgeY] of [
      [Math.round(width / 2), 0],
      [Math.round(width / 2), height],
      [0, Math.round(height / 2)],
      [width, Math.round(height / 2)],
    ]) {
      assert.ok(rimAlpha(width, height, edgeX, edgeY) > 0.2, `edge ${edgeX},${edgeY} stayed clear of the rim`);
    }
    // Corners stay the hottest part of the rim in every aspect.
    assert.ok(rimAlpha(width, height, width, height) > rimAlpha(width, height, Math.round(width / 2), height));
  });
}

test("square arenas keep the original rim circle", () => {
  const rim = damageVignette(600, 600);
  assert.equal(rim.scaleX, 1);
  assert.equal(rim.scaleY, 1);
  assert.equal(rim.innerRadius, 600 * 0.32);
  assert.equal(rim.outerRadius, 600 * 0.72);
});
