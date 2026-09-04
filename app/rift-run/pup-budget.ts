/**
 * The rift's power-up budget.
 *
 * Rift Run used to shed power-ups in proportion to damage: every
 * `portalThreshold` points of nominal cannon damage bloomed one, forever. A
 * rift that never stops paying is a rift worth camping, and camping is exactly
 * what made the mode too easy — the pilot could stand off the rift, farm it
 * for an unbounded supply line, and never be pushed anywhere.
 *
 * So a rift now carries a *budget* instead of a rate. Each rift releases a
 * fixed allocation, paid out as its integrity falls past descending
 * thresholds. Cross 85% and it sheds one; keep shooting and it sheds nothing
 * more until 70%. Once the last band is paid the rift is dry, and the only way
 * to be paid again is to breach it and start on the next one.
 *
 * That converts "shoot the rift" from an income stream into *progress*. The
 * supply line still exists, it is still generous — seven power-ups per rift,
 * more than the old cadence delivered in the same span of a fight — but it is
 * bounded, and it moves in one direction only.
 *
 * Pure and free of React, canvas and timers, so the whole payout curve is
 * testable as data. The game loop owns none of these numbers.
 */

/**
 * Integrity fractions that pay, deepest last.
 *
 * Descending, and checked in order, so a single enormous hit that skips
 * several bands at once pays every band it crossed rather than only the last.
 */
export const RIFT_PUP_THRESHOLDS = [0.85, 0.7, 0.55, 0.4, 0.25, 0.1] as const;

/**
 * Power-ups each band is worth.
 *
 * Flat until the rift is nearly dead, then a parting double. The pilot who
 * pushes a rift the last fifteen percent is the one taking the most fire for
 * it, and the run's hardest moment is the right place to hand over the extra
 * payload rather than the easiest.
 */
export const RIFT_PUP_BAND_ALLOWANCE = [1, 1, 1, 1, 1, 2] as const;

/** Everything one rift will ever release. Seven, whatever route is taken to it. */
export const RIFT_PUP_BUDGET_TOTAL = RIFT_PUP_BAND_ALLOWANCE.reduce((total, band) => total + band, 0);

/** Ticks a rift-shed power-up survives before it expires. ~18s at 20ms ticks. */
export const RIFT_PUP_LIFE_TICKS = 900;

/**
 * Ticks a rift-shed power-up is untouchable after ejection.
 *
 * Inherited from the original client, which made loose power-ups
 * indestructible for the first twenty ticks: the burst that ejects one would
 * otherwise routinely shoot it back out of existence in the same breath, which
 * reads to the pilot as the drop never having happened.
 *
 * About two seconds at the 15ms tick.
 *
 * Twenty ticks -- a third of a second -- let a pilot already firing at the rift
 * destroy the drop before it had cleared the rift's own radius. A full second
 * fixed that but still read as short in play: a drop ejected into a firefight
 * lapsed while the pilot was still turning towards it. Two seconds covers the
 * turn and the approach, and still ends before a PUP that has drifted clear can
 * be reached, so shooting a settled power-up stays a real choice.
 */
export const RIFT_PUP_GRACE_TICKS = 130;

/** Speed range an ejected power-up leaves the rift at. */
// Fast enough to be past the cannon's line of fire before it can hit them
// twice. 1.6-3.4 left them drifting through the pilot's own bullet stream and
// a graze that was meant to bloom the rift ate the drop it just produced.
export const RIFT_PUP_EJECT_SPEED = { min: 3.0, max: 5.4 } as const;

/** How far from the rift centre an ejection starts. */
export const RIFT_PUP_EJECT_OFFSET = 26;

export type RiftPupBudget = {
  /** The next threshold that has not been crossed yet. `length` means dry. */
  band: number;
  /** Power-ups this rift has released so far. */
  released: number;
};

export function createRiftPupBudget(): RiftPupBudget {
  return { band: 0, released: 0 };
}

/** Power-ups this rift has left to give, at any point in its life. */
export function riftPupBudgetRemaining(budget: RiftPupBudget): number {
  return Math.max(0, RIFT_PUP_BUDGET_TOTAL - budget.released);
}

/** True once shooting this rift can no longer produce anything. */
export function riftPupBudgetSpent(budget: RiftPupBudget): boolean {
  return budget.band >= RIFT_PUP_THRESHOLDS.length;
}

/**
 * Books the rift's integrity and returns how many power-ups to eject *now*.
 *
 * Advances through every band the integrity has fallen past since the last
 * call, so one railgun round that takes a rift from full to a sliver pays all
 * six bands rather than swallowing five of them. Called every time integrity
 * changes; returns zero on the overwhelming majority of ticks.
 *
 * Integrity that goes back up — a reformed rift, an enrage heal — never
 * un-books a band. A budget is per rift, and a rift that has already paid for
 * a threshold does not pay for it twice.
 */
export function creditRiftPupBudget(budget: RiftPupBudget, integrityFraction: number): number {
  const fraction = Number.isFinite(integrityFraction) ? Math.max(0, Math.min(1, integrityFraction)) : 1;
  let released = 0;
  while (budget.band < RIFT_PUP_THRESHOLDS.length && fraction <= RIFT_PUP_THRESHOLDS[budget.band]) {
    released += RIFT_PUP_BAND_ALLOWANCE[budget.band];
    budget.band += 1;
  }
  budget.released += released;
  return released;
}

export type RiftPupEjection = { x: number; y: number; vx: number; vy: number; life: number };

/**
 * Where one power-up leaves the rift, and how fast.
 *
 * Outward, always: the old drop jittered a power-up around the rift centre and
 * let it drift, which parked the pilot's supply inside the most dangerous
 * circle in the arena. Ejecting it means collecting it is a trip away from the
 * rift rather than a reason to sit on it.
 *
 * `index` and `count` fan a multi-power-up band evenly around the circle
 * before jitter, so a band that pays two never fires both into the same
 * corner.
 */
export function ejectRiftPup(
  index: number,
  count: number,
  rift: { x: number; y: number },
  random: () => number = Math.random,
): RiftPupEjection {
  const slots = Math.max(1, Math.floor(count));
  const slot = ((Math.floor(index) % slots) + slots) % slots;
  // A whole-turn random offset, so consecutive bands do not all open on east.
  const angle = random() * Math.PI * 2 + (slot / slots) * Math.PI * 2 + (random() - 0.5) * (Math.PI / slots);
  const speed = RIFT_PUP_EJECT_SPEED.min + random() * (RIFT_PUP_EJECT_SPEED.max - RIFT_PUP_EJECT_SPEED.min);
  return {
    x: rift.x + Math.cos(angle) * RIFT_PUP_EJECT_OFFSET,
    y: rift.y + Math.sin(angle) * RIFT_PUP_EJECT_OFFSET,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: RIFT_PUP_LIFE_TICKS,
  };
}

/** A loose power-up can be shot once its ejection grace has elapsed. */
export function riftPupIsShootable(pickup: { life: number }): boolean {
  return pickup.life > 0 && pickup.life <= RIFT_PUP_LIFE_TICKS - RIFT_PUP_GRACE_TICKS;
}
