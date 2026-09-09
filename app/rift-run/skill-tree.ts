/**
 * The skill tree: four branches, four ends, one of them yours.
 *
 * A Rift Run already climbed ladders with real tops. What it lacked was the
 * two things that make a set of ladders a *tree*: somewhere they lead, and a
 * way to see how far along them you are. Without those, every screen was a
 * local decision — finishing a ladder and abandoning one looked identical from
 * the cockpit, because nothing was ever downstream of anything.
 *
 * So four of the ladders end in a **capstone**: a passive strong enough to
 * define how the rest of the run is played, sitting at the top of the branch
 * that earned it.
 *
 *   CANNON     → PHASE ROUNDS         shots pass through loose power-ups
 *   THRUSTERS  → SLIPSTREAM           contact cannot hurt you at speed
 *   HULL       → REGENERATIVE PLATING the hull repairs itself, always
 *   PAYLOAD    → TRACTOR FIELD        loose power-ups come to you
 *
 * ## Only one
 *
 * A run keeps exactly one capstone. That is the whole design: four powerful
 * passives that a pilot picks *between* rather than collects, so the question
 * on the first upgrade screen is "what kind of run is this going to be?" and
 * the answer is still binding on the last one. Take one and the other three
 * leave the pool for good, whatever else the run goes on to finish.
 *
 * Without that rule a long enough run simply gets all four, the branches stop
 * competing, and the tree flattens back into the list it replaced.
 *
 * ## The Special is not a branch
 *
 * It has a ladder of its own, but it is an *active* ability the pilot fires,
 * and these four are passives that change how the ship behaves. Mixing them
 * would make "which capstone" also mean "active or passive", which is a
 * different question and a worse one. The Special ladder is unchanged.
 *
 * ## A known asymmetry
 *
 * Three branches are five rungs; the hull's is three sockets. Cutting all
 * three sockets is a real commitment — each one also owes a gun choice — but
 * it is fewer picks than topping the cannon. Left as it is rather than padded
 * with a made-up rung, and flagged for a balance pass with a pilot's hands on
 * it.
 *
 * Pure: reads state, returns numbers and cards. The loop owns the effects.
 */

import {
  RIFT_RUN_MAX_CANNON_TIER,
  RIFT_RUN_MAX_PAYLOAD_SLOTS,
  RIFT_RUN_MAX_SOCKETS,
  RIFT_RUN_MAX_THRUSTER_TIER,
  type RiftSystemId,
} from "./loadout.ts";
import type { UpgradeChoice } from "./upgrades.ts";
import type { RiftRunState } from "./types.ts";

export type BranchId = "cannon" | "thrusters" | "hull" | "payload";
export type CapstoneId = "phase-rounds" | "slipstream" | "regenerative-plating" | "tractor-field";

/* ------------------------------------------------ what the capstones cost */

/**
 * SLIPSTREAM's speed threshold, as a fraction of the hull's own top speed.
 *
 * A fraction rather than a number, so it means the same thing on every frame:
 * a slow hull is not asked to reach a fast one's figure, and a fast hull
 * cannot idle inside its own immunity. Half is high enough that holding it in
 * a crowded arena is a real piece of flying.
 */
export const SLIPSTREAM_SPEED_FRACTION = 0.5;

/**
 * REGENERATIVE PLATING's repair, in hull per tick.
 *
 * About 1.3 hull a second at the 15ms tick — roughly 80 over a minute. Chosen
 * to be useless inside a fight and decisive between them: it should remove the
 * limp back to a rift without ever out-healing incoming fire.
 */
export const HULL_REGEN_PER_TICK = 0.02;

/** How far TRACTOR FIELD reaches, in world units. */
export const TRACTOR_FIELD_RADIUS = 620;

/**
 * Pull at the pilot's own position, falling to nothing at the rim.
 *
 * Deliberately below the rift funnel's and well below GRAVITY PULSE's: this is
 * always on, so it steers a drift over seconds rather than snatching a drop
 * across the arena. The power-up still has to survive the trip.
 */
export const TRACTOR_FIELD_PULL = 0.09;

/** Every capstone id, for the pool and the apply step to recognise. */
export const CAPSTONE_IDS: readonly CapstoneId[] = [
  "phase-rounds",
  "slipstream",
  "regenerative-plating",
  "tractor-field",
];

export type BranchDefinition = {
  id: BranchId;
  system: RiftSystemId;
  label: string;
  capstoneId: CapstoneId;
  capstoneName: string;
  capstoneDescription: string;
  /** How far up this branch the run has climbed, and how far there is to go. */
  read: (state: RiftRunState) => { current: number; max: number };
};

/** A locked hardpoint has not been cut yet; every other status has. */
const socketsCut = (state: RiftRunState) =>
  state.hardpoints.filter((point) => point.status !== "locked").length;

export const RIFT_BRANCHES: readonly BranchDefinition[] = [
  {
    id: "cannon",
    system: "cannon",
    label: "CANNON",
    capstoneId: "phase-rounds",
    capstoneName: "PHASE ROUNDS",
    capstoneDescription: "Your shots pass through loose power-ups instead of destroying them.",
    read: (state) => ({ current: state.loadout.cannonTier, max: RIFT_RUN_MAX_CANNON_TIER }),
  },
  {
    id: "thrusters",
    system: "thrusters",
    label: "THRUSTERS",
    capstoneId: "slipstream",
    capstoneName: "SLIPSTREAM",
    capstoneDescription: "Nothing you fly into can hurt you while you are moving at speed.",
    read: (state) => ({ current: state.loadout.thrusterTier, max: RIFT_RUN_MAX_THRUSTER_TIER }),
  },
  {
    id: "hull",
    system: "hull",
    label: "HULL",
    capstoneId: "regenerative-plating",
    capstoneDescription: "The hull repairs itself, slowly and without stopping.",
    capstoneName: "REGENERATIVE PLATING",
    read: (state) => ({ current: socketsCut(state), max: RIFT_RUN_MAX_SOCKETS }),
  },
  {
    id: "payload",
    system: "payload",
    label: "PAYLOAD",
    capstoneId: "tractor-field",
    capstoneName: "TRACTOR FIELD",
    capstoneDescription: "Loose power-ups drift towards you from across the arena.",
    read: (state) => ({ current: state.loadout.payloadSlots, max: RIFT_RUN_MAX_PAYLOAD_SLOTS }),
  },
];

export const RIFT_BRANCH_BY_CAPSTONE = Object.fromEntries(
  RIFT_BRANCHES.map((branch) => [branch.capstoneId, branch]),
) as Record<CapstoneId, BranchDefinition>;

export type BranchProgress = {
  id: BranchId;
  system: RiftSystemId;
  label: string;
  capstoneId: CapstoneId;
  capstoneName: string;
  current: number;
  max: number;
  /** At the top of the branch, so its capstone is reachable. */
  complete: boolean;
};

/**
 * How far along each branch this run is.
 *
 * Read from the loadout rather than counted out of `upgradeHistory`: the
 * loadout is what the rest of the game already treats as the truth, and a
 * history-derived count would drift the moment a rung paid out anywhere else.
 */
export function branchProgress(state: RiftRunState): BranchProgress[] {
  return RIFT_BRANCHES.map((branch) => {
    const { current, max } = branch.read(state);
    return {
      id: branch.id,
      system: branch.system,
      label: branch.label,
      capstoneId: branch.capstoneId,
      capstoneName: branch.capstoneName,
      current,
      max,
      complete: current >= max,
    };
  });
}

/** The capstone this run holds, or nothing. A run holds at most one. */
export function takenCapstone(state: RiftRunState): CapstoneId | null {
  const held = state.upgradeHistory.find((entry) =>
    (CAPSTONE_IDS as readonly string[]).includes(entry.upgradeId));
  return held ? (held.upgradeId as CapstoneId) : null;
}

/** Does this run hold this particular capstone? */
export function hasCapstone(state: RiftRunState, id: CapstoneId): boolean {
  return takenCapstone(state) === id;
}

/** Shots pass through loose power-ups. */
export const hasPhaseRounds = (state: RiftRunState) => hasCapstone(state, "phase-rounds");
/** Contact cannot hurt a pilot who is moving. */
export const hasSlipstream = (state: RiftRunState) => hasCapstone(state, "slipstream");
/** The hull repairs itself. */
export const hasRegenerativePlating = (state: RiftRunState) => hasCapstone(state, "regenerative-plating");
/** Loose power-ups drift towards the pilot. */
export const hasTractorField = (state: RiftRunState) => hasCapstone(state, "tractor-field");

/**
 * Capstones this run could take right now.
 *
 * Empty once one is held, which is what makes the four alternatives rather
 * than a collection. Several can be available at once — a run that tops two
 * branches before spending the pick genuinely does get to choose.
 */
export function availableCapstones(state: RiftRunState): BranchProgress[] {
  if (takenCapstone(state)) return [];
  return branchProgress(state).filter((branch) => branch.complete);
}

/** One card per capstone currently on offer. */
export function capstoneChoices(state: RiftRunState): UpgradeChoice[] {
  return availableCapstones(state).map((branch) => {
    const definition = RIFT_BRANCH_BY_CAPSTONE[branch.capstoneId];
    return {
      key: branch.capstoneId,
      upgradeId: branch.capstoneId,
      system: branch.system,
      gameplayCategory: branch.id === "hull" ? "defensive" : branch.id === "thrusters" ? "mobility" : "offensive",
      track: branch.capstoneId,
      title: definition.capstoneName,
      target: `${branch.label} BRANCH COMPLETE`,
      description: definition.capstoneDescription,
    } satisfies UpgradeChoice;
  });
}
