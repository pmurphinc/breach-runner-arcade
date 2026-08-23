import test from "node:test";
import assert from "node:assert/strict";
import { SHIPS, SHIP_SPECIALS } from "../app/game-data.ts";

test("every selectable ship has one named Q special", () => {
  assert.deepEqual(
    Object.keys(SHIP_SPECIALS).sort(),
    SHIPS.map((ship) => ship.id).sort(),
  );

  for (const ship of SHIPS) {
    const special = SHIP_SPECIALS[ship.id];
    assert.ok(special.name.trim().length > 0, `${ship.id} needs an ability name`);
    assert.ok(special.cooldownSeconds > 0, `${ship.id} needs a positive cooldown`);
    assert.match(ship.special, /^Q:/, `${ship.id} selection copy must explain Q`);
  }
});

test("ability names are unique so HUD feedback identifies the activation", () => {
  const names = Object.values(SHIP_SPECIALS).map((special) => special.name);
  assert.equal(new Set(names).size, SHIPS.length);
});
