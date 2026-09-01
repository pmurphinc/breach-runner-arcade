/**
 * The multi-portal model.
 *
 * Classic Wormhole gives every pilot a portal: all of them visible, all of them
 * shootable by anyone, each banking its own damage. This is that model, and it
 * is tested here rather than through the game loop because the loop still owns
 * exactly one rift — the read sites migrate alongside the mode that needs them.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ARENA_SIZES, DEFAULT_ARENA, squareArena } from "../app/arena.ts";
import {
  PORTAL_ORBIT_DEGREES_PER_TICK,
  PORTAL_ORBIT_RADII,
  PORTAL_THRESHOLD,
  advancePortal,
  arenaCentre,
  chargePortal,
  createPortal,
  createPortalRing,
  isPortalWarpedIn,
  nearestPortal,
  portalBreadcrumbs,
  portalOrbitRadius,
  rivalPortals,
  stepPortalWarpIn,
} from "../app/portals.ts";

const arena = squareArena(ARENA_SIZES.duel);

test("the reference constants are unchanged", () => {
  assert.equal(PORTAL_THRESHOLD, 150);
  assert.equal(PORTAL_ORBIT_DEGREES_PER_TICK, 0.5);
  assert.deepEqual(PORTAL_ORBIT_RADII, { 873: 150, 1310: 240, 1572: 280 });
});

test("orbit radius follows the arena band", () => {
  assert.equal(portalOrbitRadius(squareArena(873)), 150);
  assert.equal(portalOrbitRadius(squareArena(1310)), 240);
  assert.equal(portalOrbitRadius(squareArena(1572)), 280);
  // An arena outside the named bands still gets a proportional ring rather
  // than undefined.
  const other = portalOrbitRadius(DEFAULT_ARENA);
  assert.ok(Number.isFinite(other) && other > 0);
});

test("a portal warps in from the centre and stops at its orbit", () => {
  let portal = createPortal(0, "alice", arena, 0);
  const centre = arenaCentre(arena);
  assert.equal(portal.warpRadius, 0);
  assert.deepEqual({ x: portal.x, y: portal.y }, centre, "it starts stacked on the centre");
  assert.ok(!isPortalWarpedIn(portal));

  let steps = 0;
  while (!isPortalWarpedIn(portal) && steps < 500) {
    const previous = portal.warpRadius;
    portal = stepPortalWarpIn(portal, arena);
    assert.ok(portal.warpRadius > previous, "each step must make progress");
    steps += 1;
  }
  assert.ok(isPortalWarpedIn(portal), "the warp-in must finish");
  assert.equal(portal.warpRadius, portal.orbitRadius, "and never overshoot");
  // Stepping an arrived portal is a no-op rather than pushing it past its ring.
  assert.deepEqual(stepPortalWarpIn(portal, arena), portal);
});

test("orbiting moves the portal without changing its radius", () => {
  let portal = createPortal(0, "alice", arena, 0);
  while (!isPortalWarpedIn(portal)) portal = stepPortalWarpIn(portal, arena);
  const centre = arenaCentre(arena);
  const before = portal.angle;

  portal = advancePortal(portal, arena);
  assert.equal(portal.angle, before + PORTAL_ORBIT_DEGREES_PER_TICK);
  const distance = Math.hypot(portal.x - centre.x, portal.y - centre.y);
  assert.ok(Math.abs(distance - portal.orbitRadius) < 0.001, "orbit is a circle, not a spiral");
});

test("the orbit wraps rather than growing without bound", () => {
  let portal = createPortal(0, "alice", arena, 359.75);
  portal = advancePortal(portal, arena);
  assert.ok(portal.angle < 360);
  assert.ok(portal.angle >= 0);
});

test("a portal sheds one power-up per threshold, and banks the rest", () => {
  const portal = createPortal(0, "alice", arena, 0);
  const under = chargePortal(portal, PORTAL_THRESHOLD - 1);
  assert.equal(under.bloomed, false);
  assert.equal(under.portal.charge, PORTAL_THRESHOLD - 1);

  const over = chargePortal(under.portal, 2);
  assert.equal(over.bloomed, true);
  assert.equal(over.portal.charge, 0, "the counter resets rather than carrying over");
});

test("one enormous hit sheds one power-up, not a shower", () => {
  const portal = createPortal(0, "alice", arena, 0);
  const huge = chargePortal(portal, PORTAL_THRESHOLD * 40);
  assert.equal(huge.bloomed, true);
  assert.equal(huge.portal.charge, 0);
});

test("negative damage cannot drain a portal's banked charge", () => {
  const portal = { ...createPortal(0, "alice", arena, 0), charge: 90 };
  assert.equal(chargePortal(portal, -500).portal.charge, 90);
});

test("a ring gives every pilot a portal, evenly spaced", () => {
  const portals = createPortalRing(["alice", "bob", "cara", "dan"], arena);
  assert.equal(portals.length, 4);
  assert.deepEqual(portals.map((portal) => portal.ownerId), ["alice", "bob", "cara", "dan"]);
  assert.deepEqual(portals.map((portal) => portal.angle), [0, 90, 180, 270]);
  // Even spacing is what makes a free-for-all fair: nobody starts nearer a
  // rival's portal than anyone else.
  assert.equal(new Set(portals.map((portal) => portal.id)).size, 4);
  assert.deepEqual(createPortalRing([], arena), []);
});

test("attacks land in a rival's portal, never your own", () => {
  const portals = createPortalRing(["alice", "bob", "cara"], arena);
  const rivals = rivalPortals(portals, "alice");
  assert.equal(rivals.length, 2);
  assert.ok(!rivals.some((portal) => portal.ownerId === "alice"));
});

test("the nearest portal resolves what a shot hit", () => {
  const portals = createPortalRing(["alice", "bob"], arena).map((portal) => {
    let warped = portal;
    while (!isPortalWarpedIn(warped)) warped = stepPortalWarpIn(warped, arena);
    return warped;
  });
  const target = portals[1];
  const hit = nearestPortal(portals, target.x + 3, target.y - 4);
  assert.equal(hit.ownerId, target.ownerId);
  assert.equal(nearestPortal([], 0, 0), null);
});

test("breadcrumbs point from the centre at an off-screen portal", () => {
  let portal = createPortal(0, "bob", arena, 45);
  while (!isPortalWarpedIn(portal)) portal = stepPortalWarpIn(portal, arena);
  const trail = portalBreadcrumbs(portal, arena);
  const centre = arenaCentre(arena);

  assert.ok(trail.length > 1, "a trail, not a single dot");
  // Each dot is further out than the last, and none reaches the portal itself.
  let previous = 0;
  for (const dot of trail) {
    const distance = Math.hypot(dot.x - centre.x, dot.y - centre.y);
    assert.ok(distance > previous, "dots must march outward");
    assert.ok(distance < portal.orbitRadius, "the trail stops short of the portal");
    previous = distance;
  }
  // A larger arena earns a longer trail rather than a sparser one.
  let big = createPortal(0, "bob", squareArena(ARENA_SIZES.melee), 45);
  while (!isPortalWarpedIn(big)) big = stepPortalWarpIn(big, squareArena(ARENA_SIZES.melee));
  assert.ok(portalBreadcrumbs(big, squareArena(ARENA_SIZES.melee)).length > trail.length);
});

test("a portal mid warp-in trails only as far as it has travelled", () => {
  const portal = stepPortalWarpIn(createPortal(0, "bob", arena, 0), arena);
  const centre = arenaCentre(arena);
  for (const dot of portalBreadcrumbs(portal, arena)) {
    assert.ok(Math.hypot(dot.x - centre.x, dot.y - centre.y) <= portal.warpRadius);
  }
});
