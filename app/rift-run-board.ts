/**
 * The on-device Rift Run board.
 *
 * Rift Run is ranked by **depth** — how many rifts the run broke through —
 * because depth is the thing the mode is actually about. Everything else in a
 * run escalates off it: the ruleset, the hazards, the payload budget, the
 * hardpoint unlocks. "I got to depth six" is the sentence a pilot says after a
 * run, so it is the number the board sorts on.
 *
 * It cannot share either board that already exists:
 *
 * - The **arcade** board keeps one best *score* from a completed *victory*.
 *   Rift Run is endless and has no victory, and until this module existed a
 *   Rift Run's score was quietly competing for that single arcade record —
 *   two different measurements fighting over one number.
 * - The **Survival** board ranks on *time survived*. A careful Rift Run that
 *   reaches depth eight can take less time than a cautious one that dies at
 *   depth two, so time ranks the mode backwards.
 *
 * Ranking is pure and kept separate from storage, exactly as the Survival
 * board does it: `localStorage` is unavailable in the test runner and can
 * throw in a private window, so the comparison rules — the part that is easy
 * to get wrong — stay testable without either.
 */

import type { RunResult } from "./arcade-scores.ts";

/** Entries kept on the device. Deep enough to chase, short enough to read. */
export const RIFT_RUN_BOARD_LIMIT = 25;

export type RiftRunEntry = {
  /** Unique per run, so replaying a restored summary cannot double-record it. */
  runId: string;
  initials: string;
  /** The rank metric: rifts broken through. */
  depth: number;
  /** Pilot level reached. Supporting detail, not a rank metric — see below. */
  level: number;
  score: number;
  durationSeconds: number;
  /** Epoch milliseconds. Also the tie-breaker of last resort. */
  achievedAt: number;
};

function whole(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Compares two runs the way the mode asks to be judged.
 *
 * Depth first, because that is what Rift Run is scored on. Score breaks a tie,
 * and it will be doing real work: depth is a small number, so most runs on a
 * board will be tied on it, and score is what separates two pilots who both
 * died in the fourth rift. The earlier run wins a total tie — whoever got
 * there first keeps the higher rank rather than being pushed down by a later
 * equal.
 *
 * Pilot level is deliberately *not* a tie-break. It climbs with the same rift
 * energy that drives score, so it would almost never break a tie that score
 * had not already broken, and a third comparison that changes nothing is a
 * third rule to keep true.
 */
export function compareRiftRunEntries(a: RiftRunEntry, b: RiftRunEntry) {
  if (b.depth !== a.depth) return b.depth - a.depth;
  if (b.score !== a.score) return b.score - a.score;
  return a.achievedAt - b.achievedAt;
}

/** Sorted, trimmed, and free of duplicate runs. Never mutates its input. */
export function rankRiftRunEntries(entries: readonly RiftRunEntry[]) {
  const seen = new Set<string>();
  const unique: RiftRunEntry[] = [];
  for (const entry of entries) {
    if (entry.runId && seen.has(entry.runId)) continue;
    if (entry.runId) seen.add(entry.runId);
    unique.push(entry);
  }
  return unique.sort(compareRiftRunEntries).slice(0, RIFT_RUN_BOARD_LIMIT);
}

export type RiftRunPlacement = {
  board: RiftRunEntry[];
  /**
   * Where the run landed, 1-based, or null when it did not make the board.
   *
   * Null is a real answer rather than an error: a shallow run on a full board
   * simply did not place, and the result card says so instead of claiming a
   * rank the player cannot find.
   */
  rank: number | null;
};

/** Adds one run to a board and re-ranks. Pure — the caller decides to persist. */
export function placeRiftRunEntry(
  board: readonly RiftRunEntry[],
  entry: RiftRunEntry
): RiftRunPlacement {
  const ranked = rankRiftRunEntries([...board, entry]);
  const index = ranked.findIndex((candidate) => candidate.runId === entry.runId);
  return { board: ranked, rank: index >= 0 ? index + 1 : null };
}

/** The deepest run on a board, or null when there is nothing on it yet. */
export function deepestRiftRun(board: readonly RiftRunEntry[]) {
  return board.length > 0 ? board[0] : null;
}

/**
 * Turns a finished run into a board entry.
 *
 * There is no ship on the entry, and that is not an omission: every Rift Run
 * launches on the same issued starter frame, so a ship column would print one
 * value forever and a ship filter would offer one option. The Survival board
 * carries both because Survival flies the roster.
 */
export function riftRunEntryFromRun(run: RunResult, achievedAt = Date.now()): RiftRunEntry | null {
  if (typeof run.depth !== "number" || !Number.isFinite(run.depth)) return null;
  return {
    runId: run.runId,
    initials: run.initials ?? "",
    depth: whole(run.depth),
    level: Math.max(1, whole(run.riftLevel)),
    score: whole(run.score),
    durationSeconds: whole(run.durationSeconds),
    achievedAt,
  };
}

/** Rebuilds an entry from whatever was in storage, discarding anything unusable. */
export function parseRiftRunEntry(value: unknown): RiftRunEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.depth !== "number" || !Number.isFinite(record.depth)) return null;
  return {
    runId: typeof record.runId === "string" ? record.runId : "",
    initials: typeof record.initials === "string" ? record.initials.slice(0, 3) : "",
    depth: whole(record.depth),
    level: Math.max(1, whole(record.level)),
    score: whole(record.score),
    durationSeconds: whole(record.durationSeconds),
    achievedAt: whole(record.achievedAt),
  };
}

// ---------------------------------------------------------------- storage --

const RIFT_RUN_BOARD_KEY = "wormhole-arcade:rift-run-board";

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
export function loadRiftRunBoard(): RiftRunEntry[] {
  const raw = readStorage(RIFT_RUN_BOARD_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries = parsed
      .map(parseRiftRunEntry)
      .filter((entry): entry is RiftRunEntry => entry !== null);
    return rankRiftRunEntries(entries);
  } catch {
    return [];
  }
}

/** Records a finished Rift Run and returns the new board and its rank. */
export function recordRiftRun(run: RunResult, achievedAt = Date.now()): RiftRunPlacement {
  const entry = riftRunEntryFromRun(run, achievedAt);
  if (!entry) return { board: loadRiftRunBoard(), rank: null };

  const placement = placeRiftRunEntry(loadRiftRunBoard(), entry);
  writeStorage(RIFT_RUN_BOARD_KEY, JSON.stringify(placement.board));
  return placement;
}

/**
 * Re-stamps a run already on the board with the initials it was just given.
 *
 * The initials prompt comes after the run is recorded, so without this the
 * board would keep the anonymous version of a run the player has since signed.
 */
export function nameRiftRun(runId: string, initials: string): RiftRunPlacement {
  const board = loadRiftRunBoard();
  const named = board.map((entry) => (entry.runId === runId ? { ...entry, initials } : entry));
  writeStorage(RIFT_RUN_BOARD_KEY, JSON.stringify(named));
  const index = named.findIndex((entry) => entry.runId === runId);
  return { board: named, rank: index >= 0 ? index + 1 : null };
}
