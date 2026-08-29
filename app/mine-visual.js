/** Lightweight, deterministic animation values shared by every hostile mine renderer. */
export const MINE_BLINK_PERIOD_MS = 1150;

/** Uses the mine's existing spawn phase so mine fields do not animate in lockstep. */
export function mineVisualState(timeMs, phase, armed) {
  const safeTime = Number.isFinite(timeMs) ? timeMs : 0;
  const safePhase = Number.isFinite(phase) ? phase : 0;
  const wave = (safeTime / MINE_BLINK_PERIOD_MS) * Math.PI * 2 + safePhase;
  const pulse = (Math.sin(wave) + 1) * 0.5;
  return {
    blink: armed ? 0.22 + pulse * 0.78 : 0.28,
    rotation: safeTime * 0.00035 + safePhase * 0.18,
  };
}
