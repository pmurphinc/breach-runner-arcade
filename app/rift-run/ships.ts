/**
 * The finished fleet, as Rift Run build archetypes.
 *
 * These ten were the mode's starting choices. They are not any more — every
 * run begins on the same stripped starter frame — but they remain useful as
 * *destinations*: recognisable configurations a build can grow toward, and the
 * reference the lobby uses to say what kind of ship a run might end up as. The
 * class and socket counts here describe the finished ship, not a constraint on
 * a run; nothing in `app/rift-run/state.ts` reads them any more.
 *
 * Hybrids are the point. A heavy hull with Scrambler, a railgun, a flamethrower
 * and a heavily upgraded main cannon is a legitimate ship matching no preset.
 */
import { SHIPS, SHIP_SPECIALS, type ShipId } from "../game-data.ts";
import { RIFT_SHIP_CLASSES } from "./data.ts";
import type { RiftShipClass } from "./types.ts";

export type RiftRunShip = {
  id: ShipId;
  name: string;
  shipClass: RiftShipClass;
  maximumHardpoints: 1 | 2 | 3;
  abilityName: string;
};

const fleet: ReadonlyArray<[ShipId, RiftShipClass, string?]> = [
  ["tank", "heavy"],
  ["wing", "light"],
  ["squid", "medium", "SCRAMBLER OVERCHARGE"],
  ["rabbit", "light"],
  ["turtle", "heavy"],
  ["flash", "medium"],
  ["hunter", "medium"],
  ["flagship", "heavy"],
  ["kestrel", "light"],
  ["warden", "medium"],
];

export const RIFT_RUN_SHIPS: readonly RiftRunShip[] = fleet.map(([id, shipClass, abilityName]) => {
  const ship = SHIPS.find((candidate) => candidate.id === id);
  if (!ship) throw new Error(`Missing canonical ship data for ${id}`);
  return {
    id,
    name: ship.name,
    shipClass,
    maximumHardpoints: RIFT_SHIP_CLASSES[shipClass].maximumHardpoints,
    abilityName: abilityName ?? SHIP_SPECIALS[id].name,
  };
});

export const RIFT_RUN_SHIP_IDS = RIFT_RUN_SHIPS.map(({ id }) => id);

export function riftRunShip(id: ShipId): RiftRunShip | undefined {
  return RIFT_RUN_SHIPS.find((ship) => ship.id === id);
}

/**
 * The three archetypes the design names, for the lobby's build briefing.
 *
 * Deliberately not a picker and deliberately not exhaustive: they are examples
 * of what a finished Rift Run ship can look like, shown so a new pilot has
 * some idea what they are building toward before their first upgrade screen.
 */
export const RIFT_RUN_ARCHETYPES: ReadonlyArray<{ id: ShipId; label: string; summary: string }> = [
  { id: "tank", label: "Ironclad-type", summary: "Heavy durability, multiple hull weapons, Impact Guard, lower mobility." },
  { id: "wing", label: "Starling-type", summary: "High mobility, lightweight weapons, Swarm Overcharge, lower durability." },
  { id: "squid", label: "Phantom-type", summary: "Medium handling, disruption equipment, balanced weapons." },
];
