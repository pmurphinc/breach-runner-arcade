/**
 * Rift Survival.
 *
 * Survival's whole difficulty curve is data, so almost all of it can be
 * checked here without a canvas, a timer or a browser: the level clock, the
 * stage boundaries, when each hazard arms, and the guarantee that escalating
 * one run never escalates the next. The handful of assertions at the bottom
 * are about the join between that table and the game loop — that the loop
 * really does read the table rather than keeping survival numbers of its own.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  SURVIVAL_HOSTILE_CAP,
  STAGE_LEVELS,
  SURVIVAL_LEVEL_SECONDS,
  SURVIVAL_STAGES,
  advanceSurvival,
  armSurvivalLevel,
  createSurvivalState,
  escalationForLevel,
  riftLevelForSeconds,
  secondsForRiftLevel,
  stageBeginsAtLevel,
  stageForLevel,
  SURVIVAL_RIFT_DAMAGE_SCORE,
  scoreRiftDamage,
  survivalBreachBonus,
  survivalBreachIntegrity,
  survivalRiftDamageScore,
  survivalRulesFor,
} from "../app/survival.ts";
import { DIFFICULTIES, PVP_RULES, RULESET_IDS, rulesFor, ticksForSeconds } from "../app/difficulty.ts";
import { settleScore } from "../app/run-scoring.ts";
import { saveScoreToMurph } from "../app/arcade-scores.ts";

const game = await readFile(new URL("../app/game.tsx", import.meta.url), "utf8");
const menu = await readFile(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const gameCode = stripComments(game);

/** Every level the escalation table is exercised across. */
const LEVELS = Array.from({ length: 24 }, (_, index) => index + 1);

test("the Rift Level clock ticks every 45 seconds, starting at one", () => {
  // Was a minute. A level a minute left a run in the gentlest arena the game
  // has for its first two minutes, which is a long time in an arcade game.
  assert.equal(SURVIVAL_LEVEL_SECONDS, 45);
  assert.equal(riftLevelForSeconds(0), 1);
  assert.equal(riftLevelForSeconds(44), 1);
  assert.equal(riftLevelForSeconds(45), 2);
  assert.equal(riftLevelForSeconds(89), 2);
  assert.equal(riftLevelForSeconds(450), 11);
  // A run cannot be at level zero, and nonsense never produces one either.
  assert.equal(riftLevelForSeconds(-30), 1);
  assert.equal(riftLevelForSeconds(Number.NaN), 1);

  for (const level of LEVELS) {
    assert.equal(riftLevelForSeconds(secondsForRiftLevel(level)), level);
    assert.equal(riftLevelForSeconds(secondsForRiftLevel(level) - 1), Math.max(1, level - 1));
  }
});

test("stages come from one table, compressed so the ramp bites sooner", () => {
  const boundaries = SURVIVAL_STAGES.map((stage) => [stage.id, stage.fromLevel]);
  assert.deepEqual(boundaries, [
    ["stable", STAGE_LEVELS.stable],
    ["unstable", STAGE_LEVELS.unstable],
    ["critical", STAGE_LEVELS.critical],
    ["enraged", STAGE_LEVELS.enraged],
    ["collapse", STAGE_LEVELS.collapse],
  ]);
  // Was 1 / 3 / 5 / 7 / 11: two levels per stage and four for ENRAGED, which
  // let a pilot outlast the arena rather than the other way round.
  assert.deepEqual(Object.values(STAGE_LEVELS), [1, 2, 4, 6, 9]);

  // At 45s a level: stable to 0:45, unstable to 2:15, critical to 3:45,
  // enraged to 6:00, collapse beyond.
  assert.equal(stageForLevel(riftLevelForSeconds(0)).id, "stable");
  assert.equal(stageForLevel(riftLevelForSeconds(44)).id, "stable");
  assert.equal(stageForLevel(riftLevelForSeconds(45)).id, "unstable");
  assert.equal(stageForLevel(riftLevelForSeconds(135)).id, "critical");
  assert.equal(stageForLevel(riftLevelForSeconds(225)).id, "enraged");
  assert.equal(stageForLevel(riftLevelForSeconds(359)).id, "enraged");
  assert.equal(stageForLevel(riftLevelForSeconds(360)).id, "collapse");
  // The mode is meant to run indefinitely, so the last stage has no end.
  assert.equal(stageForLevel(400).id, "collapse");

  assert.ok(stageBeginsAtLevel(STAGE_LEVELS.enraged));
  assert.ok(!stageBeginsAtLevel(STAGE_LEVELS.enraged + 1));
});

test("pressure only ever increases, and every cadence has a floor", () => {
  let previous = escalationForLevel(1);
  for (const level of LEVELS.slice(1)) {
    const current = escalationForLevel(level);
    assert.ok(
      current.waveIntervalTicks <= previous.waveIntervalTicks,
      `waves got slower at level ${level}`
    );
    assert.ok(current.waveSizeBonus >= previous.waveSizeBonus, `waves shrank at level ${level}`);
    assert.ok(current.gravityPull >= previous.gravityPull, `gravity eased at level ${level}`);
    assert.ok(current.secondScore > previous.secondScore, `time got cheaper at level ${level}`);
    assert.ok(
      current.powerUpCharge >= previous.powerUpCharge,
      `the rift got easier to charge at level ${level}`
    );
    previous = current;
  }

  // Nothing runs away to zero: an endless mode still has to be playable, and a
  // spawn interval that keeps shrinking eventually spawns every tick.
  const deep = escalationForLevel(500);
  assert.equal(deep.waveIntervalTicks, ticksForSeconds(2.2));
  assert.equal(deep.mineStormIntervalTicks, ticksForSeconds(3));
  assert.equal(deep.beamIntervalTicks, ticksForSeconds(8));
  assert.equal(deep.waveSizeBonus, 3);
  assert.equal(deep.mineStormCount, 6);
  assert.equal(deep.gravityPull, 0.018);
  assert.equal(deep.powerUpCharge, 240);
});

test("each hazard arms at its own level rather than all at once", () => {
  // Expressed against the stage table rather than against level numbers, so
  // retuning the ladder does not mean rewriting every hazard assertion.

  // Sweep beams from Unstable.
  assert.equal(escalationForLevel(STAGE_LEVELS.unstable - 1).beamIntervalTicks, 0);
  assert.ok(escalationForLevel(STAGE_LEVELS.unstable).beamIntervalTicks > 0);
  assert.equal(escalationForLevel(STAGE_LEVELS.unstable).beamCount, 1);
  // Rift Collapse runs two beams at once.
  assert.equal(escalationForLevel(STAGE_LEVELS.collapse - 1).beamCount, 1);
  assert.equal(escalationForLevel(STAGE_LEVELS.collapse).beamCount, 2);

  // Mine storms one level after the beams.
  assert.equal(escalationForLevel(STAGE_LEVELS.unstable).mineStormIntervalTicks, 0);
  assert.equal(escalationForLevel(STAGE_LEVELS.unstable).mineStormCount, 0);
  assert.ok(escalationForLevel(STAGE_LEVELS.unstable + 1).mineStormIntervalTicks > 0);
  assert.equal(escalationForLevel(STAGE_LEVELS.unstable + 1).mineStormCount, 2);

  // The gravity well is the deep run's warning shot, one level before collapse.
  assert.equal(escalationForLevel(STAGE_LEVELS.collapse - 2).gravityPull, 0);
  assert.ok(escalationForLevel(STAGE_LEVELS.collapse - 1).gravityPull > 0);

  // The full hostile catalogue opens once the run leaves Stable.
  assert.ok(escalationForLevel(1).wavePool.length < escalationForLevel(3).wavePool.length);
  assert.ok(escalationForLevel(1).wavePool.includes("mines"));
});

test("the gravity well is a current to fly against, not a tractor beam", () => {
  // Every frame in the fleet accelerates at 0.04 per tick or better. A pull
  // that reached those numbers would simply take the ship, so the deepest
  // well stays well under the slowest frame's own thrust.
  const slowestAcceleration = 0.04;
  for (const level of [...LEVELS, 500]) {
    assert.ok(escalationForLevel(level).gravityPull < slowestAcceleration);
  }
});

test("escalating one run never escalates the next", () => {
  const baseline = DIFFICULTIES.survival;
  const before = JSON.stringify(baseline);

  const deep = survivalRulesFor(14);
  assert.notEqual(deep, baseline);
  assert.equal(deep.id, "survival");
  assert.notEqual(deep.wormhole.kind, baseline.wormhole.kind);

  // The shared ruleset every future run starts from is untouched.
  assert.equal(JSON.stringify(DIFFICULTIES.survival), before);
  assert.equal(DIFFICULTIES.survival.wormhole.kind, "locked");
  assert.equal(DIFFICULTIES.survival.contactHazard.enabled, false);
  assert.equal(DIFFICULTIES.survival.wormholeEnrage.enabled, false);
});

test("the rift breaks orbit at Unstable and keeps gaining speed", () => {
  assert.equal(survivalRulesFor(STAGE_LEVELS.stable).wormhole.kind, "locked");
  assert.equal(survivalRulesFor(STAGE_LEVELS.unstable - 1).wormhole.kind, "locked");

  const unstable = survivalRulesFor(STAGE_LEVELS.unstable).wormhole;
  assert.equal(unstable.kind, "orbit");
  assert.equal(unstable.radius, 210);

  let previous = 0;
  for (const level of LEVELS.slice(STAGE_LEVELS.unstable - 1)) {
    const motion = survivalRulesFor(level).wormhole;
    assert.equal(motion.kind, "orbit");
    assert.ok(motion.degreesPerTick >= previous);
    previous = motion.degreesPerTick;
  }
  // Capped, so the rift never outruns the fleet entirely.
  assert.equal(survivalRulesFor(500).wormhole.degreesPerTick, 1.4);
});

test("Critical arms rift contact and keeps shrinking the safe space", () => {
  assert.equal(survivalRulesFor(STAGE_LEVELS.critical - 1).contactHazard.enabled, false);

  const critical = survivalRulesFor(STAGE_LEVELS.critical).contactHazard;
  assert.equal(critical.enabled, true);
  assert.equal(critical.radius, 46);
  assert.ok(survivalRulesFor(STAGE_LEVELS.critical + 4).contactHazard.radius > critical.radius);
  assert.equal(survivalRulesFor(500).contactHazard.radius, 76);

  // One contact episode must never be able to destroy a full-health pilot,
  // the same guarantee Hard Mode's hazard carries.
  assert.ok(survivalRulesFor(500).contactHazard.maxEpisodeFraction < 1);
});

test("enrage arrives on the clock, never on the rift's remaining integrity", () => {
  assert.equal(survivalRulesFor(STAGE_LEVELS.enraged - 1).wormholeEnrage.enabled, false);

  const enraged = survivalRulesFor(STAGE_LEVELS.enraged).wormholeEnrage;
  assert.equal(enraged.enabled, true);
  // A zero threshold is what stops the PvE "the rival is nearly dead" trigger
  // from firing: that check also requires integrity above zero.
  assert.equal(enraged.thresholdFraction, 0);
  assert.ok(enraged.healFraction > 0);
  // Survival schedules its own mine storms, so enrage must not run a second,
  // independent mine source on top of them.
  assert.equal(enraged.minePulseIntervalTicks, 0);
  assert.equal(enraged.minePulseCount, 0);

  // The rift only starts shielding itself once the run reaches Rift Collapse.
  assert.equal(survivalRulesFor(STAGE_LEVELS.enraged).wormholeEnrage.temporaryShieldFraction, 0);
  assert.ok(survivalRulesFor(STAGE_LEVELS.collapse).wormholeEnrage.temporaryShieldFraction > 0);
});

test("survival is a solo ruleset the other modes cannot be dragged into", () => {
  assert.ok(RULESET_IDS.includes("survival"));
  assert.equal(rulesFor("pve", "survival"), DIFFICULTIES.survival);
  assert.equal(rulesFor("pvp", "survival"), PVP_RULES);
  // A preference carried over from a survival run must not escalate a shared
  // co-op arena that was never balanced for it.
  assert.equal(rulesFor("coop", "survival"), DIFFICULTIES.difficult);
});

test("breaching the rift pays out and reforms it tougher", () => {
  assert.equal(survivalBreachIntegrity(0), DIFFICULTIES.survival.rivalIntegrity);
  assert.ok(survivalBreachIntegrity(1) > survivalBreachIntegrity(0));
  assert.ok(survivalBreachIntegrity(4) > survivalBreachIntegrity(3));

  // Worth more the deeper the run has gone, and more again for each breach.
  assert.ok(survivalBreachBonus(9, 0) > survivalBreachBonus(2, 0));
  assert.ok(survivalBreachBonus(2, 3) > survivalBreachBonus(2, 0));
});

test("a newly armed hazard does not fire the instant it arms", () => {
  const state = createSurvivalState();
  assert.equal(state.level, 1);
  assert.equal(state.mineStormIn, 0);
  assert.equal(state.beamIn, 0);

  // Level 4 arms mine storms: the first storm is a full interval away rather
  // than landing on the level-up tick.
  const armed = escalationForLevel(4);
  armSurvivalLevel(state, armed);
  assert.equal(state.level, 4);
  // The loop reads the table entry off the state rather than rebuilding it.
  assert.equal(state.escalation, armed);
  assert.equal(state.peakLevel, 4);
  assert.equal(state.mineStormIn, armed.mineStormIntervalTicks);
  assert.equal(state.beamIn, escalationForLevel(4).beamIntervalTicks);

  // A counter already close to firing is never pushed back by a level-up, so
  // a well-timed minute boundary cannot skip a wave.
  state.waveIn = 3;
  armSurvivalLevel(state, escalationForLevel(5));
  assert.equal(state.waveIn, 3);

  // Peak level is a high-water mark for the result card.
  armSurvivalLevel(state, escalationForLevel(2));
  assert.equal(state.peakLevel, 5);
});

test("a twenty-minute run levels up on every boundary and never twice", () => {
  // The level-up branch in the loop is only reachable after a level's worth of
  // real play, so the decision it applies is made out here where a whole run
  // can be simulated in milliseconds. Counts are derived from
  // SURVIVAL_LEVEL_SECONDS rather than restated, so retuning the clock does not
  // mean recomputing this by hand.
  const state = createSurvivalState();
  const levelUps = [];
  const stages = [];

  // One call per simulated tick, for twenty minutes.
  for (let tick = 1; tick <= (20 * 60 * 1000) / 15; tick += 1) {
    const levelUp = advanceSurvival(state, (tick * 15) / 1000);
    if (!levelUp) continue;
    levelUps.push(levelUp);
    if (levelUp.stageChanged) stages.push(levelUp.stage.id);
  }

  // Every boundary in twenty minutes, in order, with no repeats.
  const expected = Math.floor((20 * 60) / SURVIVAL_LEVEL_SECONDS);
  assert.equal(levelUps.length, expected);
  assert.deepEqual(levelUps.map((entry) => entry.level), Array.from({ length: expected }, (_, i) => i + 2));
  assert.equal(state.level, expected + 1);
  assert.equal(state.peakLevel, expected + 1);

  // Each stage is announced exactly once, in order, and level 1's Stable is
  // never announced because the run opens there.
  assert.deepEqual(stages, ["unstable", "critical", "enraged", "collapse"]);

  for (const levelUp of levelUps) {
    // Every level-up hands the loop a complete, fresh rules object and the
    // matching table entry — nothing the loop has to re-derive.
    assert.equal(levelUp.rules.id, "survival");
    assert.equal(levelUp.escalation.level, levelUp.level);
    assert.equal(levelUp.stage, levelUp.escalation.stage);
    assert.equal(state.escalation.level >= levelUp.level, true);
    assert.match(levelUp.notice, new RegExp(`^RIFT LEVEL ${levelUp.level}\\b`));
    if (levelUp.stageChanged) assert.match(levelUp.notice, /\/\/ [A-Z ]+$/);
  }

  // The rules really do escalate across the run rather than being handed back
  // unchanged with a new label on them.
  // Compared against the rules the run *opens* with rather than the first
  // level-up's, because the first boundary now lands in UNSTABLE — the ramp
  // starts biting one level in, which is the point of the compressed ladder.
  const opening = survivalRulesFor(STAGE_LEVELS.stable);
  const last = levelUps[levelUps.length - 1].rules;
  assert.equal(opening.wormhole.kind, "locked");
  assert.equal(last.wormhole.kind, "orbit");
  assert.equal(opening.contactHazard.enabled, false);
  assert.equal(last.contactHazard.enabled, true);
  assert.equal(opening.wormholeEnrage.enabled, false);
  assert.equal(last.wormholeEnrage.enabled, true);
});

test("the level clock reports nothing on the ticks where nothing changed", () => {
  const state = createSurvivalState();
  assert.equal(advanceSurvival(state, 0), null);
  assert.equal(advanceSurvival(state, SURVIVAL_LEVEL_SECONDS - 0.1), null);

  const levelUp = advanceSurvival(state, SURVIVAL_LEVEL_SECONDS);
  assert.equal(levelUp?.level, 2);
  // Crossing the same boundary again is not a second level-up.
  assert.equal(advanceSurvival(state, SURVIVAL_LEVEL_SECONDS), null);
  assert.equal(advanceSurvival(state, SURVIVAL_LEVEL_SECONDS * 2 - 1), null);
});

test("the arena has a hostile ceiling, because the mode has no end", () => {
  assert.ok(SURVIVAL_HOSTILE_CAP > 0);
  assert.match(gameCode, /game\.enemies\.length >= SURVIVAL_HOSTILE_CAP/);
  assert.match(gameCode, /if \(!crowded\)/);
});

test("the PvE time penalty does not apply to a survival run", () => {
  // Survival ends in defeat, and `settleScore` only charges the penalty on a
  // victory — so the score the pilot earned by the second is the score kept.
  const settled = settleScore(48_000, 615, "defeat");
  assert.equal(settled.timePenalty, 0);
  assert.equal(settled.finalScore, 48_000);
});

test("survival runs are kept off the arcade global board", async () => {
  const result = await saveScoreToMurph({
    runId: "survival-run",
    score: 48_000,
    initials: "ABC",
    difficulty: "survival",
    outcome: "defeat",
    ship: "Starling",
    rivalHealth: 100,
    durationSeconds: 615,
  });
  assert.equal(result.status, "failed");

  // The guard is on the difficulty as well as the outcome, so a survival run
  // stays off the board even if it ever acquires one.
  assert.match(
    await readFile(new URL("../app/arcade-scores.ts", import.meta.url), "utf8"),
    /run\.difficulty === "survival" \|\|/
  );
});

test("the game loop reads the escalation table instead of keeping its own", () => {
  // The loop applies a level-up rather than deciding one, so rift motion,
  // contact and enrage all escalate through the systems that already own them.
  assert.match(gameCode, /const levelUp = advanceSurvival\(survival, /);
  assert.match(gameCode, /game\.rules = levelUp\.rules/);
  assert.match(gameCode, /game\.portalThreshold = levelUp\.escalation\.powerUpCharge/);

  // Survival's clock runs before anything that reads the rules this tick.
  const tickBody = gameCode.slice(gameCode.indexOf("const tick = () =>"));
  const survivalCall = tickBody.indexOf("tickSurvival(game)");
  const enrageBlock = tickBody.indexOf("if (game.enrageActive && game.rules.wormholeEnrage.enabled)");
  assert.ok(survivalCall > 0 && enrageBlock > survivalCall);

  // The PvE wave scheduler stands down rather than spawning alongside it.
  assert.match(gameCode, /\} else if \(\s*!game\.survival/);

  // A collapsed rift is a reward here, not an ending.
  assert.match(gameCode, /if \(game\.rivalHealth <= 0 && game\.survival\) \{\s*breachRift\(game\);/);
  assert.doesNotMatch(
    gameCode.slice(gameCode.indexOf("const breachRift")),
    /breachRift[\s\S]{0,900}?game\.result = "victory"/
  );
});

test("survival is launched from Challenges, not from the difficulty list", () => {
  // The roadmap rules out Survival Easy / Survival Hard menu entries, so the
  // difficulty selector must not offer it at all.
  assert.ok(!DIFFICULTIES.survival.unlimitedHull);
  // One list now, rather than a PvE branch of its own.
  assert.match(menu, /title="Select Game Mode"/);
  assert.match(menu, /data-mode="survival"/);
  assert.match(menu, /onClick=\{onSurvival\}/);
  // Survival owns its launch and never enters the standard Difficulty screen.
  const difficultyScreen = menu.slice(menu.indexOf("export function DifficultyScreen"), menu.indexOf("Rift Run --"));
  assert.doesNotMatch(difficultyScreen, /survival/);

  // Choosing an arcade mode leaves the challenge behind.
  assert.match(gameCode, /difficultyPreference\.get\(\) === "survival"/);
  assert.match(gameCode, /modePreference\.set\("pve"\);\s*difficultyPreference\.set\("survival"\)/);
});

test("the result card reports what survival actually asked of the player", () => {
  assert.match(gameCode, /riftLevel: survivalRun \? hud\.riftLevel : undefined/);
  assert.match(gameCode, /breaches: survivalRun \? hud\.breaches : undefined/);
  // Time, not score, and its own device board rather than the arcade record.
  // The board's own rules are covered in `survival-board.test.mjs`.
  assert.match(gameCode, /recordSurvivalRun\(identifiedRun\)/);
  assert.match(gameCode, /<span>SURVIVED<\/span>/);
  assert.match(gameCode, /RIFT LEVEL <b>\{summary\.run\.riftLevel \?\? 1\}<\/b>/);
});


/* ------------------------------------------- rift damage as score ------- */

test("damage the rift absorbs is worth score, one for one", () => {
  assert.equal(SURVIVAL_RIFT_DAMAGE_SCORE, 1);
  assert.equal(survivalRiftDamageScore(10), 10);
  assert.equal(survivalRiftDamageScore(150), 150);

  // A whole charge cycle is worth having, without out-earning the clock: at
  // Rift Level 1 the rift sheds a power-up for 150 cannon damage, which is
  // worth a few seconds of simply staying alive.
  const opening = escalationForLevel(1);
  const cycle = survivalRiftDamageScore(opening.powerUpCharge);
  assert.ok(cycle > opening.secondScore, "shooting the rift has to be worth doing");
  assert.ok(cycle < opening.secondScore * 20, "and must not eclipse surviving");
});

test("shooting the rift always scores, at every level of a run", () => {
  for (const level of LEVELS) {
    assert.ok(
      survivalRiftDamageScore(escalationForLevel(level).powerUpCharge) > 0,
      `rift damage must never stop paying, level ${level}`,
    );
  }
});

test("a run's rift damage accumulates and never double-counts one hit", () => {
  const state = createSurvivalState();
  assert.equal(state.riftDamage, 0);

  let score = 0;
  for (let shot = 0; shot < 12; shot += 1) score += scoreRiftDamage(state, 10);

  assert.equal(state.riftDamage, 120, "each hit is recorded exactly once");
  assert.equal(score, 120);

  // The same total arriving as one large hit is worth exactly the same, so a
  // duplicated collision event cannot be laundered into extra score by being
  // split up, and a single event cannot be paid twice by being replayed.
  const single = createSurvivalState();
  assert.equal(scoreRiftDamage(single, 120), score);
  assert.equal(single.riftDamage, state.riftDamage);
});

test("damage the rift never actually took scores nothing", () => {
  const state = createSurvivalState();
  // A round refunded, a hit fully swallowed by an enrage shield, or an impact
  // on a rift already at zero all arrive here as nothing to pay for.
  for (const nothing of [0, -40, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
    assert.equal(scoreRiftDamage(state, nothing), 0, `${nothing} must not score`);
  }
  assert.equal(state.riftDamage, 0);
});

test("rift damage is paid on top of the score sources survival already had", () => {
  // The roadmap's existing sources are untouched by the new one.
  assert.ok(escalationForLevel(1).secondScore > 0, "time survived still pays");
  assert.ok(survivalBreachBonus(1, 0) > 0, "breaching still pays");
  const state = createSurvivalState();
  scoreRiftDamage(state, 50);
  assert.equal(state.level, 1, "scoring rift damage must not disturb the level clock");
  assert.equal(state.breaches, 0);
});

test("the loop pays for rift damage where it is applied, not where it is fired", () => {
  // One award site per place the rift actually takes damage, and both of them
  // go through the same helper — which is what makes the conversion editable
  // in one place and impossible to double up by accident.
  assert.equal((gameCode.match(/awardRiftDamage\(game, /g) ?? []).length, 2);
  assert.match(gameCode, /const awardRiftDamage = \(game: Game, damage: number\)/);
  assert.match(gameCode, /game\.score \+= scoreRiftDamage\(survival, damage\)/);

  // Cannon damage is paid for beside the charge it actually adds to the rift.
  assert.match(
    gameCode,
    /chargeRiftPup\(game, bullet\.damage\);[\s\S]*?awardRiftDamage\(game, bullet\.damage\);/,
  );
  // A payload is paid for on the integrity actually removed — never on the
  // projectile's nominal damage, which an enrage shield may have swallowed.
  assert.match(gameCode, /awardRiftDamage\(game, game\.lastRivalDamage\)/);
  assert.doesNotMatch(gameCode, /awardRiftDamage\(game, damage\)/);

  // Nothing outside survival is disturbed: the helper leaves every other mode
  // alone, and the existing PvE payout is still there beside it.
  assert.match(gameCode, /const survival = game\.survival;\s*if \(!survival \|\| game\.result\) return;/);
  assert.match(gameCode, /game\.score \+= 750 \+ damage \* 10;/);
});
