/**
 * Score persistence for Wormhole Arcade.
 *
 * The arcade has no database of its own and never gates play behind an
 * account. Two independent stores back that promise:
 *
 *  - Guests: personal bests live in this device's `localStorage` and are never
 *    uploaded anywhere.
 *  - Signed-in players: after a run they may save that score to Murph
 *    Tournaments, which is also what puts them on the global board.
 *
 * Everything here fails soft. A blocked `localStorage`, an offline network, or
 * a Murph Tournaments outage must never stop someone from playing.
 */

export const MURPH_SITE_URL = "https://murphtournaments.com";

/**
 * Where the score API lives. Overridable at build time so a local arcade can
 * point at a local site; the deployed default is the production site.
 */
export const MURPH_API_BASE =
  process.env.NEXT_PUBLIC_MURPH_API_BASE?.replace(/\/+$/, "") || MURPH_SITE_URL;

export type RunOutcome = "victory" | "defeat";

export type RunResult = {
  score: number;
  outcome: RunOutcome;
  ship: string;
  rivalHealth: number;
  durationSeconds: number;
};

export type LocalBest = {
  score: number;
  outcome: RunOutcome;
  ship: string;
  /** Epoch milliseconds, so the card can say how long the record has stood. */
  achievedAt: number;
};

export type ArcadePlayer = {
  displayName: string;
  discordUsername: string | null;
  discordAvatarUrl: string | null;
  bestScore: number;
  runs: number;
  rank: number | null;
};

export type LeaderboardEntry = {
  rank: number;
  displayName: string;
  discordUsername: string | null;
  discordAvatarUrl: string | null;
  bestScore: number;
  runs: number;
};

const LOCAL_BEST_KEY = "wormhole-arcade:best";
const LOCAL_RUNS_KEY = "wormhole-arcade:runs";
const DISCORD_SAVE_PROMPT_SEEN_KEY = "wormhole-arcade:discord-save-prompt-seen";

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private mode, disabled site data, or an embedded webview. Not an error.
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

/** The Discord save invitation is shown on only one completed-run screen per device. */
export function hasSeenDiscordSavePrompt() {
  return readStorage(DISCORD_SAVE_PROMPT_SEEN_KEY) === "1";
}

export function markDiscordSavePromptSeen() {
  writeStorage(DISCORD_SAVE_PROMPT_SEEN_KEY, "1");
}

/**
 * Records a finished run against this device's history.
 * Returns the stored best afterwards and whether this run replaced it.
 */
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
    achievedAt: Date.now(),
  };
  writeStorage(LOCAL_BEST_KEY, JSON.stringify(best));
  return { best, isBest: true, runs };
}

async function murphFetch(path: string, init?: RequestInit) {
  return fetch(`${MURPH_API_BASE}${path}`, {
    ...init,
    // The Murph session cookie is SameSite=None; Secure, so it rides along on
    // these cross-origin calls. Without this the API always sees a guest.
    credentials: "include",
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
  });
}

/** Who Murph Tournaments thinks is playing. `null` means "could not ask". */
export async function fetchArcadeSession(): Promise<
  { signedIn: boolean; player: ArcadePlayer | null } | null
> {
  try {
    const response = await murphFetch("/api/arcade/session");
    if (!response.ok) return null;
    return (await response.json()) as {
      signedIn: boolean;
      player: ArcadePlayer | null;
    };
  } catch {
    return null;
  }
}

export async function fetchLeaderboard(limit = 10): Promise<LeaderboardEntry[] | null> {
  try {
    const response = await murphFetch(`/api/arcade/leaderboard?limit=${limit}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { entries?: LeaderboardEntry[] };
    return body.entries ?? [];
  } catch {
    return null;
  }
}

export type SaveScoreResult =
  | { status: "saved"; bestScore: number; runs: number; rank: number | null }
  | { status: "signed-out" }
  | { status: "failed"; message: string };

export async function saveScoreToMurph(run: RunResult): Promise<SaveScoreResult> {
  try {
    const response = await murphFetch("/api/arcade/scores", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        score: run.score,
        outcome: run.outcome,
        ship: run.ship || undefined,
        rivalHealth: run.rivalHealth,
        durationSeconds: run.durationSeconds,
      }),
    });

    if (response.status === 401) return { status: "signed-out" };

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      return {
        status: "failed",
        message: body?.error ?? "That score could not be saved.",
      };
    }

    const body = (await response.json()) as {
      bestScore?: number;
      runs?: number;
      rank?: number | null;
    };
    return {
      status: "saved",
      bestScore: body.bestScore ?? run.score,
      runs: body.runs ?? 1,
      rank: body.rank ?? null,
    };
  } catch {
    return {
      status: "failed",
      message: "Murph Tournaments could not be reached.",
    };
  }
}

/**
 * Sends the player to Discord sign-in and back to this exact page afterwards,
 * so a run that is waiting to be saved is still on screen when they return.
 */
export function discordSignInUrl(returnTo: string) {
  return `${MURPH_API_BASE}/api/auth/discord/login?returnTo=${encodeURIComponent(returnTo)}`;
}

/**
 * A finished run held across the Discord sign-in round trip.
 *
 * Signing in navigates away to Discord and back, so the run in memory is gone
 * by the time the player returns. It is parked here with a short expiry —
 * long enough for an OAuth hop, short enough that a run abandoned mid-sign-in
 * does not resurface days later.
 */
const PENDING_RUN_KEY = "wormhole-arcade:pending-run";
const PENDING_RUN_TTL_MS = 15 * 60 * 1000;

export function stashPendingRun(run: RunResult) {
  writeStorage(PENDING_RUN_KEY, JSON.stringify({ ...run, stashedAt: Date.now() }));
}

export function clearPendingRun() {
  try {
    window.localStorage.removeItem(PENDING_RUN_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

/** Reads the parked run and clears it, so it can only ever be saved once. */
export function takePendingRun(): RunResult | null {
  const raw = readStorage(PENDING_RUN_KEY);
  clearPendingRun();
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const stashedAt = typeof record.stashedAt === "number" ? record.stashedAt : 0;
    if (Date.now() - stashedAt > PENDING_RUN_TTL_MS) return null;
    if (typeof record.score !== "number" || !Number.isFinite(record.score)) return null;

    return {
      score: Math.max(0, Math.floor(record.score)),
      outcome: isOutcome(record.outcome) ? record.outcome : "defeat",
      ship: typeof record.ship === "string" ? record.ship : "Unknown",
      rivalHealth: typeof record.rivalHealth === "number" ? record.rivalHealth : 0,
      durationSeconds:
        typeof record.durationSeconds === "number" ? record.durationSeconds : 0,
    };
  } catch {
    return null;
  }
}
