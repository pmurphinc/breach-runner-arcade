import { SHOT_LEVELS, type PowerId } from "./game-data.ts";

/** Warden's fixed hull weapon tuning. It never reads the fitted cannon level. */
export const AUTO_GUN_RANGE = 300;
export const AUTO_GUN_FIRE_RATE = 3;
export const AUTO_GUN_DAMAGE = SHOT_LEVELS[0].damage * 0.4;
export const AUTO_GUN_PROJECTILE_SPEED = 10;
export const AUTO_GUN_PROJECTILE_TICKS = Math.ceil(AUTO_GUN_RANGE / AUTO_GUN_PROJECTILE_SPEED);

export type AutoGunTarget = {
  id: number | string;
  x: number;
  y: number;
  hp: number;
  kind: PowerId | "hostile-player";
  hostile?: boolean;
};

/** Core Bomb, Plasma Bloom, then every other damageable hostile. */
export function autoGunPriority(target: AutoGunTarget) {
  if (target.kind === "nuke") return 0;
  if (target.kind === "inflator") return 1;
  return 2;
}

export function isAutoGunTarget(target: AutoGunTarget) {
  return target.hp > 0 && target.hostile !== false && target.kind !== "ghost";
}

/**
 * Deterministic acquisition: priority, squared distance, then stable entity id.
 * No target reference is retained, so removed/dead entities disappear on the
 * next simulation tick and a higher-priority arrival immediately takes over.
 */
export function selectAutoGunTarget(
  origin: { x: number; y: number },
  targets: readonly AutoGunTarget[],
  range = AUTO_GUN_RANGE,
) {
  const rangeSquared = range * range;
  return targets
    .filter((target) => {
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      return isAutoGunTarget(target) && dx * dx + dy * dy <= rangeSquared;
    })
    .map((target) => ({
      target,
      priority: autoGunPriority(target),
      distanceSquared: (target.x - origin.x) ** 2 + (target.y - origin.y) ** 2,
    }))
    .sort((a, b) => a.priority - b.priority
      || a.distanceSquared - b.distanceSquared
      || String(a.target.id).localeCompare(String(b.target.id)))[0]?.target ?? null;
}

/** Fixed-tick cooldown; elapsed render frames never participate. */
export function autoGunDelayTicks(tickMilliseconds: number) {
  return Math.max(1, Math.round(1000 / AUTO_GUN_FIRE_RATE / tickMilliseconds));
}
