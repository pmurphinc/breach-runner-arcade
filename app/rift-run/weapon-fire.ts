import type { RiftHardpoint } from "./types";
import type { WeaponRuntime } from "./weapon-runtime";
import { RIFT_WEAPON_BY_ID } from "./weapons";

export type Point = { x: number; y: number };
export type FireShot = { kind: "projectile" | "flame"; weaponId: string; instanceId: string; origin: Point; angle: number; damage: number; speed: number; radius: number; life: number; penetrations: number; explosionRadius: number };

export function logicalMountOffset(total: number, index: number): Point {
  if (total <= 1) return { x: 12, y: 0 };
  const lateral = total === 2 ? [-8, 8] : [0, -10, 10];
  return { x: index === 0 && total === 3 ? 14 : 9, y: lateral[index] ?? 0 };
}

export function mountOrigin(center: Point, angle: number, total: number, index: number): Point {
  const mount = logicalMountOffset(total, index), cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: center.x + cos * mount.x - sin * mount.y, y: center.y + sin * mount.x + cos * mount.y };
}

export function processHardpointFire(hardpoints: RiftHardpoint[], runtime: WeaponRuntime, held: boolean, center: Point, angle: number): FireShot[] {
  const shots: FireShot[] = [];
  for (const point of hardpoints) {
    if (point.status !== "occupied") continue;
    const state = runtime[point.weapon.instanceId] ??= { cooldown: 0, triggerTicks: 0, shotsFired: 0 };
    state.triggerTicks = held ? state.triggerTicks + 1 : 0;
    if (!held || state.cooldown > 0) continue;
    const definition = RIFT_WEAPON_BY_ID[point.weapon.weaponId];
    const spread = definition.id === "minigun" ? ((state.shotsFired % 5) - 2) * 0.012 : 0;
    shots.push({ kind: definition.id === "flamethrower" ? "flame" : "projectile", weaponId: definition.id, instanceId: point.weapon.instanceId, origin: mountOrigin(center, angle, hardpoints.length, point.index), angle: angle + spread, damage: definition.damage * point.weapon.modifiers.damage, speed: definition.projectileSpeed, radius: definition.projectileRadius, life: definition.lifetimeTicks, penetrations: definition.penetration + point.weapon.modifiers.penetration, explosionRadius: definition.explosionRadius + point.weapon.modifiers.explosionRadius });
    state.cooldown = Math.max(1, Math.round(definition.cadenceTicks / point.weapon.modifiers.fireRate));
    state.shotsFired += 1;
  }
  return shots;
}
