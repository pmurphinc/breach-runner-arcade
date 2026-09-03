/**
 * Environmental hazards — the arena itself becomes hostile.
 *
 * Rift Run's design philosophy is that the pilot becomes powerful while the
 * arena becomes hostile. The upgrade systems deliver the first half well: by
 * the third breach a run is flying something the starter frame would not
 * recognise. Nothing was delivering the second half. Hostiles got faster and
 * more numerous, but the *room* stayed a friendly empty rectangle, and a
 * powerful build in a friendly room is exactly the "too easy" complaint.
 *
 * So the room gets its own antagonist. This module owns the whole lifecycle of
 * an environmental hazard — selection, warning, telegraph, spawn, live window,
 * collision and expiry — in one scheduler, because those stages only make
 * sense together. A hazard that spawns without a warning is unfair; a warning
 * with no hazard behind it is noise; and two lethal hazards that happen to
 * overlap is a death the pilot could not have avoided.
 *
 * Four hazards to start:
 *
 *   - ASTEROID STRIKE — a single marked impact point, lethal, dodged by leaving.
 *   - METEOR STORM    — several impacts in sequence across the arena, lethal.
 *   - RIFT PULSE      — a wide, slow expansion from the rift, pressure only:
 *                       it hurts but is survivable, and its job is to move the
 *                       pilot rather than to kill them.
 *   - GRAVITY WELL    — a persistent pull toward a point, pressure only, no
 *                       damage of its own. It makes every *other* danger in
 *                       the arena harder to answer.
 *
 * Two gates open a hazard, and both must be satisfied. Run **Depth** is the
 * primary: hazards belong to a run that has proved it can collapse a rift.
 * Player **Level** is a secondary floor, because depth alone is gameable — a
 * lucky opening burst can breach the first rift in ninety seconds on a level-2
 * build, and opening asteroid strikes on that pilot is punishing a good run
 * rather than a deep one.
 *
 * Hazards are split into `lethal` and `pressure` categories, and the scheduler
 * enforces the fairness guarantee on the lethal half only: at most one lethal
 * event at a time, never on top of a rift retaliation, and a mandatory rest
 * after each. Pressure hazards are free to overlap anything, including each
 * other — that is what makes them pressure rather than lethality.
 *
 * Pure, React-free and canvas-free, so the whole schedule is testable as data.
 */

export type RiftHazardId = "asteroid-strike" | "meteor-storm" | "rift-pulse" | "gravity-well";

/**
 * What a hazard is allowed to do to a pilot.
 *
 * `lethal` hazards deal enough damage to end a run and are therefore subject
 * to the overlap guarantee. `pressure` hazards shape where the pilot can fly
 * and cost some hull for ignoring them, but are never the sole cause of death.
 */
export type RiftHazardCategory = "lethal" | "pressure";

export type RiftHazardSpec = {
  id: RiftHazardId;
  /** Player-facing name, used verbatim in the warning plate. */
  name: string;
  category: RiftHazardCategory;
  /** Breaches the run must have banked before this hazard is eligible. */
  fromDepth: number;
  /**
   * Pilot level floor.
   *
   * The secondary gate. Depth says the run is deep; level says the build can
   * answer what depth is about to send.
   */
  fromLevel: number;
  /** Ticks the warning plate shows before the telegraph is dangerous. */
  warningTicks: number;
  /** Ticks the hazard stays live and collidable after the warning. */
  liveTicks: number;
  /** Ticks between attempts to schedule this hazard once eligible. */
  intervalTicks: number;
  /** Hull damage one contact costs. Zero for a hazard that only moves people. */
  damage: number;
  /** Radius of the danger zone. */
  radius: number;
  /** Impacts one event produces. One for everything except the meteor storm. */
  impacts: number;
  /** Ticks between successive impacts of a multi-impact event. */
  impactSpacingTicks: number;
};

/**
 * The hazard table.
 *
 * Read top to bottom as the answer to "what does depth N put in the room?".
 * The pressure pair opens first and stays cheap; the lethal pair opens later
 * and is rationed by the overlap guarantee below.
 */
export const RIFT_HAZARDS: readonly RiftHazardSpec[] = [
  {
    id: "rift-pulse",
    name: "RIFT PULSE",
    category: "pressure",
    fromDepth: 1,
    fromLevel: 3,
    warningTicks: 55,
    liveTicks: 90,
    intervalTicks: 620,
    damage: 8,
    radius: 300,
    impacts: 1,
    impactSpacingTicks: 0,
  },
  {
    id: "asteroid-strike",
    name: "ASTEROID STRIKE",
    category: "lethal",
    fromDepth: 1,
    fromLevel: 5,
    warningTicks: 70,
    liveTicks: 26,
    intervalTicks: 780,
    damage: 26,
    radius: 118,
    impacts: 1,
    impactSpacingTicks: 0,
  },
  {
    id: "meteor-storm",
    name: "METEOR STORM",
    category: "lethal",
    fromDepth: 2,
    fromLevel: 8,
    warningTicks: 90,
    liveTicks: 26,
    intervalTicks: 1150,
    damage: 22,
    radius: 96,
    impacts: 5,
    impactSpacingTicks: 34,
  },
  {
    id: "gravity-well",
    name: "GRAVITY WELL",
    category: "pressure",
    fromDepth: 3,
    fromLevel: 11,
    warningTicks: 70,
    liveTicks: 460,
    intervalTicks: 1500,
    damage: 0,
    radius: 420,
    impacts: 1,
    impactSpacingTicks: 0,
  },
];

/** Ticks of enforced quiet after a lethal hazard finishes. */
export const RIFT_HAZARD_LETHAL_REST_TICKS = 220;

/** Ticks before the first hazard of a run may be scheduled at all. */
export const RIFT_HAZARD_OPENING_GRACE_TICKS = 420;

/** How far from the pilot an impact point is allowed to be placed. */
export const RIFT_HAZARD_IMPACT_SPREAD = 260;

/** Keeps an impact point inside the arena by this margin. */
export const RIFT_HAZARD_ARENA_MARGIN = 60;

export function riftHazardSpec(id: RiftHazardId): RiftHazardSpec {
  const found = RIFT_HAZARDS.find((hazard) => hazard.id === id);
  if (!found) throw new Error(`unknown rift hazard: ${id}`);
  return found;
}

/**
 * Hazards a run at this depth and level may see.
 *
 * Both gates, always. A depth-4 run on a level-3 build gets the same short
 * list a depth-1 run does, which is the point: the arena escalates with the
 * pilot, not merely with the clock.
 */
export function availableHazards(depth: number, level: number): RiftHazardSpec[] {
  const safeDepth = Math.max(0, Math.floor(Number.isFinite(depth) ? depth : 0));
  const safeLevel = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  return RIFT_HAZARDS.filter((hazard) => safeDepth >= hazard.fromDepth && safeLevel >= hazard.fromLevel);
}

/** One live danger zone in the arena. */
export type RiftHazardImpact = {
  x: number;
  y: number;
  radius: number;
  /** Ticks of warning left. Dangerous only once this reaches zero. */
  warningTicks: number;
  /** Ticks of live window left, once the warning has elapsed. */
  liveTicks: number;
  /** True once this impact has already cost the pilot hull. */
  struck: boolean;
};

export type RiftHazardEvent = {
  id: RiftHazardId;
  name: string;
  category: RiftHazardCategory;
  damage: number;
  impacts: RiftHazardImpact[];
  /** Ticks until the whole event may be discarded. */
  remaining: number;
};

export type RiftHazardScheduler = {
  /** Ticks until the next scheduling attempt. */
  nextIn: number;
  active: RiftHazardEvent[];
  /** Ticks of enforced quiet before another lethal hazard may be scheduled. */
  lethalRest: number;
  /** Hazards this run has fired, newest last. Used to avoid immediate repeats. */
  history: RiftHazardId[];
};

export function createRiftHazardScheduler(): RiftHazardScheduler {
  return { nextIn: RIFT_HAZARD_OPENING_GRACE_TICKS, active: [], lethalRest: 0, history: [] };
}

/** True while a lethal hazard is warning or live. */
export function lethalHazardActive(scheduler: RiftHazardScheduler): boolean {
  return scheduler.active.some((event) => event.category === "lethal");
}

/** True while any hazard at all is in the arena. */
export function riftHazardActive(scheduler: RiftHazardScheduler): boolean {
  return scheduler.active.length > 0;
}

/** The live gravity-well pull a scheduler is applying, or zero. */
export function riftHazardGravity(scheduler: RiftHazardScheduler): { x: number; y: number; pull: number } | null {
  const well = scheduler.active.find((event) => event.id === "gravity-well");
  const impact = well?.impacts.find((point) => point.warningTicks <= 0 && point.liveTicks > 0);
  if (!well || !impact) return null;
  return { x: impact.x, y: impact.y, pull: 0.05 };
}

export type RiftHazardContext = {
  depth: number;
  level: number;
  arena: { width: number; height: number };
  playerX: number;
  playerY: number;
  riftX: number;
  riftY: number;
  /**
   * True while the rift itself is telegraphing or resolving a retaliation.
   *
   * The other half of the fairness guarantee. `rift-pressure.ts` asks this
   * scheduler the mirror-image question, so neither system can open a lethal
   * event while the other one owns the arena.
   */
  retaliationActive?: boolean;
  random?: () => number;
};

export type RiftHazardTick = {
  /** Events that began their warning on this tick. Announce these. */
  warned: RiftHazardEvent[];
  /** Impacts that became dangerous on this tick. Draw and sound these. */
  erupted: RiftHazardImpact[];
  /** Events that finished on this tick and have been removed. */
  expired: RiftHazardEvent[];
};

/** Places one impact point, clamped inside the arena. */
function placeImpact(
  spec: RiftHazardSpec,
  context: RiftHazardContext,
  random: () => number,
  index: number,
): RiftHazardImpact {
  const margin = RIFT_HAZARD_ARENA_MARGIN;
  // A rift pulse and a gravity well are anchored on the rift; impacts hunt the
  // pilot. Either way the point is clamped, so nothing lands in a wall where
  // it cannot be seen or dodged.
  const anchored = spec.id === "rift-pulse" || spec.id === "gravity-well";
  const baseX = anchored ? context.riftX : context.playerX;
  const baseY = anchored ? context.riftY : context.playerY;
  const spread = anchored ? 0 : RIFT_HAZARD_IMPACT_SPREAD;
  const x = Math.max(margin, Math.min(context.arena.width - margin, baseX + (random() - 0.5) * 2 * spread));
  const y = Math.max(margin, Math.min(context.arena.height - margin, baseY + (random() - 0.5) * 2 * spread));
  return {
    x,
    y,
    radius: spec.radius,
    warningTicks: spec.warningTicks + index * spec.impactSpacingTicks,
    liveTicks: spec.liveTicks,
    struck: false,
  };
}

function buildEvent(spec: RiftHazardSpec, context: RiftHazardContext, random: () => number): RiftHazardEvent {
  const impacts = Array.from({ length: Math.max(1, spec.impacts) }, (_unused, index) =>
    placeImpact(spec, context, random, index));
  const longest = impacts.reduce((most, impact) => Math.max(most, impact.warningTicks + impact.liveTicks), 0);
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    damage: spec.damage,
    impacts,
    remaining: longest,
  };
}

/**
 * Picks the hazard to fire, or null when none may fire right now.
 *
 * Exported because the selection rule is the part most worth pinning in a
 * test: which hazards are eligible, which are refused by the overlap
 * guarantee, and how the immediate-repeat brake behaves.
 */
export function selectHazard(
  scheduler: RiftHazardScheduler,
  context: RiftHazardContext,
  random: () => number = Math.random,
): RiftHazardSpec | null {
  const eligible = availableHazards(context.depth, context.level);
  if (eligible.length === 0) return null;

  const lethalBlocked = scheduler.lethalRest > 0
    || lethalHazardActive(scheduler)
    || Boolean(context.retaliationActive);

  // A hazard already in the arena never doubles up on itself, whatever its
  // category: two gravity wells is not twice the pressure, it is confusion.
  const live = new Set(scheduler.active.map((event) => event.id));
  const previous = scheduler.history[scheduler.history.length - 1];
  let pool = eligible.filter((hazard) => !live.has(hazard.id) && !(lethalBlocked && hazard.category === "lethal"));
  if (pool.length === 0) return null;
  // Avoid firing the same hazard twice running when there is anything else to
  // pick, so a long run does not become a single hazard on a loop.
  const varied = pool.filter((hazard) => hazard.id !== previous);
  if (varied.length > 0) pool = varied;
  return pool[Math.floor(random() * pool.length) % pool.length];
}

/**
 * One tick of the hazard scheduler.
 *
 * Mutates `scheduler` and reports the three moments a caller reacts to: a new
 * event warning, an impact becoming dangerous, and an event finishing.
 * Collision is deliberately *not* done here — see `hazardImpactHits` — because
 * the caller owns the pilot's invulnerability and shield rules and must be the
 * one to decide whether a hit lands.
 */
export function tickRiftHazards(
  scheduler: RiftHazardScheduler,
  context: RiftHazardContext,
): RiftHazardTick {
  const random = context.random ?? Math.random;
  const warned: RiftHazardEvent[] = [];
  const erupted: RiftHazardImpact[] = [];
  const expired: RiftHazardEvent[] = [];

  if (scheduler.lethalRest > 0) scheduler.lethalRest -= 1;

  for (const event of scheduler.active) {
    for (const impact of event.impacts) {
      if (impact.warningTicks > 0) {
        impact.warningTicks -= 1;
        if (impact.warningTicks === 0) erupted.push(impact);
        continue;
      }
      if (impact.liveTicks > 0) impact.liveTicks -= 1;
    }
    event.remaining -= 1;
  }

  const surviving: RiftHazardEvent[] = [];
  for (const event of scheduler.active) {
    if (event.remaining > 0) {
      surviving.push(event);
      continue;
    }
    expired.push(event);
    if (event.category === "lethal") scheduler.lethalRest = RIFT_HAZARD_LETHAL_REST_TICKS;
  }
  scheduler.active = surviving;

  scheduler.nextIn -= 1;
  if (scheduler.nextIn > 0) return { warned, erupted, expired };

  const spec = selectHazard(scheduler, context, random);
  if (!spec) {
    // Nothing may fire — try again shortly rather than burning the whole
    // interval, so the arena resumes as soon as it is fair to.
    scheduler.nextIn = 60;
    return { warned, erupted, expired };
  }

  scheduler.nextIn = spec.intervalTicks;
  const event = buildEvent(spec, context, random);
  scheduler.active.push(event);
  scheduler.history.push(spec.id);
  warned.push(event);
  return { warned, erupted, expired };
}

/** True while this impact is live and standing on this point would hurt. */
export function hazardImpactHits(impact: RiftHazardImpact, point: { x: number; y: number }): boolean {
  if (impact.warningTicks > 0 || impact.liveTicks <= 0 || impact.struck) return false;
  return Math.hypot(point.x - impact.x, point.y - impact.y) <= impact.radius;
}

/** Every impact currently dangerous, across every active event. */
export function liveHazardImpacts(scheduler: RiftHazardScheduler): { event: RiftHazardEvent; impact: RiftHazardImpact }[] {
  return scheduler.active.flatMap((event) =>
    event.impacts
      .filter((impact) => impact.warningTicks <= 0 && impact.liveTicks > 0)
      .map((impact) => ({ event, impact })));
}

/** Wipes every hazard. Called when a rift reforms or a run ends. */
export function clearRiftHazards(scheduler: RiftHazardScheduler): void {
  scheduler.active = [];
  scheduler.lethalRest = 0;
  scheduler.nextIn = Math.max(scheduler.nextIn, 180);
}

/** The warning plate wording for an event that has just been scheduled. */
export function riftHazardNotice(event: RiftHazardEvent): string {
  return event.category === "lethal" ? `${event.name} INBOUND` : `${event.name} FORMING`;
}
