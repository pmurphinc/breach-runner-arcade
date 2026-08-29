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
    getServerSnapshot: newPilotProgression,
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
