/** Pure run-timing and score-settlement rules for Wormhole Arcade. */

export const TIME_PENALTY_PER_SECOND = 10;

export type ScoreSettlement = {
  baseScore: number;
  durationSeconds: number;
  timePenalty: number;
  finalScore: number;
};

export function settleScore(
  baseScore: number,
  durationSeconds: number,
  outcome: "victory" | "defeat"
): ScoreSettlement {
  const safeBase = Math.max(0, Math.floor(Number.isFinite(baseScore) ? baseScore : 0));
  const safeDuration = Math.max(0, Math.floor(Number.isFinite(durationSeconds) ? durationSeconds : 0));
  const timePenalty = outcome === "victory" ? safeDuration * TIME_PENALTY_PER_SECOND : 0;
  return {
    baseScore: safeBase,
    durationSeconds: safeDuration,
    timePenalty,
    finalScore: Math.max(0, safeBase - timePenalty),
  };
}

export function formatRunTime(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function normalizeInitials(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
}
