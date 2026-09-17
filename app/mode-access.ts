/**
 * Which game modes are open, and to whom.
 *
 * The roster on the Mode Select screen is wider than the set of modes that are
 * finished. Rather than delete the unfinished ones — they build, they pass
 * their suites, and half the engine is shared with the finished ones — every
 * card stays on the screen and the unfinished ones are shown as locked: a
 * title and the fact that they are being worked on, and nothing else. A player
 * can see what is coming without being invited to play something that is not
 * ready to be judged.
 *
 * Two lists decide everything, so opening a mode is a one-line change:
 *
 *   - `AVAILABLE_MODE_CARDS` is what every pilot can play.
 *   - `DEVELOPER_EMAILS` is who bypasses the lock entirely, for testing.
 *
 * Nothing here consults the network. A locked mode is locked in the menu and
 * again at the launch call, because a menu-only lock is a lock a stale
 * preference walks straight past: the remembered mode is restored from local
 * storage on the next visit, and Home's Play launches it without going through
 * Mode Select at all.
 */

import type { GameMode } from "./difficulty.ts";

/**
 * Every card on Mode Select.
 *
 * Wider than `GameMode` because two of the cards are not modes in the engine's
 * sense: Rift Survival is a difficulty, and Rift Run is a run type. The menu
 * treats all six as one list, so the lock has to as well.
 */
export type ModeCardId = "pve" | "rift-run" | "survival" | "coop" | "pvp" | "team";

export const MODE_CARD_IDS: readonly ModeCardId[] = [
  "pve",
  "rift-run",
  "survival",
  "coop",
  "pvp",
  "team",
];

/**
 * The modes open to everyone.
 *
 * PvP 1v1 and Rift Survival. Both are complete loops that end on their own
 * terms — a duel ends when a pilot is eliminated, Survival ends when the hull
 * does — which is what makes them the two that can be played and scored today.
 *
 * PvP 2v2 is deliberately not in this list even though it is also "PvP": it
 * needs four pilots in one lobby before it can deliver its premise, so it is
 * held back with the rest. Opening it is adding `"team"` here.
 */
export const AVAILABLE_MODE_CARDS: readonly ModeCardId[] = ["survival", "pvp"];

/** What a locked card says, in place of its usual description. */
export const WORK_IN_PROGRESS_NOTE = "Work in progress";

/** Shown once above the catalog, so the lock is explained rather than merely applied. */
export const WORK_IN_PROGRESS_HINT =
  "Locked modes are in development. PvP 1v1 and Rift Survival are playable now.";

/**
 * Accounts that see the whole roster.
 *
 * The project owner, so unfinished modes stay reachable for testing without a
 * build flag that could ship enabled by accident. Compared case-insensitively
 * against the signed-in account's email and nothing else — there is no way to
 * get here without owning that address at sign-up time.
 */
export const DEVELOPER_EMAILS: readonly string[] = ["pmurphinc@gmail.com"];

export function isDeveloperEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return DEVELOPER_EMAILS.includes(normalized);
}

/** Who is asking. Signed out is the same as an ordinary pilot, never more. */
export type ModeAccess = { developer: boolean };

export const PUBLIC_ACCESS: ModeAccess = Object.freeze({ developer: false });

export function isModeCardAvailable(id: ModeCardId, access: ModeAccess = PUBLIC_ACCESS): boolean {
  return access.developer || AVAILABLE_MODE_CARDS.includes(id);
}

/**
 * The card a `GameMode` belongs to.
 *
 * Survival is a difficulty flown in `pve`, so a mode alone cannot answer this:
 * the caller passes the difficulty when it has one.
 */
export function modeCardFor(mode: GameMode, difficulty?: string): ModeCardId | null {
  if (difficulty === "survival") return "survival";
  if (mode === "classic") return null;
  return mode;
}

/**
 * Is this launch allowed?
 *
 * The guard `start()` and Home's Play both run. Classic is not on the menu at
 * all, so it answers false rather than being quietly treated as available.
 */
export function canLaunch(
  mode: GameMode,
  difficulty: string | undefined,
  access: ModeAccess = PUBLIC_ACCESS,
): boolean {
  if (access.developer) return true;
  const card = modeCardFor(mode, difficulty);
  return card !== null && isModeCardAvailable(card, access);
}
