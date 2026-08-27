import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { SHIPS } from "../app/game-data.ts";
import { SHIP_ORDER } from "../app/ship-data.ts";
import { SHIP_SHAPES, drawShipShape } from "../app/weapon-art.ts";

const ORIGINAL_SHAPES = {
  tank: [[18, 0], [9, -12], [-11, -16], [-8, -5], [-17, -6], [-13, 0], [-17, 6], [-8, 5], [-11, 16], [9, 12]],
  wing: [[20, 0], [-8, -10], [-3, -3], [-15, 0], [-3, 3], [-8, 10]],
  squid: [[18, 0], [-15, -7], [-7, 0], [-19, 12], [1, 7], [-6, 0], [-19, -12]],
  rabbit: [[17, 0], [5, -7], [-14, -9], [-7, 0], [-14, 9], [5, 7]],
  turtle: [[18, 0], [8, -13], [-8, -12], [-13, -7], [-12, 0], [-13, 7], [-8, 12], [8, 13]],
  flash: [[19, 0], [-12, -13], [-5, 0], [-12, 13]],
  hunter: [[20, 0], [-7, -13], [-5, -5], [-15, -6], [-8, 0], [-15, 6], [-5, 5], [-7, 13]],
  flagship: [[28, 0], [15, -19], [-8, -19], [-9, -10], [-18, -13], [-20, 0], [-18, 13], [-9, 10], [-8, 19], [15, 19]],
};

function recordingContext() {
  const calls = [];
  return {
    calls,
    beginPath: () => calls.push(["beginPath"]),
    moveTo: (x, y) => calls.push(["moveTo", x, y]),
    lineTo: (x, y) => calls.push(["lineTo", x, y]),
    closePath: () => calls.push(["closePath"]),
  };
}

test("every canonical ship has a finite, drawable silhouette", () => {
  assert.deepEqual(SHIP_ORDER, SHIPS.map(({ id }) => id));
  assert.deepEqual(Object.keys(SHIP_SHAPES).sort(), [...SHIP_ORDER].sort());
  for (const id of SHIP_ORDER) {
    const points = SHIP_SHAPES[id];
    assert.ok(points.length >= 3, `${id} needs a closed polygon`);
    assert.ok(points.every((point) => point.length === 2 && point.every(Number.isFinite)), `${id} points must be finite pairs`);
    const ctx = recordingContext();
    assert.doesNotThrow(() => drawShipShape(ctx, id));
    assert.deepEqual(ctx.calls[0], ["beginPath"], `${id} starts a path`);
    assert.deepEqual(ctx.calls.at(-1), ["closePath"], `${id} closes its path`);
    assert.equal(ctx.calls.filter(([method]) => method === "moveTo").length, 1, `${id} has a starting point`);
    assert.equal(ctx.calls.filter(([method]) => method === "lineTo").length, points.length - 1, `${id} traces every point`);
  }
});

test("Kestrel renders through the shared ship renderer", () => {
  const ctx = recordingContext();
  assert.doesNotThrow(() => drawShipShape(ctx, "kestrel", 1.9));
  assert.ok(ctx.calls.length > 3);
});

test("the original eight silhouettes remain unchanged", () => {
  for (const [id, points] of Object.entries(ORIGINAL_SHAPES)) assert.deepEqual(SHIP_SHAPES[id], points, id);
});

test("ShipsScreen sends every canonical ship through the shared renderer", async () => {
  const menu = await readFile(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
  const shipsScreen = menu.slice(menu.indexOf("export function ShipsScreen"));
  assert.match(shipsScreen, /SHIP_ORDER\.map\(\(id\) =>/);
  assert.match(shipsScreen, /\{renderShip\(id, 44\)\}/);
  assert.doesNotThrow(() => SHIP_ORDER.map((id) => drawShipShape(recordingContext(), id)));
});
