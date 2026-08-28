import type { ShipId } from "./game-data.ts";
import type { DifficultyId, GameMode } from "./difficulty.ts";
import { activateRiftRun, createRiftRun } from "./rift-run/state.ts";
import type { RiftRunState } from "./rift-run/types.ts";

export type RunReplay =
  | { kind: "pve" }
  | { kind: "rift-run"; shipId: ShipId }
  | { kind: "survival" }
  | { kind: "coop" }
  | { kind: "pvp" };

/** Capture what actually ran; the underlying PvE mode cannot identify Rift Run. */
export function replayForCompletedRun(
  mode: GameMode,
  difficulty: DifficultyId,
  riftRun: RiftRunState | null,
): RunReplay {
  if (mode === "pve" && riftRun) return { kind: "rift-run", shipId: riftRun.selectedShip };
  if (mode === "pve" && difficulty === "survival") return { kind: "survival" };
  return { kind: mode };
}

/** A replay deliberately creates state rather than reviving the completed run. */
export function createRunAgainRiftRun(replay: Extract<RunReplay, { kind: "rift-run" }>, seed: string): RiftRunState {
  return activateRiftRun(createRiftRun(replay.shipId, seed));
}
