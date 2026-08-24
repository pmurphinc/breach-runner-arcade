import test from "node:test";
import assert from "node:assert/strict";
import {
  VICTORY_TOTAL_SECONDS,
  pullVelocity,
  victoryVisualState,
} from "../app/victory-sequence.ts";

const tickMs = 15;
const totalTicks = Math.round(VICTORY_TOTAL_SECONDS * 1000 / tickMs);

test("victory progresses through freeze, pull, collapse, and blast", () => {
  assert.equal(victoryVisualState(totalTicks, tickMs).phase, "freeze");
  assert.equal(victoryVisualState(Math.round(totalTicks * 0.7), tickMs).phase, "pull");
  assert.equal(victoryVisualState(Math.round(totalTicks * 0.3), tickMs).phase, "collapse");
  assert.equal(victoryVisualState(1, tickMs).phase, "blast");
});

test("the portal becomes a tiny dot before the blast", () => {
  const collapse = victoryVisualState(Math.round(totalTicks * 0.3), tickMs);
  const blast = victoryVisualState(1, tickMs);
  assert.ok(collapse.portalScale < 0.72);
  assert.equal(blast.portalScale, 0.02);
  assert.ok(blast.shake > 0);
});

test("pull velocity attracts objects without teleporting them", () => {
  const pulled = pullVelocity(0, 0, 1, 0, 100, 0, 2);
  assert.ok(pulled.vx > 1);
  assert.equal(pulled.vy, 0);
  assert.equal(pulled.distance, 100);
});
