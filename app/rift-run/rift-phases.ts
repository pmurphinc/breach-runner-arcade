/**
 * Rift health phases — the rift gets meaner as it dies.
 *
 * Breach depth is Rift Run's long clock: every rift collapsed makes the whole
 * arena harsher, and that curve lives in `escalation.ts`. This is the *short*
 * clock, inside a single rift. A rift at full integrity is a target; a rift at
 * ten percent is a cornered animal. Without that, every rift in a run feels
 * identical from the first shot to the last, and the most dramatic moment in
 * the mode — the kill — is the least eventful.
 *
 * A phase says three things, and only three, so the numbers stay comparable
 * down the table: how fast standing near the rift builds pressure, how much
 * warning the pilot gets before the rift hits back, and what the rift throws
 * into the arena when it does. Everything else about the rift is depth's job.
 *
 * Pure data. The pressure system reads it, the hazard scheduler reads it, and
 * neither of them owns a number of its own.
 */

import type { PowerId } from "../game-data.ts";

export type RiftPhaseId = "intact" | "strained" | "fracturing" | "collapsing";

export type RiftPhase = {
  id: RiftPhaseId;
  /** Player-facing name, shown when the phase changes. */
  name: string;
  /** Integrity fraction at or below which this phase takes over. */
  atFraction: number;
  /** Multiplier on how fast a camping pilot builds Rift Pressure. */
  pressureScale: number;
  /** Ticks of telegraph before a retaliation lands. Shorter is meaner. */
  telegraphTicks: number;
  /** Ticks the rift rests after a retaliation before it may charge another. */
  cooldownTicks: number;
  /** Damage a retaliation from this phase deals. */
  retaliationDamage: number;
  /** What the rift throws into the arena alongside a retaliation. */
  spawnMix: readonly PowerId[];
  /** How many of them. Zero in the opening phase: the first rift stays clean. */
  spawnCount: number;
};

/**
 * The four phases, healthiest first.
 *
 * The shape is deliberate: the opening phase is barely a phase at all — over
 * two seconds of telegraph, seven seconds of rest between strikes and no
 * hostiles at all — because a pilot meeting the system for the first time
 * should get hit exactly once and understand why. By COLLAPSING that telegraph
 * is well under a second, the rest is halved, and every retaliation arrives
 * with an escort.
 */
export const RIFT_PHASES: readonly RiftPhase[] = [
  {
    id: "intact",
    name: "INTACT",
    atFraction: 1,
    pressureScale: 1,
    telegraphTicks: 110,
    cooldownTicks: 420,
    retaliationDamage: 12,
    spawnMix: [],
    spawnCount: 0,
  },
  {
    id: "strained",
    name: "STRAINED",
    atFraction: 0.7,
    pressureScale: 1.25,
    telegraphTicks: 85,
    cooldownTicks: 330,
    retaliationDamage: 16,
    spawnMix: ["heatseeker", "scarab", "mines"],
    spawnCount: 2,
  },
  {
    id: "fracturing",
    name: "FRACTURING",
    atFraction: 0.4,
    pressureScale: 1.6,
    telegraphTicks: 62,
    cooldownTicks: 260,
    retaliationDamage: 20,
    spawnMix: ["turret", "minelayer", "ufo", "inflator"],
    spawnCount: 3,
  },
  {
    id: "collapsing",
    name: "COLLAPSING",
    atFraction: 0.18,
    pressureScale: 2.1,
    telegraphTicks: 45,
    cooldownTicks: 200,
    retaliationDamage: 26,
    spawnMix: ["gunship", "wallcrawler", "artillery", "nuke"],
    spawnCount: 3,
  },
];

/** The phase a rift at this integrity fraction is in. */
export function riftPhaseForIntegrity(fraction: number): RiftPhase {
  const safe = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 1;
  // Walk deepest-first so the lowest matching band wins.
  for (let index = RIFT_PHASES.length - 1; index > 0; index -= 1) {
    if (safe <= RIFT_PHASES[index].atFraction) return RIFT_PHASES[index];
  }
  return RIFT_PHASES[0];
}

/** The phase's position in the table. Useful for "deeper than" comparisons. */
export function riftPhaseIndex(phase: RiftPhase): number {
  const found = RIFT_PHASES.findIndex(({ id }) => id === phase.id);
  return found < 0 ? 0 : found;
}

/** The notice for a rift that has just dropped into a new phase. */
export function riftPhaseNotice(phase: RiftPhase): string {
  return `RIFT ${phase.name}`;
}

/** One hostile kind from this phase's mix, or null when the phase sends none. */
export function riftPhaseSpawn(phase: RiftPhase, random: () => number = Math.random): PowerId | null {
  if (phase.spawnMix.length === 0) return null;
  return phase.spawnMix[Math.floor(random() * phase.spawnMix.length) % phase.spawnMix.length];
}
