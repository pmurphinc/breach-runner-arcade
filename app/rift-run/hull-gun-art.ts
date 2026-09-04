/**
 * The guns a Rift Run bolts onto your hull, and how they move when they fire.
 *
 * Before this module a hardpoint was real in every way except the one that
 * matters while you are flying: it had a weapon, a cadence and a mount offset,
 * and it drew *nothing*. Rounds appeared out of empty space beside the ship.
 * A pilot who spent an upgrade pick on a socket, and then a second on a gun to
 * put in it, got no visual confirmation that either purchase existed.
 *
 * So: every unlocked socket draws a mount, every filled socket draws a gun in
 * it, and the gun kicks back along its own bore when it shoots.
 *
 * Everything here is deliberately canvas-free apart from `drawHullGun`, which
 * takes the smallest 2D context it can get away with (`HullGunContext`) rather
 * than the real one — the silhouettes, the recoil curve and the animation
 * bookkeeping are the parts worth asserting, and a recording object is enough
 * to assert them.
 *
 * Coordinates are the ship's own frame: `+x` is the nose, `+y` is ship-right,
 * origin at the mount. `ship-models.ts` owns where each mount actually sits on
 * each hull.
 */

import type { RiftWeaponId } from "./types.ts";
import { RAILGUN_PALETTE } from "./railgun-fx.ts";

/**
 * The 2D drawing surface a hull gun needs.
 *
 * A structural subset of `CanvasRenderingContext2D`, which means the real
 * context satisfies it and a test can pass a recorder that satisfies it too.
 */
export type HullGunContext = {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  fill(): void;
  stroke(): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
};

/** How a hull gun of a given type is shaped, coloured and animated. */
export type HullGunProfile = {
  weaponId: RiftWeaponId;
  /** How many barrels leave the breech. */
  barrels: number;
  /** Lateral spacing between barrels, or the rotary cluster's radius. */
  barrelSpread: number;
  barrelLength: number;
  barrelHalfWidth: number;
  breechLength: number;
  breechHalfWidth: number;
  /** Peak slide back along the bore, in ship units. */
  recoil: number;
  /** Ticks the slide takes to settle back to rest. */
  recoilTicks: number;
  /** Ticks the muzzle flash burns for. */
  flashTicks: number;
  flashLength: number;
  flashHalfWidth: number;
  /** The barrel cluster turns as it fires (minigun). */
  rotary: boolean;
  /** A boxed tube launcher rather than a barrel (missile pod). */
  launcher: boolean;
  /** The barrel widens toward its mouth (flamethrower nozzle). */
  flared: boolean;
  /** Parallel accelerator rails either side of the bore (railgun). */
  railed: boolean;
  /** The gun's identifying colour. Matches its projectile wherever one exists. */
  accent: string;
  /** Barrel metal. Darker than the accent so the accent reads as trim. */
  barrel: string;
  /** Muzzle flash colour. */
  flash: string;
};

/** Mount plate metal, shared by every socket so an empty one still reads as hardware. */
export const HULL_GUN_MOUNT = {
  plate: "#141d24",
  trim: "#6d8b9b",
  socket: "#080d11",
  /** Half-extent of the mount plate, forward and lateral. */
  forward: 2.1,
  aft: 3.4,
  halfWidth: 2.8,
} as const;

const BASE: Omit<HullGunProfile, "weaponId"> = {
  barrels: 1,
  barrelSpread: 0,
  barrelLength: 7.2,
  barrelHalfWidth: 1.15,
  breechLength: 4.2,
  breechHalfWidth: 1.9,
  recoil: 1.8,
  recoilTicks: 8,
  flashTicks: 5,
  flashLength: 5.2,
  flashHalfWidth: 2.4,
  rotary: false,
  launcher: false,
  flared: false,
  railed: false,
  accent: "#69ecff",
  barrel: "#2b3740",
  flash: "#d8f8ff",
};

/**
 * One silhouette per weapon.
 *
 * The brief is that a pilot glancing at their own wing can name the gun on it
 * without reading the HUD, so each entry changes the outline rather than only
 * the colour: a rotary cluster, a long railed needle, a boxed tube pod and a
 * flared nozzle are four different shapes before they are four different hues.
 */
export const HULL_GUN_PROFILES: Record<RiftWeaponId, HullGunProfile> = {
  "pulse-cannon": { ...BASE, weaponId: "pulse-cannon" },
  minigun: {
    ...BASE,
    weaponId: "minigun",
    barrels: 3,
    barrelSpread: 1.45,
    barrelLength: 6.4,
    barrelHalfWidth: 0.72,
    breechLength: 4.6,
    breechHalfWidth: 2.1,
    // Light rounds at four times the cadence: a buzz, not a thump. Three ticks
    // is the minigun's whole cadence, so the slide is always home before the
    // next round rather than visibly stuck halfway back.
    recoil: 0.85,
    recoilTicks: 3,
    flashTicks: 3,
    flashLength: 3.6,
    flashHalfWidth: 1.9,
    rotary: true,
    accent: "#ffe67b",
    flash: "#fff4c2",
  },
  railgun: {
    ...BASE,
    weaponId: "railgun",
    barrelLength: 12.5,
    barrelHalfWidth: 0.85,
    breechLength: 5.2,
    breechHalfWidth: 2.3,
    // The heaviest kick in the set, and the slowest to settle: 55 ticks of
    // cadence means the slide has all the time in the world to come home.
    recoil: 3.4,
    recoilTicks: 16,
    flashTicks: 8,
    flashLength: 7.5,
    flashHalfWidth: 2.2,
    railed: true,
    accent: RAILGUN_PALETTE.edge,
    barrel: "#2a2438",
    flash: RAILGUN_PALETTE.glow,
  },
  "missile-pod": {
    ...BASE,
    weaponId: "missile-pod",
    barrels: 3,
    barrelSpread: 1.7,
    barrelLength: 5.4,
    barrelHalfWidth: 0.9,
    breechLength: 4.4,
    breechHalfWidth: 3.0,
    // A tube launcher does not slide; it just shrugs.
    recoil: 1.0,
    recoilTicks: 10,
    flashTicks: 6,
    flashLength: 4.2,
    flashHalfWidth: 2.8,
    launcher: true,
    accent: "#ff9b58",
    barrel: "#39302a",
    flash: "#ffd0a3",
  },
  flamethrower: {
    ...BASE,
    weaponId: "flamethrower",
    barrelLength: 4.4,
    barrelHalfWidth: 1.3,
    breechLength: 4.0,
    breechHalfWidth: 2.2,
    // Continuous burn: the nozzle trembles rather than recoils, and the cone
    // in `flame-fx.ts` is already doing the loud part of the job.
    recoil: 0.45,
    recoilTicks: 4,
    flashTicks: 0,
    flashLength: 0,
    flashHalfWidth: 0,
    flared: true,
    accent: "#ff7e2a",
    barrel: "#3a2318",
    flash: "#ffd08a",
  },
};

export function hullGunProfile(weaponId: RiftWeaponId): HullGunProfile {
  return HULL_GUN_PROFILES[weaponId] ?? HULL_GUN_PROFILES["pulse-cannon"];
}

/** How far a gun's muzzle sits ahead of its mount, at rest. Used for flashes and origins. */
export function hullGunMuzzleReach(profile: HullGunProfile): number {
  return profile.breechLength / 2 + (profile.launcher ? profile.breechHalfWidth * 0.6 : profile.barrelLength);
}

/**
 * Per-socket animation state.
 *
 * Deliberately tick counters rather than seconds or timestamps: the fire path
 * that creates a shot and the counter that animates it are then driven by the
 * same clock, and a recoil cannot drift out of step with the rounds that
 * caused it no matter what the render rate is doing.
 */
export type HullGunFx = {
  hardpointIndex: number;
  /** Ticks of slide left to settle. */
  recoil: number;
  /** Ticks of muzzle flash left. */
  flash: number;
  /** Rotary cluster phase, radians. */
  spin: number;
};

/** Radians the rotary cluster advances per round fired. */
export const HULL_GUN_SPIN_STEP = 0.72;

export function createHullGunFx(hardpointIndex: number): HullGunFx {
  return { hardpointIndex, recoil: 0, flash: 0, spin: 0 };
}

/** The socket's animation record, created on first use. */
export function hullGunFxFor(states: HullGunFx[], hardpointIndex: number): HullGunFx {
  const existing = states.find((state) => state.hardpointIndex === hardpointIndex);
  if (existing) return existing;
  const created = createHullGunFx(hardpointIndex);
  states.push(created);
  return created;
}

/**
 * Register that this socket just fired.
 *
 * Called from the shot loop rather than from a cadence guess, which is the
 * whole point: no shot, no kick; every shot, exactly one kick.
 */
export function kickHullGun(states: HullGunFx[], hardpointIndex: number, weaponId: RiftWeaponId): HullGunFx {
  const profile = hullGunProfile(weaponId);
  const state = hullGunFxFor(states, hardpointIndex);
  state.recoil = profile.recoilTicks;
  state.flash = profile.flashTicks;
  state.spin = (state.spin + HULL_GUN_SPIN_STEP) % (Math.PI * 2);
  return state;
}

/** Advances every socket one simulation tick. Idle sockets stay at rest. */
export function tickHullGunFx(states: HullGunFx[]): void {
  for (const state of states) {
    if (state.recoil > 0) state.recoil -= 1;
    if (state.flash > 0) state.flash -= 1;
  }
}

/** Drops records for sockets the run no longer has, so a lost gun stops animating. */
export function pruneHullGunFx(states: HullGunFx[], liveIndexes: ReadonlySet<number>): void {
  let write = 0;
  for (const state of states) if (liveIndexes.has(state.hardpointIndex)) states[write++] = state;
  states.length = write;
}

/**
 * How far back the gun body has slid, in ship units.
 *
 * Instant on the firing tick, then quadratic back to rest: a hard kick with a
 * soft return, which is what a recoiling breech actually looks like. Squaring
 * the remaining fraction (rather than using it raw) is what makes the last
 * third of the travel slow enough to read as settling.
 */
export function hullGunRecoilOffset(state: HullGunFx | null, profile: HullGunProfile): number {
  if (!state || state.recoil <= 0 || profile.recoilTicks <= 0) return 0;
  const remaining = Math.min(1, state.recoil / profile.recoilTicks);
  return profile.recoil * remaining * remaining;
}

/** Muzzle-flash intensity, 0 to 1, fading linearly over the flash window. */
export function hullGunFlashIntensity(state: HullGunFx | null, profile: HullGunProfile): number {
  if (!state || state.flash <= 0 || profile.flashTicks <= 0) return 0;
  return Math.min(1, state.flash / profile.flashTicks);
}

function chamferedBlock(ctx: HullGunContext, front: number, back: number, halfWidth: number, chamfer: number) {
  ctx.beginPath();
  ctx.moveTo(front, -halfWidth + chamfer);
  ctx.lineTo(front - chamfer, -halfWidth);
  ctx.lineTo(-back + chamfer, -halfWidth);
  ctx.lineTo(-back, -halfWidth + chamfer);
  ctx.lineTo(-back, halfWidth - chamfer);
  ctx.lineTo(-back + chamfer, halfWidth);
  ctx.lineTo(front - chamfer, halfWidth);
  ctx.lineTo(front, halfWidth - chamfer);
  ctx.closePath();
}

function fillStroke(ctx: HullGunContext, fill: string, stroke: string, width: number) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** The plate every socket has, gun or no gun. */
function drawMount(ctx: HullGunContext, occupied: boolean) {
  chamferedBlock(ctx, HULL_GUN_MOUNT.forward, HULL_GUN_MOUNT.aft, HULL_GUN_MOUNT.halfWidth, 0.9);
  fillStroke(ctx, HULL_GUN_MOUNT.plate, HULL_GUN_MOUNT.trim, 0.65);
  if (occupied) return;
  // An empty socket is an open collar with nothing in it — visibly a place a
  // gun goes, rather than an absence.
  ctx.beginPath();
  ctx.arc(-0.5, 0, 1.55, 0, Math.PI * 2);
  fillStroke(ctx, HULL_GUN_MOUNT.socket, HULL_GUN_MOUNT.trim, 0.55);
}

/** Lateral offsets of a gun's barrels this frame, rotary cluster included. */
export function hullGunBarrelOffsets(profile: HullGunProfile, spin: number): number[] {
  if (profile.barrels <= 1) return [0];
  if (!profile.rotary) {
    const step = profile.barrelSpread;
    return Array.from({ length: profile.barrels }, (_, index) => (index - (profile.barrels - 1) / 2) * step);
  }
  // Seen from above, a spinning cluster is its barrels projected onto one
  // axis — so the cosine of each barrel's phase is literally where it is.
  return Array.from({ length: profile.barrels }, (_, index) =>
    Math.cos(spin + (index * Math.PI * 2) / profile.barrels) * profile.barrelSpread);
}

function drawBarrels(ctx: HullGunContext, profile: HullGunProfile) {
  const front = profile.breechLength / 2;
  const tip = front + profile.barrelLength;
  for (const offset of hullGunBarrelOffsets(profile, 0)) {
    ctx.beginPath();
    ctx.moveTo(front, offset - profile.barrelHalfWidth);
    ctx.lineTo(tip, offset - profile.barrelHalfWidth);
    ctx.lineTo(tip, offset + profile.barrelHalfWidth);
    ctx.lineTo(front, offset + profile.barrelHalfWidth);
    ctx.closePath();
    fillStroke(ctx, profile.barrel, profile.accent, 0.5);
  }
}

/**
 * Draws one hull gun, mount included, in the ship's own rotated frame.
 *
 * The caller is expected to be inside a transform already translated to the
 * hull and rotated to its heading — the same one the ship PNG is drawn in — so
 * this only translates to the mount. A null `weaponId` draws an empty socket.
 *
 * `detail` is the quality scalar: below 0.35 the flash and the fine trim are
 * dropped, but the gun itself is never dropped, because a gun you paid an
 * upgrade for should not vanish on a low-end device.
 */
export function drawHullGun(
  ctx: HullGunContext,
  mount: { x: number; y: number },
  weaponId: RiftWeaponId | null,
  state: HullGunFx | null,
  detail = 1,
): void {
  ctx.save();
  ctx.translate(mount.x, mount.y);
  ctx.globalAlpha = 1;
  drawMount(ctx, weaponId !== null);
  if (weaponId === null) {
    ctx.restore();
    return;
  }

  const profile = hullGunProfile(weaponId);
  const slide = hullGunRecoilOffset(state, profile);
  const flash = hullGunFlashIntensity(state, profile);
  const spin = profile.rotary ? (state?.spin ?? 0) : 0;
  const fine = detail >= 0.35;

  // The whole gun body slides, mount excluded — that is what makes the kick
  // read as the gun moving against the hull rather than the ship twitching.
  ctx.save();
  ctx.translate(-slide, 0);

  const front = profile.breechLength / 2;
  const tip = front + profile.barrelLength;

  if (profile.launcher) {
    chamferedBlock(ctx, front + 2.6, profile.breechLength / 2, profile.breechHalfWidth, 0.8);
    fillStroke(ctx, "#241c17", profile.accent, 0.7);
    for (const offset of hullGunBarrelOffsets(profile, 0)) {
      ctx.beginPath();
      ctx.arc(front + 1.7, offset, 0.85, 0, Math.PI * 2);
      fillStroke(ctx, "#0a0704", profile.accent, 0.45);
    }
  } else if (profile.flared) {
    chamferedBlock(ctx, front, profile.breechLength / 2, profile.breechHalfWidth, 0.7);
    fillStroke(ctx, "#2a1a12", profile.accent, 0.65);
    ctx.beginPath();
    ctx.moveTo(front, -profile.barrelHalfWidth);
    ctx.lineTo(front + profile.barrelLength, -profile.barrelHalfWidth * 2.1);
    ctx.lineTo(front + profile.barrelLength, profile.barrelHalfWidth * 2.1);
    ctx.lineTo(front, profile.barrelHalfWidth);
    ctx.closePath();
    fillStroke(ctx, profile.barrel, profile.accent, 0.55);
  } else {
    chamferedBlock(ctx, front, profile.breechLength / 2, profile.breechHalfWidth, 0.7);
    fillStroke(ctx, "#1b242b", profile.accent, 0.7);
    if (profile.rotary) {
      for (const offset of hullGunBarrelOffsets(profile, spin)) {
        ctx.beginPath();
        ctx.moveTo(front, offset - profile.barrelHalfWidth);
        ctx.lineTo(tip, offset - profile.barrelHalfWidth);
        ctx.lineTo(tip, offset + profile.barrelHalfWidth);
        ctx.lineTo(front, offset + profile.barrelHalfWidth);
        ctx.closePath();
        fillStroke(ctx, profile.barrel, profile.accent, 0.45);
      }
    } else {
      drawBarrels(ctx, profile);
    }
    if (profile.railed && fine) {
      // Two accelerator rails straddling the bore. Cheap, and it is the whole
      // reason the railgun is recognisable at a glance on the wing.
      for (const side of [-1, 1]) {
        const rail = side * (profile.barrelHalfWidth + 0.75);
        ctx.beginPath();
        ctx.moveTo(front - 0.6, rail - 0.3);
        ctx.lineTo(tip - 1.4, rail - 0.3);
        ctx.lineTo(tip - 1.4, rail + 0.3);
        ctx.lineTo(front - 0.6, rail + 0.3);
        ctx.closePath();
        fillStroke(ctx, profile.accent, profile.flash, 0.3);
      }
    }
  }

  if (flash > 0 && fine) {
    const reach = profile.launcher ? front + 2.6 : profile.flared ? front + profile.barrelLength : tip;
    ctx.globalAlpha = flash * 0.92;
    ctx.beginPath();
    ctx.moveTo(reach - 1.2, 0);
    ctx.lineTo(reach + profile.flashLength * 0.35, -profile.flashHalfWidth * flash);
    ctx.lineTo(reach + profile.flashLength * flash, 0);
    ctx.lineTo(reach + profile.flashLength * 0.35, profile.flashHalfWidth * flash);
    ctx.closePath();
    ctx.fillStyle = profile.flash;
    ctx.fill();
    if (detail >= 0.6) {
      ctx.globalAlpha = flash;
      ctx.beginPath();
      ctx.moveTo(reach - 0.4, 0);
      ctx.lineTo(reach + profile.flashLength * 0.22, -profile.flashHalfWidth * 0.42 * flash);
      ctx.lineTo(reach + profile.flashLength * 0.55 * flash, 0);
      ctx.lineTo(reach + profile.flashLength * 0.22, profile.flashHalfWidth * 0.42 * flash);
      ctx.closePath();
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();
  ctx.restore();
}
