/**
 * Overcharged power-up specials.
 *
 * A ship special used to be bespoke logic bolted onto `activateSpecial`. This
 * module replaces that for the frames that use the pattern: a special is now
 * declared as an *overcharged build of a power-up the game already has*, so the
 * player is never learning a second vocabulary. TRACKER SWARM is still a swarm
 * of homing missiles and CORE BOMB is still an expanding blast — the special
 * version is the same idea with the limiter taken off.
 *
 * Everything here is data plus pure maths. The render loop owns no ability
 * rules, and adding the pattern to a fourth ship is a new entry in
 * `SHIP_OVERCHARGES` rather than another branch in the game loop.
 */
// Explicit .ts extensions so Node's type stripping can load this module in
// tests without a bundler, matching the rest of app/.
import { ticksForSeconds } from "./difficulty.ts";
import { POWER_COLORS, WEAPONS, type PowerId, type ShipId } from "./game-data.ts";

/** Every overcharge in the game. One per ship that opts into the pattern. */
export type OverchargeId = "swarm" | "scrambler" | "core";

/**
 * An expanding ring that sweeps outward from the hull.
 *
 * One shape covers both a damaging detonation and a non-damaging control
 * pulse, because the only difference between them is what the swept band does
 * when it reaches a hostile.
 */
export type OverchargeBlast = {
  /** Peak radius in arena units. */
  radius: number;
  /** Ticks taken to reach `radius`. Shorter reads as a harder hit. */
  expandTicks: number;
  /** Concentric rings drawn and swept. The normal pickups all emit one. */
  rings: number;
  /** Damage at the centre. Zero makes this a pure control pulse. */
  damage: number;
  /** Damage at the rim, interpolated from `damage`. */
  edgeDamage: number;
  /** Outward impulse applied to a hostile the band reaches. */
  knockback: number;
  /** Seconds of scramble applied to a swept hostile. Zero applies none. */
  scrambleSeconds: number;
  /** Whether hostiles killed by the blast always drop a pickup. */
  guaranteedDrops: boolean;
};

/** A fan of friendly homing missiles launched from the hull. */
export type OverchargeVolley = {
  count: number;
  /** Total arc the fan is spread across, centred on the nose. */
  spreadDegrees: number;
  speed: number;
  damage: number;
  lifeTicks: number;
  /** Steering authority in radians per tick. */
  turnRadians: number;
};

/** A temporary handling change applied to the pilot by the special. */
export type OverchargeRider = {
  seconds: number;
  accelerationScale: number;
  maxSpeedScale: number;
};

export type OverchargeSpec = {
  id: OverchargeId;
  ship: ShipId;
  /** Player-facing ability name. Mirrors `SHIP_SPECIALS[ship].name`. */
  name: string;
  /** The ordinary pickup this special is an overcharged build of. */
  source: PowerId;
  /** Ship energy accent, so the effect reads as this frame's special. */
  accent: string;
  cooldownSeconds: number;
  /** Seconds of contact immunity granted on activation. */
  invulnSeconds: number;
  blast?: OverchargeBlast;
  volley?: OverchargeVolley;
  rider?: OverchargeRider;
  /**
   * Fraction of the pilot's momentum left after firing, for a special that
   * shoves its own ship. 1 leaves the flight path untouched.
   */
  recoil?: number;
  /**
   * How the overcharged build differs from the normal pickup, one line each.
   *
   * Written here rather than in the UI so the selection screen, the HUD and
   * the tests all read the same sentences and none of them can drift.
   */
  differences: string[];
};

/** Ticks the hull flare runs for after any overcharge. */
export const OVERCHARGE_FLASH_TICKS = 26;

/**
 * Extra damage a scrambled hostile takes.
 *
 * Scramble is control rather than damage, so it needs a way to convert into
 * progress or it is only ever a delay. Destabilised hostiles taking half again
 * as much is what makes setting one up worth doing.
 */
export const SCRAMBLE_DAMAGE_MULTIPLIER = 1.5;

export const SHIP_OVERCHARGES: Partial<Record<ShipId, OverchargeSpec>> = {
  /**
   * Starling — skirmisher. Burst offence that does not ask the pilot to stop
   * moving, plus the handling rider its old Afterburn special used to be.
   */
  wing: {
    id: "swarm",
    ship: "wing",
    name: "SWARM OVERCHARGE",
    source: "heatseeker",
    accent: "#ffd36b",
    cooldownSeconds: 10,
    invulnSeconds: 0,
    volley: { count: 12, spreadDegrees: 40, speed: 9.5, damage: 20, lifeTicks: 150, turnRadians: 0.14 },
    rider: { seconds: 3, accelerationScale: 1.5, maxSpeedScale: 1.35 },
    differences: [
      "The twelve trackers fly for you instead of hunting you.",
      "20 damage each against a normal tracker's 10 on contact.",
      "Launched from the hull rather than out of the rift mouth.",
      "Faster and harder-steering: 9.5 speed and 8° of correction a tick.",
      "Carries a three-second afterburn so you can leave the volley behind.",
      "With the arena clear the swarm charges the rift instead of idling.",
    ],
  },

  /**
   * Phantom — trickster. PULSE SCRAMBLER turned outward: the hostiles get the
   * inverted controls this time, and Phantom phases out while it lands.
   */
  squid: {
    id: "scrambler",
    ship: "squid",
    name: "SCRAMBLER OVERCHARGE",
    source: "emp",
    accent: "#b58bff",
    cooldownSeconds: 14,
    invulnSeconds: 2.5,
    blast: {
      radius: 430,
      expandTicks: 34,
      rings: 3,
      damage: 0,
      edgeDamage: 0,
      knockback: 2.4,
      scrambleSeconds: 4,
      guaranteedDrops: false,
    },
    rider: { seconds: 2.5, accelerationScale: 1, maxSpeedScale: 1.15 },
    differences: [
      "Scrambles every hostile it sweeps instead of scrambling you.",
      "Three rings rather than one, out to 430 units against 320.",
      "Fires the instant you press it, with no arming delay to wait out.",
      "Scrambled hostiles fly backwards and hold their fire for four seconds.",
      "They also take 50% more damage while the scramble holds.",
      "Phantom phases for 2.5 seconds and gains 15% top speed to reposition.",
    ],
  },

  /**
   * Talon — brawler. CORE BOMB with the countdown removed and the blast
   * pointed the other way, at the cost of being staggered where it stands.
   */
  hunter: {
    id: "core",
    ship: "hunter",
    name: "CORE OVERCHARGE",
    source: "nuke",
    accent: "#ff8a3d",
    cooldownSeconds: 18,
    invulnSeconds: 0.8,
    blast: {
      radius: 340,
      expandTicks: 24,
      rings: 2,
      damage: 95,
      edgeDamage: 45,
      knockback: 9,
      scrambleSeconds: 0,
      guaranteedDrops: true,
    },
    rider: { seconds: 1.6, accelerationScale: 0.45, maxSpeedScale: 0.6 },
    recoil: 0.25,
    differences: [
      "Detonates on contact with the button, not after a nine-second timer.",
      "Centred on your hull instead of parked wherever the rift dropped it.",
      "Guts hostiles rather than you: 95 damage at the core, 45 at the rim.",
      "Throws survivors outward with a nine-unit shockwave.",
      "Everything the blast kills leaves a power-up behind.",
      "Talon rides it out immune, then flies staggered for 1.6 seconds.",
    ],
  },
};

/** The overcharge a ship flies, or null when it uses a bespoke special. */
export function overchargeFor(ship: ShipId): OverchargeSpec | null {
  return SHIP_OVERCHARGES[ship] ?? null;
}

/** "Overcharged TRACKER SWARM" — the one line that names the derivation. */
export function overchargeSource(spec: OverchargeSpec) {
  return `Overcharged ${WEAPONS[spec.source].name}`;
}

/** Colour of the pickup this special is built from, for the shared visuals. */
export function overchargeSourceColor(spec: OverchargeSpec) {
  return POWER_COLORS[spec.source];
}

/* ------------------------------------------------------------- geometry -- */

/**
 * Headings for a volley, in degrees, centred on the ship's nose.
 *
 * A single missile fires straight ahead rather than at one edge of the arc,
 * which is the case a naive `index * step` gets wrong.
 */
export function volleyHeadings(noseDegrees: number, count: number, spreadDegrees: number) {
  const total = Math.max(1, Math.floor(count));
  if (total === 1) return [noseDegrees];
  const step = spreadDegrees / (total - 1);
  const first = noseDegrees - spreadDegrees / 2;
  return Array.from({ length: total }, (_, index) => first + index * step);
}

/**
 * Radius of the blast band this tick.
 *
 * Eased so the ring leaves fast and settles at the rim, which is what makes a
 * detonation read as a detonation rather than a growing circle.
 */
export function blastRadiusAt(age: number, blast: OverchargeBlast) {
  const progress = Math.max(0, Math.min(1, age / Math.max(1, blast.expandTicks)));
  return blast.radius * (1 - (1 - progress) ** 2);
}

/**
 * Damage at a distance from the centre, falling from `damage` to `edgeDamage`.
 *
 * Anything past the rim takes nothing, so a hostile the ring never reached is
 * never quietly caught by rounding.
 */
export function blastDamageAt(distance: number, blast: OverchargeBlast) {
  if (blast.damage <= 0) return 0;
  if (distance > blast.radius) return 0;
  const reach = Math.max(0, Math.min(1, distance / Math.max(1, blast.radius)));
  return blast.damage + (blast.edgeDamage - blast.damage) * reach;
}

/** Ring radii for one frame of the effect, outermost first. */
export function blastRingRadii(age: number, blast: OverchargeBlast) {
  const leading = blastRadiusAt(age, blast);
  return Array.from({ length: Math.max(1, blast.rings) }, (_, index) =>
    Math.max(0, leading - index * (blast.radius / (Math.max(1, blast.rings) * 2.6))),
  );
}

/** Handling with a rider applied. Absent riders leave the numbers untouched. */
export function riderHandling(
  acceleration: number,
  maxSpeed: number,
  rider: OverchargeRider | null,
) {
  if (!rider) return { acceleration, maxSpeed };
  return {
    acceleration: acceleration * rider.accelerationScale,
    maxSpeed: maxSpeed * rider.maxSpeedScale,
  };
}

/** Damage a hostile takes from one hit, after any scramble multiplier. */
export function scrambledDamage(damage: number, scrambled: boolean) {
  return scrambled ? damage * SCRAMBLE_DAMAGE_MULTIPLIER : damage;
}

/* ---------------------------------------------------------- shot budget -- */

/**
 * Whether a round counts against the cannon's on-screen shot budget.
 *
 * `SHOT_LEVELS` caps how many player rounds may be alive at once, and that cap
 * used to be measured over every friendly bullet including the ones a special
 * fired. Talon's old 17-round Missile Fan therefore spent almost the whole
 * MK0 budget of 20 on itself and silently disabled the cannon that fired it
 * for the entire flight of the volley — a penalty nothing in the game told the
 * player about. Special rounds now sit outside the budget entirely.
 */
export function countsTowardShotBudget(bullet: { enemy: boolean; special?: boolean }) {
  return !bullet.enemy && !bullet.special;
}

/** Rounds from `bullets` that the cannon's budget actually has to pay for. */
export function cannonShotBudgetUsed(bullets: readonly { enemy: boolean; special?: boolean }[]) {
  let used = 0;
  for (const bullet of bullets) if (countsTowardShotBudget(bullet)) used += 1;
  return used;
}

/* -------------------------------------------------------------- timings -- */

/** Every duration in the spec, converted to simulation ticks in one place. */
export function overchargeTicks(spec: OverchargeSpec) {
  return {
    cooldown: ticksForSeconds(spec.cooldownSeconds),
    invuln: ticksForSeconds(spec.invulnSeconds),
    flash: OVERCHARGE_FLASH_TICKS,
    rider: spec.rider ? ticksForSeconds(spec.rider.seconds) : 0,
    scramble: spec.blast ? ticksForSeconds(spec.blast.scrambleSeconds) : 0,
    /** How long the visual is kept alive after the band reaches the rim. */
    blast: spec.blast ? spec.blast.expandTicks + 26 : 0,
  };
}
