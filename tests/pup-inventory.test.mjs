import test from "node:test";
import assert from "node:assert/strict";
import { pupInventoryLayout } from "../app/pup-inventory.js";

test("loaded and stored PUPs preserve firing order", () => {
  const layout = pupInventoryLayout(["oldest", "middle", "next", "loaded"], 10);
  assert.equal(layout.loaded, "loaded");
  assert.equal(layout.stored.length, 9);
  assert.deepEqual(layout.stored.slice(-3), ["oldest", "middle", "next"]);
});

test("empty and full inventories always expose nine stored slots", () => {
  assert.deepEqual(pupInventoryLayout([], 10), { loaded: null, stored: Array(9).fill(null) });
  const full = pupInventoryLayout(Array.from({ length: 10 }, (_, index) => index), 10);
  assert.equal(full.loaded, 9);
  assert.deepEqual(full.stored, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});
