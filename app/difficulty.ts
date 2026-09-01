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

/**
 * Every mode a run can be flown in.
 *
 * "classic" is a peer of the others rather than a difficulty: it pins its own
 * physics and drop table instead of scaling an existing ruleset, so there is
 * nothing for a difficulty selector to choose. The id is deliberately stable in
 * code, saves and network payloads — the player-facing name is one label in
 * MODE_INFO and can change at any point without a migration.
 */
export type GameMode = "pve" | "coop" | "pvp" | "classic";
/**
 * Every ruleset a run can be flown under.
 *
 * Not all of them are difficulties in the "pick how hard this is" sense —
 * `practice` and `survival` are whole play styles, and both are chosen
 * somewhere other than the difficulty selector. What they share, and the
 * reason they live in one union, is that the game loop reads their behaviour
 * out of one `DifficultyRules` object instead of branching on which mode it is
 * running.
 */
export type DifficultyId = "practice" | "easy" | "difficult" | "hard" | "survival";

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
      healFraction: number;
      healDurationTicks: number;
      temporaryShieldFraction: number;
      temporaryShieldDurationTicks: number;
      minePulseIntervalTicks: number;
      minePulseCount: number;
    };

export type WallRules = {
  /**
   * Velocity retained after a wall hit, as a negative multiplier.
   *
   * Breach Runner's own modes use -0.55. Classic uses -0.5, the reference
   * client's rebound coefficient, which is a slightly livelier wall.
   */
  bounce: number;
  /** Hull damage per wall scrape. Classic charges nothing for touching a wall. */
  damage: number;
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
  /** Practice ignores every source of pilot hull damage. */
  unlimitedHull: boolean;
  wall: WallRules;
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
/**
 * Wall behaviour for every mode that is not Classic.
 *
 * -0.55 and a 2-point scrape is what Breach Runner has always done: walls are a
 * mild deterrent rather than a hazard. Classic overrides both.
 */
const STANDARD_WALL: WallRules = { bounce: -0.55, damage: 2 };

const HARD_CONTACT: ContactHazardRules = {
  enabled: true,
  radius: 46,
  tickIntervalTicks: ticksForSeconds(0.5),
  damagePerTickFraction: 0.04,
  maxEpisodeFraction: 0.32,
  reentryGraceTicks: ticksForSeconds(0.6),
};

export const DIFFICULTIES: Record<DifficultyId, DifficultyRules> = {
  practice: {
    id: "practice",
    displayName: "SIMULATION // HULL LOCKED",
    shortName: "SIMULATION",
    blurb:
      "Learn the flight controls, weapons, and rift loop without taking hull damage. Practice runs are never submitted to the leaderboard.",
    wormhole: { kind: "locked" },
    collisionShield: { enabled: false },
    contactHazard: { enabled: false },
    unlimitedHull: true,
    wall: STANDARD_WALL,
    rivalIntegrity: 100,
    wormholeEnrage: { enabled: false },
  },
  easy: {
    id: "easy",
    displayName: "STABLE // COLLISION SHIELD",
    shortName: "STABLE",
    blurb:
      "The rift is locked dead centre and never moves. You fly with a collision shield that fully absorbs impact damage from walls and hostile bodies, then recharges four seconds after the last hit — anywhere in the arena.",
    wormhole: { kind: "locked" },
    collisionShield: {
      enabled: true,
      capacity: 40,
      rechargeDelayTicks: ticksForSeconds(4),
    },
    contactHazard: { enabled: false },
    unlimitedHull: false,
    wall: STANDARD_WALL,
    rivalIntegrity: 100,
    wormholeEnrage: { enabled: false },
  },
  difficult: {
    id: "difficult",
    displayName: "VOLATILE // MOVING RIFT",
    shortName: "VOLATILE",
    blurb:
      "The rift orbits with 200 integrity and you have to lead it. At 15% integrity it enrages, turns red, restores 10% of its maximum integrity over 10 seconds, and repeatedly spits out mines, UFOs, and power-up-eating Scarabs. No collision shield — impacts hit hull under the normal rules.",
    wormhole: ORBIT,
    collisionShield: { enabled: false },
    contactHazard: { enabled: false },
    unlimitedHull: false,
    wall: STANDARD_WALL,
    rivalIntegrity: 200,
    wormholeEnrage: {
      enabled: true,
      thresholdFraction: 0.15,
      waveIntervalTicks: ticksForSeconds(10),
      healFraction: 0.1,
      healDurationTicks: ticksForSeconds(10),
      temporaryShieldFraction: 0,
      temporaryShieldDurationTicks: 0,
      minePulseIntervalTicks: 0,
      minePulseCount: 0,
      wave: [
        { enemy: "mines", count: 6 },
        { enemy: "ufo", count: 1 },
        { enemy: "scarab", count: 2 },
      ],
    },
  },
  hard: {
    id: "hard",
    displayName: "CRITICAL // CONTACT HAZARD",
    shortName: "CRITICAL",
    blurb:
      "The rift has 350 integrity, orbits, and touching it burns hull in visible ticks. At 30% integrity it enrages, turns red, restores 20% of its maximum integrity over 10 seconds, gains a 10%-integrity shield for 10 seconds, keeps its mixed hostile waves, and launches extra mines every 3 seconds.",
    wormhole: ORBIT,
    collisionShield: { enabled: false },
    contactHazard: HARD_CONTACT,
    unlimitedHull: false,
    wall: STANDARD_WALL,
    rivalIntegrity: 350,
    wormholeEnrage: {
      enabled: true,
      thresholdFraction: 0.3,
      waveIntervalTicks: ticksForSeconds(10),
      healFraction: 0.2,
      healDurationTicks: ticksForSeconds(10),
      temporaryShieldFraction: 0.1,
      temporaryShieldDurationTicks: ticksForSeconds(10),
      minePulseIntervalTicks: ticksForSeconds(3),
      minePulseCount: 2,
      wave: [
        { enemy: "mines", count: 6 },
        { enemy: "ufo", count: 1 },
        { enemy: "scarab", count: 2 },
      ],
    },
  },
  /**
   * Rift Survival at Rift Level 1.
   *
   * Only the opening minute is described here. Survival re-derives its rules
   * every minute from this baseline — see `survivalRulesFor` in
   * `app/survival.ts` — so this entry is the floor of the escalation curve
   * rather than the whole of it. It lives beside the other rulesets because
   * the loop must be able to look a run's rules up by id like any other.
   */
  survival: {
    id: "survival",
    displayName: "RIFT SURVIVAL // STABLE",
    shortName: "SURVIVAL",
    blurb:
      "Endless. The rift cannot be outlasted — it gains a Rift Level every minute, and each level moves it, arms it, and crowds the arena harder. Time survived is the score.",
    wormhole: { kind: "locked" },
    collisionShield: {
      enabled: true,
      capacity: 40,
      rechargeDelayTicks: ticksForSeconds(4),
    },
    contactHazard: { enabled: false },
    unlimitedHull: false,
    wall: STANDARD_WALL,
    rivalIntegrity: 150,
    wormholeEnrage: { enabled: false },
  },
};

/** Order the selector presents the four PvE choices in. */
export type EnrageRecoveryState = {
  healRemaining: number;
  healTicksLeft: number;
  shield: number;
  shieldTicksLeft: number;
};

export function createEnrageRecovery(): EnrageRecoveryState {
  return { healRemaining: 0, healTicksLeft: 0, shield: 0, shieldTicksLeft: 0 };
}

export function activateEnrageRecovery(state: EnrageRecoveryState, rules: DifficultyRules, maxIntegrity: number) {
  const enrage = rules.wormholeEnrage;
  if (!enrage.enabled) return;
  state.healRemaining = maxIntegrity * enrage.healFraction;
  state.healTicksLeft = enrage.healDurationTicks;
  state.shield = maxIntegrity * enrage.temporaryShieldFraction;
  state.shieldTicksLeft = enrage.temporaryShieldDurationTicks;
}

export function tickEnrageRecovery(state: EnrageRecoveryState, currentIntegrity: number, maxIntegrity: number) {
  let healed = 0;
  if (state.healTicksLeft > 0 && state.healRemaining > 0) {
    const scheduled = state.healRemaining / state.healTicksLeft;
    healed = Math.min(scheduled, Math.max(0, maxIntegrity - currentIntegrity));
    state.healRemaining = Math.max(0, state.healRemaining - scheduled);
    state.healTicksLeft -= 1;
  }
  if (state.shieldTicksLeft > 0) {
    state.shieldTicksLeft -= 1;
    if (state.shieldTicksLeft <= 0) state.shield = 0;
  }
  return healed;
}

export function absorbEnrageShield(state: EnrageRecoveryState, damage: number) {
  const incoming = Math.max(0, damage);
  const absorbed = Math.min(state.shield, incoming);
  state.shield -= absorbed;
  return { absorbed, toIntegrity: incoming - absorbed };
}

/**
 * The four choices the difficulty selector offers.
 *
 * Survival is deliberately absent: it is launched from Challenges and sets its
 * own difficulty from elapsed time, so listing it here would produce exactly
 * the "Survival Easy / Survival Hard" menu the roadmap rules out.
 */
export const DIFFICULTY_ORDER: DifficultyId[] = ["practice", "easy", "difficult", "hard"];

/** Every ruleset id, including the ones the selector does not offer. */
export const RULESET_IDS: DifficultyId[] = [...DIFFICULTY_ORDER, "survival"];

/**
 * PvP runs Easy's safety rules — collision shield on, no contact hazard, no
 * enrage — but its rift orbits rather than sitting locked in the centre.
 *
 * The lock made the rift a stationary target, which is the one thing PvP cannot
 * afford: both pilots are shooting the same kind of objective, so a fixed point
 * reduces the duel to who can hold an angle longest. An orbiting rift is also
 * what the original does, at the same 0.5 degrees per tick every other moving
 * ruleset already uses.
 *
 * Kept as its own object rather than an alias of DIFFICULTIES.easy so this
 * divergence is deliberate and cannot be undone by retuning Easy.
 */
export const PVP_RULES: DifficultyRules = {
  ...DIFFICULTIES.easy,
  wormhole: ORBIT,
};

/**
 * Classic Wormhole's ruleset.
 *
 * Pins its own numbers rather than scaling one of the difficulties, and that is
 * the whole point of the mode: it is not tuned like the modern ones. The rift
 * orbits, walls rebound at the reference coefficient and cost nothing to touch,
 * and none of the modern safety systems are present — no collision shield, no
 * contact hazard, no enrage. A pilot who flies into a wall in Classic loses
 * speed, not hull.
 *
 * Deliberately NOT built by spreading DIFFICULTIES.easy: Classic must not drift
 * when Easy is retuned, and every field here is a decision rather than an
 * inheritance.
 */
export const CLASSIC_RULES: DifficultyRules = {
  id: "easy",
  displayName: "Classic Wormhole",
  shortName: "CLASSIC",
  blurb:
    "The original loop. Every portal orbits, sheds power-ups when shot, and throws whatever you launch into it straight back at its owner.",
  wormhole: { kind: "orbit", radius: 240, degreesPerTick: 0.5 },
  collisionShield: { enabled: false },
  contactHazard: { enabled: false },
  unlimitedHull: false,
  wall: { bounce: -0.5, damage: 0 },
  rivalIntegrity: 100,
  wormholeEnrage: { enabled: false },
};

export function rulesFor(mode: GameMode, difficulty: DifficultyId): DifficultyRules {
  if (mode === "pvp") return PVP_RULES;
  // Classic pins its own rules, so the difficulty selector has nothing to say
  // about it — a Classic run flown from any difficulty is the same run.
  if (mode === "classic") return CLASSIC_RULES;
  // Survival is a solo challenge and has no co-op balance behind it. A
  // survival preference carried into a co-op match falls back to the standard
  // co-op difficulty rather than escalating a shared arena that was never
  // tuned for it.
  if (mode === "coop" && difficulty === "survival") return DIFFICULTIES.difficult;
  return DIFFICULTIES[difficulty];
}

/**
 * Modes that never open a socket.
 *
 * The distinction the game actually cares about at its network seams is solo
 * versus networked, and until Classic gained a mode of its own "pve" was a
 * complete spelling of solo. It is not any more: solo Classic has no opponent,
 * no lobby and no server-owned hull, and treating it as networked made it dial
 * a WebSocket, skip the hull guard and refuse to pause.
 *
 * When versus Classic lands it stops being offline, and this is the one place
 * that has to change.
 */
export function isOfflineMode(mode: GameMode): boolean {
  return mode === "pve" || mode === "classic";
}

/** True when this ruleset is the endless Rift Survival challenge. */
export function isSurvival(rules: DifficultyRules) {
  return rules.id === "survival";
}

export type ArenaDimensions = number | { width: number; height: number };

function arenaCentre(arena: ArenaDimensions) {
  return typeof arena === "number"
    ? { x: arena / 2, y: arena / 2 }
    : { x: arena.width / 2, y: arena.height / 2 };
}

/** Where the wormhole sits this tick, given the arena dimensions and orbit phase. */
export function wormholePosition(
  rules: DifficultyRules,
  arena: ArenaDimensions,
  angleDegrees: number
) {
  const centre = arenaCentre(arena);
  if (rules.wormhole.kind === "locked") return centre;
  const radians = (angleDegrees * Math.PI) / 180;
  return {
    x: centre.x + Math.cos(radians) * rules.wormhole.radius,
    y: centre.y + Math.sin(radians) * rules.wormhole.radius,
  };
}

/**
 * Where the pilot starts. A locked wormhole owns the centre of the arena, so
 * the ship takes the spot the wormhole would otherwise orbit through — the
 * same 210px separation the orbiting modes open with, just mirrored.
 */
export function pilotSpawn(rules: DifficultyRules, arena: ArenaDimensions) {
  const centre = arenaCentre(arena);
  if (rules.wormhole.kind === "locked") return { x: centre.x + ORBIT_SEPARATION, y: centre.y };
  return centre;
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
