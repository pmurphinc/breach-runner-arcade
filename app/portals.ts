/**
 * Portals as a list rather than a single rift.
 *
 * Breach Runner has always had exactly one rift, so its position, orbit phase
 * and damage accumulator live as flat fields on the game. Classic Wormhole needs
 * one portal per pilot — every one visible, every one shootable by anyone, each
 * accumulating its own damage and shedding its own power-ups — and PvP needs at
 * least two before a duel can happen at all.
 *
 * This is the model for that. It is deliberately pure: a portal is data plus the
 * handful of rules that move it, so the whole system is testable without a
 * canvas, and the game loop keeps ownership of when those rules run.
 *
 * ## Why not rename everything at once
 *
 * The game reads a flat `portalX` / `portalY` in roughly sixty places, and every
 * one of them means "the rift this pilot is shooting". Rewriting them all before
 * a second portal exists would be a large blind diff with nothing to validate it
 * against. So the list is the model, portal zero is the rift the game already
 * had, and the migration of the read sites happens alongside the mode that
 * actually needs them.
 */

import type { ArenaSize } from "./arena";

/** Cannon damage a portal absorbs per power-up shed, before escalation. */
export const PORTAL_THRESHOLD = 150;

/** Degrees of orbit per tick. Every portal in an arena shares one rate. */
export const PORTAL_ORBIT_DEGREES_PER_TICK = 0.5;

/**
 * Orbit radius by arena side.
 *
 * Paired with the square arena bands: a bigger board pushes the portals further
 * out, so the ring of portals stays proportional to the space rather than
 * huddling in the middle of a large arena.
 */
export const PORTAL_ORBIT_RADII = { 873: 150, 1310: 240, 1572: 280 } as const;

/** The orbit radius for an arena, falling back proportionally for other sizes. */
export function portalOrbitRadius(arena: ArenaSize): number {
  const side = Math.min(arena.width, arena.height);
  const known = PORTAL_ORBIT_RADII[side as keyof typeof PORTAL_ORBIT_RADII];
  if (known) return known;
  // Between and beyond the named bands, hold the same share of the board that
  // the smallest band uses, so an arbitrary arena still looks deliberate.
  return Math.round(side * (PORTAL_ORBIT_RADII[873] / 873));
}

export type Portal = {
  id: number;
  /** Whose portal this is. Attacks launched into it are credited against them. */
  ownerId: string;
  /** Current orbit phase in degrees. */
  angle: number;
  /** Distance from the arena centre once fully warped in. */
  orbitRadius: number;
  /** Cannon damage banked toward the next power-up. */
  charge: number;
  /** Damage required to shed one power-up. Escalation moves this. */
  threshold: number;
  /**
   * How far out the portal has warped so far, from 0 at the arena centre to
   * orbitRadius. A portal is not shootable until it arrives.
   */
  warpRadius: number;
  x: number;
  y: number;
};

export function arenaCentre(arena: ArenaSize) {
  return { x: arena.width / 2, y: arena.height / 2 };
}

/** Where a portal sits, given its phase and how far it has warped out. */
export function portalPosition(portal: Portal, arena: ArenaSize) {
  const centre = arenaCentre(arena);
  const radians = (portal.angle * Math.PI) / 180;
  return {
    x: centre.x + Math.cos(radians) * portal.warpRadius,
    y: centre.y + Math.sin(radians) * portal.warpRadius,
  };
}

/**
 * A portal, mid warp-in at the arena centre.
 *
 * Portals arrive rather than appear: they expand out of the centre to their
 * orbit. `warpRadius` starts at zero, so a freshly created portal is stacked on
 * the centre with every other one and separates as they travel out.
 */
export function createPortal(
  id: number,
  ownerId: string,
  arena: ArenaSize,
  angle: number,
  threshold = PORTAL_THRESHOLD
): Portal {
  const centre = arenaCentre(arena);
  return {
    id,
    ownerId,
    angle,
    orbitRadius: portalOrbitRadius(arena),
    charge: 0,
    threshold,
    warpRadius: 0,
    x: centre.x,
    y: centre.y,
  };
}

/**
 * One portal per owner, evenly spaced around the ring.
 *
 * Even spacing is what makes a free-for-all fair: no pilot starts closer to a
 * rival's portal than anyone else does.
 */
export function createPortalRing(owners: readonly string[], arena: ArenaSize, threshold = PORTAL_THRESHOLD): Portal[] {
  return owners.map((ownerId, index) =>
    createPortal(index, ownerId, arena, (index / Math.max(1, owners.length)) * 360, threshold)
  );
}

/**
 * Advance the warp-in.
 *
 * Eases out: the step is a third of the distance left, floored so it always
 * finishes rather than approaching the orbit forever.
 */
export function stepPortalWarpIn(portal: Portal, arena: ArenaSize): Portal {
  if (portal.warpRadius >= portal.orbitRadius) return portal;
  const remaining = portal.orbitRadius - portal.warpRadius;
  const warpRadius = Math.min(portal.orbitRadius, portal.warpRadius + Math.max(6, remaining / 3));
  const moved = { ...portal, warpRadius };
  return { ...moved, ...portalPosition(moved, arena) };
}

export function isPortalWarpedIn(portal: Portal): boolean {
  return portal.warpRadius >= portal.orbitRadius;
}

/** Advance one portal's orbit by the shared rate and reposition it. */
export function advancePortal(portal: Portal, arena: ArenaSize, degreesPerTick = PORTAL_ORBIT_DEGREES_PER_TICK): Portal {
  const spun = { ...portal, angle: (portal.angle + degreesPerTick) % 360 };
  return { ...spun, ...portalPosition(spun, arena) };
}

/**
 * Bank cannon damage against a portal.
 *
 * Returns whether the portal shed a power-up. The counter resets to zero rather
 * than carrying the remainder, which is what keeps the threshold meaningful: a
 * single enormous hit sheds one power-up, not a shower of them.
 */
export function chargePortal(portal: Portal, damage: number): { portal: Portal; bloomed: boolean } {
  const charge = portal.charge + Math.max(0, damage);
  if (charge <= portal.threshold) return { portal: { ...portal, charge }, bloomed: false };
  return { portal: { ...portal, charge: 0 }, bloomed: true };
}

/**
 * Breadcrumbs from the arena centre toward a portal.
 *
 * A scrolling camera in a large arena leaves rival portals off-screen with no
 * indication of where they are. A trail of dots from the centre outward points
 * at each one; the count scales with the orbit so a bigger board gets a longer
 * trail rather than a sparser one.
 */
export function portalBreadcrumbs(portal: Portal, arena: ArenaSize): { x: number; y: number }[] {
  const centre = arenaCentre(arena);
  const count = Math.max(1, Math.round(portal.orbitRadius / 35));
  const radians = (portal.angle * Math.PI) / 180;
  return Array.from({ length: count }, (_, index) => {
    const distance = (portal.warpRadius * (index + 1)) / (count + 1);
    return {
      x: centre.x + Math.cos(radians) * distance,
      y: centre.y + Math.sin(radians) * distance,
    };
  });
}

/** The portal a launched attack should land in: a rival's, never your own. */
export function rivalPortals(portals: readonly Portal[], ownerId: string): Portal[] {
  return portals.filter((portal) => portal.ownerId !== ownerId);
}

/** The portal nearest a point, for resolving what a shot actually hit. */
export function nearestPortal(portals: readonly Portal[], x: number, y: number): Portal | null {
  let best: Portal | null = null;
  let bestDistance = Infinity;
  for (const portal of portals) {
    const distance = Math.hypot(portal.x - x, portal.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = portal;
    }
  }
  return best;
}
