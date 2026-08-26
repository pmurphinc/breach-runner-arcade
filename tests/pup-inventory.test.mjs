import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("firing promotes the queued PUP closest to the loaded panel and clears the old slot", () => {
  const stock = Array.from({ length: 10 }, (_, index) => `pup-${index}`);
  const before = pupInventoryLayout(stock, 10);
  assert.equal(before.loaded, "pup-9");
  assert.equal(before.stored.at(-1), "pup-8");

  const after = pupInventoryLayout(stock.slice(0, -1), 10);
  assert.equal(after.loaded, "pup-8");
  assert.equal(after.stored.at(-1), "pup-7");
  assert.equal(after.stored[0], null, "the vacated queue position must not retain a stale symbol");
});

test("arena canvas rules cannot capture nested inventory icon canvases", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.canvas-wrap\s+canvas\s*\{/);
  assert.match(css, /\.canvas-wrap\s*>\s*canvas\s*\{/);
});
