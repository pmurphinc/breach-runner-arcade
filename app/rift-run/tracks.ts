/**
 * The tiered upgrade ladders.
 *
 * Four of the five systems progress along a ladder with a fixed top: payload
 * slots I→V, cannon I→V, thrusters I→V, and the Special — locked, unlocked,
 * then I→III. Hull sockets are the fifth ladder, capped at
 * `RIFT_RUN_MAX_SOCKETS`.
 *
 * Every function here returns *at most one* card, and returns none the moment
 * the ladder is finished. That is the whole point: the pool must never spend
 * one of the pilot's three choices on something they cannot use — never a
 * maxed track, never a sixth payload slot, and never a second UNLOCK SPECIAL
 * once a Special has been chosen. Encoding the rule in the producer rather
 * than filtering afterwards means there is exactly one place it can be wrong.
 */

import {
  RIFT_RUN_MAX_CANNON_TIER,
  RIFT_RUN_MAX_PAYLOAD_SLOTS,
  RIFT_RUN_MAX_SOCKETS,
  RIFT_RUN_MAX_SPECIAL_TIER,
  RIFT_RUN_MAX_THRUSTER_TIER,
  cannonMarkForTier,
  tierNumeral,
  thrusterMarkForTier,
} from "./loadout.ts";
import { riftRunSpecial } from "./specials.ts";
import { availableHardpointIndexes, nextLockedHardpointIndex } from "./state.ts";
import type { UpgradeChoice } from "./upgrades.ts";
import type { RiftRunState } from "./types.ts";

const card = (
  track: NonNullable<UpgradeChoice["track"]>,
  system: UpgradeChoice["system"],
  gameplayCategory: UpgradeChoice["gameplayCategory"],
  title: string,
  target: string,
  description: string,
): UpgradeChoice => ({ key: track, upgradeId: track, system, gameplayCategory, track, title, target, description });

/** PAYLOAD SLOT II…V. Leaves the pool for good at the shared five-slot cap. */
export function payloadTrackChoice(state: RiftRunState): UpgradeChoice | null {
  const next = state.loadout.payloadSlots + 1;
  if (next > RIFT_RUN_MAX_PAYLOAD_SLOTS) return null;
  return card(
    "payload-slot",
    "payload",
    "defensive",
    `PAYLOAD SLOT ${tierNumeral(next)}`,
    `${state.loadout.payloadSlots} → ${next} SLOTS`,
    "Carry one more payload PUP before the bin overflows.",
  );
}

/**
 * CANNON II…V.
 *
 * The first three steps advance the cannon's mark, which changes the shots
 * themselves — count, damage and colour — and the fourth pays out as raw
 * damage and fire rate once the mark is at its ceiling. Both are stated on the
 * card so the last step never reads as a dud.
 */
export function cannonTrackChoice(state: RiftRunState): UpgradeChoice | null {
  const next = state.loadout.cannonTier + 1;
  if (next > RIFT_RUN_MAX_CANNON_TIER) return null;
  const mark = cannonMarkForTier(next);
  const advances = mark > cannonMarkForTier(state.loadout.cannonTier);
  return card(
    "cannon-tier",
    "cannon",
    "offensive",
    `CANNON ${tierNumeral(next)}`,
    `MAIN CANNON · MK${mark + 1}`,
    advances
      ? `Advance the main cannon to mark ${mark + 1}, with more damage and a faster cycle.`
      : "Push the main cannon past its mark: more damage and a faster cycle.",
  );
}

/**
 * THRUSTERS II…V.
 *
 * The first step is the one that has to land hardest — it takes the frame off
 * mark zero and hands it reverse thrust, which the starter deliberately does
 * not have.
 */
export function thrusterTrackChoice(state: RiftRunState): UpgradeChoice | null {
  const next = state.loadout.thrusterTier + 1;
  if (next > RIFT_RUN_MAX_THRUSTER_TIER) return null;
  const mark = thrusterMarkForTier(next);
  const firstMark = thrusterMarkForTier(state.loadout.thrusterTier) === 0 && mark > 0;
  return card(
    "thruster-tier",
    "thrusters",
    "mobility",
    `THRUSTERS ${tierNumeral(next)}`,
    `ENGINES · MK${mark + 1}`,
    firstMark
      ? "Bring the engines online: faster, sharper handling, and reverse thrust."
      : "More acceleration, more top speed, sharper turns.",
  );
}

/**
 * UNLOCK SPECIAL, then SPECIAL II and III.
 *
 * Exactly one card either way, and none once the Special is at tier three.
 * While a Special unlock is waiting to be spent — the pilot has taken the card
 * but not yet picked which ability — the system offers nothing, so the choice
 * in front of them cannot be pre-empted by another one.
 */
export function specialTrackChoice(state: RiftRunState): UpgradeChoice | null {
  if (state.pendingSpecialChoice) return null;
  const special = state.loadout.special;
  if (!special) {
    return card(
      "special-unlock",
      "special",
      "offensive",
      "UNLOCK SPECIAL",
      "SPECIAL ABILITY",
      "Install a Special ability and choose which one.",
    );
  }
  const next = special.tier + 1;
  if (next > RIFT_RUN_MAX_SPECIAL_TIER) return null;
  const name = riftRunSpecial(special.shipId)?.name ?? "SPECIAL";
  return card(
    "special-tier",
    "special",
    "offensive",
    `SPECIAL ${tierNumeral(next)}`,
    name,
    "Shorten the Special's cooldown so it comes back sooner.",
  );
}

/**
 * HULL SOCKET II…III, as an earned choice.
 *
 * Sockets used to be handed out purely by breach count and capped by the ship
 * class you picked in the menu. Breaches still open the first one — arriving
 * at a hull gun without spending an upgrade is a good early beat — but past
 * that a socket is something the pilot chooses over a cannon mark or a payload
 * slot, which is what makes a three-gun build cost something.
 *
 * Never sold while an opened socket is still empty. An empty socket is already
 * a decision the pilot owes; a second one would spend a pick to deepen a debt
 * rather than to gain anything.
 */
export function socketTrackChoice(state: RiftRunState): UpgradeChoice | null {
  if (availableHardpointIndexes(state).length > 0) return null;
  const index = nextLockedHardpointIndex(state);
  if (index === null || index >= RIFT_RUN_MAX_SOCKETS) return null;
  return card(
    "socket-unlock",
    "hull",
    "offensive",
    `HULL SOCKET ${tierNumeral(index + 1)}`,
    `HARDPOINT ${index + 1}`,
    "Cut a new hull hardpoint and mount a weapon in it.",
  );
}

/** Every ladder card currently worth offering, in system order. */
export function trackChoices(state: RiftRunState): UpgradeChoice[] {
  return [
    payloadTrackChoice(state),
    cannonTrackChoice(state),
    thrusterTrackChoice(state),
    specialTrackChoice(state),
    socketTrackChoice(state),
  ].filter((choice): choice is UpgradeChoice => choice !== null);
}
