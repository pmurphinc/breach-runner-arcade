/**
 * The shared PvP arena's geometry and its small pure rules.
 *
 * A duel used to be a correspondence game: two clients each simulated a private
 * mirror and traded abstract damage across it. Everything asserted here is what
 * makes one arena hold two pilots instead — and all of it is pure, so it is
 * tested directly rather than by reading `game.tsx` as text.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PVP_SHOTS_PER_VOLLEY,
  PVP_PILOT_HIT_RADIUS,
  PVP_PORTAL_RADIUS,
  PVP_RIVAL_INVULN_TICKS,
  PVP_SIDE_ANGLES,
  PVP_SPAWN_RADIUS,
  PVP_WORLD_INTERVAL_TICKS,
  advancePvpShot,
  dropPortalsOwnedBy,
  pvpAuthority,
  pvpPortalAngle,
  pvpPortalPoint,
  pvpShotAlive,
  pvpShotHitsPilot,
  pvpSide,
  pvpSpawnPoint,
  rivalSide,
} from "../app/pvp-arena.ts";
import { DEFAULT_ARENA } from "../app/arena.ts";
import { MAX_PVP_SHOTS_PER_VOLLEY as SERVER_MAX_VOLLEY } from "../server/protocol.mjs";

const arena = DEFAULT_ARENA;

// ------------------------------------------------------------------- sides --

test("sides come from the two player ids, so both clients agree and disagree oppositely", () => {
  // The whole point: each client runs the same comparison over the same pair
  // and necessarily lands on the other half of the board from its opponent.
  assert.equal(pvpSide("p1", "p2"), "left");
  assert.equal(pvpSide("p2", "p1"), "right");
  for (const [you, them] of [["p1", "p2"], ["p7", "p12"], ["pa", "pb"]]) {
    assert.notEqual(pvpSide(you, them), pvpSide(them, you), `${you} vs ${them}`);
  }
});

test("an unknown opponent still yields a board to draw", () => {
  // Reached from lobby state a disconnect can leave mid-update, and from the
  // pre-match preview, so it must not return undefined.
  assert.equal(pvpSide(null, "p2"), "left");
  assert.equal(pvpSide("p1", undefined), "left");
  assert.equal(pvpSide(undefined, undefined), "left");
});

test("rivalSide is its own inverse", () => {
  assert.equal(rivalSide("left"), "right");
  assert.equal(rivalSide("right"), "left");
  assert.equal(rivalSide(rivalSide("left")), "left");
});

test("hosting is identity, not side: a side never implies simulation authority", () => {
  assert.equal(pvpAuthority("p1", "p1"), "host");
  assert.equal(pvpAuthority("p2", "p1"), "guest");
  // A client that does not yet know who it is cannot claim to be the host.
  assert.equal(pvpAuthority(null, null), "guest");
  assert.equal(pvpAuthority(undefined, "p1"), "guest");
  assert.equal(pvpAuthority("", ""), "guest");
});

// ----------------------------------------------------------------- portals --

test("the two rifts sit exactly half a turn apart on one ring", () => {
  assert.deepEqual(PVP_SIDE_ANGLES, { left: 180, right: 0 });
  for (const ring of [0, 37, 180, 359]) {
    const gap = Math.abs(pvpPortalAngle("left", ring) - pvpPortalAngle("right", ring));
    assert.equal(Math.min(gap, 360 - gap), 180, `ring ${ring}`);
  }
});

test("portal angles stay inside one turn however far the ring has spun", () => {
  for (const ring of [-90, 0, 359.5, 720]) {
    for (const side of ["left", "right"]) {
      const angle = pvpPortalAngle(side, ring);
      assert.ok(angle >= 0 && angle < 360, `${side} at ${ring} gave ${angle}`);
    }
  }
});

test("both pilots derive the same two rift positions from one shared phase", () => {
  // Neither client is told where the other's rift is. Each computes both from
  // the ring phase the world relay already carries, which is what lets a
  // migration of the arena host leave the board untouched.
  const ring = 50;
  const leftView = {
    mine: pvpPortalPoint("left", arena, ring),
    theirs: pvpPortalPoint(rivalSide("left"), arena, ring),
  };
  const rightView = {
    mine: pvpPortalPoint("right", arena, ring),
    theirs: pvpPortalPoint(rivalSide("right"), arena, ring),
  };
  assert.deepEqual(leftView.mine, rightView.theirs);
  assert.deepEqual(leftView.theirs, rightView.mine);
});

test("rifts orbit the arena centre at the ring radius", () => {
  const centre = { x: arena.width / 2, y: arena.height / 2 };
  for (const ring of [0, 90, 217]) {
    for (const side of ["left", "right"]) {
      const point = pvpPortalPoint(side, arena, ring, PVP_PORTAL_RADIUS);
      const distance = Math.hypot(point.x - centre.x, point.y - centre.y);
      assert.ok(Math.abs(distance - PVP_PORTAL_RADIUS) < 1e-9, `${side} at ${ring}: ${distance}`);
    }
  }
  // At phase zero the left rift is left of centre, which is what makes the
  // side names mean something on screen.
  assert.ok(pvpPortalPoint("left", arena, 0).x < centre.x);
  assert.ok(pvpPortalPoint("right", arena, 0).x > centre.x);
});

test("a ruleset that locks its rift still gets a ring rather than a stack", () => {
  // PvP's own rules orbit deliberately; this is only the floor under them.
  assert.equal(PVP_PORTAL_RADIUS, 240);
  const locked = pvpPortalPoint("left", arena);
  assert.notDeepEqual(locked, pvpPortalPoint("right", arena));
});

// ------------------------------------------------------------------ spawns --

test("a duel opens with each pilot behind their own rift, inside the arena", () => {
  assert.ok(PVP_SPAWN_RADIUS > PVP_PORTAL_RADIUS, "behind the rift, not on top of it");
  for (const side of ["left", "right"]) {
    const spawn = pvpSpawnPoint(side, arena);
    assert.ok(spawn.x > 12 && spawn.x < arena.width - 12, `${side} x ${spawn.x}`);
    assert.ok(spawn.y > 12 && spawn.y < arena.height - 12, `${side} y ${spawn.y}`);
  }
  const gap = Math.hypot(
    pvpSpawnPoint("left", arena).x - pvpSpawnPoint("right", arena).x,
    pvpSpawnPoint("left", arena).y - pvpSpawnPoint("right", arena).y
  );
  // Two pilots more than a screen apart open on an empty board, which does not
  // read as a duel. The playfield is a little over 1200px wide.
  assert.ok(gap <= 780, `pilots start ${gap} apart`);
  assert.ok(gap > 400, `pilots start too close: ${gap}`);
});

// ------------------------------------------------------- relayed cannon fire --

const shot = (over = {}) => ({ x: 100, y: 100, vx: 10, vy: 0, damage: 14, life: 110, color: "#fff", ...over });

test("a relayed round integrates identically wherever it is simulated", () => {
  // Rounds cross as spawn events, not positions, precisely because both
  // machines can step them the same way from the same start.
  const here = shot();
  const there = shot();
  for (let tick = 0; tick < 25; tick += 1) {
    advancePvpShot(here);
    advancePvpShot(there);
  }
  assert.deepEqual(here, there);
  assert.equal(here.x, 100 + 10 * 25);
  assert.equal(here.life, 110 - 25);
});

test("a relayed round expires on its own lifetime and at the arena edge", () => {
  assert.equal(pvpShotAlive(shot(), arena), true);
  assert.equal(pvpShotAlive(shot({ life: 0 }), arena), false);
  assert.equal(pvpShotAlive(shot({ x: arena.width + 31 }), arena), false);
  assert.equal(pvpShotAlive(shot({ x: -31 }), arena), false);
  assert.equal(pvpShotAlive(shot({ y: arena.height + 31 }), arena), false);
  // The same 30px margin the local bullet compaction uses, so a relayed round
  // and a local one leave the board at the same place.
  assert.equal(pvpShotAlive(shot({ x: arena.width + 29 }), arena), true);
});

test("a round reaches a pilot hull on contact and not before", () => {
  const pilot = { x: 500, y: 400 };
  assert.equal(pvpShotHitsPilot({ x: 500, y: 400 }, pilot), true);
  assert.equal(pvpShotHitsPilot({ x: 500 + PVP_PILOT_HIT_RADIUS - 1, y: 400 }, pilot), true);
  assert.equal(pvpShotHitsPilot({ x: 500 + PVP_PILOT_HIT_RADIUS, y: 400 }, pilot), false);
  assert.equal(pvpShotHitsPilot({ x: 500, y: 400 + PVP_PILOT_HIT_RADIUS + 1 }, pilot), false);
});

test("the hit radius is a touch wider than the local one, and the invulnerability matches it", () => {
  // The host tests relayed rounds against a rival transform that arrives on the
  // 33ms position stream rather than one it simulated, so the check is two
  // pixels more forgiving than the 13px hostile-projectile test.
  assert.equal(PVP_PILOT_HIT_RADIUS, 15);
  // The mirror of the local post-hit window. Without it a duel is decided by
  // whoever fires first, and the host burns its server-side damage budget in a
  // fraction of a second.
  assert.equal(PVP_RIVAL_INVULN_TICKS, 24);
});

test("client and server agree on how wide a volley may be", () => {
  assert.equal(MAX_PVP_SHOTS_PER_VOLLEY, SERVER_MAX_VOLLEY, "volley cap drift");
  // Warden's Suppression Barrage is the widest spread in the game.
  assert.equal(MAX_PVP_SHOTS_PER_VOLLEY, 8);
});

test("the world relay runs at the cadence co-op already proved", () => {
  assert.equal(PVP_WORLD_INTERVAL_TICKS, 6);
});

// ------------------------------------------------------------- elimination --

test("a destroyed pilot's rift leaves the arena, and only theirs", () => {
  const portals = [{ ownerId: "rift", id: 0 }, { ownerId: "you", id: 1 }];
  assert.deepEqual(dropPortalsOwnedBy(portals, "you"), [{ ownerId: "rift", id: 0 }]);
  assert.deepEqual(dropPortalsOwnedBy(portals, "rift"), [{ ownerId: "you", id: 1 }]);
});

test("dropping a rift is pure and repeatable, so the loop can run it every tick", () => {
  const portals = [{ ownerId: "rift" }, { ownerId: "you" }];
  const once = dropPortalsOwnedBy(portals, "you");
  assert.deepEqual(dropPortalsOwnedBy(once, "you"), once, "already gone stays gone");
  assert.equal(portals.length, 2, "the original list is untouched");
});
