import type { DifficultyId, GameMode } from "./difficulty.ts";

export const PILOT_PROGRESSION_KEY = "breach-runner:pilot-progression";
export const PILOT_PROGRESSION_VERSION = 1 as const;
export const PROGRESSION_DIFFICULTIES = ["easy", "difficult", "hard"] as const;
export type ProgressionDifficulty = (typeof PROGRESSION_DIFFICULTIES)[number];

export type PilotProgression = {
  version: typeof PILOT_PROGRESSION_VERSION;
  completedDifficulties: ProgressionDifficulty[];
};

export const newPilotProgression = (): PilotProgression => ({
  version: PILOT_PROGRESSION_VERSION,
  completedDifficulties: [],
});

/**
 * The server's view of a pilot: nothing completed yet.
 *
 * One shared value rather than a call to `newPilotProgression`, and the
 * difference matters. `useSyncExternalStore` compares snapshots by identity,
 * so a factory here mints a new object on every read and every render looks
 * like a change. React notices and warns -- "The result of getServerSnapshot
 * should be cached to avoid an infinite loop" -- which is a real render-loop
 * risk rather than console noise, and it fired on every page load.
 *
 * Frozen so it cannot be mutated into a per-session value by accident, which
 * would be a much quieter bug than the one it replaces.
 */
const SERVER_PILOT_PROGRESSION: PilotProgression = Object.freeze(newPilotProgression());

export function parsePilotProgression(raw: string | null): PilotProgression {
  if (!raw) return newPilotProgression();
  try {
    const value = JSON.parse(raw) as Partial<PilotProgression>;
    if (value.version !== PILOT_PROGRESSION_VERSION || !Array.isArray(value.completedDifficulties)) return newPilotProgression();
    return {
      version: PILOT_PROGRESSION_VERSION,
      completedDifficulties: PROGRESSION_DIFFICULTIES.filter((id) => value.completedDifficulties?.includes(id)),
    };
  } catch {
    return newPilotProgression();
  }
}

export function isDifficultyUnlocked(id: DifficultyId, progression: PilotProgression): boolean {
  if (id === "practice" || id === "easy" || id === "survival") return true;
  if (id === "difficult") return progression.completedDifficulties.includes("easy");
  return progression.completedDifficulties.includes("difficult");
}

export function safeDifficulty(id: DifficultyId, progression: PilotProgression): DifficultyId {
  return isDifficultyUnlocked(id, progression) ? id : "easy";
}

export function nextDifficulty(id: ProgressionDifficulty): ProgressionDifficulty | null {
  if (id === "easy") return "difficult";
  if (id === "difficult") return "hard";
  return null;
}

export function recordDifficultyCompletion(
  progression: PilotProgression,
  result: { mode: GameMode; difficulty: DifficultyId; outcome: "victory" | "defeat" },
): PilotProgression {
  if (result.outcome !== "victory" || !["pve", "coop"].includes(result.mode)) return progression;
  if (!PROGRESSION_DIFFICULTIES.includes(result.difficulty as ProgressionDifficulty)) return progression;
  const difficulty = result.difficulty as ProgressionDifficulty;
  if (!isDifficultyUnlocked(difficulty, progression) || progression.completedDifficulties.includes(difficulty)) return progression;
  return { ...progression, completedDifficulties: [...progression.completedDifficulties, difficulty] };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;
function browserStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}
export function createPilotProgressionStore(storage: StorageLike | null = browserStorage()) {
  let raw: string | null = null;
  try { raw = storage?.getItem(PILOT_PROGRESSION_KEY) ?? null; } catch { /* Storage can be disabled. */ }
  let snapshot = parsePilotProgression(raw);
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => SERVER_PILOT_PROGRESSION,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    record(result: Parameters<typeof recordDifficultyCompletion>[1]) {
      const next = recordDifficultyCompletion(snapshot, result);
      if (next === snapshot) return false;
      snapshot = next;
      try { storage?.setItem(PILOT_PROGRESSION_KEY, JSON.stringify(snapshot)); } catch { /* Progress remains live for this session. */ }
      listeners.forEach((listener) => listener());
      return true;
    },
  };
}

export const pilotProgressionStore = createPilotProgressionStore();
