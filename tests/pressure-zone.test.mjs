/**
 * The pressure zone in PvE.
 *
 * Two rules, and both are easy to break without anything on screen changing.
 *
 * **The zone must not shorten a telegraph.** A retaliation the pilot could not
 * have seen coming is a bug, not difficulty, and a `telegraphScale` typed below
 * 1 would produce exactly that while every other number still looked sane.
 *
 * **The zone must not turn a PvE round into a Rift Run.** The two share one
 * runtime, and the thing that tells them apart is whether that runtime has a
 * payload budget. Get that wrong and PvE's rift silently stops shedding
 * power-ups on damage — which no test of the pressure system itself would
 * notice, because the pressure system would be working perfectly.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CRITICAL_PRESSURE_ZONE,
  NO_PRESSURE_ZONE,
  VOLATILE_PRESSURE_ZONE,
  pressureZonePhase,
} from "../app/pressure-zone.ts";
import { DIFFICULTIES, CLASSIC_RULES, PVP_RULES } from "../app/difficulty.ts";
import { RIFT_PHASES, riftPhaseForIntegrity } from "../app/rift-run/rift-phases.ts";
import {
  RIFT_PRESSURE_MAX,
  RIFT_PRESSURE_RADIUS,
  createRiftPressure,
  tickRiftPressure,
} from "../app/rift-run/rift-pressure.ts";
import { createPressureZoneDanger, createRiftDanger, isRiftRunDanger } from "../app/rift-run/danger.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

const INTACT = RIFT_PHASES[0];
const COLLAPSING = RIFT_PHASES[RIFT_PHASES.length - 1];

/** Ticks of camping dead centre before the rift commits to a retaliation. */
function ticksToRetaliate(zone, phase) {
  const state = createRiftPressure();
  const scaled = pressureZonePhase(phase, zone);
  for (let tick = 1; tick <= 20_000; tick += 1) {
    const result = tickRiftPressure(state, {
      distance: 0,
      playerX: 0,
      playerY: 0,
      riftX: 0,
      riftY: 0,
      phase: scaled,
    });
    if (result.telegraphed) return tick;
  }
  return null;
}

test("no zone leaves the phase exactly as written", () => {
  // Rift Run has no zone rules and wants the table untouched, so this path has
  // to be a genuine no-op rather than a rescale by 1.
  for (const phase of RIFT_PHASES) {
    assert.equal(pressureZonePhase(phase, NO_PRESSURE_ZONE), phase, `${phase.id} must pass through`);
  }
});

test("a zone never shortens the warning", () => {
  // The one number that must not be tuned down. Checked against every phase,
  // because the shortest telegraph in the table is the one a mistake here
  // would make unsurvivable.
  for (const zone of [VOLATILE_PRESSURE_ZONE, CRITICAL_PRESSURE_ZONE]) {
    assert.ok(zone.telegraphScale >= 1, "a zone only ever adds warning");
    for (const phase of RIFT_PHASES) {
      const scaled = pressureZonePhase(phase, zone);
      assert.ok(
        scaled.telegraphTicks >= phase.telegraphTicks,
        `${phase.id}: ${scaled.telegraphTicks} < ${phase.telegraphTicks}`,
      );
    }
  }
});

test("a telegraph is never zero ticks, whatever the scale", () => {
  // A zero-tick telegraph is a hit out of nowhere. Guarded even against a
  // scale nobody would write on purpose.
  const absurd = { enabled: true, gainScale: 1, telegraphScale: 0, escortScale: 0 };
  for (const phase of RIFT_PHASES) {
    assert.ok(pressureZonePhase(phase, absurd).telegraphTicks >= 1);
  }
});

test("VOLATILE is the introduction: slower to build, longer to read, alone", () => {
  const volatileTicks = ticksToRetaliate(VOLATILE_PRESSURE_ZONE, INTACT);
  const riftRunTicks = ticksToRetaliate(NO_PRESSURE_ZONE, INTACT);
  assert.ok(volatileTicks > riftRunTicks, `${volatileTicks} should exceed ${riftRunTicks}`);

  // Nothing escorts a retaliation, at any phase. The first one a pilot meets
  // has to be understandable, and a strike arriving with three fresh hostiles
  // teaches only that something killed them.
  for (const phase of RIFT_PHASES) {
    assert.equal(pressureZonePhase(phase, VOLATILE_PRESSURE_ZONE).spawnCount, 0, phase.id);
  }
});

test("CRITICAL is the real thing: full build rate, escorted", () => {
  assert.equal(
    ticksToRetaliate(CRITICAL_PRESSURE_ZONE, INTACT),
    ticksToRetaliate(NO_PRESSURE_ZONE, INTACT),
    "gainScale 1 means Rift Run's own build rate",
  );

  // Half the phase's escort, rounded down -- so the opening phase, which sends
  // none, still sends none rather than inventing one.
  assert.equal(pressureZonePhase(INTACT, CRITICAL_PRESSURE_ZONE).spawnCount, 0);
  assert.ok(pressureZonePhase(COLLAPSING, CRITICAL_PRESSURE_ZONE).spawnCount > 0);
  assert.ok(
    pressureZonePhase(COLLAPSING, CRITICAL_PRESSURE_ZONE).spawnCount < COLLAPSING.spawnCount,
    "but not a full Rift Run escort on top of CRITICAL's own enrage waves",
  );
});

test("camping is what is punished, not shooting", () => {
  // The whole premise of the system, re-checked through a zone: a pilot who
  // backs off bleeds pressure faster than sitting close builds it, so
  // disengaging is a real answer rather than a delay.
  const state = createRiftPressure();
  const phase = pressureZonePhase(INTACT, CRITICAL_PRESSURE_ZONE);
  const camp = { distance: 0, playerX: 0, playerY: 0, riftX: 0, riftY: 0, phase };
  const away = { ...camp, distance: RIFT_PRESSURE_RADIUS + 200 };

  for (let i = 0; i < 300; i += 1) tickRiftPressure(state, camp);
  const built = state.pressure;
  assert.ok(built > 0, "sitting on the rift builds pressure");

  for (let i = 0; i < 300; i += 1) tickRiftPressure(state, away);
  assert.equal(state.pressure, 0, "leaving clears it");

  // And it clears in less time than it took to build.
  const rebuild = createRiftPressure();
  let toBuild = 0;
  while (rebuild.pressure < built) { tickRiftPressure(rebuild, camp); toBuild += 1; }
  let toBleed = 0;
  while (rebuild.pressure > 0) { tickRiftPressure(rebuild, away); toBleed += 1; }
  assert.ok(toBleed < toBuild, `bleeding (${toBleed}) must beat building (${toBuild})`);
});

test("the meter still tops out, so a retaliation is reachable at every zone", () => {
  // A gainScale small enough to make the meter unreachable would silently
  // disable the whole system while every rule still read as enabled.
  for (const zone of [VOLATILE_PRESSURE_ZONE, CRITICAL_PRESSURE_ZONE]) {
    for (const phase of RIFT_PHASES) {
      const ticks = ticksToRetaliate(zone, phase);
      assert.ok(ticks !== null, `${phase.id} never retaliates`);
      // And within a length a player would actually sit still for: under a
      // minute at 20ms ticks.
      assert.ok(ticks < 3000, `${phase.id} takes ${ticks} ticks`);
    }
  }
  assert.equal(RIFT_PRESSURE_MAX, 100, "the HUD reads this as a percentage");
});

// ------------------------------------------------------ which modes get it --

test("only VOLATILE and CRITICAL carry a zone", () => {
  assert.equal(DIFFICULTIES.difficult.pressureZone, VOLATILE_PRESSURE_ZONE);
  assert.equal(DIFFICULTIES.hard.pressureZone, CRITICAL_PRESSURE_ZONE);

  // PRACTICE takes no hull damage at all, so a retaliation would be scenery.
  assert.equal(DIFFICULTIES.practice.pressureZone.enabled, false);
  // STABLE locks the rift dead centre, so a ring around it would cover the one
  // place the mode asks a learning pilot to be.
  assert.equal(DIFFICULTIES.easy.pressureZone.enabled, false);
  // Survival escalates on its own clock and would be running two systems.
  assert.equal(DIFFICULTIES.survival.pressureZone.enabled, false);
  // Classic is fidelity to a game that had no anti-camp system.
  assert.equal(CLASSIC_RULES.pressureZone.enabled, false);
  // And a duel is not something this was designed or asked for.
  assert.equal(PVP_RULES.pressureZone.enabled, false);
});

test("every ruleset answers the question", () => {
  // A ruleset with no `pressureZone` would read as disabled by accident rather
  // than by decision, and the loop would crash reading `.enabled` off it.
  for (const [id, rules] of Object.entries(DIFFICULTIES)) {
    assert.equal(typeof rules.pressureZone?.enabled, "boolean", `${id} has no pressureZone`);
  }
});

// ------------------------------------------------- keeping the modes apart --

test("the payload budget is what separates a Rift Run from a PvE round", () => {
  const riftRun = createRiftDanger();
  const pveZone = createPressureZoneDanger();

  assert.ok(isRiftRunDanger(riftRun));
  assert.ok(!isRiftRunDanger(pveZone));

  // The zone runtime carries the pressure system and the retaliation entities,
  // and neither of Rift Run's own two.
  assert.equal(pveZone.budget, null, "PvE sheds power-ups on damage, not from an allocation");
  assert.equal(pveZone.hazards, null, "hazards are gated on depth and level, which PvE has neither of");
  assert.ok(pveZone.pressure, "but it does build pressure");
  assert.deepEqual(pveZone.shockwaves, []);
  assert.deepEqual(pveZone.sweeps, []);
});

test("a PvE rift keeps charging its power-up meter on cannon fire", () => {
  // This is the regression the shared runtime makes possible. `game.riftDanger`
  // used to mean "this is a Rift Run"; now a PvE round has one too, so the test
  // has to be the budget rather than the runtime. Reading it wrong would stop
  // PvE's rift shedding power-ups, and no pressure test would notice.
  assert.ok(game.includes("if (struck.id === 0 && !game.riftDanger?.budget) chargeRiftPup(game, bullet.damage);"));
  assert.ok(!game.includes("if (struck.id === 0 && !game.riftDanger) chargeRiftPup"), "the old proxy is gone");

  // The HUD's payload readout is Rift Run's too.
  assert.ok(game.includes("riftPupBudget: game.riftDanger?.budget ? riftPupBudgetRemaining"));
});

test("environmental hazards stay in Rift Run", () => {
  // Section 4 of the danger tick is depth- and level-gated, and a PvE round has
  // neither. The guard is on both the scheduler and the run.
  assert.ok(game.includes("if (!danger.hazards || !run) return;"));
  // And the run itself is only looked up when the runtime says it is one.
  assert.ok(game.includes('const run = danger?.budget ? riftRunRef.current : null;'));
});

test("the zone rescales the phase rather than reaching into the pressure system", () => {
  assert.ok(game.includes("pressureZonePhase(riftPhaseForIntegrity(fraction), game.rules.pressureZone)"));
  // The runtime is created for either reason.
  assert.ok(game.includes("rules.pressureZone.enabled"));
  assert.ok(game.includes("createPressureZoneDanger()"));
});

test("the rail reports pressure only while there is pressure to report", () => {
  // A permanent PRESSURE 0% would widen the rail on every VOLATILE and CRITICAL
  // round for a pilot who never camps. The threshold matches the arena ring's,
  // so the number and the ring arrive together.
  assert.ok(game.includes("{hud.riftPressure > 2 ? ("));
  assert.ok(game.includes("| RIFT PRESSURE ${hud.riftPressure}%"), "and it is spoken, not only drawn");
});

test("phase changes stay unannounced outside Rift Run", () => {
  // CRITICAL enrages at 30% integrity; COLLAPSING starts at 18%. Announcing
  // both would put two different words for the rift's condition on screen.
  assert.ok(game.includes("if (phase.id !== danger.phaseId && run) {"));

  // The thresholds really do disagree, which is the reason for the rule.
  assert.equal(DIFFICULTIES.hard.wormholeEnrage.thresholdFraction, 0.3);
  assert.equal(riftPhaseForIntegrity(0.3).id, "fracturing");
  assert.equal(riftPhaseForIntegrity(0.18).id, "collapsing");
});
