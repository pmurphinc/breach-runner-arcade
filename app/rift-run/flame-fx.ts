import { mountOrigin, type Point } from "./weapon-fire.ts";

/**
 * A flame is a bounded presentation record, not a damage entity. Its origin is
 * deliberately resolved from the ship transform at draw time so a cadence
 * gap cannot leave the cone behind a moving hull.
 */
export type RiftFlameFx = {
  instanceId: string;
  hardpointIndex: number;
  hardpointCount: number;
  angleOffset: number;
  range: number;
  coneDegrees: number;
  life: number;
};

export type FlameVisualShot = Pick<RiftFlameFx, "instanceId" | "hardpointIndex" | "range" | "coneDegrees"> & {
  angle: number;
};

export function refreshFlameFx(flames: RiftFlameFx[], shot: FlameVisualShot, hardpointCount: number, hullAngle: number, life = 6) {
  const next: RiftFlameFx = {
    instanceId: shot.instanceId,
    hardpointIndex: shot.hardpointIndex,
    hardpointCount,
    angleOffset: shot.angle - hullAngle,
    range: shot.range,
    coneDegrees: shot.coneDegrees,
    life,
  };
  const existing = flames.findIndex(({ instanceId }) => instanceId === shot.instanceId);
  if (existing < 0) flames.push(next);
  else flames[existing] = next;
}

export function flameDisplayTransform(flame: RiftFlameFx, muzzle: Point, hullAngle: number) {
  return {
    origin: mountOrigin(muzzle, hullAngle, flame.hardpointCount, flame.hardpointIndex),
    angle: hullAngle + flame.angleOffset,
  };
}

export function clearInactiveFlameFx(flames: RiftFlameFx[], activeInstanceIds: ReadonlySet<string>, firing: boolean) {
  if (!firing) {
    flames.length = 0;
    return;
  }
  let write = 0;
  for (const flame of flames) if (activeInstanceIds.has(flame.instanceId)) flames[write++] = flame;
  flames.length = write;
}
