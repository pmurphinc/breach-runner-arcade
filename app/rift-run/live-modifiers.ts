import type { RiftRunState } from "./types.ts";

type Handling = { acceleration: number; maxSpeed: number };

/** One common hull-loss transform; callers still retain their shield semantics. */
export function riftRunHullDamage(amount: number, state: RiftRunState | null): number {
  if (!state || state.status !== "active") return amount;
  return Math.max(0, amount * (1 - state.shipModifiers.damageReduction));
}

/** Preserve the frame's identity while multiplying its existing flight tuning. */
export function riftRunHandling(base: Handling, state: RiftRunState | null): Handling {
  if (!state || state.status !== "active") return base;
  return {
    acceleration: base.acceleration * state.shipModifiers.movement * state.shipModifiers.handling,
    maxSpeed: base.maxSpeed * state.shipModifiers.movement,
  };
}
