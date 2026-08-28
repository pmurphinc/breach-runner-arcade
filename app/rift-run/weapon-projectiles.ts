import type { FireShot, Point } from "./weapon-fire";
import type { RiftWeaponId } from "./types";
import { RIFT_WEAPON_BY_ID } from "./weapons";

export type EntityId = string | number;
export type CombatTarget = Point & { id: EntityId; hostile?: boolean; radius?: number; hp?: number };
export type RiftProjectileState = {
  weaponId: Exclude<RiftWeaponId, "flamethrower">;
  instanceId: string;
  hardpointIndex: number;
  damage: number;
  remainingLifetime: number;
  remainingPenetrations: number;
  explosionRadius: number;
  hitTargetIds: Set<EntityId>;
  targetId: EntityId | null;
  reacquireIn: number;
  detonated: boolean;
};

export type RiftProjectile = Point & { vx: number; vy: number; radius: number; state: RiftProjectileState };

export const MISSILE_REACQUIRE_TICKS = 12;

export function projectileFromShot(shot: FireShot, inheritedVelocity: Point = { x: 0, y: 0 }): RiftProjectile | null {
  if (shot.kind !== "projectile") return null;
  return {
    ...shot.origin,
    vx: Math.cos(shot.angle) * shot.speed + inheritedVelocity.x,
    vy: Math.sin(shot.angle) * shot.speed + inheritedVelocity.y,
    radius: shot.radius,
    state: {
      weaponId: shot.weaponId as RiftProjectileState["weaponId"], instanceId: shot.instanceId,
      hardpointIndex: shot.hardpointIndex, damage: shot.damage, remainingLifetime: shot.life,
      remainingPenetrations: shot.penetrations, explosionRadius: shot.explosionRadius,
      hitTargetIds: new Set(), targetId: null, reacquireIn: 0, detonated: false,
    },
  };
}

export function penetrate(state: Pick<RiftProjectileState, "remainingPenetrations" | "hitTargetIds">, targetId: EntityId): boolean {
  if (state.hitTargetIds.has(targetId)) return false;
  state.hitTargetIds.add(targetId);
  if (state.remainingPenetrations <= 0) return false;
  state.remainingPenetrations -= 1;
  return true;
}

export function targetsInExplosion(center: Point, radius: number, targets: readonly CombatTarget[]): EntityId[] {
  const radiusSquared = radius * radius;
  return targets.filter((target) => (target.x-center.x) ** 2 + (target.y-center.y) ** 2 <= radiusSquared).map(({ id }) => id);
}

export function targetsInFlameCone(origin: Point, angle: number, range: number, coneDegrees: number, targets: readonly CombatTarget[]): EntityId[] {
  const minimumDot = Math.cos(coneDegrees * Math.PI / 360), fx = Math.cos(angle), fy = Math.sin(angle), rangeSquared = range * range;
  return targets.filter((target) => {
    const dx=target.x-origin.x, dy=target.y-origin.y, distanceSquared=dx*dx+dy*dy;
    return distanceSquared > 0 && distanceSquared <= rangeSquared && (dx*fx+dy*fy)/Math.sqrt(distanceSquared) >= minimumDot;
  }).map(({ id }) => id);
}

export function selectMissileTarget(origin: Point, angle: number, range: number, coneDegrees: number, targets: readonly (CombatTarget & { hostile: boolean })[]): EntityId | null {
  const candidates = targetsInFlameCone(origin, angle, range, coneDegrees, targets.filter(({ hostile }) => hostile));
  return candidates.sort((a,b) => String(a).localeCompare(String(b)))[0] ?? null;
}

export function steerMissile(projectile: RiftProjectile, targets: readonly (CombatTarget & { hostile: boolean })[]): void {
  if (projectile.state.weaponId !== "missile-pod") return;
  let target = projectile.state.targetId === null ? undefined : targets.find(({ id, hostile }) => hostile && id === projectile.state.targetId);
  if (!target && projectile.state.reacquireIn <= 0) {
    const angle = Math.atan2(projectile.vy, projectile.vx), definition = RIFT_WEAPON_BY_ID["missile-pod"];
    const id = selectMissileTarget(projectile, angle, definition.range, definition.coneDegrees, targets);
    projectile.state.targetId = id;
    target = id === null ? undefined : targets.find((item) => item.id === id);
    projectile.state.reacquireIn = MISSILE_REACQUIRE_TICKS;
  } else projectile.state.reacquireIn -= 1;
  if (!target) return;
  const speed = Math.hypot(projectile.vx, projectile.vy), desired = Math.atan2(target.y-projectile.y, target.x-projectile.x);
  let current = Math.atan2(projectile.vy, projectile.vx); const delta = ((desired-current+Math.PI*3)%(Math.PI*2))-Math.PI;
  current += Math.max(-0.075, Math.min(0.075, delta));
  projectile.vx = Math.cos(current)*speed; projectile.vy = Math.sin(current)*speed;
}

/** Returns victim ids exactly once; calling it again after detonation is inert. */
export function detonateMissile(projectile: RiftProjectile, targets: readonly CombatTarget[]): EntityId[] {
  if (projectile.state.weaponId !== "missile-pod" || projectile.state.detonated) return [];
  projectile.state.detonated = true; projectile.state.remainingLifetime = 0;
  return targetsInExplosion(projectile, projectile.state.explosionRadius, targets);
}

export function activeProjectileCounts(projectiles: readonly RiftProjectile[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const projectile of projectiles) if (projectile.state.remainingLifetime > 0) result.set(projectile.state.instanceId, (result.get(projectile.state.instanceId) ?? 0) + 1);
  return result;
}

export function admitsProjectile(projectiles: readonly RiftProjectile[], instanceId: string, weaponId: RiftWeaponId): boolean {
  return (activeProjectileCounts(projectiles).get(instanceId) ?? 0) < RIFT_WEAPON_BY_ID[weaponId].maxProjectiles;
}
