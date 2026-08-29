import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { SHIPS, SHIP_SPECIALS, WEAPONS } from "../app/game-data.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const rooms = readFileSync(new URL("../server/rooms.mjs", import.meta.url), "utf8");

test("Kestrel keeps its active identity without an inventory healing path", () => {
  const ship = SHIPS.find(({ id }) => id === "kestrel");
  assert.equal(ship.role, "Light / Scavenger");
  assert.equal(ship.health, 120);
  assert.equal(SHIP_SPECIALS.kestrel.name, "SALVAGE LINK");
  assert.equal(SHIP_SPECIALS.kestrel.activeSeconds, 5);
  assert.equal(SHIP_SPECIALS.kestrel.cooldownSeconds, 20);
  assert.match(ship.special, /For 5 seconds, cannon shots collect loose PUPs on impact/);
  assert.doesNotMatch(ship.special, /heal|regen|repair/i);
});

test("one or a full inventory cannot regenerate Kestrel hull", () => {
  assert.equal(existsSync(new URL("../app/pup-regen.js", import.meta.url)), false);
  assert.doesNotMatch(game, /pupRegenHull|PUP_REGEN|beforeRegen/i);
  assert.doesNotMatch(rooms, /pupRegenHull|applyPassiveRegen|lastRegenAt/i);
});

test("the universal Hull Repair pickup remains recovery and heals through the shared resolver", () => {
  assert.equal(WEAPONS.health.name, "HULL REPAIR");
  assert.equal(WEAPONS.health.pupClass, "recovery");
  assert.match(game, /type === "health"/);
  assert.match(game, /player\.health = Math\.min\(player\.maxHealth, player\.health \+ 30\)/);
});
