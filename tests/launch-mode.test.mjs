/**
 * Every launcher must state the mode it is launching.
 *
 * `start` closes over `mode` from the render it was created in. Calling
 * `modePreference.set(...)` and then `start()` in the same callback does not
 * work: the store update has not reached the closure yet, so the run launches
 * under whatever mode was remembered from last time.
 *
 * That was latent for as long as the remembered mode was always one of pve,
 * coop or pvp. Adding Classic made it bite in production — a Rift Run started
 * after a Classic run inherited CLASSIC_RULES, which orbits the rift at depth
 * zero and, worse, sends the payload down the network transmit branch instead
 * of the PvE damage branch, so rift integrity could never fall and the run was
 * unwinnable.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

test("Rift Run launches as PvE explicitly, not via the preference it just set", () => {
  const launcher = game.slice(game.indexOf("const launchRiftRun = useCallback"), game.indexOf("}, [riftShipId, start]);"));
  assert.match(launcher, /start\(riftShipId, "pve", "easy"\)/);
  assert.doesNotMatch(launcher, /start\(riftShipId\);/, "a bare start() reads the stale closed-over mode");
});

test("Classic launches as Classic explicitly", () => {
  assert.match(game, /if \(next === "classic"\) start\(undefined, "classic"\)/);
});

test("no launcher sets the mode preference and then calls a bare start()", () => {
  // The dangerous shape is `modePreference.set(x)` followed by a start() with
  // no mode argument inside the same callback body.
  for (const match of game.matchAll(/modePreference\.set\([^)]*\);([\s\S]{0,400}?)\}, \[/g)) {
    const body = match[1];
    assert.doesNotMatch(
      body,
      /\bstart\(\s*\)|\bstart\([A-Za-z_$][\w$]*\s*\)/,
      "a launcher set the mode preference then called start() without passing the mode"
    );
  }
});
