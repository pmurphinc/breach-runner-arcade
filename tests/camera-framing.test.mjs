import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { followCameraFrame } from "../app/camera-framing.ts";

const gameSource = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

const WORLD = { width: 2096, height: 1310 };
const RADIUS = 30;
const ZOOMS = [0.85, 1, 1.15, 1.3];
const shown = (player, camera) => ({ x: player.x * camera.camScale + camera.camX, y: player.y * camera.camScale + camera.camY });
function assertInside(player, camera, field, message) {
  const point = shown(player, camera);
  const radius = RADIUS * camera.camScale;
  assert.ok(point.x - radius >= field.left - 0.001, `${message}: left hull edge`);
  assert.ok(point.x + radius <= field.right + 0.001, `${message}: right hull edge`);
  assert.ok(point.y - radius >= field.top - 0.001, `${message}: top hull edge`);
  assert.ok(point.y + radius <= field.bottom + 0.001, `${message}: bottom hull edge`);
}

test("tablet portrait follow framing contains the ship at every wall and zoom", () => {
  const field = { left: 238, top: 0, right: 810, bottom: 900 };
  for (const scale of ZOOMS) for (const [name, player] of [
    ["left", { x: RADIUS, y: WORLD.height / 2 }],
    ["right", { x: WORLD.width - RADIUS, y: WORLD.height / 2 }],
    ["top", { x: WORLD.width / 2, y: RADIUS }],
    ["bottom", { x: WORLD.width / 2, y: WORLD.height - RADIUS }],
  ]) assertInside(player, followCameraFrame(player, WORLD, scale, field), field, `${name} wall at ${scale}x`);
});

test("an unclipped desktop keeps the established follow framing", () => {
  const field = { left: 0, top: 0, right: 1048, bottom: 655 };
  const player = { x: 700, y: 500 };
  for (const scale of ZOOMS) {
    const oldX = Math.max(1048 - WORLD.width * scale, Math.min(0, 524 - player.x * scale));
    const oldY = Math.max(655 - WORLD.height * scale, Math.min(0, 327.5 - player.y * scale));
    assert.deepEqual(followCameraFrame(player, WORLD, scale, field), { camScale: scale, camX: oldX, camY: oldY });
  }
});

test("follow framing is stable for an unchanged player and layout", () => {
  const field = { left: 238, top: 20, right: 810, bottom: 900 };
  const player = { x: 30, y: 500 };
  const frames = Array.from({ length: 120 }, () => followCameraFrame(player, WORLD, 1.15, field, 80));
  assert.ok(frames.every((frame) => frame.camX === frames[0].camX && frame.camY === frames[0].camY));
});

test("Full Arena retains its independent whole-world fit", () => {
  const height = 900;
  const scale = Math.min(1048 / WORLD.width, height / WORLD.height);
  assert.deepEqual({ scale, x: (1048 - WORLD.width * scale) / 2, y: (height - WORLD.height * scale) / 2 },
    { scale: 0.5, x: 0, y: 122.5 });
});

test("the renderer reuses PR 114's playfield measurement only for follow mode", () => {
  assert.match(gameSource, /followCameraFrame\([\s\S]{0,180}playfieldBox/);
  assert.match(gameSource, /const camX = followed\?\.camX \?\? \(VIEW_WIDTH - game\.worldWidth \* camScale\) \/ 2/);
  assert.match(gameSource, /const playfieldBounds = \{[\s\S]{0,300}\(playfieldBox\.left - camX\)/);
});
