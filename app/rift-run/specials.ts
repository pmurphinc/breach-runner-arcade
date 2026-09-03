/**
 * The Special abilities a Rift Run can unlock.
 *
 * A Rift Run starts with no Special at all. Unlocking one is meant to be a
 * landmark in the run's development, and the ability the pilot picks is a
 * large part of what the finished ship turns out to be — so the roster offered
 * here is the game's real, shipped set rather than a second vocabulary
 * invented for this mode. Each entry names the fleet frame whose ability
 * implementation it borrows, and the loop dispatches on *that* id rather than
 * on the hull the pilot is flying.
 *
 * FORM SHIFT is deliberately absent. It swaps Switchback between two of
 * Switchback's own handling profiles, so on any other frame it either does
 * nothing or silently replaces the run's earned thruster tuning. An ability
 * that cannot be given to a different hull is not a Rift Run Special.
 */

import { SHIP_SPECIALS, type ShipId } from "../game-data.ts";

export type RiftSpecialOption = {
  /** The frame whose ability implementation this is. Also the dispatch key. */
  shipId: ShipId;
  name: string;
  /** One line, in the same register as the hull-gun picker's role lines. */
  summary: string;
};

const OPTIONS: ReadonlyArray<[ShipId, string]> = [
  ["tank", "Three seconds of collision immunity"],
  ["wing", "Twelve homing trackers, then an afterburn"],
  ["squid", "A four-second beam that destroys what it touches"],
  ["hunter", "Detonates on the hull, gutting nearby hostiles"],
  ["flagship", "Pulls in pickups and shoves hostiles away"],
  ["turtle", "Clears nearby threats at a cost to your hull"],
  ["rabbit", "Steers your launched payloads into the rift"],
  ["kestrel", "Cannon rounds collect loose PUPs on impact"],
  ["warden", "The cannon fires a tight three-shot barrage"],
];

export const RIFT_RUN_SPECIALS: readonly RiftSpecialOption[] = OPTIONS.map(([shipId, summary]) => ({
  shipId,
  name: SHIP_SPECIALS[shipId].name,
  summary,
}));

export const RIFT_RUN_SPECIAL_IDS: readonly ShipId[] = RIFT_RUN_SPECIALS.map(({ shipId }) => shipId);

export function riftRunSpecial(shipId: ShipId): RiftSpecialOption | undefined {
  return RIFT_RUN_SPECIALS.find((option) => option.shipId === shipId);
}

export function isRiftRunSpecial(shipId: unknown): shipId is ShipId {
  return typeof shipId === "string" && RIFT_RUN_SPECIAL_IDS.includes(shipId as ShipId);
}
