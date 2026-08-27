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
      await page.goto(service.base, { waitUntil: "networkidle" });
      // The game opens on the main menu. Change the mode to PvP, then Play —
      // which routes to the lobby rather than launching into nothing.
      await page.locator(".summary-action").first().click();
      await page.waitForTimeout(400);
      await page.locator('.mode-card', { hasText: "PvP 1v1" }).first().click();
      await page.waitForTimeout(300);
      await page.locator(".menu-footer .play-button").click();
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

    // Both arenas go live on the server's timing.
    await Promise.all([
      alpha.waitForSelector(".match-bar .rival.pvp", { timeout: 30_000 }),
      bravo.waitForSelector(".match-bar .rival.pvp", { timeout: 30_000 }),
    ]);
    const firstRoundId = Number(await alpha.locator(".match-bar").getAttribute("data-round-id"));
    const alphaOpponent = (await alpha.locator(".match-bar .rival.pvp").innerText()).split("\n")[0];
    const bravoOpponent = (await bravo.locator(".match-bar .rival.pvp").innerText()).split("\n")[0];

    assert.match(
      (await alpha.locator(".vitals").innerText()).replace(/\s+/g, " "),
      /HULL 280\/280 SHIELD 100%/,
      "tank hull and shield come from the server"
    );
    assert.match(
      (await alpha.locator(".match-bar .rival.pvp").innerText()).replace(/\s+/g, " "),
      /OPPONENT HULL 170/,
      "squid hull comes from the server"
    );

    assert.match(
      (await alpha.locator(".difficulty-badge").innerText()).replace(/\s+/g, " "),
      // Same guarantee, current vocabulary: the badge says RIFT rather than
      // WORMHOLE and reports contact as SAFE rather than OFF.
      /PVP · EASY RIFT LOCKED SHIELD FULL CONTACT SAFE/,
      "PvP runs Easy rules with a centred rift and no contact hazard"
    );

    // The PvE rival objective must not appear as a second victory condition.
    const matchBar = await alpha.locator(".match-bar").innerText();
    assert.doesNotMatch(matchBar, /RIVAL INTEGRITY/, "rival integrity has no place in PvP");
    assert.match(matchBar, /OPPONENT HULL/, "PvP is decided by opponent hull");

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
    for (const action of ["RESUME", "SETTINGS", "GAME INFO", "LEADERBOARD"]) {
      assert.ok(livePause.includes(action), `live pause is missing ${action}`);
    }

    // Resume before flying again: an open menu owns the keyboard, so movement
    // keys must not reach the ship behind it.
    await alpha.keyboard.press("KeyP");
    await alpha.waitForFunction(() => document.querySelector(".menu-screen") === null, null, { timeout: 5_000 });
    await alpha.waitForTimeout(300);

    // Collisions spend the server-held shield before any hull is lost.
    const hullOf = () => alpha.locator(".vitals span").filter({ hasText: "HULL" }).innerText();
    const startHull = await hullOf();
    await alpha.keyboard.down("ArrowUp");
    await alpha.waitForFunction(
      () => !/SHIELD\s+100%/.test(document.querySelector(".vitals")?.textContent ?? "SHIELD 100%"),
      null, { timeout: 20_000 }
    );
    const shieldLine = await alpha.locator(".vitals span").filter({ hasText: "SHIELD" }).innerText();
    const hullAfter = await hullOf();
    await alpha.keyboard.up("ArrowUp");

    assert.equal(hullAfter, startHull, "hull must be untouched while the shield absorbs");
    assert.doesNotMatch(shieldLine, /SHIELD 100%/, "the shield should have taken the hit");

    // Deterministically destroy BRAVO through the same client report and
    // authoritative server damage path used by arena impacts.
    for (let hit = 0; hit < 5; hit += 1) {
      await bravo.evaluate(() => window.dispatchEvent(new Event("breach-runner:test-pvp-damage")));
      await bravo.waitForTimeout(300);
    }

    await Promise.all([
      alpha.waitForSelector(".lobby .last-round", { timeout: 20_000 }),
      bravo.waitForSelector(".lobby .last-round", { timeout: 20_000 }),
    ]);
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
    await Promise.all([
      alpha.waitForSelector(".match-bar .rival.pvp", { timeout: 30_000 }),
      bravo.waitForSelector(".match-bar .rival.pvp", { timeout: 30_000 }),
    ]);
    const secondRoundId = Number(await alpha.locator(".match-bar").getAttribute("data-round-id"));
    assert.ok(secondRoundId > firstRoundId, "the next launch has a new round id");
    assert.equal((await alpha.locator(".match-bar .rival.pvp").innerText()).split("\n")[0], alphaOpponent);
    assert.equal((await bravo.locator(".match-bar .rival.pvp").innerText()).split("\n")[0], bravoOpponent);

    assert.deepEqual(errors, [], "no console errors in either browser");
  } finally {
    await browser.close();
    service.stop();
  }
});
