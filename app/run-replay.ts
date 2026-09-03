import type { DifficultyId, GameMode } from "./difficulty.ts";
import { activateRiftRun, createRiftRun } from "./rift-run/state.ts";
import type { RiftRunState } from "./rift-run/types.ts";

export type RunReplay =
  | { kind: "pve" }
  // No ship: a Rift Run replay has nothing to carry forward but the format
  // itself, because every run starts on the same issued starter frame.
  | { kind: "rift-run" }
  | { kind: "survival" }
  | { kind: "coop" }
  | { kind: "pvp" }
  | { kind: "classic" };

/** Capture what actually ran; the underlying PvE mode cannot identify Rift Run. */
export function replayForCompletedRun(
  mode: GameMode,
  difficulty: DifficultyId,
  riftRun: RiftRunState | null,
): RunReplay {
  if (mode === "pve" && riftRun) return { kind: "rift-run" };
  if (mode === "pve" && difficulty === "survival") return { kind: "survival" };
  return { kind: mode };
}

/** A replay deliberately creates state rather than reviving the completed run. */
export function createRunAgainRiftRun(_replay: Extract<RunReplay, { kind: "rift-run" }>, seed: string): RiftRunState {
  return activateRiftRun(createRiftRun(seed));
}
