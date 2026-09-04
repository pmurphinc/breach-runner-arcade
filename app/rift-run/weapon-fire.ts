import type { RiftHardpoint } from "./types.ts";
import type { WeaponRuntime } from "./weapon-runtime.ts";
import { RIFT_WEAPON_BY_ID } from "./weapons.ts";
import { activeEvolution, RIFT_EVOLUTION_BY_ID } from "./evolutions.ts";

export type Point = { x: number; y: number };
export type FireShot = { kind: "projectile" | "flame"; weaponId: string; evolutionId: string | null; salvoIndex: number; instanceId: string; hardpointIndex: number; origin: Point; angle: number; damage: number; speed: number; radius: number; life: number; penetrations: number; explosionRadius: number; range: number; coneDegrees: number };

/**
 * The ship-agnostic fallback mount layout.
 *
 * Kept, but no longer the normal path: it knows nothing about any particular
 * hull, so a mount it returns can land in empty space beside the artwork. It
 * is what a frame with no authored hardpoints falls back to, and nothing else.
 */
export function logicalMountOffset(total: number, index: number): Point {
  if (total <= 1) return { x: 12, y: 0 };
  const lateral = total === 2 ? [-8, 8] : [0, -10, 10];
  return { x: index === 0 && total === 3 ? 14 : 9, y: lateral[index] ?? 0 };
}

/**
 * Resolves socket `index` to an offset from the hull centre, in the ship's own
 * unrotated frame and already scaled to the size the ship is drawn at.
 *
 * `ship-models.ts` supplies the real one. Returning null for a socket means
 * "this hull has not authored that mount", and the generic layout takes over.
 */
export type MountResolver = (index: number, total: number) => Point | null;

/**
 * Where a socket's rounds actually leave the ship.
 *
 * `center` is the hull centre — the same origin the ship model is drawn about —
 * so an authored mount lands exactly on the gun drawn at it. It used to be
 * handed the *nose muzzle*, which silently added a full ship-length of forward
 * offset to every hull gun and is why wing guns fired from in front of the nose.
 */
export function mountOrigin(center: Point, angle: number, total: number, index: number, resolve?: MountResolver | null): Point {
  const mount = resolve?.(index, total) ?? logicalMountOffset(total, index), cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: center.x + cos * mount.x - sin * mount.y, y: center.y + sin * mount.x + cos * mount.y };
}

export function processHardpointFire(hardpoints: RiftHardpoint[], runtime: WeaponRuntime, held: boolean, center: Point, angle: number, resolve?: MountResolver | null): FireShot[] {
  const shots: FireShot[] = [];
  for (const point of hardpoints) {
    if (point.status !== "occupied") continue;
    const state = runtime[point.weapon.instanceId] ??= { cooldown: 0, triggerTicks: 0, shotsFired: 0 };
    state.triggerTicks = held ? state.triggerTicks + 1 : 0;
    if (!held || state.cooldown > 0) continue;
    const definition = RIFT_WEAPON_BY_ID[point.weapon.weaponId];
    const evolutionId=activeEvolution(point.weapon), evolution=evolutionId ? RIFT_EVOLUTION_BY_ID[evolutionId] : null;
    const count = definition.id === "flamethrower" ? 1 : 1 + point.weapon.modifiers.projectileCount;
    for (let shotIndex=0; shotIndex<count; shotIndex++) {
      const spreadStep = evolutionId === "mirv-battery" ? .09 : .045;
      const volleySpread=(shotIndex-(count-1)/2)*spreadStep;
      const spinSpread=definition.id === "minigun" ? ((state.shotsFired % 5) - 2) * 0.012 : 0;
      shots.push({ kind: definition.id === "flamethrower" ? "flame" : "projectile", weaponId: definition.id, evolutionId, salvoIndex: shotIndex, instanceId: point.weapon.instanceId, hardpointIndex: point.index, origin: mountOrigin(center, angle, hardpoints.length, point.index, resolve), angle: angle + volleySpread + spinSpread, damage: definition.damage * point.weapon.modifiers.damage, speed: definition.projectileSpeed * point.weapon.modifiers.projectileSpeed, radius: definition.projectileRadius * (evolution?.modifiers.projectileScale ?? 1), life: definition.lifetimeTicks, penetrations: definition.penetration + point.weapon.modifiers.penetration, explosionRadius: definition.explosionRadius + point.weapon.modifiers.explosionRadius, range: definition.range + point.weapon.modifiers.range, coneDegrees: definition.coneDegrees + point.weapon.modifiers.coneWidth });
    }
    state.cooldown = Math.max(1, Math.round(definition.cadenceTicks / point.weapon.modifiers.fireRate));
    state.shotsFired += 1;
  }
  return shots;
}
