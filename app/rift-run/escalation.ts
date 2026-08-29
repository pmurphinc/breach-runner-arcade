/**
 * Rift Run escalation — the run gets harder every time the Rift dies.
 *
 * Rift Run's opening minute is deliberately the gentlest arena in the game:
 * the rift is locked dead centre, the collision shield is up, and hostiles
 * arrive on the ordinary PvE cadence. That is the right place to learn a
 * loadout and the wrong place to spend twenty minutes, so the mode needs a
 * pressure curve — and the one thing a Rift Run pilot does that no other mode
 * measures is *collapse the rift*. Breach depth is therefore the clock.
 *
 * Rather than invent a second escalation table beside the one Rift Survival
 * already proved, this module maps a breach depth onto a Survival Rift Level
 * and delegates. Depth 1 is Survival's UNSTABLE, depth 2 CRITICAL, depth 3
 * ENRAGED, and depth 4 — the fourth rift the pilot destroys — is RIFT
 * COLLAPSE, the deepest stage Survival has: double sweep beams, mine storms
 * and the gravity well. From there it keeps climbing two Survival levels per
 * breach with no cap, exactly as an endless run does.
 *
 * What comes back is a whole `DifficultyRules` object, for the same reason
 * Survival returns one: rift motion, the contact hazard and enrage are
 * already rules the game loop consults every tick, so escalating them means
 * handing the loop new numbers rather than adding a branch beside each of
 * them. The launch ruleset's own identity — its id, its short name, its
 * collision shield — is re-stamped on top, so a Rift Run stays a Rift Run in
 * the HUD, on the leaderboard and in the run summary; only its behaviour
 * escalates.
 *
 * Pure, React-free and canvas-free, so the whole curve is testable as data
 * (see `tests/rift-run.test.mjs`). The game loop owns no escalation numbers.
 */

// Explicit `.ts` specifiers: this module is imported by the Node test runner
// as well as by the bundler, and Node resolves real files rather than
// bundler-style extensionless paths.
import { DIFFICULTIES, type DifficultyRules } from "../difficulty.ts";
import {
  escalationForLevel,
  survivalRulesFor,
  SURVIVAL_HOSTILE_CAP,
  type SurvivalEscalation,
  type SurvivalStage,
} from "../survival.ts";

/** Hostiles allowed on screen before a scheduled Rift Run wave is skipped. */
export const RIFT_RUN_HOSTILE_CAP = SURVIVAL_HOSTILE_CAP;

/**
 * The Survival Rift Level each of the first breach depths is worth.
 *
 * Index is depth: an unbreached run (depth 0) opens at Survival's level 1 —
 * STABLE, which is the arena Rift Run already had — and each entry after it
 * is the first level of the next Survival stage. So every breach visibly
 * changes the rules rather than nudging a cadence nobody can feel.
 */
export const RIFT_RUN_DEPTH_LEVELS = [1, 3, 5, 7, 11] as const;

/** The breach that lands a run in RIFT COLLAPSE — Survival's deepest stage. */
export const RIFT_RUN_COLLAPSE_DEPTH = RIFT_RUN_DEPTH_LEVELS.length - 1;

/** Survival levels each breach past RIFT COLLAPSE is worth. Uncapped tail. */
export const RIFT_RUN_DEEP_LEVELS_PER_BREACH = 2;

/** The Survival Rift Level a run that has breached `depth` times flies under. */
export function survivalLevelForDepth(depth: number): number {
  const safe = Math.max(0, Math.floor(Number.isFinite(depth) ? depth : 0));
  if (safe < RIFT_RUN_COLLAPSE_DEPTH) return RIFT_RUN_DEPTH_LEVELS[safe];
  const collapse = RIFT_RUN_DEPTH_LEVELS[RIFT_RUN_COLLAPSE_DEPTH];
  return collapse + (safe - RIFT_RUN_COLLAPSE_DEPTH) * RIFT_RUN_DEEP_LEVELS_PER_BREACH;
}

export type RiftRunEscalation = {
  /** Rifts destroyed so far. Zero on a fresh run. */
  depth: number;
  /** The Survival Rift Level this depth is flying under. */
  level: number;
  stage: SurvivalStage;
  /** Cadences, hazard counts, gravity and PUP charge for this depth. */
  escalation: SurvivalEscalation;
  /** The rules now in force. A fresh object, ready to be assigned. */
  rules: DifficultyRules;
  /**
   * True once the rift schedules its own hostile waves.
   *
   * An unbreached run keeps the ordinary PvE wave scheduler it has always
   * used, so nothing about the opening changes; the first breach is what
   * hands the rift its own clock. Two schedulers running at once would double
   * every wave, so the loop reads this to stand the PvE one down.
   */
  ownsWaveSchedule: boolean;
  /** True on the depth that opens a new stage, which is announced louder. */
  stageChanged: boolean;
};

/**
 * The escalation in force after `depth` breaches.
 *
 * `base` is the ruleset the run launched under. Its identity is preserved —
 * a Rift Run is never mistaken for a Survival run by the HUD, the summary or
 * the leaderboard — and so is its collision shield, which is part of what the
 * pilot chose rather than part of the escalation.
 */
export function riftRunEscalationForDepth(
  depth: number,
  base: DifficultyRules = DIFFICULTIES.easy,
): RiftRunEscalation {
  const safe = Math.max(0, Math.floor(Number.isFinite(depth) ? depth : 0));
  const level = survivalLevelForDepth(safe);
  const escalation = escalationForLevel(level);
  const survival = survivalRulesFor(level);

  return {
    depth: safe,
    level,
    stage: escalation.stage,
    escalation,
    ownsWaveSchedule: safe > 0,
    stageChanged: safe > 0 && escalation.stage.id !== riftRunStageForDepth(safe - 1).id,
    rules: {
      ...survival,
      id: base.id,
      shortName: base.shortName,
      blurb: base.blurb,
      collisionShield: base.collisionShield,
      rivalIntegrity: base.rivalIntegrity,
      unlimitedHull: base.unlimitedHull,
      displayName: `RIFT RUN // ${escalation.stage.name}`,
    },
  };
}

/** The stage at a depth, without building a whole rules object for it. */
export function riftRunStageForDepth(depth: number): SurvivalStage {
  return escalationForLevel(survivalLevelForDepth(depth)).stage;
}

/**
 * The breach notice, already worded.
 *
 * A breach that opens a new stage says what changed, because the pilot is
 * about to fly into it; one that only deepens the same stage stays short.
 */
export function riftRunBreachNotice(next: RiftRunEscalation): string {
  return next.stageChanged
    ? `RIFT BREACHED // DEPTH ${next.depth} // ${next.stage.name}`
    : `RIFT BREACHED // DEPTH ${next.depth}`;
}

/**
 * Live escalation bookkeeping for one Rift Run.
 *
 * Cadence counters live here rather than on the shared `botTimer` so the
 * ordinary PvE scheduler stays exactly as it is, and so an escalating run can
 * be reasoned about — and re-armed — as one object.
 */
export type RiftRunEscalationRuntime = {
  /**
   * The ruleset the run launched under.
   *
   * Kept because `current.rules` is replaced on every breach, and each new
   * depth is derived from the launch identity rather than from the escalated
   * object it is about to replace.
   */
  base: DifficultyRules;
  current: RiftRunEscalation;
  /** Ticks until the next scheduled hostile wave. Inert before the first breach. */
  waveIn: number;
  /** Ticks until the next mine storm. Inert while storms are not armed. */
  mineStormIn: number;
  /** Ticks until the next sweep beam. Inert while beams are not armed. */
  beamIn: number;
};

export function createRiftRunEscalationRuntime(
  base: DifficultyRules = DIFFICULTIES.easy,
): RiftRunEscalationRuntime {
  return { base, current: riftRunEscalationForDepth(0, base), waveIn: 0, mineStormIn: 0, beamIn: 0 };
}

/**
 * Re-arms the cadence counters for a depth the run has just reached.
 *
 * A counter already running is tightened rather than restarted, so breaching
 * the instant before a wave was due cannot skip it. A counter that was
 * disabled at the previous depth starts fresh, so a newly armed hazard does
 * not fire the same tick the rift reforms.
 */
export function armRiftRunDepth(runtime: RiftRunEscalationRuntime, next: RiftRunEscalation): void {
  const { escalation, ownsWaveSchedule } = next;
  runtime.current = next;
  runtime.waveIn = !ownsWaveSchedule
    ? 0
    : runtime.waveIn > 0
      ? Math.min(runtime.waveIn, escalation.waveIntervalTicks)
      : escalation.waveIntervalTicks;
  runtime.mineStormIn = escalation.mineStormIntervalTicks === 0
    ? 0
    : runtime.mineStormIn > 0
      ? Math.min(runtime.mineStormIn, escalation.mineStormIntervalTicks)
      : escalation.mineStormIntervalTicks;
  runtime.beamIn = escalation.beamIntervalTicks === 0
    ? 0
    : runtime.beamIn > 0
      ? Math.min(runtime.beamIn, escalation.beamIntervalTicks)
      : escalation.beamIntervalTicks;
}

/** Advances a Rift Run to `depth`, returning what the loop has to apply. */
export function escalateRiftRunToDepth(
  runtime: RiftRunEscalationRuntime,
  depth: number,
): RiftRunEscalation {
  const next = riftRunEscalationForDepth(depth, runtime.base);
  armRiftRunDepth(runtime, next);
  return next;
}
