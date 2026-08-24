/**
 * Local score history and the public, initials-only Wormhole leaderboard.
 *
 * Play never depends on the network. Device bests stay in localStorage, while
 * completed non-Practice PvE victories can also be submitted to the shared
 * arcade board without an account or login.
 */

export const MURPH_SITE_URL = "https://murphtournaments.com";

/** The public score API lives on Murph Tournaments in production. */
export const MURPH_API_BASE =
  process.env.NEXT_PUBLIC_MURPH_API_BASE?.replace(/\/+$/, "") || MURPH_SITE_URL;

export type RunOutcome = "victory" | "defeat";
export type ArcadeDifficulty = "easy" | "difficult" | "hard" | "practice";

export type RunResult = {
  /** Unique per completed run so a retry cannot create a duplicate row. */
  runId: string;
  /** Final score after the time adjustment. */
  score: number;
  baseScore?: number;
  timePenalty?: number;
  initials?: string;
  practice?: boolean;
  difficulty: ArcadeDifficulty;
  outcome: RunOutcome;
  ship: string;
  rivalHealth: number;
  durationSeconds: number;
  finalTarget?: string;
  finalCause?: string;
  finalDamage?: number;
  finalReason?: string;
};

export type LocalBest = {
  score: number;
  outcome: RunOutcome;
  ship: string;
  initials?: string;
  /** Epoch milliseconds, so the card can say how long the record has stood. */
  achievedAt: number;
};

export type LeaderboardEntry = {
  id: number;
  rank: number;
  initials: string;
  score: number;
  ship: string;
  difficulty: Exclude<ArcadeDifficulty, "practice">;
  durationSeconds: number;
  achievedAt: string;
};

const LOCAL_BEST_KEY = "wormhole-arcade:best";
const LOCAL_RUNS_KEY = "wormhole-arcade:runs";

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

function isOutcome(value: unknown): value is RunOutcome {
  return value === "victory" || value === "defeat";
}

export function createArcadeRunId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const random = Math.random().toString(36).slice(2).padEnd(12, "0");
  return `${Date.now().toString(36)}-${random}`;
}

export function loadLocalBest(): LocalBest | null {
  const raw = readStorage(LOCAL_BEST_KEY);
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.score !== "number" || !Number.isFinite(record.score)) return null;
    return {
      score: Math.max(0, Math.floor(record.score)),
      outcome: isOutcome(record.outcome) ? record.outcome : "defeat",
      ship: typeof record.ship === "string" ? record.ship : "Unknown",
      initials: typeof record.initials === "string" ? record.initials.slice(0, 3) : undefined,
      achievedAt: typeof record.achievedAt === "number" ? record.achievedAt : 0,
    };
  } catch {
    return null;
  }
}

export function loadLocalRunCount() {
  const raw = readStorage(LOCAL_RUNS_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Records a finished run against this device and returns the device best. */
export function saveLocalRun(run: RunResult) {
  const previous = loadLocalBest();
  const runs = loadLocalRunCount() + 1;
  writeStorage(LOCAL_RUNS_KEY, String(runs));

  const isBest = !previous || run.score > previous.score;
  if (!isBest) return { best: previous, isBest: false, runs };

  const best: LocalBest = {
    score: run.score,
    outcome: run.outcome,
    ship: run.ship,
    initials: run.initials,
    achievedAt: Date.now(),
  };
  writeStorage(LOCAL_BEST_KEY, JSON.stringify(best));
  return { best, isBest: true, runs };
}

async function murphFetch(path: string, init?: RequestInit) {
  return fetch(`${MURPH_API_BASE}${path}`, {
    ...init,
    credentials: "omit",
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
  });
}

export async function fetchLeaderboard(limit = 10): Promise<LeaderboardEntry[] | null> {
  try {
    const response = await murphFetch(`/api/arcade/leaderboard?limit=${limit}`, {
      cache: "no-store",
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
      return null;
    }
    const body = (await response.json()) as { entries?: LeaderboardEntry[] };
    return body.entries ?? [];
  } catch {
    return null;
  }
}

export type SaveScoreResult =
  | { status: "saved"; rank: number | null }
  | { status: "failed"; message: string };

/** Submit one completed classic-arcade victory. No account cookie is sent. */
export async function saveScoreToMurph(run: RunResult): Promise<SaveScoreResult> {
  if (
    run.outcome !== "victory" ||
    run.practice ||
    run.difficulty === "practice" ||
    !run.initials ||
    !/^[A-Z0-9]{3}$/.test(run.initials)
  ) {
    return { status: "failed", message: "Only completed arcade victories can be ranked." };
  }

  try {
    const response = await murphFetch("/api/arcade/scores", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: run.runId,
        initials: run.initials,
        score: run.score,
        ship: run.ship,
        difficulty: run.difficulty,
        durationSeconds: run.durationSeconds,
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return {
        status: "failed",
        message: body?.error ?? "That score could not be added to the board.",
      };
    }

    const body = (await response.json()) as { rank?: number | null };
    return { status: "saved", rank: body.rank ?? null };
  } catch {
    return {
      status: "failed",
      message: "The global board could not be reached. Your device score is safe.",
    };
  }
}
