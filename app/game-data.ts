export type ShipId = "tank" | "wing" | "squid" | "rabbit" | "turtle" | "flash" | "hunter" | "flagship";

export type ShipSpec = {
  id: ShipId;
  name: string;
  role: string;
  turn: number;
  maxSpeed: number;
  acceleration: number;
  health: number;
  gun: number;
  thrust: number;
  special: string;
  unlock: string;
};

// The original Redux fighter ratios are preserved, with movement tuned down for
// the smaller browser arena and more precise touch play.
export const SHIPS: ShipSpec[] = [
  { id: "tank", name: "The Tank", role: "Heavy brawler", turn: 5, maxSpeed: 2.7, acceleration: 0.04, health: 280, gun: 2, thrust: 0, special: "Q: Bulwark grants three seconds of impact immunity.", unlock: "OPEN" },
  { id: "wing", name: "The Wing", role: "Balanced interceptor", turn: 7, maxSpeed: 3.2, acceleration: 0.1, health: 240, gun: 1, thrust: 1, special: "Q: Vector Overdrive boosts controllable speed and acceleration for three seconds.", unlock: "OPEN" },
  { id: "squid", name: "The Squid", role: "High-speed scout", turn: 9, maxSpeed: 4, acceleration: 0.13, health: 200, gun: 0, thrust: 2, special: "Q: Phase Veil breaks hostile tracking and collision contact for 2.5 seconds.", unlock: "OPEN" },
  { id: "rabbit", name: "The Viper", role: "Guided-strike corvette", turn: 12, maxSpeed: 3, acceleration: 0.14, health: 150, gun: 0, thrust: 2, special: "Q: Viper Guidance makes power-ups launched during the next three seconds home on the wormhole.", unlock: "OPEN" },
  { id: "turtle", name: "The Turtle", role: "Defensive bruiser", turn: 4.5, maxSpeed: 2.4, acceleration: 0.06, health: 250, gun: 1, thrust: 1, special: "Q: Turtle Cannon clears threats at a health cost.", unlock: "OPEN" },
  { id: "flash", name: "The Flash", role: "Shape-shifter", turn: 1, maxSpeed: 1, acceleration: 0.1, health: 190, gun: 3, thrust: 3, special: "Q: Transform between Tank and Squid handling.", unlock: "OPEN" },
  { id: "hunter", name: "The Hunter", role: "Missile corvette", turn: 4.8, maxSpeed: 3.2, acceleration: 0.12, health: 220, gun: 0, thrust: 1, special: "Q: Launch a 17-missile Piranha spread.", unlock: "OPEN" },
  { id: "flagship", name: "The Flagship", role: "Command vessel", turn: 2, maxSpeed: 1.8, acceleration: 0.04, health: 300, gun: 0, thrust: 2, special: "Q: Project a 3-second field that pulls in power-ups and repels nearby enemies.", unlock: "OPEN" },
];

export type ShipSpecial = {
  name: string;
  cooldownSeconds: number;
  /** Fixed contribution to the 100-point ship budget. The ability itself is unchanged. */
  balancePoints: number;
};

/** Single source of truth for active Q/SPEC ability names and cooldowns. */
export const SHIP_SPECIALS: Record<ShipId, ShipSpecial> = {
  tank: { name: "BULWARK", cooldownSeconds: 12, balancePoints: 20 },
  wing: { name: "VECTOR OVERDRIVE", cooldownSeconds: 10, balancePoints: 15 },
  squid: { name: "PHASE VEIL", cooldownSeconds: 12, balancePoints: 15 },
  rabbit: { name: "VIPER GUIDANCE", cooldownSeconds: 20, balancePoints: 20 },
  turtle: { name: "TURTLE CANNON", cooldownSeconds: 14, balancePoints: 25 },
  flash: { name: "FORM SHIFT", cooldownSeconds: 1, balancePoints: 20 },
  hunter: { name: "PIRANHA ARRAY", cooldownSeconds: 20, balancePoints: 24 },
  flagship: { name: "A/R FIELD PULSE", cooldownSeconds: 10, balancePoints: 30 },
};

export type PowerId = "heatseeker" | "turret" | "mines" | "ufo" | "inflator" | "minelayer" | "gunship" | "scarab" | "nuke" | "wallcrawler" | "beam" | "emp" | "ghost" | "artillery";
export type PickupId = PowerId | "gun" | "thrust" | "retros" | "shield" | "clear" | "health";

/** Broad gameplay role, used for colour-independent grouping in the HUD. */
export type WeaponCategory = "attack" | "hazard" | "defense" | "utility";

/**
 * Single source of truth for every pickup the wormhole can produce. Labels,
 * colours, silhouettes, descriptions, and HUD copy are all derived from here so
 * a weapon never has to be described twice.
 */
export type WeaponMeta = {
  id: PickupId;
  /** Full readable name, shown whenever there is room for it. */
  name: string;
  /** Trimmed name for medium slots. */
  short: string;
  /** Two-character code for the smallest slots and canvas badges. */
  abbr: string;
  color: string;
  category: WeaponCategory;
  /** Can this power-up be fired back through the rival wormhole? */
  sendable: boolean;
  /** Relative danger of the incoming wave, 1 (light) to 3 (severe). */
  threat: 1 | 2 | 3;
  /** One line: what the weapon is. */
  summary: string;
  /** One line: how the projectile or deployment behaves. */
  behavior: string;
  /** One line: what it does for or to the player. */
  role: string;
};

export const CATEGORY_LABELS: Record<WeaponCategory, string> = {
  attack: "ATTACK",
  hazard: "HAZARD",
  defense: "DEFENSE",
  utility: "UTILITY",
};

export const WEAPONS: Record<PickupId, WeaponMeta> = {
  gun: {
    id: "gun", name: "GUN UPGRADE", short: "GUN UP", abbr: "GU", color: "#7fe3ff",
    category: "utility", sendable: false, threat: 1,
    summary: "Cannon calibration module collected on contact.",
    behavior: "Applies the moment you fly over it; nothing is stored in the bin.",
    role: "Advances the pulse cannon one mark, up to MK 4.",
  },
  thrust: {
    id: "thrust", name: "THRUST UPGRADE", short: "THRUST", abbr: "TH", color: "#6dffd6",
    category: "utility", sendable: false, threat: 1,
    summary: "Engine tuning module collected on contact.",
    behavior: "Applies immediately; nothing is stored in the bin.",
    role: "Raises acceleration and top speed, up to MK 3.",
  },
  retros: {
    id: "retros", name: "RETROS", short: "RETROS", abbr: "RT", color: "#bcff66",
    category: "utility", sendable: false, threat: 1,
    summary: "Retro thruster package collected on contact.",
    behavior: "Passive once installed; nothing is stored in the bin.",
    role: "Bleeds off drift when you stop thrusting, for tighter turns.",
  },
  shield: {
    id: "shield", name: "INVULNERABILITY", short: "SHIELD", abbr: "SH", color: "#8f9cff",
    category: "defense", sendable: false, threat: 1,
    summary: "Deflector bubble collected on contact.",
    behavior: "Wraps the hull instantly and burns down over time.",
    role: "Blocks all incoming damage while the bubble holds.",
  },
  clear: {
    id: "clear", name: "ZAP ATTACK", short: "ZAP", abbr: "ZP", color: "#ffffff",
    category: "utility", sendable: false, threat: 1,
    summary: "Arena-wide discharge collected on contact.",
    behavior: "Detonates the instant you pick it up.",
    role: "Destroys every hostile currently in the arena.",
  },
  health: {
    id: "health", name: "EXTRA HEALTH", short: "REPAIR", abbr: "HP", color: "#7dff96",
    category: "defense", sendable: false, threat: 1,
    summary: "Hull repair canister collected on contact.",
    behavior: "Applies immediately; nothing is stored in the bin.",
    role: "Restores 30 hull, never above your frame maximum.",
  },
  heatseeker: {
    id: "heatseeker", name: "HEAT SEEKER", short: "SEEKER", abbr: "HS", color: "#ff7a70",
    category: "attack", sendable: true, threat: 2,
    summary: "Swarm of compact homing missiles with lit tracking noses.",
    behavior: "Each missile flies fast and steers hard to stay on your tail.",
    role: "Fragile individually — one cannon hit kills a missile — but they arrive as a wave of 12.",
  },
  turret: {
    id: "turret", name: "WORMHOLE TURRET", short: "TURRET", abbr: "TU", color: "#5ef0ff",
    category: "attack", sendable: true, threat: 2,
    summary: "Mechanical gun platform bolted to the rival wormhole.",
    behavior: "Orbits the portal on a fixed arm and shells you at range.",
    role: "Armoured and stationary; it denies the portal until you break it.",
  },
  mines: {
    id: "mines", name: "WORMHOLE MINES", short: "MINES", abbr: "MN", color: "#eeff5c",
    category: "hazard", sendable: true, threat: 2,
    summary: "Spiked proximity mines scattered across the arena.",
    behavior: "They coast outward from the portal, then arm and hold position.",
    role: "Area denial. Contact hurts badly, but they die to a single burst.",
  },
  ufo: {
    id: "ufo", name: "SEND UFO", short: "UFO", abbr: "UF", color: "#ff6dd0",
    category: "attack", sendable: true, threat: 3,
    summary: "Saucer carrier with a glowing underside bay.",
    behavior: "Hunts you directly and periodically drops heat seekers.",
    role: "A pursuing spawner — kill it early or the swarm compounds.",
  },
  inflator: {
    id: "inflator", name: "SEND INFLATOR", short: "INFLATOR", abbr: "IN", color: "#ffa562",
    category: "hazard", sendable: true, threat: 2,
    summary: "Organic energy sac that swells the longer it lives.",
    behavior: "Drifts toward you while its body and armour keep growing.",
    role: "Cheap to kill early, dangerous to ignore — it eats the arena.",
  },
  minelayer: {
    id: "minelayer", name: "SEND MINELAYER", short: "MINELAYER", abbr: "ML", color: "#d7ff56",
    category: "attack", sendable: true, threat: 2,
    summary: "Carrier hull with an open drop bay underneath.",
    behavior: "Weaves across the arena and releases live mines behind it.",
    role: "Leaves a trail of hazards that outlives the carrier.",
  },
  gunship: {
    id: "gunship", name: "SEND GUNSHIP", short: "GUNSHIP", abbr: "GS", color: "#9a8dff",
    category: "attack", sendable: true, threat: 3,
    summary: "Heavy multi-engine attack craft with twin barrels.",
    behavior: "Drifts on a slow arc and keeps up sustained cannon fire.",
    role: "The toughest conventional hull the rival sends; worth heavy score.",
  },
  scarab: {
    id: "scarab", name: "SEND SCARAB", short: "SCARAB", abbr: "SC", color: "#ffcf62",
    category: "attack", sendable: true, threat: 2,
    summary: "Angular insect hull with mandibles and jointed legs.",
    behavior: "Ignores you and races for whatever power-up is loose in the arena.",
    role: "A thief — it eats your pickups instead of your hull.",
  },
  nuke: {
    id: "nuke", name: "SEND NUKE", short: "NUKE", abbr: "NK", color: "#ffe066",
    category: "hazard", sendable: true, threat: 3,
    summary: "Hazard-banded warhead with a visible pulsing core.",
    behavior: "Sits still and counts down, then throws an expanding blast ring.",
    role: "Heavily armoured. Destroy it before the timer, or leave the ring's path.",
  },
  wallcrawler: {
    id: "wallcrawler", name: "SEND WALLCRAWLER", short: "CRAWLER", abbr: "WC", color: "#ff8a70",
    category: "attack", sendable: true, threat: 3,
    summary: "Segmented armoured crawler that rides the arena walls.",
    behavior: "Tracks the perimeter without stopping and shells the interior.",
    role: "The single most armoured hostile — expect a long exchange.",
  },
  beam: {
    id: "beam", name: "WORMHOLE BEAM", short: "BEAM", abbr: "BM", color: "#ef8bff",
    category: "attack", sendable: true, threat: 2,
    summary: "Focusing emitter capsule seated in the portal mouth.",
    behavior: "Charges briefly, then sweeps a continuous beam across the arena.",
    role: "Thin hull, but standing in the beam line drains you fast.",
  },
  emp: {
    id: "emp", name: "WORMHOLE EMP", short: "EMP", abbr: "EM", color: "#7fb6ff",
    category: "hazard", sendable: true, threat: 2,
    summary: "Electrical orb wrapped in arcing rings.",
    behavior: "Rides your position and releases one expanding shock ring.",
    role: "Does no damage — it inverts your controls once the ring reaches you.",
  },
  ghost: {
    id: "ghost", name: "SEND GHOST-PUD", short: "GHOST", abbr: "GH", color: "#eaf8ff",
    category: "hazard", sendable: true, threat: 3,
    summary: "Translucent distorted silhouette that cannon fire passes through.",
    behavior: "Drifts on a random walk and cannot be shot down.",
    role: "Unkillable. Fly around it; only a Zap Attack removes it.",
  },
  artillery: {
    id: "artillery", name: "SEND ARTILLERY", short: "ARTILLERY", abbr: "AR", color: "#ff6086",
    category: "attack", sendable: true, threat: 3,
    summary: "Heavy shell platform with a banded breech and cannon muzzle.",
    behavior: "Loiters at range and lobs fast, high-damage shells.",
    role: "Hits harder per shot than anything else the rival fields.",
  },
};

export const POWER_LABELS = Object.fromEntries(
  Object.values(WEAPONS).map((weapon) => [weapon.id, weapon.name]),
) as Record<PickupId, string>;

export const POWER_COLORS = Object.fromEntries(
  Object.values(WEAPONS).map((weapon) => [weapon.id, weapon.color]),
) as Record<PickupId, string>;

export const SENDABLE_POWERUPS: PowerId[] = [
  "heatseeker", "turret", "mines", "ufo", "inflator", "minelayer", "gunship",
  "scarab", "nuke", "wallcrawler", "beam", "emp", "ghost", "artillery",
];

export const INSTANT_PICKUPS: PickupId[] = ["gun", "thrust", "retros", "shield", "clear", "health"];

/** Hull and hit radius for each hostile the rival can send, recovered from the client. */
export const ENEMY_STATS: Record<PowerId, { hp: number; radius: number }> = {
  heatseeker: { hp: 1, radius: 6 },
  turret: { hp: 45, radius: 13 },
  mines: { hp: 5, radius: 15 },
  ufo: { hp: 40, radius: 25 },
  inflator: { hp: 30, radius: 20 },
  minelayer: { hp: 55, radius: 18 },
  gunship: { hp: 80, radius: 25 },
  scarab: { hp: 35, radius: 15 },
  nuke: { hp: 100, radius: 20 },
  wallcrawler: { hp: 150, radius: 20 },
  beam: { hp: 10, radius: 12 },
  emp: { hp: 1, radius: 8 },
  ghost: { hp: 9999, radius: 16 },
  artillery: { hp: 60, radius: 20 },
};

/** How many hostiles arrive per wave. */
export const ENEMY_COUNTS: Record<PowerId, number> = {
  heatseeker: 12,
  turret: 1,
  mines: 15,
  ufo: 3,
  inflator: 4,
  minelayer: 2,
  gunship: 1,
  scarab: 2,
  nuke: 1,
  wallcrawler: 1,
  beam: 1,
  emp: 1,
  ghost: 1,
  artillery: 2,
};

/** Damage a transmitted power-up deals to the rival's integrity. */
export function rivalDamageFor(type: PowerId) {
  if (type === "nuke") return 24;
  if (type === "beam" || type === "artillery" || type === "gunship") return 18;
  return 12;
}

export const SHOT_LEVELS = [
  { damage: 10, shots: 1, maxShots: 20, delay: 8, color: "#ffffff" },
  { damage: 14, shots: 1, maxShots: 14, delay: 6, color: "#5aa7ff" },
  { damage: 8, shots: 2, maxShots: 28, delay: 6, color: "#ff5ad4" },
  { damage: 10, shots: 2, maxShots: 34, delay: 6, color: "#ff5d62" },
];
