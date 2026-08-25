/**
 * Rift Survival — the endless time challenge.
 *
 * Survival is the first mode from the game-modes roadmap, and it is built the
 * way the roadmap asks for: it adds no second combat system. The arena, the
 * ships, the rift, the power-ups and the hostiles are exactly the ones Solo
 * PvE already uses. What Survival adds is *pressure over time* — a Rift Level
 * that climbs every minute and re-derives the rules the existing game loop is
 * already reading.
 *
 * That is why `survivalRulesFor` returns a whole `DifficultyRules` object
 * rather than a bag of flags. Rift motion, the contact hazard and enrage are
 * already rules the loop consults every tick, so escalating them means handing
 * the loop a new rules object — not adding a branch beside every one of them.
 * `escalationForLevel` carries only the knobs that have no home in
 * `DifficultyRules`: wave cadence, mine storms, sweep beams, the gravity well,
 * and how hard the rift is to charge.
 *
 * Everything here is pure and free of React, canvas and timers, so the whole
 * escalation curve is testable as data (see `tests/survival.test.mjs`). The
 * game loop owns no survival numbers of its own.
 */

// Explicit `.ts` specifiers: this module is imported directly by the Node test
// runner as well as by the bundler, and Node resolves real files rather than
// bundler-style extensionless paths. `allowImportingTsExtensions` is on, so
// the same specifiers typecheck.
import { SENDABLE_POWERUPS, type PowerId } from "./game-data.ts";
import {
  DIFFICULTIES,
  ticksForSeconds,
  type ContactHazardRules,
  type DifficultyRules,
  type WormholeMotion,
  type WormholeEnrageRules,
} from "./difficulty.ts";

/** How long one Rift Level lasts. The roadmap's fixed interval. */
export const SURVIVAL_LEVEL_SECONDS = 60;

/** Cannon damage the rift absorbs per power-up at Rift Level 1. */
export const SURVIVAL_BASE_POWER_UP_CHARGE = 150;

/** Rift integrity a fresh, unbreached rift carries. */
export const SURVIVAL_BASE_INTEGRITY = DIFFICULTIES.survival.rivalIntegrity;

/**
 * Hostiles allowed on screen before a scheduled wave is skipped.
 *
 * An endless mode has no natural end to spawning, so without a ceiling a long
 * run degenerates into a slideshow rather than a fight. Skipping a wave when
 * the arena is already full costs nothing the player can perceive; dropping to
 * ten frames a second costs them the run.
 */
export const SURVIVAL_HOSTILE_CAP = 90;

export type SurvivalStageId = "stable" | "unstable" | "critical" | "enraged" | "collapse";

export type SurvivalStage = {
  id: SurvivalStageId;
  /** Player-facing name, shown on the badge and on the level-up pulse. */
  name: string;
  /** First Rift Level that belongs to this stage. */
  fromLevel: number;
  /** One line describing what changed, for the level-up notice. */
  blurb: string;
};

/**
 * The five escalation stages, in order.
 *
 * Stage boundaries are the roadmap's minute marks: Stable 0–2, Unstable 2–4,
 * Critical 4–6, Enraged 6–10, Rift Collapse 10+.
 */
export const SURVIVAL_STAGES: readonly SurvivalStage[] = [
  {
    id: "stable",
    name: "STABLE",
    fromLevel: 1,
    blurb: "The rift holds centre. Ordinary hostile waves.",
  },
  {
    id: "unstable",
    name: "UNSTABLE",
    fromLevel: 3,
    blurb: "The rift breaks orbit, sweep beams appear, and waves come faster.",
  },
  {
    id: "critical",
    name: "CRITICAL",
    fromLevel: 5,
    blurb: "Touching the rift burns hull, and its contact radius keeps growing.",
  },
  {
    id: "enraged",
    name: "ENRAGED",
    fromLevel: 7,
    blurb: "The rift enrages: it regenerates, shields itself, and answers with mixed waves.",
  },
  {
    id: "collapse",
    name: "RIFT COLLAPSE",
    fromLevel: 11,
    blurb: "Double beams, a gravity well, and mine storms. Nothing here is survivable forever.",
  },
];

/** Palette per stage, so the arena visibly darkens as the run goes on. */
export const SURVIVAL_PALETTES: Record<SurvivalStageId, readonly [string, string, string]> = {
  stable: ["#0b1d22", "#061016", "#020409"],
  unstable: ["#141a2e", "#080b18", "#020409"],
  critical: ["#1d1029", "#0b0817", "#020409"],
  enraged: ["#2a1018", "#0f070d", "#030305"],
  collapse: ["#33070c", "#120406", "#050203"],
};

/** Hostile kinds the rift draws from before the full catalogue opens up. */
const STARTER_POOL: readonly PowerId[] = ["heatseeker", "mines", "ufo", "inflator"];

function whole(value: number) {
  return Math.max(1, Math.round(value));
}

/**
 * A value that decreases by `perLevel` for every level past `fromLevel` and
 * then stops. Used for every cadence in the table, so "gets faster, but never
 * past this" is one shape rather than five hand-written clamps.
 */
function rampDown(level: number, fromLevel: number, start: number, perLevel: number, floor: number) {
  return Math.max(floor, start - Math.max(0, level - fromLevel) * perLevel);
}

/** Rift Level for a run that has been going `seconds` long. One-based. */
export function riftLevelForSeconds(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return Math.floor(safe / SURVIVAL_LEVEL_SECONDS) + 1;
}

/** Seconds a run has to reach before `level` begins. */
export function secondsForRiftLevel(level: number) {
  return Math.max(0, Math.floor(level) - 1) * SURVIVAL_LEVEL_SECONDS;
}

export function stageForLevel(level: number): SurvivalStage {
  let stage = SURVIVAL_STAGES[0];
  for (const candidate of SURVIVAL_STAGES) {
    if (level >= candidate.fromLevel) stage = candidate;
  }
  return stage;
}

/** True on the level a stage begins, so the run announces it exactly once. */
export function stageBeginsAtLevel(level: number) {
  return SURVIVAL_STAGES.some((stage) => stage.fromLevel === level);
}

export type SurvivalEscalation = {
  level: number;
  stage: SurvivalStage;
  /** Ticks between ordinary hostile waves. */
  waveIntervalTicks: number;
  /** Hostiles added to every wave on top of the weapon's own count. */
  waveSizeBonus: number;
  /** Hostile kinds a wave may be drawn from. */
  wavePool: readonly PowerId[];
  /** Ticks between mine storms. Zero until mine storms start. */
  mineStormIntervalTicks: number;
  mineStormCount: number;
  /** Ticks between hostile sweep beams. Zero until beams start. */
  beamIntervalTicks: number;
  beamCount: number;
  /**
   * Inward acceleration applied to the pilot every tick. Zero until the well
   * opens.
   *
   * Deliberately tiny: the slowest frames accelerate at 0.04 per tick, so a
   * pull measured in hundredths is the difference between a current the pilot
   * has to fly against and one no ship in the fleet can escape.
   */
  gravityPull: number;
  /** Cannon damage the rift must absorb before it sheds a power-up. */
  powerUpCharge: number;
  /** Score for each whole second survived at this level. */
  secondScore: number;
};

/**
 * The escalation table.
 *
 * Read it top to bottom as the answer to "what is different about minute N?".
 * Every entry is behaviour, cadence or pressure — none of it is the roadmap's
 * forbidden shortcut of simply multiplying hostile health.
 */
export function escalationForLevel(level: number): SurvivalEscalation {
  const safe = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  const stage = stageForLevel(safe);

  return {
    level: safe,
    stage,
    // 8.5s between waves at level 1, tightening to 2.2s by Rift Collapse.
    waveIntervalTicks: whole(ticksForSeconds(rampDown(safe, 1, 8.5, 0.65, 2.2))),
    waveSizeBonus: Math.min(3, Math.floor((safe - 1) / 3)),
    wavePool: safe < 3 ? STARTER_POOL : SENDABLE_POWERUPS,
    // Mine storms open at level 4 and keep tightening.
    mineStormIntervalTicks: safe < 4 ? 0 : whole(ticksForSeconds(rampDown(safe, 4, 9, 0.6, 3))),
    mineStormCount: safe < 4 ? 0 : Math.min(6, 2 + Math.floor((safe - 4) / 3)),
    // Sweep beams open at level 3; Rift Collapse runs two at a time.
    beamIntervalTicks: safe < 3 ? 0 : whole(ticksForSeconds(rampDown(safe, 3, 20, 1.2, 8))),
    beamCount: safe < 3 ? 0 : safe >= 11 ? 2 : 1,
    gravityPull: safe < 9 ? 0 : Math.min(0.018, 0.006 + (safe - 9) * 0.002),
    powerUpCharge: Math.round(
      SURVIVAL_BASE_POWER_UP_CHARGE * Math.min(1.6, 1 + (safe - 1) * 0.06)
    ),
    secondScore: 20 + (safe - 1) * 20,
  };
}

/**
 * The rules in force at a given Rift Level.
 *
 * A fresh object every time: `DIFFICULTIES.survival` is module state shared by
 * every run in the tab, so escalating a run by mutating it would quietly
 * escalate the next one too.
 */
export function survivalRulesFor(level: number): DifficultyRules {
  const safe = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  const base = DIFFICULTIES.survival;
  const stage = stageForLevel(safe);

  // Stable holds the rift dead centre. From Unstable it orbits, and keeps
  // gaining angular speed, so leading it never stops being a skill.
  const wormhole: WormholeMotion = safe < 3
    ? { kind: "locked" }
    : { kind: "orbit", radius: 210, degreesPerTick: Math.min(1.4, 0.5 + (safe - 3) * 0.07) };

  // Critical arms the contact hazard, and every level after it widens the
  // radius — the roadmap's "reduced safe space", expressed in the system that
  // already owns proximity danger.
  const contactHazard: ContactHazardRules = safe < 5
    ? { enabled: false }
    : {
        enabled: true,
        radius: Math.min(76, 46 + (safe - 5) * 3),
        tickIntervalTicks: ticksForSeconds(0.5),
        damagePerTickFraction: 0.03,
        maxEpisodeFraction: 0.24,
        reentryGraceTicks: ticksForSeconds(0.6),
      };

  // Enrage is time-driven here, not integrity-driven: `thresholdFraction` is
  // zero so the PvE "the rival is nearly dead" trigger can never fire, and the
  // run activates it on reaching the Enraged stage instead. Mine pulses stay
  // off because Survival schedules its own mine storms; two independent mine
  // sources on one timer is exactly the duplicated mechanic the roadmap warns
  // about.
  const wormholeEnrage: WormholeEnrageRules = safe < 7
    ? { enabled: false }
    : {
        enabled: true,
        thresholdFraction: 0,
        waveIntervalTicks: whole(ticksForSeconds(rampDown(safe, 7, 14, 0.8, 8))),
        wave: [
          { enemy: "mines", count: 4 },
          { enemy: "ufo", count: 1 },
          { enemy: "scarab", count: 1 },
        ],
        healFraction: 0.08,
        healDurationTicks: ticksForSeconds(8),
        temporaryShieldFraction: safe >= 11 ? 0.1 : 0,
        temporaryShieldDurationTicks: ticksForSeconds(8),
        minePulseIntervalTicks: 0,
        minePulseCount: 0,
      };

  return {
    ...base,
    displayName: `RIFT SURVIVAL // ${stage.name}`,
    wormhole,
    contactHazard,
    wormholeEnrage,
  };
}

/**
 * Integrity the rift reforms with after being breached.
 *
 * Half again per breach. The point is pacing, not a health wall: each breach
 * has to stay reachable, but a run that keeps breaching should spend longer
 * and longer between the clears that breaching hands out.
 */
export function survivalBreachIntegrity(breaches: number) {
  const safe = Math.max(0, Math.floor(Number.isFinite(breaches) ? breaches : 0));
  return Math.round(SURVIVAL_BASE_INTEGRITY * (1 + safe * 0.5));
}

/** Score for collapsing the rift, worth more the deeper the run has gone. */
export function survivalBreachBonus(level: number, breaches: number) {
  const safeLevel = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  const safeBreaches = Math.max(0, Math.floor(Number.isFinite(breaches) ? breaches : 0));
  return 2500 * safeLevel + 1500 * safeBreaches;
}

/**
 * Live Survival bookkeeping for one run.
 *
 * Cadence counters live here rather than on the shared `botTimer` so the
 * ordinary PvE wave scheduler stays exactly as it is, and so a Survival run
 * can be reasoned about — and reset — as one object.
 */
export type SurvivalState = {
  /** Current Rift Level. */
  level: number;
  /**
   * The table entry for `level`, kept rather than recomputed.
   *
   * The loop reads it every tick — for the wave clock, the gravity well and
   * the HUD — and it only ever changes once a minute, so rebuilding it sixty-
   * six times a second would be allocation for nothing.
   */
  escalation: SurvivalEscalation;
  /** Highest level reached, reported on the result card. */
  peakLevel: number;
  /** Times the rift has been collapsed and reformed. */
  breaches: number;
  /** Ticks until the next ordinary hostile wave. */
  waveIn: number;
  /** Ticks until the next mine storm. Inert while the storm is not armed. */
  mineStormIn: number;
  /** Ticks until the next sweep beam. Inert while beams are not armed. */
  beamIn: number;
  /** Ticks until the next whole second of survival is scored. */
  secondIn: number;
};

export function createSurvivalState(): SurvivalState {
  const opening = escalationForLevel(1);
  return {
    level: 1,
    escalation: opening,
    peakLevel: 1,
    breaches: 0,
    waveIn: opening.waveIntervalTicks,
    mineStormIn: 0,
    beamIn: 0,
    secondIn: ticksForSeconds(1),
  };
}

/**
 * What a level-up changes, as data.
 *
 * The game loop applies this; it does not decide any of it. Keeping the
 * decision out here is what makes a twenty-minute escalation testable in
 * milliseconds — the alternative is a branch that only runs after a minute of
 * real play, which is a branch nothing will ever check.
 */
export type SurvivalLevelUp = {
  level: number;
  stage: SurvivalStage;
  /** True when this level opens a new stage, which is announced louder. */
  stageChanged: boolean;
  /** The rules now in force. A fresh object, ready to be assigned. */
  rules: DifficultyRules;
  escalation: SurvivalEscalation;
  /** The level-up notice, already worded. */
  notice: string;
};

/**
 * Advances the level clock, returning what changed.
 *
 * Null on the ticks where nothing did, which is all but one in every four
 * thousand — so the caller's level-up branch is entered exactly when the run
 * has genuinely crossed a minute boundary.
 */
export function advanceSurvival(
  state: SurvivalState,
  elapsedSeconds: number
): SurvivalLevelUp | null {
  const level = riftLevelForSeconds(elapsedSeconds);
  if (level === state.level) return null;

  const escalation = escalationForLevel(level);
  armSurvivalLevel(state, escalation);
  const stageChanged = stageBeginsAtLevel(level);

  return {
    level,
    stage: escalation.stage,
    stageChanged,
    rules: survivalRulesFor(level),
    escalation,
    notice: stageChanged ? `RIFT LEVEL ${level} // ${escalation.stage.name}` : `RIFT LEVEL ${level}`,
  };
}

/**
 * Re-arms the cadence counters for a level the run has just entered.
 *
 * A counter that is already running is left alone: re-arming on every level-up
 * would let a player who times their minute boundaries well skip a wave that
 * was one tick from spawning. A counter that was disabled at the previous
 * level starts fresh, so a newly armed hazard does not fire instantly.
 */
export function armSurvivalLevel(state: SurvivalState, escalation: SurvivalEscalation) {
  state.level = escalation.level;
  state.escalation = escalation;
  state.peakLevel = Math.max(state.peakLevel, escalation.level);
  state.waveIn = Math.min(state.waveIn, escalation.waveIntervalTicks);
  state.mineStormIn = escalation.mineStormIntervalTicks === 0
    ? 0
    : state.mineStormIn > 0
      ? Math.min(state.mineStormIn, escalation.mineStormIntervalTicks)
      : escalation.mineStormIntervalTicks;
  state.beamIn = escalation.beamIntervalTicks === 0
    ? 0
    : state.beamIn > 0
      ? Math.min(state.beamIn, escalation.beamIntervalTicks)
      : escalation.beamIntervalTicks;
}
