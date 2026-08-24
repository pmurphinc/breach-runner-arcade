/**
 * Pure timing and attraction helpers for the staged wormhole victory.
 */

export const VICTORY_TIMING = {
  freezeSeconds: 0.55,
  pullSeconds: 2.2,
  collapseSeconds: 1,
  blastSeconds: 1.45,
} as const;

export const VICTORY_TOTAL_SECONDS =
  VICTORY_TIMING.freezeSeconds
  + VICTORY_TIMING.pullSeconds
  + VICTORY_TIMING.collapseSeconds
  + VICTORY_TIMING.blastSeconds;

export type VictoryPhase = "freeze" | "pull" | "collapse" | "blast";

export type VictoryVisualState = {
  phase: VictoryPhase;
  progress: number;
  phaseProgress: number;
  portalScale: number;
  shake: number;
};

export function victoryVisualState(remainingTicks: number, tickMs: number): VictoryVisualState {
  const totalTicks = Math.max(1, Math.round(VICTORY_TOTAL_SECONDS * 1000 / tickMs));
  const elapsedSeconds = (totalTicks - Math.max(0, remainingTicks)) * tickMs / 1000;
  const progress = Math.max(0, Math.min(1, elapsedSeconds / VICTORY_TOTAL_SECONDS));

  if (elapsedSeconds < VICTORY_TIMING.freezeSeconds) {
    const phaseProgress = elapsedSeconds / VICTORY_TIMING.freezeSeconds;
    return { phase: "freeze", progress, phaseProgress, portalScale: 1 + Math.sin(phaseProgress * Math.PI * 8) * 0.12, shake: 0 };
  }

  const pullEnd = VICTORY_TIMING.freezeSeconds + VICTORY_TIMING.pullSeconds;
  if (elapsedSeconds < pullEnd) {
    const phaseProgress = (elapsedSeconds - VICTORY_TIMING.freezeSeconds) / VICTORY_TIMING.pullSeconds;
    return { phase: "pull", progress, phaseProgress, portalScale: 1 - phaseProgress * 0.28, shake: 0 };
  }

  const collapseEnd = pullEnd + VICTORY_TIMING.collapseSeconds;
  if (elapsedSeconds < collapseEnd) {
    const phaseProgress = (elapsedSeconds - pullEnd) / VICTORY_TIMING.collapseSeconds;
    return { phase: "collapse", progress, phaseProgress, portalScale: Math.max(0.035, (1 - phaseProgress) ** 2 * 0.72), shake: 0 };
  }

  const phaseProgress = Math.min(1, (elapsedSeconds - collapseEnd) / VICTORY_TIMING.blastSeconds);
  return {
    phase: "blast",
    progress,
    phaseProgress,
    portalScale: 0.02,
    shake: Math.max(0, (1 - phaseProgress) * 14),
  };
}

export function pullVelocity(
  x: number,
  y: number,
  vx: number,
  vy: number,
  targetX: number,
  targetY: number,
  strength: number,
) {
  const dx = targetX - x;
  const dy = targetY - y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const drag = 0.9;
  return {
    vx: vx * drag + dx / distance * strength,
    vy: vy * drag + dy / distance * strength,
    distance,
  };
}
