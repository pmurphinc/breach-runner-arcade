import test from "node:test";
import assert from "node:assert/strict";
import {
  createPilotProgressionStore, isDifficultyUnlocked, newPilotProgression,
  parsePilotProgression, recordDifficultyCompletion, safeDifficulty,
} from "../app/pilot-progression.ts";

test("new pilots start with only Stable in the competitive ladder", () => {
  const pilot = newPilotProgression();
  assert.equal(isDifficultyUnlocked("easy", pilot), true);
  assert.equal(isDifficultyUnlocked("difficult", pilot), false);
  assert.equal(isDifficultyUnlocked("hard", pilot), false);
  assert.equal(isDifficultyUnlocked("practice", pilot), true);
});

test("victories sequentially unlock Volatile and Critical", () => {
  let pilot = newPilotProgression();
  pilot = recordDifficultyCompletion(pilot, { mode: "coop", difficulty: "easy", outcome: "victory" });
  assert.equal(isDifficultyUnlocked("difficult", pilot), true);
  pilot = recordDifficultyCompletion(pilot, { mode: "pve", difficulty: "difficult", outcome: "victory" });
  assert.equal(isDifficultyUnlocked("hard", pilot), true);
});

test("defeats, Simulation, and out-of-sequence completions do not advance", () => {
  const fresh = newPilotProgression();
  for (const result of [
    { mode: "pve", difficulty: "easy", outcome: "defeat" },
    { mode: "pve", difficulty: "practice", outcome: "victory" },
    { mode: "pvp", difficulty: "easy", outcome: "victory" },
    { mode: "pve", difficulty: "difficult", outcome: "victory" },
  ]) assert.deepEqual(recordDifficultyCompletion(fresh, result), fresh);
});

test("store persists unlocks and reloads them", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  createPilotProgressionStore(storage).record({ mode: "pve", difficulty: "easy", outcome: "victory" });
  assert.equal(isDifficultyUnlocked("difficult", createPilotProgressionStore(storage).getSnapshot()), true);
});

test("migration ignores old selected difficulty and stale locked choices fall back", () => {
  const pilot = parsePilotProgression(null);
  assert.deepEqual(pilot.completedDifficulties, []);
  assert.equal(safeDifficulty("difficult", pilot), "easy");
  assert.equal(safeDifficulty("hard", pilot), "easy");
});
