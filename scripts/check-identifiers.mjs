#!/usr/bin/env node
/**
 * Catch the one kind of type error that is always a crash.
 *
 * On 2026-09-10 the live game froze the moment anything died. The cause was a
 * dropped import: two pull requests added a line to the same import block, the
 * merge kept one and discarded the other, and `app/game.tsx` was left calling
 * `spatialVolume` with nothing importing it. Every call was a ReferenceError,
 * every ReferenceError happened inside the animation frame, and the frame is
 * what schedules the next one — so the game stopped dead.
 *
 * Nothing caught it. `npm run build` does not typecheck. The tests read
 * `game.tsx` as *text* and assert on source strings, so a missing import reads
 * exactly like a present one. Lint does not resolve imports. CI runs the tests
 * and the linter and nothing else.
 *
 * ## Why this is not simply `tsc --noEmit`
 *
 * The repository has a handful of long-standing type errors that nobody is
 * being asked to fix today, and `db/` and `worker/` legitimately reference
 * Cloudflare globals that are not in this tsconfig at all. Turning the whole
 * typechecker into a gate would mean going red on all of that at once, and a
 * gate that is red on arrival gets switched off within a week.
 *
 * So this checks for exactly the fatal class and nothing else: an identifier
 * or module that does not exist, in the code that ships to the browser. Those
 * are never a matter of taste. They are a crash, every time the line runs.
 */

import { execFileSync } from "node:child_process";

/** The errors that mean "this will throw the moment it executes". */
const FATAL = /error TS(2304|2307|2552|2503|2686)\b/;

/** Where a fault actually reaches a player. */
const SHIPPED = /^app[\\/]/;

/**
 * `db/` and `worker/` run on Cloudflare and reference its globals. They are not
 * part of the browser bundle and their missing-name errors are a tsconfig gap,
 * not a bug.
 */
const EXEMPT = /^(db|worker|server)[\\/]/;

function typecheckOutput() {
  try {
    execFileSync("npx", ["tsc", "--noEmit"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: true });
    return "";
  } catch (error) {
    // tsc exits non-zero when it reports anything, which is the normal path
    // here: the repository has known errors this check deliberately ignores.
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
}

const fatal = typecheckOutput()
  .split(/\r?\n/)
  .filter((line) => FATAL.test(line))
  .filter((line) => SHIPPED.test(line) && !EXEMPT.test(line));

if (fatal.length > 0) {
  console.error("Undefined identifiers or modules in shipped code.\n");
  console.error("Each of these throws the moment its line runs. In the game loop");
  console.error("that means the next frame is never scheduled and the game freezes.\n");
  for (const line of fatal) console.error(`  ${line}`);
  console.error(`\n${fatal.length} fatal reference${fatal.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("No undefined identifiers or modules in shipped code.");
