import type { RiftWeaponId, RiftWeaponInstance } from "./types";

export type RiftWeaponDefinition = {
  id: RiftWeaponId; name: string; role: string; summary: string;
  cadenceTicks: number; damage: number; projectileSpeed: number; projectileRadius: number;
  lifetimeTicks: number; penetration: number; explosionRadius: number;
  range: number; coneDegrees: number; maxProjectiles: number;
};

export const RIFT_WEAPONS: readonly RiftWeaponDefinition[] = [
  { id: "pulse-cannon", name: "PULSE CANNON", role: "Balanced / Reliable", summary: "Moderate fire · Moderate impact · Direct", cadenceTicks: 12, damage: 10, projectileSpeed: 10, projectileRadius: 3, lifetimeTicks: 110, penetration: 0, explosionRadius: 0, range: 0, coneDegrees: 0, maxProjectiles: 28 },
  { id: "minigun", name: "MINIGUN", role: "Sustained / Suppression", summary: "Rapid fire · Light impact · Slight spread", cadenceTicks: 3, damage: 3, projectileSpeed: 12, projectileRadius: 1.5, lifetimeTicks: 70, penetration: 0, explosionRadius: 0, range: 0, coneDegrees: 0, maxProjectiles: 48 },
  { id: "railgun", name: "RAILGUN", role: "Precision / Penetration", summary: "Slow fire · Extreme impact · Piercing", cadenceTicks: 55, damage: 42, projectileSpeed: 22, projectileRadius: 1.5, lifetimeTicks: 75, penetration: 3, explosionRadius: 0, range: 0, coneDegrees: 0, maxProjectiles: 8 },
  { id: "missile-pod", name: "MISSILE POD", role: "Guided / Explosive", summary: "Slow fire · Heavy blast · Homing", cadenceTicks: 38, damage: 18, projectileSpeed: 6, projectileRadius: 4, lifetimeTicks: 150, penetration: 0, explosionRadius: 64, range: 420, coneDegrees: 70, maxProjectiles: 12 },
  { id: "flamethrower", name: "FLAMETHROWER", role: "Close / Crowd control", summary: "Continuous · Short range · Wide cone", cadenceTicks: 5, damage: 2, projectileSpeed: 0, projectileRadius: 0, lifetimeTicks: 0, penetration: 0, explosionRadius: 0, range: 125, coneDegrees: 58, maxProjectiles: 0 },
] as const;

export const RIFT_WEAPON_BY_ID = Object.fromEntries(RIFT_WEAPONS.map((weapon) => [weapon.id, weapon])) as Record<RiftWeaponId, RiftWeaponDefinition>;

export function createWeaponInstance(weaponId: RiftWeaponId, instanceId: string): RiftWeaponInstance {
  return { instanceId, weaponId, level: 1, modifiers: { fireRate: 1, damage: 1, projectileCount: 0, penetration: 0, explosionRadius: 0 }, evolution: {} };
}
