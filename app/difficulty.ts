/**
 * Centralized difficulty rules for Wormhole Arcade.
 *
 * Everything that varies between EASY, DIFFICULT and HARD MODE is declared
 * here as data, and the two stateful systems those rules drive — the collision
 * shield and the wormhole contact hazard — are implemented as pure functions
 * over plain state objects. The game loop reads rules and calls these; it does
 * not branch on the difficulty id.
 *
 * Pure by design so the rules can be tested directly (see
 * `tests/difficulty.test.mjs`) without standing up a canvas or a game loop.
 */

/** Fixed simulation step, shared with the game loop. */
export const TICK_MS = 15;

/** Ticks in a given number of seconds, rounded to the nearest whole tick. */
export function ticksForSeconds(seconds: number) {
  return Math.round((seconds * 1000) / TICK_MS);
}

/** Seconds remaining, for countdown readouts. One decimal place. */
export function secondsForTicks(ticks: number) {
  return Math.max(0, Math.round((ticks * TICK_MS) / 100) / 10);
}

export type GameMode = "pve" | "pvp";
export type DifficultyId = "easy" | "difficult" | "hard";

/** How the rival wormhole behaves in the arena. */
export type WormholeMotion =
  | { kind: "locked" }
  | { kind: "orbit"; radius: number; degreesPerTick: number };

export type CollisionShieldRules =
  | { enabled: false }
  | {
      enabled: true;
      /**
       * Total collision damage the shield absorbs before hull is exposed.
       *
       * 40 is chosen against the collision damage the game actually deals:
       * a mine or inflator body is 20, a heatseeker 10, a generic hostile 8,
       * and a wall scrape 2. So a full shield eats two mine hits, five
       * ordinary hostile bumps, or twenty wall scrapes. That covers the
       * incidental contact of ordinary flying without making a pilot who
       * keeps ramming things effectively immortal — the fourth reckless
       * collision in a row lands on hull.
       */
      capacity: number;
      /** Uninterrupted ticks without collision damage before a full restore. */
      rechargeDelayTicks: number;
    };

export type ContactHazardRules =
  | { enabled: false }
  | {
      enabled: true;
      /** Distance from the wormhole centre that counts as contact. */
      radius: number;
      /** Ticks between damage ticks, so damage is countable rather than instant. */
      tickIntervalTicks: number;
      /** Damage per tick as a fraction of the ship's maximum hull. */
      damagePerTickFraction: number;
      /** Hard ceiling on one continuous contact episode, as a fraction of max hull. */
      maxEpisodeFraction: number;
      /**
       * Ticks the pilot must stay clear before the episode is considered over.
       * Stops edge jitter at the contact boundary registering as a fresh
       * episode (and so resetting the episode cap).
       */
      reentryGraceTicks: number;
    };

export type EnrageEnemy = "mines" | "ufo" | "scarab";

export type WormholeEnrageRules =
  | { enabled: false }
  | {
      enabled: true;
      /** Remaining rival-integrity fraction that activates enrage. */
      thresholdFraction: number;
      /** Delay between automatic enrage waves. */
      waveIntervalTicks: number;
      /** Mixed hostile wave emitted by the enraged wormhole. */
      wave: ReadonlyArray<{ enemy: EnrageEnemy; count: number }>;
    };

export type DifficultyRules = {
  id: DifficultyId;
  /** Player-facing name, exactly as shown in the selector and HUD. */
  displayName: string;
  /** Short label for compact badges. */
  shortName: string;
  /** One sentence explaining the mode before the player starts. */
  blurb: string;
  wormhole: WormholeMotion;
  collisionShield: CollisionShieldRules;
  contactHazard: ContactHazardRules;
  /** Starting rival integrity for this difficulty. Standard integrity is 100. */
  rivalIntegrity: number;
  wormholeEnrage: WormholeEnrageRules;
};

/** Wormhole orbit used by DIFFICULT and HARD MODE — the game's existing motion. */
const ORBIT: WormholeMotion = { kind: "orbit", radius: 210, degreesPerTick: 0.5 };

/**
 * HARD MODE contact damage.
 *
 * 4% of maximum hull every 0.5s, capped at 32% of maximum hull per episode.
 * Scaling against max hull rather than using a flat number keeps the mode
 * equally survivable in a 240-hull interceptor and a heavy frame.
 *
 * The 32% cap is what makes the required guarantees hold:
 *  - one continuous episode can never destroy a full-health pilot (32% < 100%)
 *  - three separate episodes still leave 4% hull, so contact damage alone
 *    needs a fourth — comfortably satisfying "at least three".
 * Reaching the cap takes eight ticks, i.e. four seconds of unbroken overlap.
 */
const HARD_CONTACT: ContactHazardRules = {
  enabled: true,
  radius: 46,
  tickIntervalTicks: ticksForSeconds(0.5),
  damagePerTickFraction: 0.04,
  maxEpisodeFraction: 0.32,
  reentryGraceTicks: ticksForSeconds(0.6),
};

export const DIFFICULTIES: Record<DifficultyId, DifficultyRules> = {
  easy: {
    id: "easy",
    displayName: "EASY // COLLISION SHIELD",
    shortName: "EASY",
    blurb:
      "The wormhole is locked dead centre and never moves. You fly with a collision shield that fully absorbs impact damage from walls and hostile bodies, then recharges four seconds after the last hit — anywhere in the arena.",
    wormhole: { kind: "locked" },
    collisionShield: {
      enabled: true,
      capacity: 40,
      rechargeDelayTicks: ticksForSeconds(4),
    },
    contactHazard: { enabled: false },
    rivalIntegrity: 100,
    wormholeEnrage: { enabled: false },
  },
  difficult: {
    id: "difficult",
    displayName: "DIFFICULT // MOVING VOID",
    shortName: "DIFFICULT",
    blurb:
      "The wormhole orbits with 200 integrity and you have to lead it. At 15% integrity it enrages, turns red, and repeatedly spits out mines, UFOs, and power-up-eating Scarabs. No collision shield — impacts hit hull under the normal rules.",
    wormhole: ORBIT,
    collisionShield: { enabled: false },
    contactHazard: { enabled: false },
    rivalIntegrity: 200,
    wormholeEnrage: {
      enabled: true,
      thresholdFraction: 0.15,
      waveIntervalTicks: ticksForSeconds(10),
      wave: [
        { enemy: "mines", count: 6 },
        { enemy: "ufo", count: 1 },
        { enemy: "scarab", count: 2 },
      ],
    },
  },
  hard: {
    id: "hard",
    displayName: "HARD MODE // CONTACT HAZARD",
    shortName: "HARD MODE",
    blurb:
      "The wormhole has 350 integrity, orbits, and touching it burns hull in visible ticks. At 30% integrity it enrages, turns red, and repeatedly spits out mines, UFOs, and power-up-eating Scarabs.",
    wormhole: ORBIT,
    collisionShield: { enabled: false },
    contactHazard: HARD_CONTACT,
    rivalIntegrity: 350,
    wormholeEnrage: {
      enabled: true,
      thresholdFraction: 0.3,
      waveIntervalTicks: ticksForSeconds(10),
      wave: [
        { enemy: "mines", count: 6 },
        { enemy: "ufo", count: 1 },
        { enemy: "scarab", count: 2 },
      ],
    },
  },
};

/** Order the selector presents the three PvE difficulties in. */
export const DIFFICULTY_ORDER: DifficultyId[] = ["easy", "difficult", "hard"];

/**
 * PvP always runs Easy rules: centred wormhole, collision shield, no contact
 * hazard. Kept as its own export so the intent is explicit at every call site
 * rather than PvP quietly reading a PvE difficulty.
 */
export const PVP_RULES: DifficultyRules = DIFFICULTIES.easy;

export function rulesFor(mode: GameMode, difficulty: DifficultyId): DifficultyRules {
  return mode === "pvp" ? PVP_RULES : DIFFICULTIES[difficulty];
}

/** Where the wormhole sits this tick, given the arena size and orbit phase. */
export function wormholePosition(
  rules: DifficultyRules,
  worldSize: number,
  angleDegrees: number
) {
  const centre = worldSize / 2;
  if (rules.wormhole.kind === "locked") return { x: centre, y: centre };
  const radians = (angleDegrees * Math.PI) / 180;
  return {
    x: centre + Math.cos(radians) * rules.wormhole.radius,
    y: centre + Math.sin(radians) * rules.wormhole.radius,
  };
}

/**
 * Where the pilot starts. A locked wormhole owns the centre of the arena, so
 * the ship takes the spot the wormhole would otherwise orbit through — the
 * same 210px separation the orbiting modes open with, just mirrored.
 */
export function pilotSpawn(rules: DifficultyRules, worldSize: number) {
  const centre = worldSize / 2;
  if (rules.wormhole.kind === "locked") return { x: centre + ORBIT_SEPARATION, y: centre };
  return { x: centre, y: centre };
}

const ORBIT_SEPARATION = 210;

/** Advance the orbit phase. A locked wormhole ignores this entirely. */
export function advanceWormholeAngle(rules: DifficultyRules, angleDegrees: number) {
  if (rules.wormhole.kind === "locked") return 0;
  return (angleDegrees + rules.wormhole.degreesPerTick) % 360;
}

// ---------------------------------------------------------------- shield --

export type CollisionShieldState = {
  /** Remaining absorption. Zero means broken until it recharges. */
  charge: number;
  capacity: number;
  /** Ticks left on the recharge delay. Zero when the shield is already full. */
  rechargeIn: number;
};

export function createCollisionShield(
  rules: DifficultyRules
): CollisionShieldState | null {
  const shield = rules.collisionShield;
  if (!shield.enabled) return null;
  return { charge: shield.capacity, capacity: shield.capacity, rechargeIn: 0 };
}

export type ShieldAbsorption = {
  /** Damage that still reaches hull after the shield took its part. */
  toHull: number;
  absorbed: number;
  /** True when this hit emptied a shield that had charge a moment ago. */
  broke: boolean;
};

/**
 * Applies collision damage to the shield first.
 *
 * Callers must only route genuine *collision* damage here — wall contact and
 * hostile bodies. Projectiles, beams and blasts keep their existing path
 * straight to hull, which is what stops this shield becoming a blanket
 * immunity to everything.
 *
 * Mutates `state` and returns what happened, so the caller can play the right
 * feedback without re-deriving it.
 */
export function absorbCollisionDamage(
  state: CollisionShieldState,
  amount: number,
  rules: DifficultyRules
): ShieldAbsorption {
  const shield = rules.collisionShield;
  if (!shield.enabled || amount <= 0) {
    return { toHull: Math.max(0, amount), absorbed: 0, broke: false };
  }

  const hadCharge = state.charge > 0;
  const absorbed = Math.min(state.charge, amount);
  state.charge -= absorbed;

  // Any collision damage restarts the delay, even one the shield fully ate,
  // and even one that landed while the shield was already empty.
  state.rechargeIn = shield.rechargeDelayTicks;

  return {
    toHull: amount - absorbed,
    absorbed,
    broke: hadCharge && state.charge === 0,
  };
}

export type ShieldTick = {
  /** True on the tick the shield came back to full. */
  restored: boolean;
};

/**
 * Counts down the recharge delay. Position in the arena is deliberately not an
 * input: the shield recharges anywhere, and never depends on the wormhole.
 */
export function tickCollisionShield(
  state: CollisionShieldState,
  rules: DifficultyRules
): ShieldTick {
  const shield = rules.collisionShield;
  if (!shield.enabled) return { restored: false };
  if (state.charge >= state.capacity) {
    state.rechargeIn = 0;
    return { restored: false };
  }
  if (state.rechargeIn > 0) {
    state.rechargeIn -= 1;
    if (state.rechargeIn > 0) return { restored: false };
  }
  state.charge = state.capacity;
  state.rechargeIn = 0;
  return { restored: true };
}

// ---------------------------------------------------------- contact hazard --

export type ContactHazardState = {
  /** Whether an episode is currently open. */
  active: boolean;
  /** Damage already dealt in the open episode. */
  episodeDamage: number;
  /** Ticks until the next damage tick. */
  nextTickIn: number;
  /**
   * Ticks of clearance remaining before an open episode closes. Refilled every
   * tick the pilot is inside, so brief jitter across the boundary does not end
   * the episode and hand back a fresh cap.
   */
  graceLeft: number;
};

export function createContactHazard(): ContactHazardState {
  return { active: false, episodeDamage: 0, nextTickIn: 0, graceLeft: 0 };
}

export type ContactHazardResult = {
  /** Hull damage to apply this tick. Zero on most ticks. */
  damage: number;
  /** True on the tick a fresh episode opened. */
  entered: boolean;
  /** True on the tick the episode closed after full clearance. */
  exited: boolean;
  /** True while the open episode has hit its cap and can do no more. */
  capped: boolean;
  /** True while the pilot is inside the radius, for warning UI. */
  overlapping: boolean;
};

const NO_CONTACT: ContactHazardResult = {
  damage: 0,
  entered: false,
  exited: false,
  capped: false,
  overlapping: false,
};

/**
 * One tick of the wormhole contact hazard.
 *
 * `distance` is the pilot's distance from the wormhole centre. An episode runs
 * from the first overlap until the pilot has been clear for the whole grace
 * period; within one episode the damage total can never exceed the configured
 * fraction of maximum hull, and once capped further overlap costs nothing.
 */
export function tickContactHazard(
  state: ContactHazardState,
  rules: DifficultyRules,
  distance: number,
  maxHealth: number
): ContactHazardResult {
  const hazard = rules.contactHazard;
  if (!hazard.enabled) {
    state.active = false;
    state.episodeDamage = 0;
    state.graceLeft = 0;
    state.nextTickIn = 0;
    return NO_CONTACT;
  }

  const overlapping = distance <= hazard.radius;

  if (!state.active) {
    if (!overlapping) return NO_CONTACT;
    // Fresh episode: the first tick lands immediately so contact is never
    // silent, then subsequent ticks follow the interval.
    state.active = true;
    state.episodeDamage = 0;
    state.graceLeft = hazard.reentryGraceTicks;
    const damage = episodeDamage(state, hazard, maxHealth);
    state.nextTickIn = hazard.tickIntervalTicks;
    return {
      damage,
      entered: true,
      exited: false,
      capped: isCapped(state, hazard, maxHealth),
      overlapping: true,
    };
  }

  if (overlapping) {
    state.graceLeft = hazard.reentryGraceTicks;
  } else {
    state.graceLeft -= 1;
    if (state.graceLeft <= 0) {
      state.active = false;
      state.episodeDamage = 0;
      state.nextTickIn = 0;
      return { ...NO_CONTACT, exited: true };
    }
  }

  // Damage only accrues while genuinely overlapping; the grace window keeps the
  // episode open but costs nothing on its own.
  if (!overlapping) {
    return {
      damage: 0,
      entered: false,
      exited: false,
      capped: isCapped(state, hazard, maxHealth),
      overlapping: false,
    };
  }

  state.nextTickIn -= 1;
  if (state.nextTickIn > 0) {
    return {
      damage: 0,
      entered: false,
      exited: false,
      capped: isCapped(state, hazard, maxHealth),
      overlapping: true,
    };
  }

  const damage = episodeDamage(state, hazard, maxHealth);
  state.nextTickIn = hazard.tickIntervalTicks;
  return {
    damage,
    entered: false,
    exited: false,
    capped: isCapped(state, hazard, maxHealth),
    overlapping: true,
  };
}

function episodeCap(
  hazard: Extract<ContactHazardRules, { enabled: true }>,
  maxHealth: number
) {
  return maxHealth * hazard.maxEpisodeFraction;
}

function isCapped(
  state: ContactHazardState,
  hazard: Extract<ContactHazardRules, { enabled: true }>,
  maxHealth: number
) {
  return state.episodeDamage >= episodeCap(hazard, maxHealth);
}

/** Damage for one tick, trimmed so the episode total never passes its cap. */
function episodeDamage(
  state: ContactHazardState,
  hazard: Extract<ContactHazardRules, { enabled: true }>,
  maxHealth: number
) {
  const remaining = episodeCap(hazard, maxHealth) - state.episodeDamage;
  if (remaining <= 0) return 0;
  const damage = Math.min(remaining, maxHealth * hazard.damagePerTickFraction);
  state.episodeDamage += damage;
  return damage;
}
