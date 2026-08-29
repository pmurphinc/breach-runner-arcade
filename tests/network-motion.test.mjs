import test from "node:test";
import assert from "node:assert/strict";
import {
  INTERPOLATION_DELAY_MS,
  LARGE_CORRECTION_DISTANCE,
  MAX_EXTRAPOLATION_MS,
  RemoteMotion,
  interpolateAngle,
} from "../app/network-motion.ts";
import { POSITION_SEND_INTERVAL_MS, PvpClient } from "../app/pvp-client.ts";

const point = (seq, receivedAt, x, angle = 0) => ({ seq, sentAt: 1000 + receivedAt, receivedAt, x, y: 0, angle });

test("remote motion interpolates between the two latest snapshots", () => {
  const motion = new RemoteMotion();
  motion.push(point(1, 100, 0));
  motion.push(point(2, 200, 100));
  assert.equal(motion.sample(200)?.x, 50); // render target is 150ms
});

test("remote rotation takes the shortest path through wraparound", () => {
  assert.equal(interpolateAngle(359, 1, 0.5), 0);
  assert.equal(interpolateAngle(1, 359, 0.5), 0);
});

test("remote extrapolation is bounded when a packet is late", () => {
  const motion = new RemoteMotion();
  motion.push(point(1, 100, 0));
  motion.push(point(2, 200, 100));
  const farFuture = motion.sample(200 + INTERPOLATION_DELAY_MS + 1000);
  assert.equal(farFuture?.x, 100 + MAX_EXTRAPOLATION_MS);
});

test("major corrections snap rather than gliding across the arena", () => {
  const motion = new RemoteMotion();
  motion.push(point(1, 100, 0));
  motion.push(point(2, 200, 10));
  motion.push(point(3, 210, 10 + LARGE_CORRECTION_DISTANCE + 1));
  assert.equal(motion.sample(210)?.x, 10 + LARGE_CORRECTION_DISTANCE + 1);
});

test("normal corrections retain an interpolated display position without overshoot", () => {
  const motion = new RemoteMotion();
  motion.push(point(1, 100, 0));
  motion.push(point(2, 200, LARGE_CORRECTION_DISTANCE - 1));
  const rendered = motion.sample(200);
  assert.ok(rendered.x > 0 && rendered.x < LARGE_CORRECTION_DISTANCE - 1);
});

test("an explicit respawn/reset snapshot snaps immediately", () => {
  const motion = new RemoteMotion();
  motion.push(point(1, 100, 20));
  motion.push(point(2, 110, 80), true);
  assert.equal(motion.sample(110)?.x, 80);
});

test("newer snapshots replace the target in the shared co-op/PvP motion model", () => {
  for (const mode of ["coop", "pvp"]) {
    const motion = new RemoteMotion();
    motion.push(point(1, 100, 0));
    motion.push(point(2, 200, 50));
    motion.push(point(3, 300, 100));
    assert.equal(motion.sample(350)?.x, 100, mode);
  }
});

test("stale sequences are rejected and counted", () => {
  const motion = new RemoteMotion();
  assert.equal(motion.push(point(2, 100, 10)), true);
  assert.equal(motion.push(point(1, 110, 99)), false);
  assert.equal(motion.sample(200)?.x, 10);
  assert.equal(motion.metrics(200).dropped, 1);
});

test("reset clears old sequence and visual state for reconnect/new match", () => {
  const motion = new RemoteMotion();
  motion.push(point(20, 100, 100));
  motion.reset();
  assert.equal(motion.sample(200), null);
  assert.equal(motion.push(point(1, 210, 5)), true);
  assert.equal(motion.sample(210)?.x, 5);
});

test("position reporting has one approximately 30Hz cadence and adds ordering data", () => {
  const client = new PvpClient("coop");
  const frames = [];
  client.socket = { readyState: 1, send: (frame) => frames.push(JSON.parse(frame)) };
  assert.equal(client.reportPosition(1, 2, 3, 100), true);
  assert.equal(client.reportPosition(2, 3, 4, 100 + POSITION_SEND_INTERVAL_MS - 1), false);
  assert.equal(client.reportPosition(3, 4, 5, 100 + POSITION_SEND_INTERVAL_MS), true);
  assert.deepEqual(frames.map(({ seq }) => seq), [1, 2]);
  assert.ok(frames.every(({ sentAt }) => Number.isInteger(sentAt)));
});
