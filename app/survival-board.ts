/**
 * The on-device Rift Survival board.
 *
 * Survival is ranked by time, not by a settled score, so it cannot share the
 * arcade device record: that one keeps a single best score, and a Survival
 * score climbs with every minute survived, so one long run would take the
 * arcade record and never give it back. This keeps a proper board instead of a
 * single number — the mode's whole appeal is beating your own last run, and a
 * board is what makes "two seconds off your best" visible.
 *
 * Ranking is pure and separate from storage on purpose. `localStorage` is
 * unavailable in the test runner and can throw in a private window, so the
 * comparison rules — the part that is actually easy to get wrong — are
 * testable without either.
 */

import type { RunResult } from "./arcade-scores.ts";

/** Entries kept on the device. Deep enough to chase, short enough to read. */
export const SURVIVAL_BOARD_LIMIT = 25;

export type SurvivalEntry = {
  /** Unique per run, so replaying a restored summary cannot double-record it. */
  runId: string;
  initials: string;
  ship: string;
  /** The rank metric. */
  durationSeconds: number;
  score: number;
  riftLevel: number;
  breaches: number;
  /** Epoch milliseconds. Also the tie-breaker of last resort. */
  achievedAt: number;
};

function whole(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Compares two runs the way the mode asks to be judged.
 *
 * Time first, because that is what Survival is scored on. Score breaks a tie,
 * since two pilots who lasted the same number of seconds are separated by what
 * they did with them. The earlier run wins a total tie: whoever got there first
 * keeps the higher rank rather than being pushed down by a later equal.
 */
export function compareSurvivalEntries(a: SurvivalEntry, b: SurvivalEntry) {
  if (b.durationSeconds !== a.durationSeconds) return b.durationSeconds - a.durationSeconds;
  if (b.score !== a.score) return b.score - a.score;
  return a.achievedAt - b.achievedAt;
}

/** Sorted, trimmed, and free of duplicate runs. Never mutates its input. */
export function rankSurvivalEntries(entries: readonly SurvivalEntry[]) {
  const seen = new Set<string>();
  const unique: SurvivalEntry[] = [];
  for (const entry of entries) {
    if (entry.runId && seen.has(entry.runId)) continue;
    if (entry.runId) seen.add(entry.runId);
    unique.push(entry);
  }
  return unique.sort(compareSurvivalEntries).slice(0, SURVIVAL_BOARD_LIMIT);
}

export type SurvivalPlacement = {
  board: SurvivalEntry[];
  /**
   * Where the run landed, 1-based, or null when it did not make the board.
   *
   * Null is a real answer rather than an error: a short run on a full board
   * simply did not place, and the result card says so instead of claiming a
   * rank the player cannot find.
   */
  rank: number | null;
};

/** Adds one run to a board and re-ranks. Pure — the caller decides to persist. */
export function placeSurvivalEntry(
  board: readonly SurvivalEntry[],
  entry: SurvivalEntry
): SurvivalPlacement {
  const ranked = rankSurvivalEntries([...board, entry]);
  const index = ranked.findIndex((candidate) => candidate.runId === entry.runId);
  return { board: ranked, rank: index >= 0 ? index + 1 : null };
}

/** The board as one ship flew it. An empty ship name means every ship. */
export function survivalEntriesForShip(board: readonly SurvivalEntry[], ship: string) {
  if (!ship) return [...board];
  return board.filter((entry) => entry.ship === ship);
}

/** Every ship that appears on the board, in the order it first ranks. */
export function shipsOnSurvivalBoard(board: readonly SurvivalEntry[]) {
  const ships: string[] = [];
  for (const entry of board) {
    if (entry.ship && !ships.includes(entry.ship)) ships.push(entry.ship);
  }
  return ships;
}

/** Turns a finished run into a board entry. Non-Survival runs are rejected. */
export function survivalEntryFromRun(run: RunResult, achievedAt = Date.now()): SurvivalEntry | null {
  if (run.difficulty !== "survival") return null;
  return {
    runId: run.runId,
    initials: run.initials ?? "",
    ship: run.ship,
    durationSeconds: whole(run.durationSeconds),
    score: whole(run.score),
    riftLevel: Math.max(1, whole(run.riftLevel)),
    breaches: whole(run.breaches),
    achievedAt,
  };
}

/** Rebuilds an entry from whatever was in storage, discarding anything unusable. */
export function parseSurvivalEntry(value: unknown): SurvivalEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.durationSeconds !== "number" || !Number.isFinite(record.durationSeconds)) {
    return null;
  }
  return {
    runId: typeof record.runId === "string" ? record.runId : "",
    initials: typeof record.initials === "string" ? record.initials.slice(0, 3) : "",
    ship: typeof record.ship === "string" ? record.ship : "Unknown",
    durationSeconds: whole(record.durationSeconds),
    score: whole(record.score),
    riftLevel: Math.max(1, whole(record.riftLevel)),
    breaches: whole(record.breaches),
    achievedAt: whole(record.achievedAt),
  };
}

// ---------------------------------------------------------------- storage --

const SURVIVAL_BOARD_KEY = "wormhole-arcade:survival-board";

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * The stored board.
 *
 * Always returns an array. A missing key, unreadable storage, corrupt JSON and
 * a stored value that is not a list all mean the same thing to a player — no
 * runs yet — and none of them should stop the game rendering.
 */
export function loadSurvivalBoard(): SurvivalEntry[] {
  const raw = readStorage(SURVIVAL_BOARD_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries = parsed
      .map(parseSurvivalEntry)
      .filter((entry): entry is SurvivalEntry => entry !== null);
    return rankSurvivalEntries(entries);
  } catch {
    return [];
  }
}

/** Records a finished Survival run and returns the new board and its rank. */
export function recordSurvivalRun(run: RunResult, achievedAt = Date.now()): SurvivalPlacement {
  const entry = survivalEntryFromRun(run, achievedAt);
  if (!entry) return { board: loadSurvivalBoard(), rank: null };

  const placement = placeSurvivalEntry(loadSurvivalBoard(), entry);
  writeStorage(SURVIVAL_BOARD_KEY, JSON.stringify(placement.board));
  return placement;
}

/**
 * Re-stamps a run already on the board with the initials it was just given.
 *
 * The initials prompt comes after the run is recorded, so without this the
 * board would keep the anonymous version of a run the player has since signed.
 */
export function nameSurvivalRun(runId: string, initials: string): SurvivalPlacement {
  const board = loadSurvivalBoard();
  const named = board.map((entry) => (entry.runId === runId ? { ...entry, initials } : entry));
  writeStorage(SURVIVAL_BOARD_KEY, JSON.stringify(named));
  const index = named.findIndex((entry) => entry.runId === runId);
  return { board: named, rank: index >= 0 ? index + 1 : null };
}
