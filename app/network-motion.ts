/** Visual-only smoothing for a remote co-op pilot. Game authority stays elsewhere. */
export const INTERPOLATION_DELAY_MS = 50;
export const MAX_EXTRAPOLATION_MS = 90;
// Corrections beyond this are respawns/reconnects, not motion to animate.
export const LARGE_CORRECTION_DISTANCE = 240;

export type MotionSnapshot = {
  seq: number;
  sentAt: number;
  receivedAt: number;
  x: number;
  y: number;
  angle: number;
};

export type RenderedMotion = Pick<MotionSnapshot, "x" | "y" | "angle">;

export function shortestAngleDelta(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

export function interpolateAngle(from: number, to: number, amount: number) {
  return (from + shortestAngleDelta(from, to) * amount + 360) % 360;
}

export class RemoteMotion {
  private snapshots: MotionSnapshot[] = [];
  private lastRendered: RenderedMotion | null = null;
  private receivedTimes: number[] = [];
  private dropped = 0;

  reset() {
    this.snapshots = [];
    this.lastRendered = null;
    this.receivedTimes = [];
    this.dropped = 0;
  }

  push(snapshot: MotionSnapshot) {
    const latest = this.snapshots.at(-1);
    if (latest && snapshot.seq <= latest.seq) {
      this.dropped += 1;
      return false;
    }

    const predicted = this.sample(snapshot.receivedAt);
    if (predicted && Math.hypot(snapshot.x - predicted.x, snapshot.y - predicted.y) > LARGE_CORRECTION_DISTANCE) {
      this.snapshots = [snapshot];
      this.lastRendered = { x: snapshot.x, y: snapshot.y, angle: snapshot.angle };
    } else {
      this.snapshots.push(snapshot);
      // Two are sufficient for interpolation/velocity; one extra survives uneven delivery.
      if (this.snapshots.length > 3) this.snapshots.shift();
    }
    this.receivedTimes.push(snapshot.receivedAt);
    if (this.receivedTimes.length > 31) this.receivedTimes.shift();
    return true;
  }

  sample(now: number): RenderedMotion | null {
    const latest = this.snapshots.at(-1);
    if (!latest) return null;
    const target = now - INTERPOLATION_DELAY_MS;
    const previous = this.snapshots.at(-2);

    let result: RenderedMotion;
    if (!previous) {
      result = { x: latest.x, y: latest.y, angle: latest.angle };
    } else if (target <= latest.receivedAt) {
      const span = Math.max(1, latest.receivedAt - previous.receivedAt);
      const amount = Math.max(0, Math.min(1, (target - previous.receivedAt) / span));
      result = {
        x: previous.x + (latest.x - previous.x) * amount,
        y: previous.y + (latest.y - previous.y) * amount,
        angle: interpolateAngle(previous.angle, latest.angle, amount),
      };
    } else {
      const span = Math.max(1, latest.receivedAt - previous.receivedAt);
      const ahead = Math.min(MAX_EXTRAPOLATION_MS, target - latest.receivedAt);
      result = {
        x: latest.x + ((latest.x - previous.x) / span) * ahead,
        y: latest.y + ((latest.y - previous.y) / span) * ahead,
        angle: interpolateAngle(latest.angle, latest.angle + shortestAngleDelta(previous.angle, latest.angle), ahead / span),
      };
    }
    this.lastRendered = result;
    return result;
  }

  metrics(now: number) {
    const intervals = this.receivedTimes.slice(1).map((value, index) => value - this.receivedTimes[index]);
    const average = intervals.length ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length : 0;
    const jitter = intervals.length
      ? intervals.reduce((sum, value) => sum + Math.abs(value - average), 0) / intervals.length
      : 0;
    return {
      updateHz: average > 0 ? 1000 / average : 0,
      latestAgeMs: this.snapshots.length ? Math.max(0, now - this.snapshots.at(-1)!.receivedAt) : 0,
      jitterMs: jitter,
      dropped: this.dropped,
    };
  }
}
