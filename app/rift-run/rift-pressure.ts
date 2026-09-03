/**
 * Rift Pressure — the rift fights back.
 *
 * The rift used to be furniture: a stationary integrity pool that absorbed
 * fire and paid out power-ups. Nothing it did ever cost the pilot anything, so
 * the optimal way to play Rift Run was to park inside knife range of it and
 * hold the trigger. That single degenerate line is most of why the mode was
 * too easy.
 *
 * So proximity now has a price. Standing near the rift builds *pressure*; the
 * closer the pilot sits and the more wounded the rift is, the faster it
 * climbs. At full pressure the rift retaliates with one of three answers, in
 * strict rotation so the pilot learns all three rather than only the one the
 * dice liked:
 *
 *   - a TARGETED STRIKE, marked on the pilot's position and detonating there;
 *   - a SHOCKWAVE, a ring driven outward from the rift that has to be flown
 *     over or outrun;
 *   - a SWEEP, one rotating arm anchored at the rift.
 *
 * Each is telegraphed first, for as long as the rift's health phase allows —
 * see `rift-phases.ts`, which owns the timings. A retaliation the pilot could
 * not have seen coming is a bug, not difficulty, so the telegraph is part of
 * the event rather than decoration around it.
 *
 * Pressure is *not* a punishment for shooting the rift. It is a punishment for
 * standing still. Backing off bleeds it away faster than sitting close builds
 * it, so a pilot who circles, strafes and re-approaches can fight a rift at
 * range indefinitely without ever seeing a retaliation.
 *
 * Pure, React-free and canvas-free: the whole escalation is testable as data,
 * and the game loop owns none of these numbers.
 */

import { RIFT_PHASES, riftPhaseIndex, type RiftPhase } from "./rift-phases.ts";

/** Inside this radius of the rift, pressure builds. Outside it, pressure bleeds. */
export const RIFT_PRESSURE_RADIUS = 240;

/** Pressure at which the rift commits to a retaliation. */
export const RIFT_PRESSURE_MAX = 100;

/**
 * Pressure gained per tick while sitting exactly on the rift.
 *
 * Scaled down linearly to zero at the edge of the radius, and up by the rift's
 * health phase, so the worst case — a COLLAPSING rift with the pilot on top of
 * it — charges in a little under two seconds and the gentlest approach at the
 * rim charges never.
 */
export const RIFT_PRESSURE_GAIN = 1.15;

/**
 * Pressure lost per tick outside the radius.
 *
 * Deliberately faster than the gain. Disengaging has to be a real answer to
 * pressure, not a slow one, or the system stops teaching movement and starts
 * taxing time.
 */
export const RIFT_PRESSURE_DECAY = 1.9;

/** Radius of a targeted strike's detonation. */
export const RIFT_STRIKE_RADIUS = 96;

/** How far a shockwave travels before it dissipates. */
export const RIFT_SHOCKWAVE_RANGE = 520;

/** World units a shockwave ring expands per tick. */
export const RIFT_SHOCKWAVE_SPEED = 7.5;

/** Half-thickness of the damaging band of a shockwave ring. */
export const RIFT_SHOCKWAVE_BAND = 26;

/** How far a sweep arm reaches from the rift. */
export const RIFT_SWEEP_LENGTH = 420;

/** Half-width of a sweep arm, in degrees. */
export const RIFT_SWEEP_HALF_ANGLE = 9;

/** Degrees a sweep arm turns per tick. */
export const RIFT_SWEEP_DEGREES_PER_TICK = 2.4;

/** Ticks one sweep lasts — a little over a full turn at the standard rate. */
export const RIFT_SWEEP_TICKS = 170;

export type RiftRetaliationKind = "strike" | "shockwave" | "sweep";

/** Rotation order. Fixed, so the pilot meets all three inside one rift. */
export const RIFT_RETALIATION_ORDER: readonly RiftRetaliationKind[] = ["strike", "shockwave", "sweep"];

export type RiftRetaliation = {
  kind: RiftRetaliationKind;
  /** Where it will land. The rift for a shockwave or sweep; the pilot for a strike. */
  x: number;
  y: number;
  /** Ticks of telegraph left. Zero on the tick it lands. */
  telegraphTicks: number;
  /** Telegraph length it started with, so a renderer can draw a fill fraction. */
  telegraphTotal: number;
  radius: number;
  damage: number;
  /** Sweep only: the heading the arm starts on, in degrees. */
  angle: number;
};

export type RiftPressureState = {
  /** 0 to RIFT_PRESSURE_MAX. */
  pressure: number;
  /** The retaliation currently telegraphing, or null when the rift is idle. */
  pending: RiftRetaliation | null;
  /** Ticks before the rift may begin charging another retaliation. */
  cooldown: number;
  /** Index into RIFT_RETALIATION_ORDER for the next one. */
  rotation: number;
  /** Retaliations this rift has landed. Reset when the rift reforms. */
  landed: number;
};

export function createRiftPressure(): RiftPressureState {
  return { pressure: 0, pending: null, cooldown: 0, rotation: 0, landed: 0 };
}

export type RiftPressureContext = {
  /** Distance from the pilot to the rift centre. */
  distance: number;
  playerX: number;
  playerY: number;
  riftX: number;
  riftY: number;
  phase: RiftPhase;
  /**
   * True while something else lethal already owns the arena.
   *
   * The rift will not begin charging a retaliation on top of a live
   * environmental hazard — see `environmental-hazards.ts`, which asks the same
   * question in reverse. One unavoidable thing at a time is difficulty; two at
   * once is a coin flip.
   */
  hazardBusy?: boolean;
};

export type RiftPressureTick = {
  /** Normalized 0..1, for the HUD ring. */
  fraction: number;
  /** The retaliation that began telegraphing on this tick, or null. */
  telegraphed: RiftRetaliation | null;
  /** The retaliation that landed on this tick, or null. */
  landed: RiftRetaliation | null;
};

/**
 * One tick of pressure.
 *
 * Mutates `state` and reports the two moments a caller has to react to: a
 * telegraph starting, and a retaliation landing. Everything in between is the
 * caller reading `state.pending` to draw it.
 */
export function tickRiftPressure(state: RiftPressureState, context: RiftPressureContext): RiftPressureTick {
  const { distance, phase } = context;

  // A retaliation already in the air runs to completion. Pressure does not
  // build during it: the pilot is busy dodging, and charging a second strike
  // while the first is still falling is how a system stops being readable.
  if (state.pending) {
    state.pending.telegraphTicks -= 1;
    if (state.pending.telegraphTicks > 0) {
      return { fraction: state.pressure / RIFT_PRESSURE_MAX, telegraphed: null, landed: null };
    }
    const landed = state.pending;
    state.pending = null;
    state.pressure = 0;
    state.cooldown = phase.cooldownTicks;
    state.landed += 1;
    return { fraction: 0, telegraphed: null, landed };
  }

  const inside = Number.isFinite(distance) && distance <= RIFT_PRESSURE_RADIUS;
  if (inside) {
    // Closeness matters more than mere presence: the rim barely registers, the
    // centre charges fast. Linear, so it is legible from the HUD ring alone.
    const closeness = 1 - Math.max(0, distance) / RIFT_PRESSURE_RADIUS;
    state.pressure = Math.min(
      RIFT_PRESSURE_MAX,
      state.pressure + RIFT_PRESSURE_GAIN * closeness * phase.pressureScale,
    );
  } else {
    state.pressure = Math.max(0, state.pressure - RIFT_PRESSURE_DECAY);
  }

  if (state.cooldown > 0) {
    state.cooldown -= 1;
    return { fraction: state.pressure / RIFT_PRESSURE_MAX, telegraphed: null, landed: null };
  }

  if (state.pressure < RIFT_PRESSURE_MAX || context.hazardBusy) {
    return { fraction: state.pressure / RIFT_PRESSURE_MAX, telegraphed: null, landed: null };
  }

  const kind = RIFT_RETALIATION_ORDER[state.rotation % RIFT_RETALIATION_ORDER.length];
  state.rotation += 1;
  const pending: RiftRetaliation = {
    kind,
    // A strike is aimed where the pilot *was* when the telegraph opened, which
    // is the whole reason the telegraph is worth watching: the answer to it is
    // to leave. A shockwave and a sweep come from the rift, so they are marked
    // there.
    x: kind === "strike" ? context.playerX : context.riftX,
    y: kind === "strike" ? context.playerY : context.riftY,
    telegraphTicks: phase.telegraphTicks,
    telegraphTotal: phase.telegraphTicks,
    radius: kind === "strike" ? RIFT_STRIKE_RADIUS : RIFT_SHOCKWAVE_BAND,
    damage: phase.retaliationDamage,
    angle: Math.atan2(context.playerY - context.riftY, context.playerX - context.riftX) * (180 / Math.PI),
  };
  state.pending = pending;
  return { fraction: 1, telegraphed: pending, landed: null };
}

/** Wipes pressure and any pending retaliation. Called when a rift reforms. */
export function resetRiftPressure(state: RiftPressureState): void {
  state.pressure = 0;
  state.pending = null;
  state.cooldown = 0;
  state.landed = 0;
}

/** The player-facing warning for a retaliation that has just begun telegraphing. */
export function riftRetaliationNotice(kind: RiftRetaliationKind): string {
  if (kind === "strike") return "RIFT TARGETING // MOVE";
  if (kind === "shockwave") return "RIFT SHOCKWAVE INBOUND";
  return "RIFT SWEEP ARMING";
}

/* ------------------------------------------------------------------ */
/* Shockwave                                                           */
/* ------------------------------------------------------------------ */

export type RiftShockwave = {
  x: number;
  y: number;
  /** Current ring radius. Grows every tick. */
  radius: number;
  maxRadius: number;
  damage: number;
  /** A ring passes through the pilot once; it does not grind them down. */
  struck: boolean;
};

export function createRiftShockwave(x: number, y: number, damage: number): RiftShockwave {
  return { x, y, radius: 0, maxRadius: RIFT_SHOCKWAVE_RANGE, damage, struck: false };
}

/** Advances the ring. Returns false once it has dissipated. */
export function tickRiftShockwave(wave: RiftShockwave): boolean {
  wave.radius += RIFT_SHOCKWAVE_SPEED;
  return wave.radius <= wave.maxRadius;
}

/** True while the ring's damaging band is over this point. */
export function riftShockwaveHits(wave: RiftShockwave, point: { x: number; y: number }): boolean {
  if (wave.struck) return false;
  const distance = Math.hypot(point.x - wave.x, point.y - wave.y);
  return Math.abs(distance - wave.radius) <= RIFT_SHOCKWAVE_BAND;
}

/**
 * Outward push a shockwave applies to whatever it passes.
 *
 * The ring is not only damage: it shoves. That is what makes it read as the
 * rift *pushing back* rather than as an invisible tripwire, and it is also the
 * mechanical answer to camping — even a pilot who tanks the hit is moved off
 * the rift by it.
 */
export function riftShockwavePush(wave: RiftShockwave, point: { x: number; y: number }): { vx: number; vy: number } {
  const dx = point.x - wave.x;
  const dy = point.y - wave.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  return { vx: (dx / length) * 6.5, vy: (dy / length) * 6.5 };
}

/* ------------------------------------------------------------------ */
/* Sweep                                                               */
/* ------------------------------------------------------------------ */

export type RiftSweep = {
  x: number;
  y: number;
  /** Current heading of the arm, in degrees. */
  angle: number;
  degreesPerTick: number;
  length: number;
  damage: number;
  /** Ticks left before the arm shuts down. */
  remaining: number;
  /** Ticks before the arm may damage the pilot again. */
  hitCooldown: number;
};

export function createRiftSweep(x: number, y: number, angle: number, damage: number): RiftSweep {
  return {
    x,
    y,
    angle,
    degreesPerTick: RIFT_SWEEP_DEGREES_PER_TICK,
    length: RIFT_SWEEP_LENGTH,
    damage,
    remaining: RIFT_SWEEP_TICKS,
    hitCooldown: 0,
  };
}

/** Turns the arm one tick. Returns false once the sweep is over. */
export function tickRiftSweep(sweep: RiftSweep): boolean {
  sweep.angle += sweep.degreesPerTick;
  sweep.remaining -= 1;
  if (sweep.hitCooldown > 0) sweep.hitCooldown -= 1;
  return sweep.remaining > 0;
}

/**
 * True while the arm is over this point *and* is allowed to hit again.
 *
 * A rotating arm passes over a stationary pilot for several consecutive ticks,
 * so without the cooldown a single sweep would deal its damage five or six
 * times and read as an instant kill rather than as a thing to fly around.
 */
export function riftSweepHits(sweep: RiftSweep, point: { x: number; y: number }): boolean {
  if (sweep.hitCooldown > 0) return false;
  const dx = point.x - sweep.x;
  const dy = point.y - sweep.y;
  const distance = Math.hypot(dx, dy);
  if (distance > sweep.length) return false;
  const heading = Math.atan2(dy, dx) * (180 / Math.PI);
  const delta = Math.abs((((heading - sweep.angle) % 360) + 540) % 360 - 180);
  return delta <= RIFT_SWEEP_HALF_ANGLE;
}

/** Marks a sweep as having just connected, opening its re-hit cooldown. */
export function markRiftSweepHit(sweep: RiftSweep): void {
  sweep.hitCooldown = 45;
}

/** The deeper of two phases, for a run summary line. */
export function deepestRiftPhase(a: RiftPhase, b: RiftPhase): RiftPhase {
  return riftPhaseIndex(a) >= riftPhaseIndex(b) ? a : b;
}

/** The phase table, re-exported so the pressure system is one import for callers. */
export { RIFT_PHASES };
