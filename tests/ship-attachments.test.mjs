import assert from "node:assert/strict";
import test from "node:test";
import { SHIP_HARDPOINT_CEILING, SHIP_MODEL_BASE_SIZE, SHIP_MODEL_GEOMETRY, shipAttachmentWorldPoint, shipForwardVelocity, shipHardpointOffset, shipHardpointResolver, shipHardpointWorldPoints, shipModelScale, shipMuzzleWorldPoint, shipThrusterWorldPoints } from "../app/ship-models.ts";
import { RIFT_RUN_MAX_SOCKETS } from "../app/rift-run/loadout.ts";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("a forward muzzle rotates with all cardinal headings", () => {
  const expected = [[120, 200], [100, 220], [80, 200], [100, 180]];
  [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach((heading, index) => {
    const point = shipAttachmentWorldPoint("tank", { x: 20, y: 0 }, { x: 100, y: 200 }, heading);
    close(point.x, expected[index][0]); close(point.y, expected[index][1]);
  });
});

test("thrusters remain behind the ship after rotation", () => {
  for (const heading of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const forward = { x: Math.cos(heading), y: Math.sin(heading) };
    for (const point of shipThrusterWorldPoints("squid", { x: 0, y: 0 }, heading)) assert.ok(point.x * forward.x + point.y * forward.y < 0);
  }
});

test("ships own independently tunable attachment locations", () => {
  assert.notDeepEqual(SHIP_MODEL_GEOMETRY.tank.thrusters, SHIP_MODEL_GEOMETRY.flash.thrusters);
  assert.notDeepEqual(shipMuzzleWorldPoint("tank", { x: 0, y: 0 }, 0), shipMuzzleWorldPoint("squid", { x: 0, y: 0 }, 0));
});

test("model presentation scaling also scales attachments", () => {
  const normal = shipMuzzleWorldPoint("tank", { x: 0, y: 0 }, 0), large = shipMuzzleWorldPoint("tank", { x: 0, y: 0 }, 0, 2);
  close(large.x, normal.x * 2); close(large.y, normal.y * 2); close(shipModelScale("flagship", 1.15), 0.82 * 1.15);
});

test("muzzle origin does not alter projectile velocity or heading", () => {
  const inherited = { x: 1.25, y: -0.75 };
  for (const heading of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const velocity = shipForwardVelocity(heading, 10, inherited);
    close(velocity.x, Math.cos(heading) * 10 + inherited.x); close(velocity.y, Math.sin(heading) * 10 + inherited.y);
  }
});

test("every configured attachment produces finite world coordinates", () => {
  for (const ship of Object.keys(SHIP_MODEL_GEOMETRY)) {
    const points = [shipMuzzleWorldPoint(ship, { x: 17, y: -9 }, 1.234, 1.15), ...shipThrusterWorldPoints(ship, { x: 17, y: -9 }, 1.234, 1.15), ...shipHardpointWorldPoints(ship, { x: 17, y: -9 }, 1.234, 1.15)];
    assert.ok(points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)), ship);
  }
});

test("every hull carries a full set of its own hardpoints", () => {
  assert.equal(SHIP_HARDPOINT_CEILING, RIFT_RUN_MAX_SOCKETS, "the art ceiling matches the run's socket cap");
  for (const ship of Object.keys(SHIP_MODEL_GEOMETRY)) {
    const mounts = SHIP_MODEL_GEOMETRY[ship].hardpoints;
    assert.equal(mounts.length, SHIP_HARDPOINT_CEILING, `${ship} authors every socket a run can open`);
    assert.ok(mounts.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)), ship);
  }
});

test("a hardpoint sits on the hull, not in the space beside it", () => {
  // The model is drawn `SHIP_MODEL_BASE_SIZE` across, so nothing outside half
  // of that is on the ship at all. Guns are kept inside a margin of that so the
  // mount plate and its barrel stay over painted metal.
  const limit = SHIP_MODEL_BASE_SIZE / 2 - 6;
  for (const ship of Object.keys(SHIP_MODEL_GEOMETRY)) {
    for (const mount of SHIP_MODEL_GEOMETRY[ship].hardpoints) {
      assert.ok(Math.abs(mount.x) <= limit, `${ship} mount x ${mount.x} is off the nose or tail`);
      assert.ok(Math.abs(mount.y) <= limit, `${ship} mount y ${mount.y} is off the wing`);
    }
  }
});

test("socket zero is the centreline gun and the rest are a mirrored pair", () => {
  for (const ship of Object.keys(SHIP_MODEL_GEOMETRY)) {
    const [centre, port, starboard] = SHIP_MODEL_GEOMETRY[ship].hardpoints;
    assert.equal(centre.y, 0, `${ship} mounts its first gun on the centreline`);
    assert.ok(centre.x > 0, `${ship} mounts its first gun forward of the hull centre`);
    assert.equal(port.y, -starboard.y, `${ship} wing guns are mirrored`);
    assert.equal(port.x, starboard.x, `${ship} wing guns are level with each other`);
    assert.ok(port.y < 0 && starboard.y > 0, `${ship} wing guns are actually out on the wings`);
  }
});

test("hardpoints are authored per ship rather than shared", () => {
  // A wide delta and a needle cannot share a mount layout; that was the bug.
  assert.notDeepEqual(SHIP_MODEL_GEOMETRY.turtle.hardpoints, SHIP_MODEL_GEOMETRY.rabbit.hardpoints);
  const widest = Math.abs(SHIP_MODEL_GEOMETRY.turtle.hardpoints[1].y);
  const narrowest = Math.abs(SHIP_MODEL_GEOMETRY.rabbit.hardpoints[1].y);
  assert.ok(widest > narrowest * 2, "the diamond's guns sit far wider than the needle's");
  const layouts = new Set(Object.values(SHIP_MODEL_GEOMETRY).map(({ hardpoints }) => JSON.stringify(hardpoints)));
  assert.ok(layouts.size >= 8, "at least eight of the ten frames have their own layout");
});

test("a hardpoint offset scales with the model it is bolted to", () => {
  const normal = shipHardpointOffset("tank", 1), large = shipHardpointOffset("tank", 1, 2);
  close(large.x, normal.x * 2); close(large.y, normal.y * 2);
  // The flagship's model is drawn at 0.82, so its mounts have to shrink too or
  // they float off the wing.
  close(shipHardpointOffset("flagship", 1).y, SHIP_MODEL_GEOMETRY.flagship.hardpoints[1].y * shipModelScale("flagship"));
  assert.equal(shipHardpointOffset("tank", SHIP_HARDPOINT_CEILING), null, "an unauthored socket says so");
  assert.equal(shipHardpointOffset("tank", -1), null);
});

test("a hardpoint rotates with the hull exactly as the muzzle does", () => {
  const position = { x: 100, y: 200 };
  for (const heading of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const [, port] = shipHardpointWorldPoints("tank", position, heading, 1.15);
    const expected = shipAttachmentWorldPoint("tank", SHIP_MODEL_GEOMETRY.tank.hardpoints[1], position, heading, 1.15);
    close(port.x, expected.x); close(port.y, expected.y);
  }
});

test("the resolver Rift Run fires through is the same geometry the renderer draws", () => {
  const resolve = shipHardpointResolver("warden", 1.15);
  for (let index = 0; index < SHIP_HARDPOINT_CEILING; index += 1) {
    assert.deepEqual(resolve(index), shipHardpointOffset("warden", index, 1.15));
  }
  assert.equal(resolve(SHIP_HARDPOINT_CEILING), null);
});
