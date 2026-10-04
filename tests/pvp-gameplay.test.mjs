/**
 * Two real browsers against the real production entry point.
 *
 * `pvp-server.test.mjs` drives the state machine and `pvp-socket.test.mjs` the
 * transport; this is the only test that proves the browser client, the game
 * loop and the authoritative server work as one system — the lobby, the ready
 * check, the countdown, and the server owning hull and shield.
 *
 * Playwright is not a repository dependency, so this skips when it is
 * unavailable. To run it:  node --test tests/pvp-gameplay.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const CHROME = process.env.WORMHOLE_TEST_CHROME
  ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

async function loadPlaywright() {
  for (const specifier of ["playwright", "/opt/node22/lib/node_modules/playwright/index.mjs"]) {
    try {
      return await import(specifier);
    } catch {
      // Try the next location.
    }
  }
  return null;
}

import {
  openModeScreen,
  seedRun,
  railLabel,
  collisionShield,
  HEALTH_RAILS,
  vitals,
  hullReadout,
  rivalReadout,
  roundId,
  waitForLiveRound,
} from "./browser-launch.mjs";

const playwright = await loadPlaywright();
const skip = playwright ? false : "playwright is not installed";

/** Boots server/start.mjs exactly as Railway does, on a free port. */
async function startService() {
  const port = 8300 + Math.floor(Math.random() * 400);
  const child = spawn("node", ["server/start.mjs"], {
    env: { ...process.env, PORT: String(port), NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });

  const base = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { base, stop: () => child.kill("SIGKILL"), log: () => log };
}

test("two guests play a PvP match end to end", { skip, timeout: 240_000 }, async () => {
  const { chromium } = playwright;
  const service = await startService();
  const browser = await chromium.launch({ executablePath: CHROME });

  try {
    const errors = [];
    const openPlayer = async (label) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(`${label}: ${e}`));
      page.on("console", (m) => {
        // The only expected error is the favicon fetch against the production
        // metadataBase host, which cannot resolve off the internet.
        if (m.type() === "error" && !m.text().includes("ERR_TUNNEL_CONNECTION_FAILED")) {
          errors.push(`${label}: ${m.text()}`);
        }
      });
      await page.route("https://murphtournaments.com/**", (r) =>
        r.fulfill({ json: { signedIn: false, player: null } })
      );
      // Flies with arrow keys, so it needs the scheme that maps keys to screen
      // directions rather than to turning. See `browser-launch.mjs`.
      await seedRun(page);
      await page.goto(service.base, { waitUntil: "networkidle" });
      // The game opens on the main menu. Change the mode to PvP, then Play —
      // which routes to the lobby rather than launching into nothing.
      // The mode is the one preference that does not survive a reload, so it
      // cannot be seeded and this genuinely has to walk the menu.
      await openModeScreen(page);
      // Keyed on data-mode, not the card's class: that class has been renamed
      // twice. Selecting a mode activates it, and PvP goes straight to the
      // lobby -- there is no second Play press.
      await page.locator("[data-mode='pvp']").first().click();
      await page.waitForSelector(".lobby", { timeout: 15_000 });
      // Wait for usability, not for the word OFFLINE to vanish: "CONNECTING"
      // also lacks it while the buttons are still disabled.
      await page.waitForFunction(
        () => document.querySelector(".lobby-actions button.primary")?.disabled === false,
        null, { timeout: 20_000 }
      );
      return page;
    };

    const alpha = await openPlayer("alpha");
    const bravo = await openPlayer("bravo");

    // Guests need no account.
    const callsign = await alpha.locator(".lobby-callsign b").innerText();
    assert.match(callsign, /^GUEST-\d{4}$/, "a guest must be able to play without signing in");

    // Quick match pairs them.
    await alpha.locator(".lobby-actions button.primary").click();
    await bravo.locator(".lobby-actions button.primary").click();
    await Promise.all([
      alpha.waitForSelector(".lobby-versus", { timeout: 25_000 }),
      bravo.waitForSelector(".lobby-versus", { timeout: 25_000 }),
    ]);

    // Each player picks their own ship.
    await alpha.locator(".lobby-ship select").selectOption("tank");
    await bravo.locator(".lobby-ship select").selectOption("squid");

    // One ready player must not start the match.
    await alpha.locator(".lobby-ready").click();
    await alpha.waitForTimeout(600);
    assert.doesNotMatch(
      await alpha.locator(".lobby-status").innerText(),
      /LAUNCHING/,
      "the match must wait for both players"
    );

    await bravo.locator(".lobby-ready").click();
    await alpha.waitForSelector(".launch-countdown", { timeout: 15_000 });
    assert.equal(
      await alpha.locator(".lobby-ship select").isDisabled(),
      true,
      "ships must lock once the countdown starts"
    );

    // Both arenas go live on the server's timing, and nothing on screen says so
    // -- see `waitForLiveRound`.
    await Promise.all([waitForLiveRound(alpha), waitForLiveRound(bravo)]);
    const firstRoundId = await roundId(alpha);
    // Each pilot's view of the *other* ship, captured at full hull. The second
    // round asserts against these: the ships are locked for the session, so a
    // relaunch has to show the same two hulls restored.
    const alphaOpponent = await rivalReadout(alpha);
    const bravoOpponent = await rivalReadout(bravo);

    // Each pilot flies the hull their own lobby confirmed, at the full health
    // the server issued it -- not the ship the menu last remembered, which is
    // what the placeholder arena behind the lobby was showing a moment ago.
    assert.match(await vitals(alpha), /HULL 280\/280/, "tank hull comes from the server");
    assert.match(await vitals(bravo), /HULL 170\/170/, "squid hull comes from the server");
    assert.equal(alphaOpponent, "OPPONENT 170", "alpha is shown the squid's hull");
    assert.equal(bravoOpponent, "OPPONENT 280", "bravo is shown the tank's hull");
    // The shield the server holds, full at the start of a round.
    assert.equal(await collisionShield(alpha), "SHIELD FULL");

    assert.match(
      await railLabel(alpha),
      // Same guarantee, current vocabulary and current rules. The badge says
      // RIFT rather than WORMHOLE and reports contact as SAFE rather than OFF;
      // the rift MOVES, because `PVP_RULES` deliberately gives Easy's safety
      // rules an orbiting rift -- a locked one is a stationary objective, which
      // reduces a duel to who can hold one angle longest.
      //
      // Read from the rail's spoken label: the visible rail was cut back to the
      // score and the money, and every rule it used to print lives in the label
      // now.
      /PVP · STABLE \| RIFT MOVING \| SHIELD FULL \| CONTACT SAFE/,
      "PvP flies Stable's collision shield and no contact hazard, with an orbiting rift"
    );

    // The PvE rival objective must not appear as a second victory condition.
    const rails = await alpha.locator(HEALTH_RAILS).innerText();
    assert.doesNotMatch(rails, /RIVAL/, "rival integrity has no place in PvP");
    assert.match(rails, /OPPONENT/, "PvP is decided by opponent hull");

    // P must not pause a live match. It opens the same pause screen every mode
    // uses, which says so rather than pretending the world stopped.
    await alpha.keyboard.press("KeyP");
    await alpha.waitForTimeout(700);
    assert.equal(
      await alpha.evaluate(() => document.querySelector(".menu-screen")?.dataset.route ?? null),
      "pause",
      "P opens the pause screen"
    );
    assert.match(
      await alpha.locator(".coach-strip").innerText(),
      /NO PAUSE|MATCH CONTINUES/,
      "a live match cannot be paused"
    );

    // Restart is a client-side start(). In a live match the server owns the
    // session, so restarting locally would desync the two clients rather than
    // begin anything: the action must not be on offer at all.
    const livePause = (await alpha.locator(".menu-panel").innerText()).toUpperCase();
    assert.ok(
      !livePause.includes("RESTART RUN"),
      `a live match must not offer Restart Run: ${livePause}`
    );
    assert.equal(
      await alpha.locator('.pause-actions button:text-is("Restart Run")').count(),
      0,
      "Restart Run must not be rendered during a live match"
    );
    // Leaving is named for a match rather than a solo run, and the actions a
    // live match can legitimately offer are still present.
    assert.ok(livePause.includes("LEAVE MATCH"), "a live match leaves rather than quits a run");
    for (const action of ["RESUME", "GAME INFO", "LEADERBOARD"]) {
      assert.ok(livePause.includes(action), `live pause is missing ${action}`);
    }
    // Settings is the gear in every screen's header rather than a row in the
    // list, so it is reached by its accessible name and not by the word.
    assert.equal(
      await alpha.getByRole("button", { name: "Open settings" }).count(),
      1,
      "live pause must still reach Settings"
    );

    // Resume before flying again: an open menu owns the keyboard, so movement
    // keys must not reach the ship behind it.
    await alpha.keyboard.press("KeyP");
    await alpha.waitForFunction(() => document.querySelector(".menu-screen") === null, null, { timeout: 5_000 });
    await alpha.waitForTimeout(300);

    // Collisions spend the server-held shield before any hull is lost.
    const startHull = await hullReadout(alpha);
    await alpha.keyboard.down("ArrowUp");
    // Polled rather than waited on: the shield has no readout of its own to
    // watch, only the words in the rail's spoken label.
    let shieldLine = "SHIELD FULL";
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      shieldLine = await collisionShield(alpha);
      if (shieldLine !== "SHIELD FULL") break;
      await alpha.waitForTimeout(200);
    }
    const hullAfter = await hullReadout(alpha);
    await alpha.keyboard.up("ArrowUp");

    assert.equal(hullAfter, startHull, "hull must be untouched while the shield absorbs");
    assert.notEqual(shieldLine, "SHIELD FULL", "the shield should have taken the hit");

    // Destroy BRAVO with the arena itself: hold thrust into a wall and let the
    // ship grind against it. Every impact is reported by bravo's own client and
    // resolved by the server, which spends the shield, then the hull, then ends
    // the round -- the whole path a real match ends through.
    //
    // This used to fire a development-only `breach-runner:test-pvp-damage`
    // event instead, and that could never have worked here: the hook is guarded
    // by `process.env.NODE_ENV === "production"`, which is baked into the client
    // bundle at build time, and this is the one suite that boots the *built*
    // server. The event was dispatched into a page that had no listener for it,
    // five times, and the round simply carried on. Steady 6 hull a second
    // against a 170-hull squid, so a little over thirty seconds.
    await bravo.keyboard.down("ArrowUp");
    try {
      await Promise.all([
        alpha.waitForSelector(".lobby .last-round", { timeout: 90_000 }),
        bravo.waitForSelector(".lobby .last-round", { timeout: 90_000 }),
      ]);
    } finally {
      await bravo.keyboard.up("ArrowUp");
    }
    assert.match(await alpha.locator(".last-round strong").innerText(), /VICTORY/);
    assert.match(await bravo.locator(".last-round strong").innerText(), /DEFEAT/);
    assert.doesNotMatch(await alpha.locator(".last-round").innerText(), /TEAM SCORE/);
    assert.equal(await alpha.getByText("SHIP DESTROYED", { exact: true }).count(), 0);
    assert.equal(await alpha.getByText("RIVAL ELIMINATED", { exact: true }).count(), 0);

    for (const page of [alpha, bravo]) {
      const readiness = await page.locator(".ready-player i").allInnerTexts();
      assert.deepEqual(readiness, ["NOT READY", "NOT READY"]);
    }
    await alpha.waitForTimeout(3500);
    assert.equal(await alpha.locator(".launch-countdown").count(), 0, "no round starts automatically");

    await alpha.locator(".lobby-ready").click();
    await alpha.waitForTimeout(500);
    assert.equal(await alpha.locator(".launch-countdown").count(), 0, "one READY must wait");
    await bravo.locator(".lobby-ready").click();
    await Promise.all([
      alpha.waitForSelector(".launch-countdown", { timeout: 15_000 }),
      bravo.waitForSelector(".launch-countdown", { timeout: 15_000 }),
    ]);
    await Promise.all([waitForLiveRound(alpha), waitForLiveRound(bravo)]);
    const secondRoundId = await roundId(alpha);
    assert.ok(secondRoundId > firstRoundId, "the next launch has a new round id");
    // Same two ships, hulls restored by the server for the new round.
    assert.equal(await rivalReadout(alpha), alphaOpponent);
    assert.equal(await rivalReadout(bravo), bravoOpponent);

    assert.deepEqual(errors, [], "no console errors in either browser");
  } finally {
    await browser.close();
    service.stop();
  }
});
