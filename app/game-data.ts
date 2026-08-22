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

// Values are translated directly from the Redux client fighter table.
export const SHIPS: ShipSpec[] = [
  { id: "tank", name: "The Tank", role: "Heavy brawler", turn: 5, maxSpeed: 6, acceleration: 0.1, health: 280, gun: 2, thrust: 0, special: "Heavy armor and advanced starting cannons.", unlock: "OPEN" },
  { id: "wing", name: "The Wing", role: "Balanced interceptor", turn: 7, maxSpeed: 7, acceleration: 0.25, health: 240, gun: 1, thrust: 1, special: "A balanced mix of speed, armor, and firepower.", unlock: "OPEN" },
  { id: "squid", name: "The Squid", role: "High-speed scout", turn: 10, maxSpeed: 10, acceleration: 0.48, health: 200, gun: 0, thrust: 3, special: "Maximum speed and acceleration; light armor.", unlock: "OPEN" },
  { id: "rabbit", name: "The Rabbit", role: "Tracking corvette", turn: 12, maxSpeed: 11, acceleration: 0.35, health: 180, gun: 0, thrust: 2, special: "Automatic tracking cannon for hit-and-run combat.", unlock: "RANK 12" },
  { id: "turtle", name: "The Turtle", role: "Defensive bruiser", turn: 4.5, maxSpeed: 5.2, acceleration: 0.15, health: 250, gun: 1, thrust: 1, special: "R: Turtle Cannon clears threats at a health cost.", unlock: "RANK 12" },
  { id: "flash", name: "The Flash", role: "Shape-shifter", turn: 1, maxSpeed: 1, acceleration: 0.1, health: 190, gun: 3, thrust: 3, special: "R: Transform between Tank and Squid handling.", unlock: "RANK 14" },
  { id: "hunter", name: "The Hunter", role: "Missile corvette", turn: 4.8, maxSpeed: 7, acceleration: 0.3, health: 220, gun: 0, thrust: 1, special: "R: Launch a 17-missile Piranha spread.", unlock: "RANK 12" },
  { id: "flagship", name: "The Flagship", role: "Command vessel", turn: 2, maxSpeed: 3.9, acceleration: 0.11, health: 300, gun: 0, thrust: 2, special: "R: Attract power-ups and repel nearby enemies.", unlock: "RANK 14" },
];

export type PowerId = "heatseeker" | "turret" | "mines" | "ufo" | "inflator" | "minelayer" | "gunship" | "scarab" | "nuke" | "wallcrawler" | "beam" | "emp" | "ghost" | "artillery";
export type PickupId = PowerId | "gun" | "thrust" | "retros" | "shield" | "clear" | "health";

export const POWER_LABELS: Record<PickupId, string> = {
  gun: "GUN UPGRADE",
  thrust: "THRUST UPGRADE",
  retros: "RETROS",
  shield: "INVULNERABILITY",
  clear: "ZAP ATTACK",
  health: "EXTRA HEALTH",
  heatseeker: "HEAT SEEKER",
  turret: "WORMHOLE TURRET",
  mines: "WORMHOLE MINES",
  ufo: "SEND UFO",
  inflator: "SEND INFLATOR",
  minelayer: "SEND MINELAYER",
  gunship: "SEND GUNSHIP",
  scarab: "SEND SCARAB",
  nuke: "SEND NUKE",
  wallcrawler: "SEND WALLCRAWLER",
  beam: "WORMHOLE BEAM",
  emp: "WORMHOLE EMP",
  ghost: "SEND GHOST-PUD",
  artillery: "SEND ARTILLERY",
};

export const POWER_COLORS: Record<PickupId, string> = {
  gun: "#72dcff",
  thrust: "#67ffcf",
  retros: "#b6ff57",
  shield: "#7c8cff",
  clear: "#f7fbff",
  health: "#6dff87",
  heatseeker: "#ff665c",
  turret: "#55e8ff",
  mines: "#e7ff4c",
  ufo: "#ff5ac8",
  inflator: "#ff994f",
  minelayer: "#cfff45",
  gunship: "#8a7dff",
  scarab: "#ffc44f",
  nuke: "#ffdb55",
  wallcrawler: "#ff795e",
  beam: "#e778ff",
  emp: "#6ba6ff",
  ghost: "#e9f7ff",
  artillery: "#ff4d74",
};

export const SENDABLE_POWERUPS: PowerId[] = [
  "heatseeker", "turret", "mines", "ufo", "inflator", "minelayer", "gunship",
  "scarab", "nuke", "wallcrawler", "beam", "emp", "ghost", "artillery",
];

export const SHOT_LEVELS = [
  { damage: 10, shots: 1, maxShots: 20, delay: 8, color: "#ffffff" },
  { damage: 14, shots: 1, maxShots: 14, delay: 6, color: "#5aa7ff" },
  { damage: 8, shots: 2, maxShots: 28, delay: 6, color: "#ff5ad4" },
  { damage: 10, shots: 2, maxShots: 34, delay: 6, color: "#ff5d62" },
];
