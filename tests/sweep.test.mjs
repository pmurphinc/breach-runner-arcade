import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { segmentDistance, sweptHit } from "../app/sweep.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

test("distance is measured to the path, not to where the round stopped", () => {
  // A round that travelled from x=-20 to x=+20 passed straight over the origin.
  const from = { x: -20, y: 0 };
  const to = { x: 20, y: 0 };
  assert.equal(segmentDistance(from, to, { x: 0, y: 0 }), 0, "it went through the middle");
  assert.equal(segmentDistance(from, to, { x: 0, y: 7 }), 7, "and seven units under one beside it");
});

test("the segment ends where the round did, and does not extend past it", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 10, y: 0 };
  // Beyond the far end: measured from that end, not from the infinite line.
  assert.equal(segmentDistance(from, to, { x: 30, y: 0 }), 20);
  // Behind the near end, likewise.
  assert.equal(segmentDistance(from, to, { x: -5, y: 0 }), 5);
});

test("a round that has not moved degrades to the old point test", () => {
  const still = { x: 4, y: 4, vx: 0, vy: 0 };
  assert.equal(segmentDistance(still, still, { x: 4, y: 9 }), 5);
  assert.ok(sweptHit(still, { x: 4, y: 9 }, 6));
  assert.ok(!sweptHit(still, { x: 4, y: 9 }, 5));
});

/**
 * The case the speed change created.
 *
 * A pilot at the fleet's top speed fires forward: the round leaves at 10 and
 * inherits 7.6, so it moves 17.6 a tick. A tracker closes head-on at 6.8. The
 * two straddle the tracker's 20-unit hit window with 24.4 units of travel
 * between samples, so the endpoint test can sample either side of it and never
 * inside.
 */
test("a head-on tracker cannot be sampled straight through", () => {
  const reach = 6 + 4; // tracker radius plus the loop's margin
  const closing = 17.6 + 6.8;

  // Place the tracker exactly halfway through the round's step: the worst
  // arrangement for an endpoint test, and a dead-centre hit for a swept one.
  const bullet = { x: closing / 2, y: 0, vx: closing, vy: 0 };
  const tracker = { x: 0, y: 0 };

  const endpointWouldMiss = Math.hypot(bullet.x - tracker.x, bullet.y - tracker.y) >= reach;
  assert.ok(endpointWouldMiss, "this is the arrangement the old test missed");
  assert.ok(sweptHit(bullet, tracker, reach), "the path went through it, so it is a hit");
});

test("a miss is still a miss", () => {
  // Same speed, but the round passes well to one side.
  const bullet = { x: 0, y: 0, vx: 24.4, vy: 0 };
  assert.ok(!sweptHit(bullet, { x: -12.2, y: 40 }, 10));
  // And a body behind the muzzle is not hit by a round moving away from it.
  assert.ok(!sweptHit(bullet, { x: -60, y: 0 }, 10));
});

test("every bullet contact in the loop is swept, so none can be skipped", () => {
  // Enemies, hostile rounds and loose power-ups are all small enough and fast
  // enough to be stepped over now that the fleet is twice as quick.
  assert.match(game, /sweptHit\(bullet, enemy, enemy\.radius \+ 4\)/);
  assert.match(game, /sweptHit\(bullet, hostile, 11\)/);
  assert.match(game, /sweptHit\(bullet, loose, PUP_RADIUS \+ 4\)/);
  assert.doesNotMatch(game, /dist\(bullet, enemy\) </, "the endpoint test must not come back");
});
