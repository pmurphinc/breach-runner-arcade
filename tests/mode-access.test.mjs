/**
 * Which modes are open, and what a locked card is allowed to say.
 *
 * Two rules are being pinned here, and they are different kinds of rule. The
 * first is data — the lock itself, which is pure and testable in
 * milliseconds. The second is presentation: a locked card must show its title
 * and the fact that it is being worked on, and must not show the copy that
 * sells it. That one is checked against the source, because the alternative is
 * a browser run for a string.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AVAILABLE_MODE_CARDS,
  DEVELOPER_EMAILS,
  MODE_CARD_IDS,
  PUBLIC_ACCESS,
  WORK_IN_PROGRESS_NOTE,
  canLaunch,
  isDeveloperEmail,
  isModeCardAvailable,
  modeCardFor,
} from "../app/mode-access.ts";

const menu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

const DEVELOPER = { developer: true };

test("PvP and Rift Survival are open; everything else is locked", () => {
  assert.deepEqual([...AVAILABLE_MODE_CARDS].sort(), ["pvp", "survival"]);
  for (const id of MODE_CARD_IDS) {
    const open = id === "pvp" || id === "survival";
    assert.equal(isModeCardAvailable(id, PUBLIC_ACCESS), open, `${id} should be ${open ? "open" : "locked"}`);
  }
});

test("a developer account sees the whole roster", () => {
  for (const id of MODE_CARD_IDS) {
    assert.equal(isModeCardAvailable(id, DEVELOPER), true, `${id} must be reachable for testing`);
  }
  assert.ok(DEVELOPER_EMAILS.includes("pmurphinc@gmail.com"), "the project owner holds the testing account");
  assert.equal(isDeveloperEmail("  PMurphinc@Gmail.com "), true, "matched case- and space-insensitively");
  assert.equal(isDeveloperEmail("someone@example.com"), false);
  assert.equal(isDeveloperEmail(null), false, "signed out is never a developer");
});

test("Rift Survival is a difficulty, so a mode alone cannot answer the question", () => {
  // `pve` is locked, but a Survival run flies under it. Reading the mode
  // without the difficulty would lock the one solo mode that is open.
  assert.equal(modeCardFor("pve", "survival"), "survival");
  assert.equal(modeCardFor("pve", "easy"), "pve");
  assert.equal(canLaunch("pve", "survival", PUBLIC_ACCESS), true, "Survival launches");
  assert.equal(canLaunch("pve", "easy", PUBLIC_ACCESS), false, "ordinary solo PvE does not");
  assert.equal(canLaunch("pvp", undefined, PUBLIC_ACCESS), true);
  assert.equal(canLaunch("team", undefined, PUBLIC_ACCESS), false, "2v2 waits for four pilots");
  assert.equal(canLaunch("coop", "easy", PUBLIC_ACCESS), false);
});

test("Classic is not quietly treated as available", () => {
  // It is off the menu entirely, so it has no card to be locked or unlocked.
  assert.equal(modeCardFor("classic"), null);
  assert.equal(canLaunch("classic", undefined, PUBLIC_ACCESS), false);
});

test("a locked card shows its title and that it is in development, and nothing else", () => {
  const catalog = menu.slice(menu.indexOf("export function GameTypeScreen"), menu.indexOf("export function LobbyShipPicker"));

  // The tag and the description are replaced rather than dimmed: the blurb is
  // the part that sells a mode, and selling a locked one is the bug.
  assert.match(catalog, /const copyFor = /, "one place decides what a card is allowed to say");
  assert.match(catalog, /card\.locked \? \{ tag: "", detail: WORK_IN_PROGRESS_NOTE \}/);
  // The tag is dropped rather than replaced: a locked card carries its title
  // and the one line saying why, and no third line of arcade dressing.
  assert.match(catalog, /\{copy\.tag \? <small>\{copy\.tag\}<\/small> : null\}/);
  // The title is never substituted — it is the one thing a locked card keeps.
  assert.match(catalog, /<b>\{card\.label\}<\/b>/);
  assert.match(catalog, /data-locked=\{card\.locked \? "true" : "false"\}/);
  assert.match(catalog, /aria-disabled=\{card\.locked\}/);
  // Pressing it does nothing rather than navigating somewhere unfinished.
  assert.match(catalog, /if \(cards\.find\(\(card\) => card\.id === id\)\?\.locked\) return;/);
  assert.equal(WORK_IN_PROGRESS_NOTE, "Work in progress");
});

test("the lock holds at the launch call, not only on the menu", () => {
  // The remembered mode is restored from local storage and Home's Play never
  // passes through Mode Select, so a menu-only lock is not a lock.
  assert.match(game, /if \(!canLaunch\(launchMode, launchDifficulty, access\)\) \{/);
  assert.match(game, /if \(!canLaunch\(mode, difficulty, access\)\) \{ setMenu\(resetRoute\("modes"\)\); return; \}/);
  /*
    And a preference that has become unplayable is *reported*, never rewritten.
    Rewriting it was the obvious fix and it was wrong: `useSyncExternalStore`
    serves the server snapshot during hydration, so for one commit every pilot
    looks signed out, and an effect acting on that wiped the remembered
    difficulty of everyone who was signed in — developers included — on every
    page load.
  */
  assert.match(game, /const remembered = canLaunch\(mode, difficulty, access\);/);
  assert.match(game, /modeLocked=\{!remembered\}/);
  assert.ok(!game.includes("modePreference.set(fallback)"), "the stored preference is never rewritten by the lock");
});
