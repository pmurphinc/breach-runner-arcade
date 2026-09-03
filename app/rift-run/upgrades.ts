import type { RiftRunState, RiftWeaponId, RiftWeaponInstance } from "./types.ts";
import type { RiftSystemId } from "./loadout.ts";

export const RIFT_REWARD_CATEGORIES = ["offensive", "defensive", "mobility", "hull-gun"] as const;
export type RewardCategory = typeof RIFT_REWARD_CATEGORIES[number];
export const rewardCategoryLabel = (category: RewardCategory): string => category === "hull-gun" ? "HULL GUN" : category.toUpperCase();
export type UpgradeCategory = "weapon" | "ship" | "rift-tech" | "hull-gun";
export type GameplayCategory = "offensive" | "defensive" | "mobility";
export type UpgradeEffect = "fireRate" | "damage" | "projectileCount" | "penetration" | "explosionRadius" | "projectileSpeed" | "range" | "coneWidth" | "hull" | "shield" | "movement" | "damageReduction" | "handling" | "cannonDamage" | "cannonFireRate";
export type UpgradeDefinition = { id: string; name: string; description: string; category: UpgradeCategory; gameplayCategory: GameplayCategory; system: RiftSystemId; tier: 1; maxStacks: number; repeatable?: boolean; effect: UpgradeEffect; amount: number; weapons?: readonly RiftWeaponId[]; excludes?: readonly RiftWeaponId[] };

/**
 * One card on the upgrade screen.
 *
 * `system` is what the roll competes across — a screen never shows two cards
 * from the same ship system — while `gameplayCategory` survives only as
 * display colour. `track` marks the tiered ladder cards (payload slots, cannon
 * and thruster marks, the Special) that `applyUpgrade` handles itself rather
 * than looking up in `RIFT_UPGRADES`.
 */
export type UpgradeChoice = { key: string; upgradeId: string; system: RiftSystemId; gameplayCategory: GameplayCategory; track?: RiftTrackId; evolutionId?: import("./types").RiftEvolutionId; targetInstanceId?: string; hardpointIndex?: number; title: string; target: string; description: string; kind?: "upgrade" | "evolution" };

/** The tiered ladders. Each advances one step at a time and then leaves the pool. */
export type RiftTrackId = "payload-slot" | "cannon-tier" | "thruster-tier" | "special-unlock" | "special-tier" | "socket-unlock";

const weapon = (id: string, name: string, description: string, effect: UpgradeEffect, amount: number, weapons?: readonly RiftWeaponId[], maxStacks=4): UpgradeDefinition => ({ id, name, description, category: "hull-gun", gameplayCategory: "offensive", system: "hull", tier: 1, maxStacks, effect, amount, weapons });
export const RIFT_UPGRADES: readonly UpgradeDefinition[] = [
  { id: "cannon-amplifier", name: "CANNON AMPLIFIER", description: "+15% base cannon damage", category: "rift-tech", gameplayCategory: "offensive", system: "cannon", tier: 1, maxStacks: 10, effect: "cannonDamage", amount: .15 },
  { id: "cannon-cycler", name: "CANNON CYCLER", description: "+12% base cannon fire rate", category: "rift-tech", gameplayCategory: "offensive", system: "cannon", tier: 1, maxStacks: 10, effect: "cannonFireRate", amount: .12 },
  { id: "weapons-mastery", name: "WEAPONS MASTERY", description: "+10% base cannon damage", category: "rift-tech", gameplayCategory: "offensive", system: "cannon", tier: 1, maxStacks: Number.POSITIVE_INFINITY, repeatable: true, effect: "cannonDamage", amount: .1 },
  weapon("overclock", "OVERCLOCK", "+20% fire rate", "fireRate", .2),
  weapon("high-energy-rounds", "HIGH-ENERGY ROUNDS", "+25% weapon damage", "damage", .25),
  { ...weapon("projectile-velocity", "PROJECTILE VELOCITY", "+18% projectile speed", "projectileSpeed", .18), excludes: ["flamethrower"] },
  weapon("rapid-pulse", "RAPID PULSE", "+25% fire rate", "fireRate", .25, ["pulse-cannon"]), weapon("heavy-pulse", "HEAVY PULSE", "+30% damage", "damage", .3, ["pulse-cannon"]), weapon("twin-pulse", "TWIN PULSE", "+1 projectile", "projectileCount", 1, ["pulse-cannon"], 3),
  weapon("overspin", "OVERSPIN", "+25% fire rate", "fireRate", .25, ["minigun"]), weapon("dense-slugs", "DENSE SLUGS", "+30% damage", "damage", .3, ["minigun"]), weapon("twin-barrel", "TWIN BARREL", "+1 projectile", "projectileCount", 1, ["minigun"], 3),
  weapon("magnetic-accelerator", "MAGNETIC ACCELERATOR", "+35% damage", "damage", .35, ["railgun"]), weapon("penetrator", "PENETRATOR", "+1 penetration", "penetration", 1, ["railgun"], 3), weapon("rapid-charge", "RAPID CHARGE", "+25% fire rate", "fireRate", .25, ["railgun"]),
  weapon("high-explosive", "HIGH EXPLOSIVE", "+16 blast radius", "explosionRadius", 16, ["missile-pod"], 3), weapon("warhead", "WARHEAD", "+35% damage", "damage", .35, ["missile-pod"]), weapon("salvo", "SALVO", "+1 missile", "projectileCount", 1, ["missile-pod"], 3),
  weapon("extended-nozzle", "EXTENDED NOZZLE", "+25 flame range", "range", 25, ["flamethrower"], 4), weapon("wide-burn", "WIDE BURN", "+10° cone width", "coneWidth", 10, ["flamethrower"], 4), weapon("hot-mix", "HOT MIX", "+30% flame damage", "damage", .3, ["flamethrower"]),
  { id: "reinforced-hull", name: "REINFORCED HULL", description: "+20 maximum and current hull", category: "ship", gameplayCategory: "defensive", system: "hull", tier: 1, maxStacks: 8, effect: "hull", amount: 20 },
  { id: "hull-restoration", name: "HULL RESTORATION", description: "+12 maximum and current hull", category: "ship", gameplayCategory: "defensive", system: "hull", tier: 1, maxStacks: 8, effect: "hull", amount: 12 },
  { id: "shield-capacitor", name: "SHIELD CAPACITOR", description: "+15 maximum and current shield", category: "ship", gameplayCategory: "defensive", system: "hull", tier: 1, maxStacks: 8, effect: "shield", amount: 15 },
  { id: "impact-plating", name: "IMPACT PLATING", description: "+5% damage resistance", category: "ship", gameplayCategory: "defensive", system: "hull", tier: 1, maxStacks: 8, effect: "damageReduction", amount: .05 },
  { id: "survival-mastery", name: "SURVIVAL MASTERY", description: "+10 maximum and current hull", category: "ship", gameplayCategory: "defensive", system: "hull", tier: 1, maxStacks: Number.POSITIVE_INFINITY, repeatable: true, effect: "hull", amount: 10 },
  { id: "thruster-tuning", name: "THRUSTER TUNING", description: "+7% acceleration and speed", category: "ship", gameplayCategory: "mobility", system: "thrusters", tier: 1, maxStacks: 10, effect: "movement", amount: .07 },
  { id: "vector-nozzles", name: "VECTOR NOZZLES", description: "+8% acceleration response", category: "ship", gameplayCategory: "mobility", system: "thrusters", tier: 1, maxStacks: 10, effect: "handling", amount: .08 },
  { id: "flight-mastery", name: "FLIGHT MASTERY", description: "+3% acceleration and speed", category: "ship", gameplayCategory: "mobility", system: "thrusters", tier: 1, maxStacks: Number.POSITIVE_INFINITY, repeatable: true, effect: "movement", amount: .03 },
] as const;
export const RIFT_UPGRADE_BY_ID = Object.fromEntries(RIFT_UPGRADES.map(x => [x.id, x])) as Record<string, UpgradeDefinition>;

export function upgradeStack(state: RiftRunState, id: string, targetInstanceId?: string): number { return state.upgradeHistory.filter(x => x.upgradeId === id && x.targetInstanceId === targetInstanceId).reduce((highest, entry) => Math.max(highest, entry.stack), 0); }
export function occupiedWeapons(state: RiftRunState): Array<{ hardpointIndex: number; weapon: RiftWeaponInstance }> { return state.hardpoints.flatMap(p => p.status === "occupied" ? [{ hardpointIndex: p.index, weapon: p.weapon }] : []); }
