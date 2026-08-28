import type { RiftRunState, RiftWeaponId, RiftWeaponInstance } from "./types";

export type UpgradeCategory = "weapon" | "ship" | "hardpoint" | "rift-tech";
export type UpgradeEffect = "fireRate" | "damage" | "projectileCount" | "penetration" | "explosionRadius" | "projectileSpeed" | "range" | "coneWidth" | "hull" | "shield" | "movement" | "hardpoint";
export type UpgradeDefinition = { id: string; name: string; description: string; category: UpgradeCategory; tier: 1; maxStacks: number; effect: UpgradeEffect; amount: number; weapons?: readonly RiftWeaponId[]; excludes?: readonly RiftWeaponId[] };
export type UpgradeChoice = { key: string; upgradeId: string; evolutionId?: import("./types").RiftEvolutionId; targetInstanceId?: string; hardpointIndex?: number; title: string; target: string; description: string; kind?: "upgrade" | "evolution" };

const weapon = (id: string, name: string, description: string, effect: UpgradeEffect, amount: number, weapons?: readonly RiftWeaponId[], maxStacks=4): UpgradeDefinition => ({ id, name, description, category: "weapon", tier: 1, maxStacks, effect, amount, weapons });
export const RIFT_UPGRADES: readonly UpgradeDefinition[] = [
  weapon("overclock", "OVERCLOCK", "+20% fire rate", "fireRate", .2),
  weapon("high-energy-rounds", "HIGH-ENERGY ROUNDS", "+25% weapon damage", "damage", .25),
  { ...weapon("projectile-velocity", "PROJECTILE VELOCITY", "+18% projectile speed", "projectileSpeed", .18), excludes: ["flamethrower"] },
  weapon("rapid-pulse", "RAPID PULSE", "+25% fire rate", "fireRate", .25, ["pulse-cannon"]), weapon("heavy-pulse", "HEAVY PULSE", "+30% damage", "damage", .3, ["pulse-cannon"]), weapon("twin-pulse", "TWIN PULSE", "+1 projectile", "projectileCount", 1, ["pulse-cannon"], 3),
  weapon("overspin", "OVERSPIN", "+25% fire rate", "fireRate", .25, ["minigun"]), weapon("dense-slugs", "DENSE SLUGS", "+30% damage", "damage", .3, ["minigun"]), weapon("twin-barrel", "TWIN BARREL", "+1 projectile", "projectileCount", 1, ["minigun"], 3),
  weapon("magnetic-accelerator", "MAGNETIC ACCELERATOR", "+35% damage", "damage", .35, ["railgun"]), weapon("penetrator", "PENETRATOR", "+1 penetration", "penetration", 1, ["railgun"], 3), weapon("rapid-charge", "RAPID CHARGE", "+25% fire rate", "fireRate", .25, ["railgun"]),
  weapon("high-explosive", "HIGH EXPLOSIVE", "+16 blast radius", "explosionRadius", 16, ["missile-pod"], 3), weapon("warhead", "WARHEAD", "+35% damage", "damage", .35, ["missile-pod"]), weapon("salvo", "SALVO", "+1 missile", "projectileCount", 1, ["missile-pod"], 3),
  weapon("extended-nozzle", "EXTENDED NOZZLE", "+25 flame range", "range", 25, ["flamethrower"], 4), weapon("wide-burn", "WIDE BURN", "+10° cone width", "coneWidth", 10, ["flamethrower"], 4), weapon("hot-mix", "HOT MIX", "+30% flame damage", "damage", .3, ["flamethrower"]),
  { id: "reinforced-hull", name: "REINFORCED HULL", description: "+20 maximum and current hull", category: "ship", tier: 1, maxStacks: 5, effect: "hull", amount: 20 },
  { id: "shield-capacitor", name: "SHIELD CAPACITOR", description: "+15 maximum and current shield", category: "ship", tier: 1, maxStacks: 4, effect: "shield", amount: 15 },
  { id: "thruster-tuning", name: "THRUSTER TUNING", description: "+7% acceleration and speed", category: "ship", tier: 1, maxStacks: 5, effect: "movement", amount: .07 },
  { id: "hardpoint-online", name: "HARDPOINT ONLINE", description: "Activate the next weapon socket", category: "hardpoint", tier: 1, maxStacks: 2, effect: "hardpoint", amount: 1 },
] as const;
export const RIFT_UPGRADE_BY_ID = Object.fromEntries(RIFT_UPGRADES.map(x => [x.id, x])) as Record<string, UpgradeDefinition>;

export function upgradeStack(state: RiftRunState, id: string, targetInstanceId?: string): number { return state.upgradeHistory.filter(x => x.upgradeId === id && x.targetInstanceId === targetInstanceId).length; }
export function occupiedWeapons(state: RiftRunState): Array<{ hardpointIndex: number; weapon: RiftWeaponInstance }> { return state.hardpoints.flatMap(p => p.status === "occupied" ? [{ hardpointIndex: p.index, weapon: p.weapon }] : []); }
