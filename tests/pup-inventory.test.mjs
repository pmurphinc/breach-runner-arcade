import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PUP_INVENTORY_CAPACITY, consumeLoadedPup, pupInventoryLayout } from "../app/pup-inventory.js";

/**
 * Every expectation below derives from PUP_INVENTORY_CAPACITY rather than hardcoding it.
 * These cases previously passed a literal 10, which meant the ceiling could be retuned without
 * a single test noticing — the suite would keep asserting a capacity the game no longer used.
 */
const STORED_SLOTS = PUP_INVENTORY_CAPACITY - 1;

test("the shared payload ceiling is five, one loaded plus four stored", () => {
  assert.equal(PUP_INVENTORY_CAPACITY, 5, "Classic Wormhole fidelity and the compact HUD frame both depend on this");
  assert.equal(pupInventoryLayout([], PUP_INVENTORY_CAPACITY).stored.length, 4);
});

test("loaded and stored PUPs preserve firing order", () => {
  const layout = pupInventoryLayout(["oldest", "middle", "next", "loaded"], PUP_INVENTORY_CAPACITY);
  assert.equal(layout.loaded, "loaded");
  assert.equal(layout.stored.length, STORED_SLOTS);
  assert.deepEqual(layout.stored.slice(-3), ["oldest", "middle", "next"]);
});

test("empty and full inventories always expose capacity-minus-one stored slots", () => {
  assert.deepEqual(pupInventoryLayout([], PUP_INVENTORY_CAPACITY), {
    loaded: null,
    stored: Array(STORED_SLOTS).fill(null),
  });
  const full = pupInventoryLayout(
    Array.from({ length: PUP_INVENTORY_CAPACITY }, (_, index) => index),
    PUP_INVENTORY_CAPACITY
  );
  assert.equal(full.loaded, PUP_INVENTORY_CAPACITY - 1);
  assert.deepEqual(full.stored, Array.from({ length: STORED_SLOTS }, (_, index) => index));
});

test("a stock longer than the ceiling shows only the newest payloads", () => {
  const overfilled = Array.from({ length: PUP_INVENTORY_CAPACITY + 3 }, (_, index) => `pup-${index}`);
  const layout = pupInventoryLayout(overfilled, PUP_INVENTORY_CAPACITY);
  assert.equal(layout.loaded, `pup-${PUP_INVENTORY_CAPACITY + 2}`);
  assert.equal(layout.stored.length, STORED_SLOTS, "the window never grows past the ceiling");
  assert.equal(layout.stored[0], `pup-${PUP_INVENTORY_CAPACITY - 2}`, "oldest payloads fall out of the window");
});

test("firing promotes the queued PUP closest to the loaded panel and clears the old slot", () => {
  const stock = Array.from({ length: PUP_INVENTORY_CAPACITY }, (_, index) => `pup-${index}`);
  const before = pupInventoryLayout(stock, PUP_INVENTORY_CAPACITY);
  assert.equal(before.loaded, `pup-${PUP_INVENTORY_CAPACITY - 1}`);
  assert.equal(before.stored.at(-1), `pup-${PUP_INVENTORY_CAPACITY - 2}`);

  const after = pupInventoryLayout(stock.slice(0, -1), PUP_INVENTORY_CAPACITY);
  assert.equal(after.loaded, `pup-${PUP_INVENTORY_CAPACITY - 2}`);
  assert.equal(after.stored.at(-1), `pup-${PUP_INVENTORY_CAPACITY - 3}`);
  assert.equal(after.stored[0], null, "the vacated queue position must not retain a stale symbol");
});

test("arena canvas rules cannot capture nested inventory icon canvases", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.canvas-wrap\s+canvas\s*\{/);
  assert.match(css, /\.canvas-wrap\s*>\s*canvas\s*\{/);
});

test("hostile beam consumption removes exactly the loaded next-to-fire payload", () => {
  const stock = ["turret", "mines", "beam"];
  assert.equal(consumeLoadedPup(stock), "beam");
  assert.deepEqual(stock, ["turret", "mines"]);
  assert.equal(consumeLoadedPup(stock), "mines", "normal firing order remains LIFO");
});

test("hostile beam consumption is safe for an empty payload inventory", () => {
  const stock = [];
  assert.equal(consumeLoadedPup(stock), null);
  assert.deepEqual(stock, []);
});

test("consuming inventory cannot reduce applied upgrades or ship state", () => {
  const stock = ["turret"];
  const ship = { gun: 3, thrust: 2, retros: 1, health: 150, shield: 450, ricochetTicks: 90 };
  consumeLoadedPup(stock);
  assert.deepEqual(ship, { gun: 3, thrust: 2, retros: 1, health: 150, shield: 450, ricochetTicks: 90 });
});
