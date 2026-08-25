/**
 * Ship metadata is derived, never transcribed.
 *
 * The point of these tests is that the presentation layer can never disagree
 * with the gameplay values: every statistic, strength and tier must come back
 * to `SHIPS` in game-data.ts, and nothing here may change one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SHIPS, SHIP_SPECIALS } from "../app/game-data.ts";
import {
  SHIP_ORDER,
  SHIP_PROFILES,
  compareShips,
  isSelectable,
  statsFor,
} from "../app/ship-data.ts";

test("every ship has a profile, in the shipped order", () => {
  assert.equal(SHIP_ORDER.length, 8);
  assert.deepEqual(SHIP_ORDER, SHIPS.map((s) => s.id));
  for (const ship of SHIPS) assert.ok(SHIP_PROFILES[ship.id], `missing profile for ${ship.id}`);
});

test("profiles report the shipped statistics unchanged", () => {
  for (const ship of SHIPS) {
    const profile = SHIP_PROFILES[ship.id];
    const byKey = Object.fromEntries(profile.stats.map((s) => [s.key, s.value]));
    assert.equal(byKey.hull, ship.health, `${ship.id} hull`);
    assert.equal(byKey.maxSpeed, ship.maxSpeed, `${ship.id} max speed`);
    assert.equal(byKey.acceleration, ship.acceleration, `${ship.id} acceleration`);
    assert.equal(byKey.turn, ship.turn, `${ship.id} turn`);
    assert.equal(byKey.gun, ship.gun, `${ship.id} gun`);
    assert.equal(byKey.thrust, ship.thrust, `${ship.id} thrust`);
    assert.equal(profile.name, ship.name);
    assert.equal(profile.role, ship.role);
    assert.equal(profile.unlock, ship.unlock);
  }
});

test("stat labels are readable words, not unexplained abbreviations", () => {
  for (const stat of statsFor(SHIPS[0])) {
    assert.ok(stat.label.length > 3, `label too terse: ${stat.label}`);
    assert.doesNotMatch(stat.label, /^MAX V$/i, "MAX V is exactly the abbreviation to avoid");
    assert.ok(stat.display.length > 0, `${stat.key} needs a display value`);
  }
});

test("specials come from the shared special table with both input prompts", () => {
  for (const ship of SHIPS) {
    const profile = SHIP_PROFILES[ship.id];
    assert.equal(profile.special.name, SHIP_SPECIALS[ship.id].name);
    assert.equal(profile.special.cooldownSeconds, SHIP_SPECIALS[ship.id].cooldownSeconds);
    assert.equal(profile.specialInput.keyboard, "Q");
    assert.equal(profile.specialInput.touch, "SPEC");
    assert.doesNotMatch(profile.special.description, /^Q:/, "prompt should not be repeated in the prose");
  }
});

test("all eight ships are open until a real progression system exists", () => {
  assert.equal(SHIP_ORDER.length, 8);
  for (const ship of SHIPS) {
    const profile = SHIP_PROFILES[ship.id];
    assert.equal(ship.unlock, "OPEN", `${ship.id} must not advertise a fake rank gate`);
    assert.equal(profile.locked, false, `${ship.id} lock state`);
    assert.equal(profile.lockRequirement, "");
    assert.equal(isSelectable(ship.id), true);
  }
});

test("every ship gets usable strengths, weaknesses, tier and playstyle", () => {
  for (const id of SHIP_ORDER) {
    const profile = SHIP_PROFILES[id];
    assert.ok(profile.strengths.length >= 1 && profile.strengths.length <= 3, id);
    assert.ok(profile.weaknesses.length >= 1 && profile.weaknesses.length <= 3, id);
    assert.ok(["Beginner", "Intermediate", "Expert"].includes(profile.experience), id);
    assert.ok(profile.playstyle.length > 40, `${id} playstyle is too thin`);
  }
});

test("derived prose never contradicts the statistics", () => {
  // The lightest frame must not be described as heavily armoured, and the
  // slowest must not be described as fast.
  const lightest = SHIPS.reduce((a, b) => (a.health <= b.health ? a : b));
  const slowest = SHIPS.reduce((a, b) => (a.maxSpeed <= b.maxSpeed ? a : b));

  assert.ok(
    !SHIP_PROFILES[lightest.id].strengths.some((s) => /armour|armor/i.test(s)),
    `${lightest.id} is the lightest frame and must not claim armour`
  );
  assert.ok(
    !SHIP_PROFILES[slowest.id].strengths.some((s) => /high top speed/i.test(s)),
    `${slowest.id} is the slowest frame and must not claim speed`
  );
  assert.ok(
    SHIP_PROFILES[lightest.id].weaknesses.some((w) => /light hull/i.test(w)),
    `${lightest.id} should be called out as fragile`
  );
});

test("comparison reports exact values on both sides, not just a direction", () => {
  const rows = compareShips("squid", "tank");
  assert.equal(rows.length, statsFor(SHIPS[0]).length);

  for (const row of rows) {
    // Colour and bar length must never be the only signal.
    assert.ok(row.display.length > 0, `${row.key} needs the inspected value`);
    assert.ok(row.againstDisplay.length > 0, `${row.key} needs the compared value`);
    assert.ok(row.deltaDisplay.length > 0, `${row.key} needs a readable delta`);
    assert.ok(["better", "worse", "same"].includes(row.direction));
  }

  const hull = rows.find((r) => r.key === "hull");
  assert.equal(hull.value, 170);
  assert.equal(hull.againstValue, 280);
  assert.equal(hull.delta, -110);
  assert.equal(hull.direction, "worse");

  const speed = rows.find((r) => r.key === "maxSpeed");
  assert.equal(speed.direction, "better");
  assert.ok(speed.delta > 0);
});

test("a ship compared against itself is identical on every axis", () => {
  for (const row of compareShips("wing", "wing")) {
    assert.equal(row.delta, 0, row.key);
    assert.equal(row.direction, "same", row.key);
    assert.equal(row.deltaDisplay, "same");
  }
});

test("comparison bars share one fleet-wide scale", () => {
  for (const id of SHIP_ORDER) {
    for (const stat of SHIP_PROFILES[id].stats) {
      assert.ok(stat.fraction >= 0 && stat.fraction <= 1, `${id} ${stat.key} fraction out of range`);
      assert.ok(stat.fleetMax > 0, `${id} ${stat.key} needs a scale`);
    }
  }
  // The fleet leader on an axis should sit at the top of the bar.
  const fastest = SHIPS.reduce((a, b) => (a.maxSpeed >= b.maxSpeed ? a : b));
  const stat = SHIP_PROFILES[fastest.id].stats.find((s) => s.key === "maxSpeed");
  assert.equal(stat.fraction, 1);
});

test("only the overcharge frames advertise a power-up derivation", () => {
  const derived = SHIP_ORDER.filter((id) => SHIP_PROFILES[id].special.derivedFrom);
  assert.deepEqual(derived, ["wing", "squid", "hunter"]);

  for (const id of SHIP_ORDER) {
    const { derivedFrom } = SHIP_PROFILES[id].special;
    if (derivedFrom) assert.match(derivedFrom, /^Overcharged /);
  }
});

/**
 * Panel copy has to stay comparable across the fleet.
 *
 * The overcharge frames once carried a six-line breakdown of what their
 * enhanced build changes, which made their panel roughly four times the height
 * of every other ship's and was the only thing forcing a scroll on desktop.
 * The breakdown still exists as the design record in `app/overcharge.ts`; what
 * this guards is that it never comes back into the selection screen, and that
 * no single ship's description runs away from the rest.
 */
test("no ship's selection copy dwarfs the rest of the fleet", () => {
  const lengths = SHIP_ORDER.map((id) => SHIP_PROFILES[id].special.description.length);
  const longest = Math.max(...lengths);
  const shortest = Math.min(...lengths);

  assert.ok(longest <= 120, `longest special description is ${longest} characters`);
  assert.ok(
    longest <= shortest * 2.5,
    `special descriptions range ${shortest}-${longest} characters, which is too uneven`
  );

  // The derivation is one short line, and it is the only extra a derived frame
  // is allowed to add to the panel.
  for (const id of SHIP_ORDER) {
    const { derivedFrom } = SHIP_PROFILES[id].special;
    if (derivedFrom) assert.ok(derivedFrom.length <= 40, `${id} derivation line is too long`);
    assert.equal("differences" in SHIP_PROFILES[id].special, false, `${id} must not carry unrendered panel copy`);
  }
});
