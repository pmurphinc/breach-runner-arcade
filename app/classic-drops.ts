/**
 * Classic Wormhole's power-up drop table.
 *
 * This is what makes the early game feel like the original rather than like
 * Breach Runner with an orbiting rift: mostly attacks, self-buffs that stop
 * appearing once you already have them, and a table that shifts as the match
 * ages so a long game stops handing out invulnerability and starts handing out
 * ordnance.
 *
 * Reimplemented from observed behaviour. The pickup catalogue already happens to
 * be in the reference order — six self-buffs, then fourteen launchable attacks —
 * so the index arithmetic below lines up without a translation table.
 *
 * Pure, with the clock and the RNG injected, because a probability table that
 * cannot be run deterministically cannot be verified at all.
 */

import { INSTANT_PICKUPS, SENDABLE_POWERUPS, type PickupId } from "./game-data.ts";

/** Indices, in the reference's numbering. */
const GUN = 0;
const THRUST = 1;
const RETROS = 2;
const INVULNERABILITY = 3;
const ZAP = 4;
const HEALTH = 5;
const HEAT_SEEKER = 6;
const TURRET = 7;
const NUKE = 14;

/** The first launchable index. Everything below it is a self-buff. */
const FIRST_ATTACK = 6;

/**
 * How many attacks the table draws from.
 *
 * The reference withholds its last three behind a subscription; the equivalent
 * here is a table setting rather than a paywall, and the default is the full
 * roster because there is nothing to sell.
 */
const BASE_ATTACK_COUNT = 11;
const ALL_ATTACK_COUNT = 14;

/** Match ages, in milliseconds, at which the table changes what it offers. */
export const CLASSIC_DROP_GATES = { health: 60_000, invulnerability: 80_000, lateGame: 120_000 } as const;

/** One in three drops is a self-buff; the rest are ordnance. */
export const CLASSIC_SELF_BUFF_CHANCE = 1 / 3;

export type ClassicDropState = {
  /** Upgrades already at their ceiling are re-rolled rather than wasted. */
  gunMaxed: boolean;
  thrustMaxed: boolean;
  retrosMaxed: boolean;
  /** How long this match has been running. */
  elapsedMs: number;
  /** Whether the last three attacks are in the table. */
  allPowerups?: boolean;
};

export type RandomSource = () => number;

function pickupForIndex(index: number): PickupId {
  if (index < FIRST_ATTACK) return INSTANT_PICKUPS[index];
  return SENDABLE_POWERUPS[index - FIRST_ATTACK];
}

/**
 * Bounded so a pathological RNG cannot hang the game loop.
 *
 * The reference spins until it finds a usable roll. In practice it always
 * terminates — the three time-gated cases accept unconditionally — but "always
 * terminates in practice" is not a property worth betting a frame on, so this
 * gives up after a generous number of attempts and takes the health slot, which
 * is never maxed out.
 */
const MAX_REROLLS = 64;

function rollSelfBuff(state: ClassicDropState, random: RandomSource): number {
  const maxed = [state.gunMaxed, state.thrustMaxed, state.retrosMaxed];
  for (let attempt = 0; attempt < MAX_REROLLS; attempt += 1) {
    const index = Math.floor(random() * 6);
    switch (index) {
      case GUN:
      case THRUST:
      case RETROS:
        // An upgrade already at its ceiling is not a reward. Roll again.
        if (!maxed[index]) return index;
        break;
      case INVULNERABILITY:
        // Late on, a shield is worth less than something to throw.
        if (state.elapsedMs > CLASSIC_DROP_GATES.lateGame) return HEAT_SEEKER;
        // Three times in four past the middle gate, it becomes a nuke instead.
        if (state.elapsedMs > CLASSIC_DROP_GATES.invulnerability && Math.floor(random() * 4) !== 0) return NUKE;
        return INVULNERABILITY;
      case ZAP:
        if (state.elapsedMs > CLASSIC_DROP_GATES.lateGame) return TURRET;
        return ZAP;
      case HEALTH:
        if (state.elapsedMs > CLASSIC_DROP_GATES.health) return NUKE;
        return HEALTH;
      default:
        break;
    }
  }
  return HEALTH;
}

function rollAttack(state: ClassicDropState, random: RandomSource): number {
  const count = state.allPowerups === false ? BASE_ATTACK_COUNT : ALL_ATTACK_COUNT;
  const draw = () => FIRST_ATTACK + Math.floor(random() * count);
  const index = draw();
  // A rolled nuke gets one re-roll on a coin flip, which halves its rate
  // without removing it. It is the strongest thing in the table and a uniform
  // draw would put one in play far too often.
  if (index === NUKE && Math.floor(random() * 2) === 0) return draw();
  return index;
}

/**
 * Roll one power-up for a portal that has just been shot enough to shed one.
 */
export function rollClassicDrop(state: ClassicDropState, random: RandomSource = Math.random): PickupId {
  const index = random() < CLASSIC_SELF_BUFF_CHANCE ? rollSelfBuff(state, random) : rollAttack(state, random);
  return pickupForIndex(index);
}

/** The pickups Classic's table can produce, for tests and the codex. */
export function classicDropCatalogue(allPowerups = true): PickupId[] {
  const attacks = allPowerups ? ALL_ATTACK_COUNT : BASE_ATTACK_COUNT;
  return [
    ...INSTANT_PICKUPS.slice(0, 6),
    ...SENDABLE_POWERUPS.slice(0, attacks),
  ];
}
