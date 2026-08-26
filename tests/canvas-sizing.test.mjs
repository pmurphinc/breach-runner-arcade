import assert from "node:assert/strict";
import test from "node:test";
import { canvasBackingSize, VIEWPORT_WIDTH } from "../app/canvas-sizing.ts";

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
