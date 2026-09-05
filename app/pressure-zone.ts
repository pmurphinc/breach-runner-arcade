/**
 * The pressure zone, outside Rift Run.
 *
 * Rift Run taught the rift to fight back: standing inside `RIFT_PRESSURE_RADIUS`
 * builds pressure, and a full meter buys a telegraphed retaliation — a targeted
 * strike, a shockwave, or a rotating sweep. The whole point is that it punishes
 * *standing still*, not shooting: backing off bleeds pressure faster than
 * sitting close builds it, so a pilot who circles and re-approaches never sees
 * one. See `rift-run/rift-pressure.ts`, which owns all of that.
 *
 * Ordinary PvE had the opposite problem and the same cause. The rift orbits on
 * VOLATILE and CRITICAL, but a pilot who simply flies the orbit with it sits at
 * point-blank range for the whole fight and is never asked to leave. The mode's
 * two existing answers — the contact hazard and the enrage waves — both punish
 * *touching* the rift or *taking too long*, and neither one moves a pilot who
 * has parked just outside contact range.
 *
 * So the mechanic comes across. What does not come across is Rift Run's tuning:
 * that curve was drawn for a mode whose whole loop is closing on the rift with
 * short-range hull guns, against a pilot carrying a run's worth of upgrades. A
 * PvE pilot is flying a stock hull and needs more warning and fewer surprises.
 *
 * Rather than teach the pressure system about difficulty, a zone scales the
 * *phase* it is handed. A phase already says the three things that matter —
 * how fast pressure builds, how much warning there is, and what escorts the
 * retaliation — so scaling one produces a complete, valid phase and every rule
 * downstream is untouched. The pressure system never learns that PvE exists.
 */

import type { RiftPhase } from "./rift-run/rift-phases.ts";

export type PressureZoneRules =
  | { enabled: false }
  | {
      enabled: true;
      /**
       * Multiplier on how fast standing near the rift builds pressure.
       *
       * Below 1 buys the pilot more time to realise what the ring means.
       */
      gainScale: number;
      /**
       * Multiplier on the telegraph. **Above** 1 is more warning, not less.
       *
       * The one number that must never be tuned down here: a retaliation the
       * pilot could not have seen coming is a bug, not difficulty.
       */
      telegraphScale: number;
      /**
       * Share of the phase's own escort that arrives with a retaliation.
       *
       * Zero means the retaliation comes alone. PvE already runs its own wave
       * schedule, so a full-strength escort on top of it is two difficulty
       * systems firing at once rather than one.
       */
      escortScale: number;
    };

export const NO_PRESSURE_ZONE: PressureZoneRules = { enabled: false };

/**
 * VOLATILE: the introduction.
 *
 * Pressure builds at three-quarters speed and the telegraph is half again as
 * long, so the first retaliation a pilot ever meets is one they had time to
 * read. Nothing escorts it — the point of the first one is to be understood,
 * and a pilot dodging a strike while three fresh hostiles arrive learns only
 * that something killed them.
 */
export const VOLATILE_PRESSURE_ZONE: PressureZoneRules = {
  enabled: true,
  gainScale: 0.75,
  telegraphScale: 1.5,
  escortScale: 0,
};

/**
 * CRITICAL: the real thing.
 *
 * Full build rate, and a telegraph only slightly longer than Rift Run's, where
 * the pilot would be flying a hull they had spent a run upgrading. Escorts
 * arrive at half the phase's count: enough that a retaliation reshapes the
 * arena rather than merely pushing the pilot, without stacking a full Rift Run
 * spawn on top of CRITICAL's own enrage waves.
 */
export const CRITICAL_PRESSURE_ZONE: PressureZoneRules = {
  enabled: true,
  gainScale: 1,
  telegraphScale: 1.2,
  escortScale: 0.5,
};

/**
 * The phase to hand the pressure system, given the zone in force.
 *
 * Returns the phase unchanged when there is no zone, so a Rift Run — which has
 * no zone rules and wants the phase table exactly as written — costs nothing
 * and reads identically.
 *
 * Escort count rounds *down*, so an `escortScale` of 0.5 against the opening
 * phase's zero escorts stays zero rather than inventing one, and a half share
 * of a 3-hostile mix sends one rather than two.
 */
export function pressureZonePhase(phase: RiftPhase, zone: PressureZoneRules): RiftPhase {
  if (!zone.enabled) return phase;
  return {
    ...phase,
    pressureScale: phase.pressureScale * zone.gainScale,
    // At least one tick of telegraph, always. A zero-tick telegraph is a hit
    // out of nowhere, which is the one thing this system must never produce.
    telegraphTicks: Math.max(1, Math.round(phase.telegraphTicks * zone.telegraphScale)),
    spawnCount: Math.floor(phase.spawnCount * zone.escortScale),
  };
}
