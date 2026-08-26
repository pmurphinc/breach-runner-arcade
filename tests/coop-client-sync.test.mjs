import test from "node:test";
import assert from "node:assert/strict";
import { countdownLabel, countdownRemaining } from "../app/pvp-client.ts";

test("server countdown deadline derives 3, 2, 1 locally without new messages", () => {
  const startsAt = 13_000;
  assert.equal(countdownRemaining(startsAt, 1_000, 9_000), 3_000);
  assert.equal(countdownLabel(countdownRemaining(startsAt, 1_000, 9_000)), "3");
  assert.equal(countdownLabel(countdownRemaining(startsAt, 1_000, 10_001)), "2");
  assert.equal(countdownLabel(countdownRemaining(startsAt, 1_000, 11_001)), "1");
  assert.equal(countdownLabel(countdownRemaining(startsAt, 1_000, 12_001)), "LAUNCH");
});

test("the same authoritative startsAt can be reused across later rounds", () => {
  for (const startsAt of [3_000, 13_000, 23_000]) {
    assert.equal(countdownLabel(countdownRemaining(startsAt, 0, startsAt - 2_500)), "3");
  }
});
