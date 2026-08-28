import assert from "node:assert/strict";
import test from "node:test";
import { SHIP_MODEL_GEOMETRY, shipAttachmentWorldPoint, shipForwardVelocity, shipModelScale, shipMuzzleWorldPoint, shipThrusterWorldPoints } from "../app/ship-models.ts";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("a forward muzzle rotates with all cardinal headings", () => {
  const expected = [[120, 200], [100, 220], [80, 200], [100, 180]];
  [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach((heading, index) => {
    const point = shipAttachmentWorldPoint("tank", { x: 20, y: 0 }, { x: 100, y: 200 }, heading);
    close(point.x, expected[index][0]); close(point.y, expected[index][1]);
  });
});

test("thrusters remain behind the ship after rotation", () => {
  for (const heading of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const forward = { x: Math.cos(heading), y: Math.sin(heading) };
    for (const point of shipThrusterWorldPoints("squid", { x: 0, y: 0 }, heading)) assert.ok(point.x * forward.x + point.y * forward.y < 0);
  }
});

test("ships own independently tunable attachment locations", () => {
  assert.notDeepEqual(SHIP_MODEL_GEOMETRY.tank.thrusters, SHIP_MODEL_GEOMETRY.flash.thrusters);
  assert.notDeepEqual(shipMuzzleWorldPoint("tank", { x: 0, y: 0 }, 0), shipMuzzleWorldPoint("squid", { x: 0, y: 0 }, 0));
});

test("model presentation scaling also scales attachments", () => {
  const normal = shipMuzzleWorldPoint("tank", { x: 0, y: 0 }, 0), large = shipMuzzleWorldPoint("tank", { x: 0, y: 0 }, 0, 2);
  close(large.x, normal.x * 2); close(large.y, normal.y * 2); close(shipModelScale("flagship", 1.15), 0.82 * 1.15);
});

test("muzzle origin does not alter projectile velocity or heading", () => {
  const inherited = { x: 1.25, y: -0.75 };
  for (const heading of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const velocity = shipForwardVelocity(heading, 10, inherited);
    close(velocity.x, Math.cos(heading) * 10 + inherited.x); close(velocity.y, Math.sin(heading) * 10 + inherited.y);
  }
});

test("every configured attachment produces finite world coordinates", () => {
  for (const ship of Object.keys(SHIP_MODEL_GEOMETRY)) {
    const points = [shipMuzzleWorldPoint(ship, { x: 17, y: -9 }, 1.234, 1.15), ...shipThrusterWorldPoints(ship, { x: 17, y: -9 }, 1.234, 1.15)];
    assert.ok(points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)), ship);
  }
});
