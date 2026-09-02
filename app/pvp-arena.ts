/**
 * The shared PvP arena.
 *
 * Until now a duel was a correspondence game: two clients each simulated their
 * own private mirror of the world and traded abstract damage across it. Nothing
 * either pilot did was ever in the same room as the other. This module holds
 * the geometry and the small pure rules that make one arena hold two pilots,
 * so all of it is assertable without a canvas or a socket.
 *
 * ## Sides are identity, not role
 *
 * Which half of the arena a pilot occupies is decided by comparing the two
 * player ids, never by who happens to be simulating. That matters because the
 * arena host can change mid-match: if host migration moved the portals, a host
 * dropping out would teleport both pilots' rifts across the board. Comparing
 * ids is stable, needs no extra wire field, and both clients necessarily agree
 * because they compare the same pair.
 *
 * ## What the host owns and what it does not
 *
 * The host simulates hostiles and resolves pilot-bullet against pilot-hull. It
 * never asserts a hull value: every hit it resolves is reported through the
 * ordinary `damage` message, so `server/rules.mjs` still applies the shield,
 * subtracts the hull and decides the result. The host is an authority on
 * geometry only.
 */

import type { ArenaSize } from "./arena";

/** Which half of the arena a pilot flies from. */
export type PvpSide = "left" | "right";

/** Whether this client is the one simulating the shared world. */
export type PvpAuthority = "host" | "guest";

/**
 * Fallback orbit radius, for a ruleset that locks its rift.
 *
 * PvP's own ruleset orbits deliberately — a locked rift is a stationary target,
 * and both pilots are shooting the same kind of objective — so in practice the
 * ring radius comes from the ruleset and this is only the floor under it.
 */
export const PVP_PORTAL_RADIUS = 240;

/**
 * Ring phase offset, in degrees, that each side's portal occupies.
 *
 * Opposed by construction, so however far the shared ring has turned the two
 * rifts are always exactly across the arena from each other.
 */
export const PVP_SIDE_ANGLES: Record<PvpSide, number> = { left: 180, right: 0 };

/**
 * Distance from the centre a pilot starts at.
 *
 * Just outside the portal ring, so a duel opens with each pilot behind their
 * own rift rather than sitting on top of it. Deliberately not further: a wider
 * split put the two pilots more than a screen apart on the first frame, and a
 * duel that opens with an empty board does not read as a duel.
 */
export const PVP_SPAWN_RADIUS = 360;

/**
 * Hit radius for a cannon round against a pilot hull.
 *
 * Two pixels more forgiving than the hostile-projectile check, because the
 * rival transform the host tests against arrives on the 33ms position stream
 * rather than being simulated locally.
 */
export const PVP_PILOT_HIT_RADIUS = 15;

/**
 * Ticks of immunity the host grants a rival it has just hit.
 *
 * Mirrors the local post-hit invulnerability exactly. Without it a duel would
 * be decided by whoever fires first — and the host would burn its whole
 * server-side damage window in a fraction of a second.
 */
export const PVP_RIVAL_INVULN_TICKS = 24;

/** Rounds one volley may carry. Suppression Barrage is the widest spread. */
export const MAX_PVP_SHOTS_PER_VOLLEY = 8;

/** Ticks between world snapshots. Shared with co-op, which uses the same relay. */
export const PVP_WORLD_INTERVAL_TICKS = 6;

/**
 * The half of the arena this pilot flies from.
 *
 * Deterministic and symmetric: the two clients compare the same pair of ids
 * and necessarily reach opposite answers. An unknown opponent yields "left" so
 * the pre-match preview has a board to draw rather than an undefined one.
 */
export function pvpSide(youId: string | null | undefined, opponentId: string | null | undefined): PvpSide {
  if (!youId || !opponentId) return "left";
  return youId < opponentId ? "left" : "right";
}

export function rivalSide(side: PvpSide): PvpSide {
  return side === "left" ? "right" : "left";
}

/** True when this client is the arena host. Mirrors co-op's "first player hosts". */
export function pvpAuthority(youId: string | null | undefined, hostId: string | null | undefined): PvpAuthority {
  return Boolean(youId) && youId === hostId ? "host" : "guest";
}

function pointOnRing(arena: ArenaSize, degrees: number, radius: number) {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: arena.width / 2 + Math.cos(radians) * radius,
    y: arena.height / 2 + Math.sin(radians) * radius,
  };
}

/**
 * The orbit phase a side's portal is at, given how far the shared ring has turned.
 *
 * One phase drives both rifts. That is what lets the whole ring be described by
 * the single `portalAngle` the world relay already carries: the host advances
 * it, the guest applies it, and each of them derives both positions.
 */
export function pvpPortalAngle(side: PvpSide, ringAngle: number): number {
  return (((ringAngle + PVP_SIDE_ANGLES[side]) % 360) + 360) % 360;
}

/** Where a side's portal sits on the shared ring. */
export function pvpPortalPoint(
  side: PvpSide,
  arena: ArenaSize,
  ringAngle = 0,
  radius = PVP_PORTAL_RADIUS
) {
  return pointOnRing(arena, pvpPortalAngle(side, ringAngle), radius);
}

/** Where a side's pilot starts, behind their own portal. */
export function pvpSpawnPoint(side: PvpSide, arena: ArenaSize) {
  return pointOnRing(arena, PVP_SIDE_ANGLES[side], PVP_SPAWN_RADIUS);
}

/**
 * One cannon round crossing the wire.
 *
 * Relayed as a spawn event rather than as a per-frame position, and simulated
 * locally by the receiver. A round has no steering, so both machines integrate
 * it identically — and the receiver gets a smooth line of fire instead of a
 * round that teleports once per snapshot.
 */
export type PvpShot = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  life: number;
  color: string;
};

/** One tick of a relayed round. Mutates in place, like the local bullet loop. */
export function advancePvpShot(shot: PvpShot): PvpShot {
  shot.x += shot.vx;
  shot.y += shot.vy;
  shot.life -= 1;
  return shot;
}

/** Same lifetime rule the local bullet compaction uses. */
export function pvpShotAlive(shot: PvpShot, arena: ArenaSize): boolean {
  return (
    shot.life > 0 &&
    shot.x > -30 &&
    shot.x < arena.width + 30 &&
    shot.y > -30 &&
    shot.y < arena.height + 30
  );
}

/** Whether a round has reached a pilot hull. */
export function pvpShotHitsPilot(
  shot: { x: number; y: number },
  pilot: { x: number; y: number },
  radius = PVP_PILOT_HIT_RADIUS
): boolean {
  return Math.hypot(shot.x - pilot.x, shot.y - pilot.y) < radius;
}

/**
 * A destroyed pilot's portal leaves the arena.
 *
 * Pure and non-mutating so the caller can run it every tick without caring
 * whether it has already happened.
 */
export function dropPortalsOwnedBy<T extends { ownerId: string }>(
  portals: readonly T[],
  ownerId: string
): T[] {
  return portals.filter((portal) => portal.ownerId !== ownerId);
}
