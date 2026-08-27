import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_PICKUPS,
  SENDABLE_POWERUPS,
  WEAPONS,
} from "../app/game-data.ts";

const PUP_CLASSES = new Set(["payload", "upgrade", "recovery", "rare"]);

test("every collectible PUP has a valid gameplay class", () => {
  assert.deepEqual(
    Object.keys(WEAPONS).sort(),
    [...CODEX_PICKUPS].sort(),
    "the collectible catalogue and metadata must cover the same IDs",
  );

  for (const id of CODEX_PICKUPS) {
    assert.ok(WEAPONS[id], `${id} is missing metadata`);
    assert.ok(PUP_CLASSES.has(WEAPONS[id].pupClass), `${id} has no valid PupClass`);
  }
});

test("every currently sendable inventory PUP is a payload", () => {
  for (const id of SENDABLE_POWERUPS) {
    assert.equal(WEAPONS[id].sendable, true, `${id} must remain sendable`);
    assert.equal(WEAPONS[id].pupClass, "payload", `${id} must be a payload`);
  }
});

test("classification preserves the existing sendable boundary", () => {
  const sendableFromMetadata = Object.values(WEAPONS)
    .filter(({ sendable }) => sendable)
    .map(({ id }) => id)
    .sort();

  assert.deepEqual(sendableFromMetadata, [...SENDABLE_POWERUPS].sort());
  assert.deepEqual(
    Object.values(WEAPONS).filter(({ pupClass }) => pupClass === "payload").map(({ id }) => id).sort(),
    sendableFromMetadata,
  );
});

test("persistent ship improvements are upgrades", () => {
  assert.equal(WEAPONS.gun.pupClass, "upgrade");
  assert.equal(WEAPONS.thrust.pupClass, "upgrade");
  assert.equal(WEAPONS.retros.pupClass, "upgrade");
});

test("Hull Repair is recovery while the temporary Shield Field is rare", () => {
  assert.equal(WEAPONS.health.pupClass, "recovery");
  assert.equal(WEAPONS.shield.pupClass, "rare");
  assert.match(WEAPONS.shield.behavior, /burns down over time/);
});

test("instant special-purpose PUPs are rare", () => {
  assert.equal(WEAPONS.clear.pupClass, "rare");
  assert.equal(WEAPONS.ricochet.pupClass, "rare");
});
