import test from "node:test";
import assert from "node:assert/strict";
import { TIME_PENALTY_PER_SECOND, formatRunTime, normalizeInitials, settleScore } from "../app/run-scoring.ts";

test("victory score subtracts ten points for every completed second", () => {
  assert.equal(TIME_PENALTY_PER_SECOND, 10);
  assert.deepEqual(settleScore(5000, 42.9, "victory"), {
    baseScore: 5000,
    durationSeconds: 42,
    timePenalty: 420,
    finalScore: 4580,
  });
});

test("time can never make a score negative and defeats receive no time adjustment", () => {
  assert.equal(settleScore(100, 999, "victory").finalScore, 0);
  assert.equal(settleScore(100, 999, "defeat").finalScore, 100);
});

test("run time and arcade initials are normalized deterministically", () => {
  assert.equal(formatRunTime(0), "00:00");
  assert.equal(formatRunTime(125), "02:05");
  assert.equal(normalizeInitials(" m-r!9 "), "MR9");
});
