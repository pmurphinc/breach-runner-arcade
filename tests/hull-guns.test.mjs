import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  HULL_GUN_MOUNT,
  HULL_GUN_PROFILES,
  HULL_GUN_SPIN_STEP,
  REDUCED_MOTION_RECOIL,
  createHullGunFx,
  dampHullGunFx,
  drawHullGun,
  hullGunBarrelOffsets,
  hullGunFlashIntensity,
  hullGunFxFor,
  hullGunMuzzleReach,
  hullGunProfile,
  hullGunRecoilOffset,
  kickHullGun,
  pruneHullGunFx,
  tickHullGunFx,
} from "../app/rift-run/hull-gun-art.ts";
import { RIFT_WEAPONS } from "../app/rift-run/weapons.ts";
import { logicalMountOffset, mountOrigin } from "../app/rift-run/weapon-fire.ts";
import { SHIP_MODEL_GEOMETRY, shipHardpointResolver } from "../app/ship-models.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

function recordingContext() {
  const calls = [];
  const ctx = {
    calls,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    save: () => calls.push(["save"]),
    restore: () => calls.push(["restore"]),
    translate: (x, y) => calls.push(["translate", x, y]),
    beginPath: () => calls.push(["beginPath"]),
    moveTo: (x, y) => calls.push(["moveTo", x, y]),
    lineTo: (x, y) => calls.push(["lineTo", x, y]),
    closePath: () => calls.push(["closePath"]),
    arc: (x, y, r) => calls.push(["arc", x, y, r]),
    fill: () => calls.push(["fill", ctx.fillStyle, ctx.globalAlpha]),
    stroke: () => calls.push(["stroke", ctx.strokeStyle, ctx.globalAlpha]),
  };
  return ctx;
}

const countOf = (ctx, method) => ctx.calls.filter(([name]) => name === method).length;

test("every Rift Run weapon has a hull gun to draw", () => {
  for (const weapon of RIFT_WEAPONS) {
    const profile = hullGunProfile(weapon.id);
    assert.equal(profile.weaponId, weapon.id, `${weapon.id} resolves to its own profile`);
    assert.ok(profile.barrelLength > 0 && profile.breechLength > 0, `${weapon.id} has a body`);
    assert.ok(profile.recoilTicks >= 0 && profile.flashTicks >= 0);
    assert.ok(hullGunMuzzleReach(profile) > 0, `${weapon.id} points somewhere`);
  }
  assert.equal(Object.keys(HULL_GUN_PROFILES).length, RIFT_WEAPONS.length, "no weapon is left without a gun");
});

test("the five guns are five silhouettes, not one silhouette in five colours", () => {
  const outlines = new Set(Object.values(HULL_GUN_PROFILES).map((profile) => JSON.stringify([
    profile.barrels, profile.barrelLength, profile.barrelHalfWidth, profile.breechHalfWidth,
    profile.rotary, profile.launcher, profile.flared, profile.railed,
  ])));
  assert.equal(outlines.size, RIFT_WEAPONS.length, "every weapon changes the outline, not only the accent");
  const accents = new Set(Object.values(HULL_GUN_PROFILES).map(({ accent }) => accent));
  assert.equal(accents.size, RIFT_WEAPONS.length, "and every weapon owns its own colour too");
  assert.ok(HULL_GUN_PROFILES.railgun.barrelLength > HULL_GUN_PROFILES["pulse-cannon"].barrelLength * 1.5,
    "the railgun is the long one");
  assert.ok(HULL_GUN_PROFILES.minigun.barrels > 1 && HULL_GUN_PROFILES.minigun.rotary, "the minigun is the rotary one");
  assert.ok(HULL_GUN_PROFILES["missile-pod"].launcher, "the missile pod is a box of tubes");
  assert.ok(HULL_GUN_PROFILES.flamethrower.flared, "the flamethrower is a nozzle");
});

test("a heavy weapon kicks harder and settles slower than a light one", () => {
  const rail = HULL_GUN_PROFILES.railgun, mini = HULL_GUN_PROFILES.minigun;
  assert.ok(rail.recoil > mini.recoil * 2, "42 damage every 55 ticks moves the gun; 3 damage every 3 ticks buzzes it");
  assert.ok(rail.recoilTicks > mini.recoilTicks);
  // A gun must finish recoiling before it is allowed to fire again, or the
  // slide never comes home and the animation reads as stuck.
  for (const weapon of RIFT_WEAPONS) {
    assert.ok(hullGunProfile(weapon.id).recoilTicks <= weapon.cadenceTicks,
      `${weapon.id} settles inside its own cadence`);
  }
});

test("recoil is instant on the shot and eases back to rest", () => {
  const profile = HULL_GUN_PROFILES["pulse-cannon"];
  const states = [];
  const state = kickHullGun(states, 1, "pulse-cannon");
  assert.equal(state.recoil, profile.recoilTicks);
  assert.equal(state.flash, profile.flashTicks);

  const travel = [hullGunRecoilOffset(state, profile)];
  assert.equal(travel[0], profile.recoil, "the gun is fully back on the frame it fired");
  for (let tick = 0; tick < profile.recoilTicks; tick += 1) {
    tickHullGunFx(states);
    travel.push(hullGunRecoilOffset(state, profile));
  }
  for (let i = 1; i < travel.length; i += 1) assert.ok(travel[i] < travel[i - 1], "the slide only ever comes forward");
  assert.equal(travel.at(-1), 0, "and it reaches rest exactly when its window expires");
  assert.equal(hullGunRecoilOffset(null, profile), 0, "a socket that has never fired sits still");
});

test("the muzzle flash fades out over its own window", () => {
  const profile = HULL_GUN_PROFILES.railgun;
  const states = [];
  const state = kickHullGun(states, 0, "railgun");
  const first = hullGunFlashIntensity(state, profile);
  assert.equal(first, 1);
  tickHullGunFx(states);
  const second = hullGunFlashIntensity(state, profile);
  assert.ok(second > 0 && second < first, "it dims rather than switching off");
  for (let tick = 0; tick < profile.flashTicks; tick += 1) tickHullGunFx(states);
  assert.equal(hullGunFlashIntensity(state, profile), 0, "and it is gone");
  // The flamethrower's cone is its own effect; it does not also flash.
  assert.equal(hullGunFlashIntensity({ hardpointIndex: 0, recoil: 0, flash: 4, spin: 0 }, HULL_GUN_PROFILES.flamethrower), 0);
});

test("a socket's animation record is created once and reused", () => {
  const states = [];
  const first = hullGunFxFor(states, 2);
  assert.deepEqual(first, createHullGunFx(2));
  assert.equal(hullGunFxFor(states, 2), first, "the same socket keeps the same record");
  hullGunFxFor(states, 0);
  assert.equal(states.length, 2);
  kickHullGun(states, 2, "minigun");
  assert.ok(states.find(({ hardpointIndex }) => hardpointIndex === 2).recoil > 0);
  assert.equal(states.find(({ hardpointIndex }) => hardpointIndex === 0).recoil, 0, "an idle socket is untouched");
});

test("sockets a run no longer has stop animating", () => {
  const states = [];
  for (const index of [0, 1, 2]) kickHullGun(states, index, "pulse-cannon");
  pruneHullGunFx(states, new Set([0, 2]));
  assert.deepEqual(states.map(({ hardpointIndex }) => hardpointIndex), [0, 2]);
  pruneHullGunFx(states, new Set());
  assert.equal(states.length, 0);
});

test("the rotary cluster turns as it fires and the others hold still", () => {
  const states = [];
  const state = kickHullGun(states, 0, "minigun");
  assert.equal(state.spin, HULL_GUN_SPIN_STEP);
  kickHullGun(states, 0, "minigun");
  assert.ok(Math.abs(state.spin - HULL_GUN_SPIN_STEP * 2) < 1e-9, "each round advances the cluster");
  for (let shot = 0; shot < 40; shot += 1) kickHullGun(states, 0, "minigun");
  assert.ok(state.spin >= 0 && state.spin < Math.PI * 2, "the phase stays wrapped");

  const rest = hullGunBarrelOffsets(HULL_GUN_PROFILES.minigun, 0);
  const turned = hullGunBarrelOffsets(HULL_GUN_PROFILES.minigun, 1.1);
  assert.equal(rest.length, HULL_GUN_PROFILES.minigun.barrels);
  assert.notDeepEqual(rest, turned, "the barrels are somewhere else once it has spun");
  const pod = HULL_GUN_PROFILES["missile-pod"];
  assert.deepEqual(hullGunBarrelOffsets(pod, 0), hullGunBarrelOffsets(pod, 2.4), "a tube pod does not spin");
  assert.deepEqual(hullGunBarrelOffsets(HULL_GUN_PROFILES["pulse-cannon"], 0), [0], "a single barrel is on the bore");
});

test("an unlocked but empty socket draws a mount, not nothing", () => {
  const ctx = recordingContext();
  drawHullGun(ctx, { x: 4, y: -10 }, null, null, 1);
  assert.ok(countOf(ctx, "fill") >= 2, "the plate and the open collar are both painted");
  assert.ok(ctx.calls.some(([name, , , r]) => name === "arc" && r > 0), "the empty socket is a visible hole");
  assert.deepEqual(ctx.calls[1], ["translate", 4, -10], "it is drawn at its mount");
  assert.equal(countOf(ctx, "save"), countOf(ctx, "restore"), "the canvas state is left as it was found");
  assert.ok(ctx.calls.some(([, style]) => style === HULL_GUN_MOUNT.trim), "the mount uses the shared plate trim");
});

test("a filled socket draws more than an empty one, for every weapon", () => {
  const empty = recordingContext();
  drawHullGun(empty, { x: 0, y: 0 }, null, null, 1);
  for (const weapon of RIFT_WEAPONS) {
    const ctx = recordingContext();
    drawHullGun(ctx, { x: 0, y: 0 }, weapon.id, null, 1);
    assert.ok(ctx.calls.length > empty.calls.length, `${weapon.id} adds a gun to the mount`);
    assert.equal(countOf(ctx, "save"), countOf(ctx, "restore"), `${weapon.id} balances its canvas state`);
    assert.ok(ctx.calls.some(([, style]) => style === hullGunProfile(weapon.id).accent),
      `${weapon.id} is painted in its own accent`);
  }
});

test("a recoiling gun is drawn slid back along its own bore", () => {
  const states = [];
  const state = kickHullGun(states, 0, "railgun");
  const firing = recordingContext();
  drawHullGun(firing, { x: 2, y: 12 }, "railgun", state, 1);
  const slide = firing.calls.filter(([name, x]) => name === "translate" && x < 0);
  assert.equal(slide.length, 1, "exactly one slide, and it is backwards");
  assert.ok(Math.abs(slide[0][1] + HULL_GUN_PROFILES.railgun.recoil) < 1e-9, "at full travel on the firing frame");
  assert.equal(slide[0][2], 0, "the kick is along the bore, not sideways");

  const rested = recordingContext();
  drawHullGun(rested, { x: 2, y: 12 }, "railgun", { hardpointIndex: 0, recoil: 0, flash: 0, spin: 0 }, 1);
  assert.equal(rested.calls.filter(([name, x]) => name === "translate" && x < 0).length, 0, "a rested gun does not slide");
});

test("the muzzle flash is what the quality scalar drops, never the gun", () => {
  const state = { hardpointIndex: 0, recoil: 3, flash: 4, spin: 0 };
  const full = recordingContext();
  drawHullGun(full, { x: 0, y: 0 }, "pulse-cannon", state, 1);
  const low = recordingContext();
  drawHullGun(low, { x: 0, y: 0 }, "pulse-cannon", state, 0.2);
  const bare = recordingContext();
  drawHullGun(bare, { x: 0, y: 0 }, "pulse-cannon", null, 1);

  assert.ok(full.calls.length > low.calls.length, "high detail paints the flash");
  assert.ok(low.calls.length >= bare.calls.length, "low detail still paints the whole gun");
  assert.ok(full.calls.some(([name, style]) => name === "fill" && style === HULL_GUN_PROFILES["pulse-cannon"].flash));
  assert.ok(!low.calls.some(([name, style]) => name === "fill" && style === HULL_GUN_PROFILES["pulse-cannon"].flash));
  const painted = full.calls.filter(([name]) => name === "fill" || name === "stroke");
  assert.ok(painted.every(([, , alpha]) => alpha >= 0 && alpha <= 1), "alpha stays legal");
  // The invariant is the state the canvas is handed back in, not the alpha of
  // the last thing painted — the muzzle flash is legitimately the final mark and
  // is legitimately translucent. Checked as state because the recording context
  // does not model save/restore, so a gun that leaked a translucent alpha into
  // whatever draws next would otherwise go unnoticed here.
  for (const ctx of [full, low, bare]) {
    assert.equal(ctx.globalAlpha, 1, "the gun hands the canvas back fully opaque");
  }
});

test("rounds leave the barrel that is drawn", () => {
  // The mount the renderer draws at and the origin the shot is fired from are
  // the same number rotated into world space — that is the whole fix.
  const resolve = shipHardpointResolver("turtle", 1.15);
  const origin = mountOrigin({ x: 500, y: 300 }, 0, 3, 2, resolve);
  const mount = resolve(2);
  assert.ok(Math.abs(origin.x - (500 + mount.x)) < 1e-9);
  assert.ok(Math.abs(origin.y - (300 + mount.y)) < 1e-9);

  // Rotating the hull rotates the mount with it.
  const turned = mountOrigin({ x: 0, y: 0 }, Math.PI / 2, 3, 2, resolve);
  assert.ok(Math.abs(turned.x + mount.y) < 1e-9);
  assert.ok(Math.abs(turned.y - mount.x) < 1e-9);
});

test("a frame with no authored mounts still falls back to the logical layout", () => {
  const none = () => null;
  for (const index of [0, 1, 2]) {
    assert.deepEqual(mountOrigin({ x: 0, y: 0 }, 0, 3, index, none), logicalMountOffset(3, index));
    assert.deepEqual(mountOrigin({ x: 0, y: 0 }, 0, 3, index), logicalMountOffset(3, index));
  }
  assert.deepEqual(mountOrigin({ x: 0, y: 0 }, 0, 1, 0, null), logicalMountOffset(1, 0));
});

test("the arena draws a gun at every unlocked socket and fires from it", () => {
  assert.ok(game.includes("drawHullGun(ctx, mount, occupied ? socket.weapon.weaponId : null"),
    "the renderer draws the socket's actual weapon");
  assert.ok(game.includes("shipHardpointOffset(game.ship.id, socket.index, 1.15)"),
    "at this ship's own mount, at the size the ship is drawn");
  assert.ok(game.includes('if (socket.status === "locked") continue;'),
    "a locked socket draws nothing; an unlocked one draws its mount");
  const model = game.indexOf("drawShipModel(ctx, game.ship.id, 1.15)");
  const guns = game.indexOf("drawHullGun(ctx, mount");
  assert.ok(model >= 0 && guns > model, "the guns are painted over the hull, not under it");

  assert.ok(game.includes("const hullMounts = shipHardpointResolver(game.ship.id, 1.15);"),
    "the fire path resolves the same geometry the renderer draws");
  assert.ok(game.includes("processHardpointFire(activeRiftRun.hardpoints, riftWeaponRuntime.current, Boolean(fire), player, player.angle * DEG, hullMounts)"),
    "hull guns fire from the hull centre plus their own mount");
  assert.ok(!game.includes("processHardpointFire(activeRiftRun.hardpoints, riftWeaponRuntime.current, Boolean(fire), shipMuzzleWorldPoint"),
    "and no longer from a generic offset off the nose muzzle");
  assert.ok(game.includes("flameDisplayTransform(flame, player, player.angle * DEG, shipHardpointResolver(game.ship.id, 1.15))"),
    "the flame cone comes out of the nozzle that is drawn");
});

test("the recoil animation is driven by the shots themselves", () => {
  assert.ok(game.includes("kickHullGun(game.riftGunFx, mounted.hardpointIndex, mounted.weaponId as RiftWeaponId)"),
    "every shot kicks the socket that produced it");
  assert.ok(game.includes("tickHullGunFx(game.riftGunFx)"), "and the simulation tick settles it");
  assert.ok(game.includes("pruneHullGunFx(game.riftGunFx"), "sockets the run has lost stop animating");
  const kick = game.indexOf("kickHullGun(game.riftGunFx");
  const shots = game.indexOf("for (const mounted of mountedShots)");
  assert.ok(shots >= 0 && kick > shots, "the kick lives inside the shot loop, not next to a cadence guess");
  assert.ok(game.includes("quiet ? dampHullGunFx(fx) : fx"),
    "reduced motion damps the gun rather than freezing it");
  assert.ok(game.includes("riftGunFx: []"), "the state is part of a fresh game");
});

/**
 * Reduced motion damps a hull gun; it does not switch it off.
 *
 * Suppressing the firing state entirely left the gun stone still as it fired —
 * no feedback that the weapon had gone off at all, which reads as broken rather
 * than as calm. A short mechanical kick is not the kind of movement reduced
 * motion exists to prevent; a large bright muzzle flash is much closer to it.
 * So the recoil survives at reduced amplitude and the flash is what goes.
 */
test("reduced motion keeps the kick and drops the flash", () => {
  const fired = { hardpointIndex: 0, recoil: 10, flash: 6, spin: 0.4 };
  const damped = dampHullGunFx(fired);

  assert.ok(damped.recoil > 0, "the gun still moves when it fires");
  assert.ok(damped.recoil < fired.recoil, "but less than it would otherwise");
  assert.equal(damped.recoil, fired.recoil * REDUCED_MOTION_RECOIL);
  assert.equal(damped.flash, 0, "the bright part is what reduced motion removes");
  assert.equal(damped.hardpointIndex, fired.hardpointIndex, "it is still the same socket");
  assert.equal(fired.recoil, 10, "and the live state is not mutated");

  // A socket with no firing state stays absent rather than becoming a resting one.
  assert.equal(dampHullGunFx(null), null);
});

test("a damped gun still paints, and still paints less than a loud one", () => {
  const fired = { hardpointIndex: 0, recoil: 10, flash: 6, spin: 0 };
  const loud = recordingContext();
  drawHullGun(loud, { x: 0, y: 0 }, "railgun", fired, 1);
  const quiet = recordingContext();
  drawHullGun(quiet, { x: 0, y: 0 }, "railgun", dampHullGunFx(fired), 1);
  const still = recordingContext();
  drawHullGun(still, { x: 0, y: 0 }, "railgun", null, 1);

  assert.ok(quiet.calls.length < loud.calls.length, "the flash is gone");
  assert.equal(quiet.calls.length, still.calls.length, "the gun itself is all still there");
  assert.ok(!quiet.calls.some(([name, style]) => name === "fill" && style === HULL_GUN_PROFILES.railgun.flash));
  assert.equal(quiet.globalAlpha, 1, "and it hands the canvas back opaque");
});

test("hull guns stay within the frames the fleet actually flies", () => {
  for (const ship of Object.keys(SHIP_MODEL_GEOMETRY)) {
    const resolve = shipHardpointResolver(ship, 1.15);
    for (let index = 0; index < SHIP_MODEL_GEOMETRY[ship].hardpoints.length; index += 1) {
      const mount = resolve(index);
      assert.ok(mount && Number.isFinite(mount.x) && Number.isFinite(mount.y), `${ship} socket ${index}`);
      // Mount plus the longest barrel in the game must still read as part of
      // the ship rather than a floating object beside it.
      const reach = Math.hypot(mount.x, mount.y) + hullGunMuzzleReach(HULL_GUN_PROFILES.railgun) * 1.15;
      assert.ok(reach < 42, `${ship} socket ${index} keeps its barrel near the hull`);
    }
  }
});
