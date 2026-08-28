import type { Point } from "./weapon-fire";

export type PenetrationState = { remaining: number; hitTargets: Set<string> };
export function penetrate(state: PenetrationState, targetId: string): boolean {
  if (state.remaining <= 0 || state.hitTargets.has(targetId)) return false;
  state.hitTargets.add(targetId); state.remaining -= 1; return true;
}
export function targetsInExplosion(center: Point, radius: number, targets: readonly (Point & { id: string })[]): string[] {
  const radiusSquared = radius * radius;
  return targets.filter((target) => (target.x-center.x) ** 2 + (target.y-center.y) ** 2 <= radiusSquared).map(({ id }) => id);
}
export function targetsInFlameCone(origin: Point, angle: number, range: number, coneDegrees: number, targets: readonly (Point & { id: string })[]): string[] {
  const minimumDot = Math.cos(coneDegrees * Math.PI / 360), fx = Math.cos(angle), fy = Math.sin(angle);
  return targets.filter((target) => { const dx=target.x-origin.x, dy=target.y-origin.y, distance=Math.hypot(dx,dy); return distance > 0 && distance <= range && (dx*fx+dy*fy)/distance >= minimumDot; }).map(({ id }) => id);
}
export function selectMissileTarget(origin: Point, angle: number, range: number, coneDegrees: number, targets: readonly (Point & { id: string; hostile: boolean })[]): string | null {
  const candidates = targetsInFlameCone(origin, angle, range, coneDegrees, targets.filter(({ hostile }) => hostile));
  return candidates.sort((a,b) => a.localeCompare(b))[0] ?? null;
}
