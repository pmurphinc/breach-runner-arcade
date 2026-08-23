/**
 * Expanded, readable metadata for every ship.
 *
 * Every number here is *derived from* `SHIPS` and `SHIP_SPECIALS` in
 * `game-data.ts` — that stays the single source of truth for gameplay values,
 * and nothing in this file changes one. What this adds is the presentation
 * layer the selection screen needs: readable stat labels, comparison helpers,
 * and prose that is generated from the statistics rather than written by hand,
 * so a description can never claim an ability the ship does not have.
 */
// Explicit .ts extension so Node's type stripping can load this module
// directly in tests, without a bundler. tsconfig sets
// allowImportingTsExtensions, and the bundler resolves it identically.
import { SHIPS, SHIP_SPECIALS, type ShipId, type ShipSpec } from "./game-data.ts";

/** Experience the frame realistically demands. */
export type ExperienceTier = "Beginner" | "Intermediate" | "Expert";

/** One comparable statistic, with the label a player should actually read. */
export type ShipStat = {
  key: "hull" | "maxSpeed" | "acceleration" | "turn" | "gun" | "thrust";
  /** Readable label. Never an unexplained abbreviation like "MAX V". */
  label: string;
  value: number;
  /** Formatted for display, including any unit. */
  display: string;
  /** 0-1 position within the fleet's range, for comparison bars. */
  fraction: number;
  /** Value the bar is measured against, so the scale is explainable. */
  fleetMax: number;
};

export type ShipProfile = {
  id: ShipId;
  spec: ShipSpec;
  name: string;
  role: string;
  /** "OPEN", or the rank a locked frame requires. */
  unlock: string;
  locked: boolean;
  /** Full sentence for a locked frame; empty when it is available. */
  lockRequirement: string;
  special: { name: string; cooldownSeconds: number; description: string };
  /** Exactly how to use the special on each input method. */
  specialInput: { keyboard: string; touch: string };
  experience: ExperienceTier;
  playstyle: string;
  strengths: string[];
  weaknesses: string[];
  stats: ShipStat[];
};

const STAT_LABELS: Record<ShipStat["key"], string> = {
  hull: "Hull strength",
  maxSpeed: "Maximum speed",
  acceleration: "Acceleration",
  turn: "Directional response",
  gun: "Starting cannon level",
  thrust: "Starting thrust level",
};

/** Highest value in the fleet for each statistic, so bars share one scale. */
const FLEET_MAX: Record<ShipStat["key"], number> = {
  hull: Math.max(...SHIPS.map((s) => s.health)),
  maxSpeed: Math.max(...SHIPS.map((s) => s.maxSpeed)),
  acceleration: Math.max(...SHIPS.map((s) => s.acceleration)),
  turn: Math.max(...SHIPS.map((s) => s.turn)),
  gun: Math.max(...SHIPS.map((s) => s.gun)),
  thrust: Math.max(...SHIPS.map((s) => s.thrust)),
};

const FLEET_AVERAGE: Record<ShipStat["key"], number> = {
  hull: average(SHIPS.map((s) => s.health)),
  maxSpeed: average(SHIPS.map((s) => s.maxSpeed)),
  acceleration: average(SHIPS.map((s) => s.acceleration)),
  turn: average(SHIPS.map((s) => s.turn)),
  gun: average(SHIPS.map((s) => s.gun)),
  thrust: average(SHIPS.map((s) => s.thrust)),
};

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function statValue(spec: ShipSpec, key: ShipStat["key"]) {
  switch (key) {
    case "hull": return spec.health;
    case "maxSpeed": return spec.maxSpeed;
    case "acceleration": return spec.acceleration;
    case "turn": return spec.turn;
    case "gun": return spec.gun;
    case "thrust": return spec.thrust;
  }
}

function formatStat(key: ShipStat["key"], value: number) {
  switch (key) {
    case "hull": return `${value}`;
    case "maxSpeed": return `${value.toFixed(1)} u/tick`;
    case "acceleration": return `${value.toFixed(2)} u/tick²`;
    case "turn": return `${value}° per tick`;
    case "gun":
    case "thrust": return `MK ${value}`;
  }
}

export function statsFor(spec: ShipSpec): ShipStat[] {
  return (Object.keys(STAT_LABELS) as ShipStat["key"][]).map((key) => {
    const value = statValue(spec, key);
    return {
      key,
      label: STAT_LABELS[key],
      value,
      display: formatStat(key, value),
      fleetMax: FLEET_MAX[key],
      fraction: FLEET_MAX[key] > 0 ? value / FLEET_MAX[key] : 0,
    };
  });
}

/** How far above or below the fleet a value sits, as a signed ratio. */
function standing(spec: ShipSpec, key: ShipStat["key"]) {
  const value = statValue(spec, key);
  const mean = FLEET_AVERAGE[key];
  if (mean === 0) return 0;
  return (value - mean) / mean;
}

const HIGH = 0.18;
const LOW = -0.18;

/**
 * Strengths and weaknesses read off the statistics.
 *
 * Deriving them means a frame can never be described as fast when it is not:
 * change a number in `game-data.ts` and the prose follows automatically.
 */
function traitsFor(spec: ShipSpec) {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  const push = (
    key: ShipStat["key"],
    high: string,
    low: string
  ) => {
    const level = standing(spec, key);
    if (level >= HIGH) strengths.push(high);
    else if (level <= LOW) weaknesses.push(low);
  };

  push("hull", "Heavy armour absorbs mistakes", "Light hull punishes contact");
  push("maxSpeed", "High top speed crosses the arena quickly", "Low top speed limits escape options");
  push("acceleration", "Reaches speed almost instantly", "Slow to build momentum");
  push("turn", "Turns sharply and answers input quickly", "Sluggish to change direction");
  push("gun", "Opens with an upgraded cannon", "Opens with the base cannon");
  push("thrust", "Starts with thrust upgrades fitted", "No thrust upgrades to start");

  // A frame can sit inside the threshold on every axis and produce nothing.
  // Rather than claim something untrue — an earlier draft told the Turtle it
  // had "no weak axis" while listing three — fall back to naming its actual
  // best and worst axis relative to the fleet.
  if (strengths.length === 0) strengths.push(`Best axis: ${extremeLabel(spec, "best")}`);
  if (weaknesses.length === 0) weaknesses.push(`Weakest axis: ${extremeLabel(spec, "worst")}`);

  return { strengths: strengths.slice(0, 3), weaknesses: weaknesses.slice(0, 3) };
}

/** The statistic on which this frame stands furthest above or below the fleet. */
function extremeLabel(spec: ShipSpec, which: "best" | "worst") {
  const keys = Object.keys(STAT_LABELS) as ShipStat["key"][];
  const ranked = [...keys].sort((a, b) =>
    which === "best" ? standing(spec, b) - standing(spec, a) : standing(spec, a) - standing(spec, b)
  );
  const key = ranked[0];
  return `${STAT_LABELS[key].toLowerCase()} (${formatStat(key, statValue(spec, key))})`;
}

/**
 * Experience tier, from how punishing the frame is to fly.
 *
 * Hard to fly means fast or slow to respond with little hull to spare; easy
 * means forgiving armour and predictable handling.
 */
function experienceFor(spec: ShipSpec): ExperienceTier {
  const fragile = standing(spec, "hull") <= LOW;
  const twitchy = standing(spec, "maxSpeed") >= HIGH || standing(spec, "acceleration") >= HIGH;
  const unresponsive = standing(spec, "turn") <= LOW;

  if (fragile && twitchy) return "Expert";
  if (unresponsive && standing(spec, "acceleration") <= LOW) return "Expert";
  if (fragile || twitchy || unresponsive) return "Intermediate";
  return "Beginner";
}

function playstyleFor(spec: ShipSpec, experience: ExperienceTier) {
  const armour = standing(spec, "hull");
  const speed = standing(spec, "maxSpeed");
  const response = standing(spec, "turn");

  if (armour >= HIGH && speed <= LOW) {
    return "Hold ground and trade hits. Line up the wormhole early, because you will not outrun anything that goes wrong.";
  }
  if (speed >= HIGH && armour <= LOW) {
    return "Stay moving and never trade. Cross the arena, take the shot, and leave before anything closes in.";
  }
  if (response >= HIGH) {
    return "Weave through waves rather than around them. Sharp turning lets you correct late and keep the wormhole in front of you.";
  }
  if (experience === "Expert") {
    return "Momentum decides everything here. Plan a route before you commit to it, because corrections are slow and expensive.";
  }
  return "A forgiving frame with no bad matchup. Good for learning the charge, collect and transmit loop before specialising.";
}

/** Human-readable version of the special, without repeating the key prompt. */
function specialDescription(spec: ShipSpec) {
  return spec.special.replace(/^Q:\s*/, "");
}

export const SHIP_PROFILES: Record<ShipId, ShipProfile> = Object.fromEntries(
  SHIPS.map((spec) => {
    const { strengths, weaknesses } = traitsFor(spec);
    const experience = experienceFor(spec);
    const locked = spec.unlock.toUpperCase() !== "OPEN";
    return [
      spec.id,
      {
        id: spec.id,
        spec,
        name: spec.name,
        role: spec.role,
        unlock: spec.unlock,
        locked,
        lockRequirement: locked ? `Reaches ${spec.unlock} to unlock this frame.` : "",
        special: {
          name: SHIP_SPECIALS[spec.id].name,
          cooldownSeconds: SHIP_SPECIALS[spec.id].cooldownSeconds,
          description: specialDescription(spec),
        },
        specialInput: { keyboard: "Q", touch: "SPEC" },
        experience,
        playstyle: playstyleFor(spec, experience),
        strengths,
        weaknesses,
        stats: statsFor(spec),
      } satisfies ShipProfile,
    ];
  })
) as Record<ShipId, ShipProfile>;

export const SHIP_ORDER: ShipId[] = SHIPS.map((spec) => spec.id);

export type StatComparison = {
  key: ShipStat["key"];
  label: string;
  /** The ship being inspected. */
  value: number;
  display: string;
  fraction: number;
  /** The ship currently selected, for side-by-side reading. */
  againstValue: number;
  againstDisplay: string;
  againstFraction: number;
  /** Signed difference, already rounded for display. */
  delta: number;
  deltaDisplay: string;
  /**
   * Direction relative to the selected ship. Never the only signal — the
   * numbers above are always shown too, so this is not colour-only meaning.
   */
  direction: "better" | "worse" | "same";
};

/**
 * Compares one ship against another, statistic by statistic.
 *
 * Every entry carries both exact values and the delta, so a comparison bar is
 * always accompanied by readable numbers rather than communicating through
 * length or colour alone.
 */
export function compareShips(inspected: ShipId, against: ShipId): StatComparison[] {
  const a = SHIP_PROFILES[inspected];
  const b = SHIP_PROFILES[against];

  return a.stats.map((stat, index) => {
    const other = b.stats[index];
    const delta = stat.value - other.value;
    const rounded = Math.abs(delta) < 0.005 ? 0 : delta;
    return {
      key: stat.key,
      label: stat.label,
      value: stat.value,
      display: stat.display,
      fraction: stat.fraction,
      againstValue: other.value,
      againstDisplay: other.display,
      againstFraction: other.fraction,
      delta: rounded,
      deltaDisplay:
        rounded === 0
          ? "same"
          : `${rounded > 0 ? "+" : "−"}${formatStat(stat.key, Math.abs(rounded)).replace(/^MK /, "")}`,
      direction: rounded === 0 ? "same" : rounded > 0 ? "better" : "worse",
    };
  });
}

/** Every ship the player may actually launch in. */
export function isSelectable(id: ShipId) {
  return !SHIP_PROFILES[id].locked;
}
