import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  RIFT_PUP_BAND_ALLOWANCE,
  RIFT_PUP_BUDGET_TOTAL,
  RIFT_PUP_EJECT_OFFSET,
  RIFT_PUP_GRACE_TICKS,
  RIFT_PUP_LIFE_TICKS,
  RIFT_PUP_THRESHOLDS,
  createRiftPupBudget,
  creditRiftPupBudget,
  ejectRiftPup,
  riftPupBudgetRemaining,
  riftPupBudgetSpent,
  riftPupIsShootable,
} from "../app/rift-run/pup-budget.ts";
import {
  RIFT_PHASES,
  riftPhaseForIntegrity,
  riftPhaseIndex,
  riftPhaseNotice,
  riftPhaseSpawn,
} from "../app/rift-run/rift-phases.ts";
import {
  RIFT_PRESSURE_MAX,
  RIFT_PRESSURE_RADIUS,
  RIFT_RETALIATION_ORDER,
  RIFT_SHOCKWAVE_BAND,
  RIFT_SWEEP_HALF_ANGLE,
  createRiftPressure,
  createRiftShockwave,
  createRiftSweep,
  markRiftSweepHit,
  resetRiftPressure,
  riftRetaliationNotice,
  riftShockwaveHits,
  riftShockwavePush,
  riftSweepHits,
  tickRiftPressure,
  tickRiftShockwave,
  tickRiftSweep,
} from "../app/rift-run/rift-pressure.ts";
import {
  RIFT_HAZARDS,
  RIFT_HAZARD_LETHAL_REST_TICKS,
  availableHazards,
  clearRiftHazards,
  createRiftHazardScheduler,
  hazardImpactHits,
  lethalHazardActive,
  liveHazardImpacts,
  riftHazardGravity,
  riftHazardNotice,
  riftHazardSpec,
  selectHazard,
  tickRiftHazards,
} from "../app/rift-run/environmental-hazards.ts";
import {
  EXTRA_LIFE_FORBIDDEN_SOURCES,
  EXTRA_LIFE_SOURCE,
  RIFT_LIFE_MILESTONE_DEPTHS,
  RIFT_RESPAWN_INVULN_TICKS,
  RIFT_RUN_MAX_LIVES,
  RIFT_RUN_STARTING_LIVES,
  awardLifeForDepth,
  extraLifeNotice,
  isLifeMilestoneDepth,
  lifeMilestonesEarned,
  respawnNotice,
  spendExtraLife,
} from "../app/rift-run/extra-lives.ts";
import { CODEX_PICKUPS, SENDABLE_POWERUPS } from "../app/game-data.ts";
import { RIFT_UPGRADES } from "../app/rift-run/upgrades.ts";
import { createRiftRun } from "../app/rift-run/state.ts";

const GAME_SOURCE = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

/** A deterministic stand-in for Math.random, cycling a fixed sequence. */
function fixedRandom(values) {
  let index = 0;
  return () => values[index++ % values.length];
}

/* ------------------------------------------------------------------ */
/* W5.1-W5.2 — the rift's power-up budget                              */
/* ------------------------------------------------------------------ */

test("the rift's power-up budget is a fixed allocation, not a rate", () => {
  assert.equal(RIFT_PUP_THRESHOLDS.length, RIFT_PUP_BAND_ALLOWANCE.length);
  assert.deepEqual([...RIFT_PUP_THRESHOLDS], [0.85, 0.7, 0.55, 0.4, 0.25, 0.1]);
  // The design asks for roughly five to eight power-ups per rift.
  assert.ok(RIFT_PUP_BUDGET_TOTAL >= 5 && RIFT_PUP_BUDGET_TOTAL <= 8, `total ${RIFT_PUP_BUDGET_TOTAL}`);
  // Thresholds descend, so a band is always deeper than the one before it.
  for (let index = 1; index < RIFT_PUP_THRESHOLDS.length; index += 1) {
    assert.ok(RIFT_PUP_THRESHOLDS[index] < RIFT_PUP_THRESHOLDS[index - 1]);
  }
});

test("crossing a threshold pays once, and shooting past it pays nothing", () => {
  const budget = createRiftPupBudget();
  assert.equal(creditRiftPupBudget(budget, 1), 0, "a full rift owes nothing");
  assert.equal(creditRiftPupBudget(budget, 0.86), 0, "just above the band still owes nothing");
  assert.equal(creditRiftPupBudget(budget, 0.85), 1, "crossing 85% pays the band");

  // This is the whole point of the change: more damage inside the same band
  // yields nothing at all. The old model paid out here indefinitely.
  for (const fraction of [0.84, 0.8, 0.76, 0.71]) {
    assert.equal(creditRiftPupBudget(budget, fraction), 0, `still inside the band at ${fraction}`);
  }
  assert.equal(creditRiftPupBudget(budget, 0.7), 1, "the next threshold opens the next band");
});

test("one enormous hit pays every band it crossed", () => {
  const budget = createRiftPupBudget();
  assert.equal(creditRiftPupBudget(budget, 0), RIFT_PUP_BUDGET_TOTAL);
  assert.ok(riftPupBudgetSpent(budget));
  assert.equal(riftPupBudgetRemaining(budget), 0);
  assert.equal(creditRiftPupBudget(budget, 0), 0, "a dry rift stays dry");
});

test("a rift cannot be farmed: integrity going back up never re-opens a band", () => {
  const budget = createRiftPupBudget();
  creditRiftPupBudget(budget, 0.5);
  const paid = budget.released;
  assert.equal(creditRiftPupBudget(budget, 1), 0, "healing does not refund the budget");
  assert.equal(creditRiftPupBudget(budget, 0.5), 0, "and re-crossing pays nothing");
  assert.equal(budget.released, paid);
});

test("a whole rift's payout is the same however it is taken apart", () => {
  const oneShot = createRiftPupBudget();
  creditRiftPupBudget(oneShot, 0);

  const gradual = createRiftPupBudget();
  let total = 0;
  for (let step = 100; step >= 0; step -= 1) total += creditRiftPupBudget(gradual, step / 100);

  assert.equal(total, RIFT_PUP_BUDGET_TOTAL);
  assert.equal(oneShot.released, total);
});

test("power-ups eject outward from the rift, in varied directions", () => {
  const rift = { x: 500, y: 400 };
  const random = fixedRandom([0.1, 0.4, 0.7, 0.2, 0.9, 0.55]);
  const ejections = [0, 1, 2].map((index) => ejectRiftPup(index, 3, rift, random));

  for (const pup of ejections) {
    // It leaves the rift's own body, and it is moving away from it.
    const offset = Math.hypot(pup.x - rift.x, pup.y - rift.y);
    assert.ok(Math.abs(offset - RIFT_PUP_EJECT_OFFSET) < 1e-9, `offset ${offset}`);
    const outward = (pup.x - rift.x) * pup.vx + (pup.y - rift.y) * pup.vy;
    assert.ok(outward > 0, "velocity points away from the rift");
    assert.equal(pup.life, RIFT_PUP_LIFE_TICKS);
  }

  const headings = ejections.map((pup) => Math.atan2(pup.vy, pup.vx));
  assert.equal(new Set(headings.map((angle) => angle.toFixed(4))).size, 3, "directions vary");
});

test("an ejected power-up expires on a timer and is briefly indestructible", () => {
  // ~18 seconds at the 20ms simulation tick, matching the reference client.
  assert.equal(RIFT_PUP_LIFE_TICKS, 900);
  // A full second at the 15ms tick. Twenty ticks was a third of a second:
  // a pilot already firing at the rift when it bloomed destroyed the drop
  // before it had cleared the rift, which read as the drop never happening.
  assert.equal(RIFT_PUP_GRACE_TICKS, 67);
  assert.equal(riftPupIsShootable({ life: RIFT_PUP_LIFE_TICKS }), false, "untouchable on spawn");
  assert.equal(riftPupIsShootable({ life: RIFT_PUP_LIFE_TICKS - 66 }), false, "still inside the grace");
  assert.equal(riftPupIsShootable({ life: RIFT_PUP_LIFE_TICKS - 67 }), true, "shootable once the grace ends");
  assert.equal(riftPupIsShootable({ life: 0 }), false, "an expired power-up is gone");
});

/* ------------------------------------------------------------------ */
/* W5.4 — rift health phases                                           */
/* ------------------------------------------------------------------ */

test("a rift's phase deepens as its integrity falls", () => {
  assert.equal(riftPhaseForIntegrity(1).id, "intact");
  assert.equal(riftPhaseForIntegrity(0.71).id, "intact");
  assert.equal(riftPhaseForIntegrity(0.7).id, "strained");
  assert.equal(riftPhaseForIntegrity(0.41).id, "strained");
  assert.equal(riftPhaseForIntegrity(0.4).id, "fracturing");
  assert.equal(riftPhaseForIntegrity(0.18).id, "collapsing");
  assert.equal(riftPhaseForIntegrity(0).id, "collapsing");
  // Nonsense integrity reads as a healthy rift rather than as the worst case.
  assert.equal(riftPhaseForIntegrity(Number.NaN).id, "intact");
});

test("every phase is strictly more aggressive than the one before it", () => {
  for (let index = 1; index < RIFT_PHASES.length; index += 1) {
    const previous = RIFT_PHASES[index - 1];
    const phase = RIFT_PHASES[index];
    assert.ok(phase.pressureScale > previous.pressureScale, `${phase.id} builds pressure faster`);
    assert.ok(phase.telegraphTicks < previous.telegraphTicks, `${phase.id} telegraphs for less time`);
    assert.ok(phase.cooldownTicks < previous.cooldownTicks, `${phase.id} rests less`);
    assert.ok(phase.retaliationDamage > previous.retaliationDamage, `${phase.id} hits harder`);
    assert.ok(riftPhaseIndex(phase) > riftPhaseIndex(previous));
  }
});

test("the opening phase sends no escort, and deeper phases send different mixes", () => {
  assert.equal(RIFT_PHASES[0].spawnCount, 0);
  assert.equal(riftPhaseSpawn(RIFT_PHASES[0]), null, "an intact rift spawns nothing itself");

  const mixes = RIFT_PHASES.slice(1).map((phase) => phase.spawnMix.join(","));
  assert.equal(new Set(mixes).size, mixes.length, "each phase has its own mix");
  for (const phase of RIFT_PHASES.slice(1)) {
    assert.ok(phase.spawnCount > 0);
    for (const kind of phase.spawnMix) {
      assert.ok(SENDABLE_POWERUPS.includes(kind), `${kind} is a real hostile kind`);
    }
    assert.ok(phase.spawnMix.includes(riftPhaseSpawn(phase, () => 0.99)));
  }
});

test("a phase change is announced by name", () => {
  assert.equal(riftPhaseNotice(riftPhaseForIntegrity(0.3)), "RIFT FRACTURING");
});

/* ------------------------------------------------------------------ */
/* W5.3 — rift pressure and retaliation                                */
/* ------------------------------------------------------------------ */

const INTACT = RIFT_PHASES[0];
const COLLAPSING = RIFT_PHASES[RIFT_PHASES.length - 1];

function camp(state, phase = INTACT, distance = 0, ticks = 1, extra = {}) {
  let last = null;
  for (let tick = 0; tick < ticks; tick += 1) {
    last = tickRiftPressure(state, {
      distance,
      playerX: 500 + distance,
      playerY: 400,
      riftX: 500,
      riftY: 400,
      phase,
      ...extra,
    });
  }
  return last;
}

test("sitting on the rift builds pressure; leaving bleeds it away faster", () => {
  const state = createRiftPressure();
  camp(state, INTACT, 0, 30);
  const built = state.pressure;
  assert.ok(built > 0, "camping builds pressure");

  camp(state, INTACT, RIFT_PRESSURE_RADIUS + 200, 30);
  assert.ok(state.pressure < built, "backing off bleeds it");

  // Disengaging has to be a real answer: 30 ticks away must undo more than 30
  // ticks on top of the rift built.
  assert.equal(state.pressure, 0, "half a second of distance clears a full second of camping");
});

test("pressure builds faster the closer the pilot sits", () => {
  const near = createRiftPressure();
  camp(near, INTACT, 10, 40);
  const far = createRiftPressure();
  camp(far, INTACT, RIFT_PRESSURE_RADIUS - 10, 40);
  assert.ok(near.pressure > far.pressure * 5, `near ${near.pressure} vs far ${far.pressure}`);

  // At the rim it is effectively zero, so orbiting the edge is safe.
  const rim = createRiftPressure();
  camp(rim, INTACT, RIFT_PRESSURE_RADIUS, 200);
  assert.ok(rim.pressure < 1, `rim pressure ${rim.pressure}`);
});

test("a wounded rift charges its retaliation faster than a healthy one", () => {
  const healthy = createRiftPressure();
  camp(healthy, INTACT, 0, 20);
  const wounded = createRiftPressure();
  camp(wounded, COLLAPSING, 0, 20);
  assert.ok(wounded.pressure > healthy.pressure);
  assert.ok(
    Math.abs(wounded.pressure / healthy.pressure - COLLAPSING.pressureScale) < 1e-6,
    "exactly the phase's scale",
  );
});

test("a retaliation telegraphs before it lands", () => {
  const state = createRiftPressure();
  let telegraphed = null;
  // Camping dead centre on an INTACT rift takes about nine seconds to charge,
  // which is the whole point of the tuning: this is a long stand-still, not an
  // approach. The bound is generous so the test is not a timing assertion.
  for (let tick = 0; tick < 2000 && !telegraphed; tick += 1) {
    telegraphed = camp(state, INTACT, 0, 1).telegraphed;
  }
  assert.ok(telegraphed, "camping eventually draws a retaliation");
  assert.equal(telegraphed.telegraphTicks, INTACT.telegraphTicks);
  assert.equal(telegraphed.telegraphTotal, INTACT.telegraphTicks);
  assert.equal(state.pressure, RIFT_PRESSURE_MAX);

  // It does not land during the telegraph, and it does land at the end of it.
  for (let tick = 1; tick < INTACT.telegraphTicks; tick += 1) {
    assert.equal(camp(state, INTACT, 0, 1).landed, null, `no landing on telegraph tick ${tick}`);
  }
  const landed = camp(state, INTACT, 0, 1).landed;
  assert.ok(landed, "it lands when the telegraph runs out");
  assert.equal(landed.damage, INTACT.retaliationDamage);
  assert.equal(state.pressure, 0, "landing spends the pressure");
  assert.equal(state.cooldown, INTACT.cooldownTicks, "and opens the rest window");
  assert.equal(state.landed, 1);
});

test("the three retaliations rotate, so all three are met inside one rift", () => {
  assert.deepEqual([...RIFT_RETALIATION_ORDER], ["strike", "shockwave", "sweep"]);
  const state = createRiftPressure();
  const seen = [];
  for (let tick = 0; tick < 6000 && seen.length < 4; tick += 1) {
    const result = camp(state, COLLAPSING, 0, 1);
    if (result.telegraphed) seen.push(result.telegraphed.kind);
  }
  assert.deepEqual(seen, ["strike", "shockwave", "sweep", "strike"]);
});

test("a targeted strike marks where the pilot was, not where the rift is", () => {
  const state = createRiftPressure();
  state.pressure = RIFT_PRESSURE_MAX;
  const result = tickRiftPressure(state, {
    distance: 40,
    playerX: 640,
    playerY: 220,
    riftX: 500,
    riftY: 400,
    phase: INTACT,
  });
  assert.equal(result.telegraphed.kind, "strike");
  assert.equal(result.telegraphed.x, 640);
  assert.equal(result.telegraphed.y, 220);

  // The shockwave that follows it comes from the rift instead.
  state.pending = null;
  state.cooldown = 0;
  state.pressure = RIFT_PRESSURE_MAX;
  const wave = tickRiftPressure(state, {
    distance: 40,
    playerX: 640,
    playerY: 220,
    riftX: 500,
    riftY: 400,
    phase: INTACT,
  });
  assert.equal(wave.telegraphed.kind, "shockwave");
  assert.equal(wave.telegraphed.x, 500);
  assert.equal(wave.telegraphed.y, 400);
});

test("the rift will not charge a retaliation while a hazard owns the arena", () => {
  const state = createRiftPressure();
  camp(state, COLLAPSING, 0, 400, { hazardBusy: true });
  assert.equal(state.pressure, RIFT_PRESSURE_MAX, "pressure still builds and holds");
  assert.equal(state.pending, null, "but nothing is committed while a hazard is live");

  const released = camp(state, COLLAPSING, 0, 1);
  assert.ok(released.telegraphed, "and it fires the moment the arena is clear");
});

test("resetting pressure clears everything a reformed rift should forget", () => {
  const state = createRiftPressure();
  camp(state, COLLAPSING, 0, 400);
  resetRiftPressure(state);
  assert.deepEqual(
    { pressure: state.pressure, pending: state.pending, cooldown: state.cooldown, landed: state.landed },
    { pressure: 0, pending: null, cooldown: 0, landed: 0 },
  );
});

test("a shockwave expands outward, hits once, and shoves the pilot away", () => {
  const wave = createRiftShockwave(500, 400, 18);
  assert.equal(riftShockwaveHits(wave, { x: 500 + 300, y: 400 }), false, "not yet out that far");

  let hit = false;
  let ticks = 0;
  while (tickRiftShockwave(wave) && !hit) {
    ticks += 1;
    hit = riftShockwaveHits(wave, { x: 800, y: 400 });
  }
  assert.ok(hit, "the ring reaches a pilot standing off at 300");
  assert.ok(ticks > 1, "it takes time to get there — it is dodgeable");

  const push = riftShockwavePush(wave, { x: 800, y: 400 });
  assert.ok(push.vx > 0 && Math.abs(push.vy) < 1e-9, "pushed directly away from the rift");

  wave.struck = true;
  assert.equal(riftShockwaveHits(wave, { x: 800, y: 400 }), false, "a ring passes through once");
});

test("a shockwave misses anyone outside its band", () => {
  const wave = createRiftShockwave(0, 0, 18);
  wave.radius = 200;
  assert.equal(riftShockwaveHits(wave, { x: 200, y: 0 }), true);
  assert.equal(riftShockwaveHits(wave, { x: 200 - RIFT_SHOCKWAVE_BAND - 1, y: 0 }), false, "inside the ring is safe");
  assert.equal(riftShockwaveHits(wave, { x: 200 + RIFT_SHOCKWAVE_BAND + 1, y: 0 }), false, "outside it is safe");
});

test("a sweep arm turns, hits a narrow cone, and cannot grind the pilot down", () => {
  const sweep = createRiftSweep(0, 0, 0, 20);
  assert.equal(riftSweepHits(sweep, { x: 100, y: 0 }), true, "directly under the arm");
  assert.equal(riftSweepHits(sweep, { x: 0, y: 100 }), false, "ninety degrees away is clear");
  assert.equal(riftSweepHits(sweep, { x: 100000, y: 0 }), false, "beyond its reach is clear");

  // The cone is narrow: just past the half-angle is a miss.
  const justInside = (RIFT_SWEEP_HALF_ANGLE - 1) * (Math.PI / 180);
  const justOutside = (RIFT_SWEEP_HALF_ANGLE + 1) * (Math.PI / 180);
  assert.equal(riftSweepHits(sweep, { x: Math.cos(justInside) * 100, y: Math.sin(justInside) * 100 }), true);
  assert.equal(riftSweepHits(sweep, { x: Math.cos(justOutside) * 100, y: Math.sin(justOutside) * 100 }), false);

  markRiftSweepHit(sweep);
  assert.equal(riftSweepHits(sweep, { x: 100, y: 0 }), false, "it will not hit again immediately");

  const before = sweep.angle;
  tickRiftSweep(sweep);
  assert.ok(sweep.angle > before, "and it keeps turning");
});

test("a sweep ends on its own", () => {
  const sweep = createRiftSweep(0, 0, 0, 20);
  let ticks = 0;
  while (tickRiftSweep(sweep)) {
    ticks += 1;
    assert.ok(ticks < 1000, "a sweep is not endless");
  }
  assert.ok(ticks > 100, "but it does last long enough to sweep the arena");
});

test("every retaliation announces itself", () => {
  for (const kind of RIFT_RETALIATION_ORDER) {
    assert.match(riftRetaliationNotice(kind), /^RIFT /);
  }
});

/* ------------------------------------------------------------------ */
/* W5.5 — environmental hazards                                        */
/* ------------------------------------------------------------------ */

const ARENA = { width: 1600, height: 1200 };

function hazardContext(overrides = {}) {
  return {
    depth: 4,
    level: 14,
    arena: ARENA,
    playerX: 800,
    playerY: 600,
    riftX: 800,
    riftY: 600,
    random: () => 0.5,
    ...overrides,
  };
}

test("the hazard table starts with the four the design names, split by category", () => {
  assert.deepEqual(
    RIFT_HAZARDS.map((hazard) => hazard.id).sort(),
    ["asteroid-strike", "gravity-well", "meteor-storm", "rift-pulse"],
  );
  assert.deepEqual(
    RIFT_HAZARDS.filter((hazard) => hazard.category === "lethal").map((hazard) => hazard.id).sort(),
    ["asteroid-strike", "meteor-storm"],
  );
  assert.deepEqual(
    RIFT_HAZARDS.filter((hazard) => hazard.category === "pressure").map((hazard) => hazard.id).sort(),
    ["gravity-well", "rift-pulse"],
  );
  // A pressure hazard never kills on its own: the gravity well does no damage
  // at all, and the pulse costs far less than a lethal impact.
  const lethalFloor = Math.min(...RIFT_HAZARDS.filter((h) => h.category === "lethal").map((h) => h.damage));
  for (const hazard of RIFT_HAZARDS.filter((h) => h.category === "pressure")) {
    assert.ok(hazard.damage < lethalFloor, `${hazard.id} is survivable`);
  }
  // Everything is telegraphed. A hazard with no warning is a bug.
  for (const hazard of RIFT_HAZARDS) assert.ok(hazard.warningTicks > 0, `${hazard.id} warns first`);
});

test("hazards are gated on depth, with player level as a secondary floor", () => {
  assert.deepEqual(availableHazards(0, 99), [], "an unbreached run sees no hazards at any level");

  // The trap the level floor exists for: a fast first breach on a level-2 build.
  assert.deepEqual(availableHazards(1, 2), [], "depth alone does not open a hazard");
  assert.deepEqual(availableHazards(1, 3).map((h) => h.id), ["rift-pulse"]);
  assert.deepEqual(availableHazards(1, 5).map((h) => h.id), ["rift-pulse", "asteroid-strike"]);

  // And the mirror: a high level on a shallow run does not open deep hazards.
  assert.equal(availableHazards(1, 40).some((h) => h.id === "meteor-storm"), false);
  assert.equal(availableHazards(2, 40).some((h) => h.id === "meteor-storm"), true);
  assert.equal(availableHazards(2, 40).some((h) => h.id === "gravity-well"), false);
  assert.equal(availableHazards(3, 11).some((h) => h.id === "gravity-well"), true);
});

test("two lethal hazards never overlap", () => {
  const scheduler = createRiftHazardScheduler();
  const context = hazardContext();

  // Force a lethal hazard into the arena, then ask for another one.
  scheduler.active.push({
    id: "asteroid-strike",
    name: "ASTEROID STRIKE",
    category: "lethal",
    damage: 26,
    impacts: [],
    remaining: 100,
  });
  const picked = selectHazard(scheduler, context, () => 0.99);
  assert.ok(picked === null || picked.category === "pressure", "only a pressure hazard may join it");

  // And the rest window after one finishes holds the next one off too.
  scheduler.active = [];
  scheduler.lethalRest = RIFT_HAZARD_LETHAL_REST_TICKS;
  const resting = selectHazard(scheduler, context, () => 0.99);
  assert.ok(resting === null || resting.category === "pressure", "no lethal hazard during the rest window");
});

test("a hazard never opens on top of a rift retaliation", () => {
  const scheduler = createRiftHazardScheduler();
  const busy = selectHazard(scheduler, hazardContext({ retaliationActive: true }), () => 0.99);
  assert.ok(busy === null || busy.category === "pressure", "the rift owns the arena while it retaliates");
});

test("the scheduler warns, erupts, then expires", () => {
  const scheduler = createRiftHazardScheduler();
  const context = hazardContext({ depth: 1, level: 5, random: () => 0.5 });
  const spec = riftHazardSpec("asteroid-strike");

  // Fast-forward to the first scheduling attempt.
  scheduler.nextIn = 1;
  scheduler.history.push("rift-pulse");
  const opened = tickRiftHazards(scheduler, context);
  assert.equal(opened.warned.length, 1);
  assert.equal(opened.warned[0].id, "asteroid-strike");
  assert.equal(opened.erupted.length, 0, "a warning is not yet dangerous");
  assert.match(riftHazardNotice(opened.warned[0]), /INBOUND$/);

  const impact = opened.warned[0].impacts[0];
  assert.equal(hazardImpactHits(impact, { x: impact.x, y: impact.y }), false, "standing on a warning is safe");

  let erupted = null;
  for (let tick = 0; tick < spec.warningTicks + 5 && !erupted; tick += 1) {
    const result = tickRiftHazards(scheduler, context);
    if (result.erupted.length > 0) [erupted] = result.erupted;
  }
  assert.ok(erupted, "the warning becomes an impact");
  assert.equal(hazardImpactHits(erupted, { x: erupted.x, y: erupted.y }), true, "and now it hurts");
  assert.equal(
    hazardImpactHits(erupted, { x: erupted.x + erupted.radius + 10, y: erupted.y }),
    false,
    "outside the radius is safe",
  );

  let expired = false;
  for (let tick = 0; tick < 4000 && !expired; tick += 1) {
    expired = tickRiftHazards(scheduler, context).expired.length > 0;
  }
  assert.ok(expired, "and it eventually clears");
  assert.equal(scheduler.lethalRest > 0, true, "a lethal hazard opens a rest window when it finishes");
});

test("a meteor storm lands its impacts in sequence, not all at once", () => {
  const spec = riftHazardSpec("meteor-storm");
  assert.ok(spec.impacts > 1);
  assert.ok(spec.impactSpacingTicks > 0);

  const scheduler = createRiftHazardScheduler();
  const context = hazardContext({ depth: 2, level: 8, random: fixedRandom([0.2, 0.8, 0.4, 0.6, 0.1, 0.9]) });
  let event = null;
  for (let tick = 0; tick < 600 && !event; tick += 1) {
    // Keep asking. Which hazard the scheduler picks is deliberately varied, so
    // the test drives it until the storm's turn comes round rather than
    // pinning the selection to one particular roll.
    scheduler.nextIn = 1;
    scheduler.lethalRest = 0;
    scheduler.active = scheduler.active.filter((live) => live.id !== "meteor-storm");
    const [warned] = tickRiftHazards(scheduler, context).warned;
    if (warned?.id === "meteor-storm") event = warned;
  }
  assert.ok(event, "the storm schedules");
  const warnings = event.impacts.map((impact) => impact.warningTicks);
  assert.equal(warnings.length, spec.impacts);
  for (let index = 1; index < warnings.length; index += 1) {
    assert.equal(warnings[index] - warnings[index - 1], spec.impactSpacingTicks, "evenly spaced");
  }
  // They are spread across the arena rather than stacked on one point.
  assert.ok(new Set(event.impacts.map((impact) => `${impact.x},${impact.y}`)).size > 1);
});

test("impacts are clamped inside the arena", () => {
  const scheduler = createRiftHazardScheduler();
  scheduler.nextIn = 1;
  const context = hazardContext({
    depth: 1,
    level: 5,
    playerX: -5000,
    playerY: 99999,
    random: () => 0,
  });
  scheduler.history.push("rift-pulse");
  const [event] = tickRiftHazards(scheduler, context).warned;
  for (const impact of event.impacts) {
    assert.ok(impact.x >= 0 && impact.x <= ARENA.width, `x ${impact.x} inside the arena`);
    assert.ok(impact.y >= 0 && impact.y <= ARENA.height, `y ${impact.y} inside the arena`);
  }
});

test("the gravity well pulls only while it is live", () => {
  const scheduler = createRiftHazardScheduler();
  assert.equal(riftHazardGravity(scheduler), null, "no well, no pull");
  const spec = riftHazardSpec("gravity-well");
  scheduler.active.push({
    id: "gravity-well",
    name: spec.name,
    category: spec.category,
    damage: spec.damage,
    impacts: [{ x: 700, y: 500, radius: spec.radius, warningTicks: 3, liveTicks: spec.liveTicks, struck: false }],
    remaining: 200,
  });
  assert.equal(riftHazardGravity(scheduler), null, "a warning well does not pull yet");
  scheduler.active[0].impacts[0].warningTicks = 0;
  const pull = riftHazardGravity(scheduler);
  assert.deepEqual({ x: pull.x, y: pull.y }, { x: 700, y: 500 });
  assert.ok(pull.pull > 0);
  assert.equal(spec.damage, 0, "and it never damages anyone directly");
});

test("a run opens with a grace period and clears cleanly", () => {
  const scheduler = createRiftHazardScheduler();
  assert.ok(scheduler.nextIn > 300, "nothing lands in the first seconds of a run");
  scheduler.nextIn = 1;
  tickRiftHazards(scheduler, hazardContext());
  assert.ok(scheduler.active.length > 0);
  assert.ok(liveHazardImpacts(scheduler).length >= 0);
  clearRiftHazards(scheduler);
  assert.deepEqual(scheduler.active, []);
  assert.equal(lethalHazardActive(scheduler), false);
});

/* ------------------------------------------------------------------ */
/* W5.6 — extra lives                                                  */
/* ------------------------------------------------------------------ */

test("a run starts with two lives and caps at three", () => {
  assert.equal(RIFT_RUN_STARTING_LIVES, 2);
  assert.equal(RIFT_RUN_MAX_LIVES, 3);
  assert.equal(createRiftRun("seed").lives, RIFT_RUN_STARTING_LIVES);
});

test("lives come from breach milestones and from nothing else", () => {
  assert.equal(EXTRA_LIFE_SOURCE, "breach-milestone");
  for (const depth of RIFT_LIFE_MILESTONE_DEPTHS) assert.equal(isLifeMilestoneDepth(depth), true);
  assert.equal(isLifeMilestoneDepth(1), false);
  assert.equal(isLifeMilestoneDepth(0), false);
  assert.equal(lifeMilestonesEarned(0), 0);
  assert.equal(lifeMilestonesEarned(RIFT_LIFE_MILESTONE_DEPTHS[0]), 1);
  assert.equal(
    lifeMilestonesEarned(RIFT_LIFE_MILESTONE_DEPTHS[RIFT_LIFE_MILESTONE_DEPTHS.length - 1]),
    RIFT_LIFE_MILESTONE_DEPTHS.length,
  );
});

test("no loot table anywhere can produce a life", () => {
  // The named sources are the tables that must stay clean. Each is walked
  // rather than trusted, so adding a life to one of them fails here.
  assert.ok(EXTRA_LIFE_FORBIDDEN_SOURCES.includes("upgrade-cards"));
  assert.ok(EXTRA_LIFE_FORBIDDEN_SOURCES.includes("rift-power-up-budget"));

  const lifeLike = /(^|[^a-z])(life|lives|1up|extra-life|revive|respawn)([^a-z]|$)/i;

  for (const pickup of CODEX_PICKUPS) assert.equal(lifeLike.test(pickup), false, `pickup ${pickup}`);
  for (const power of SENDABLE_POWERUPS) assert.equal(lifeLike.test(power), false, `power-up ${power}`);
  for (const upgrade of RIFT_UPGRADES) {
    assert.equal(lifeLike.test(upgrade.id), false, `upgrade id ${upgrade.id}`);
    assert.equal(lifeLike.test(upgrade.name ?? ""), false, `upgrade name ${upgrade.name}`);
  }

  // And the loop only ever awards one from the milestone path.
  const awards = GAME_SOURCE.match(/awardLifeForDepth\(/g) ?? [];
  assert.ok(awards.length > 0, "the milestone award is wired");
  assert.equal(
    GAME_SOURCE.includes("awardLifeForDepth") && !/chargeRiftPup[\s\S]{0,600}awardLifeForDepth/.test(GAME_SOURCE),
    true,
    "the power-up path never awards a life",
  );
});

test("a milestone pays one life, and the cap swallows the rest", () => {
  const first = awardLifeForDepth(2, RIFT_LIFE_MILESTONE_DEPTHS[0]);
  assert.deepEqual(first, { lives: 3, awarded: true, cappedOut: false });

  const atCap = awardLifeForDepth(RIFT_RUN_MAX_LIVES, RIFT_LIFE_MILESTONE_DEPTHS[1]);
  assert.deepEqual(atCap, { lives: RIFT_RUN_MAX_LIVES, awarded: false, cappedOut: true });
  assert.match(extraLifeNotice(atCap), /MAXIMUM/);

  const offMilestone = awardLifeForDepth(1, 1);
  assert.deepEqual(offMilestone, { lives: 1, awarded: false, cappedOut: false });
  assert.match(extraLifeNotice(awardLifeForDepth(0, RIFT_LIFE_MILESTONE_DEPTHS[0])), /EXTRA LIFE EARNED/);
});

test("a life covers a death and restores the hull the run has built", () => {
  const spend = spendExtraLife(2, 240);
  assert.equal(spend.respawned, true);
  assert.equal(spend.lives, 1);
  assert.equal(spend.health, 240, "respawn health follows the run's own upgrades");
  assert.equal(spend.invuln, RIFT_RESPAWN_INVULN_TICKS);
  assert.match(respawnNotice(spend), /1 LIFE LEFT/);

  const last = spendExtraLife(1, 100);
  assert.equal(last.lives, 0);
  assert.match(respawnNotice(last), /0 LIVES LEFT/);

  const dead = spendExtraLife(0, 100);
  assert.deepEqual(dead, { lives: 0, respawned: false, health: 0, invuln: 0 });
});

/* ------------------------------------------------------------------ */
/* Wiring — the loop actually consults these systems                   */
/* ------------------------------------------------------------------ */

test("the game loop wires every danger system into Rift Run", () => {
  for (const symbol of [
    "creditRiftPupBudget",
    "ejectRiftPup",
    "tickRiftPressure",
    "createRiftShockwave",
    "createRiftSweep",
    "tickRiftHazards",
    "hazardImpactHits",
    "riftPhaseForIntegrity",
    "spendExtraLife",
    "awardLifeForDepth",
  ]) {
    assert.ok(GAME_SOURCE.includes(symbol), `game.tsx calls ${symbol}`);
  }
});

test("the old damage-proportional rift power-up drop is gone from Rift Run", () => {
  // chargeRiftPup still exists for Survival and PvE, which are unchanged, but
  // the Rift Run hull-weapon path must no longer reach it.
  const riftRunPath = GAME_SOURCE.slice(
    GAME_SOURCE.indexOf("const hitRiftWithRiftRunWeapon"),
    GAME_SOURCE.indexOf("const hitRiftWithRiftRunWeapon") + 1400,
  );
  assert.ok(riftRunPath.length > 100, "the Rift Run hull-weapon path is still there");
  assert.equal(riftRunPath.includes("chargeRiftPup"), false, "and it no longer charges a per-damage drop");
});
