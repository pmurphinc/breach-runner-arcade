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
      // The launch flow now runs through the ship-selection scene: confirm a
      // ship, then pick PVP in Mission Setup, which opens the lobby.
      await page.locator(".detail-select").click();
      await page.waitForTimeout(800);
      await page.locator('.mission-setup [role=radio]', { hasText: "PVP 1V1" }).first().click();
      await page.waitForTimeout(300);
      await page.locator(".setup-launch").click();
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
    await alpha.waitForFunction(
      () => /LAUNCHING/.test(document.querySelector(".lobby-status")?.textContent ?? ""),
      null, { timeout: 15_000 }
    );
    assert.equal(
      await alpha.locator(".lobby-ship select").isDisabled(),
      true,
      "ships must lock once the countdown starts"
    );

    // Both arenas go live on the server's timing.
    await Promise.all([
      alpha.waitForSelector(".pvp-hud", { timeout: 30_000 }),
      bravo.waitForSelector(".pvp-hud", { timeout: 30_000 }),
    ]);

    const hud = (await alpha.locator(".pvp-hud").innerText()).replace(/\s+/g, " ");
    assert.match(hud, /PVP \/\/ EASY RULES/);
    assert.match(hud, /LINK OK/);
    assert.match(hud, /280\/280/, "tank hull comes from the server");
    assert.match(hud, /200\/200/, "squid hull comes from the server");

    assert.match(
      (await alpha.locator(".difficulty-badge").innerText()).replace(/\s+/g, " "),
      /PVP \/\/ EASY RULES WORMHOLE LOCKED SHIELD FULL CONTACT OFF/,
      "PvP runs Easy rules with a centred wormhole and no contact hazard"
    );

    // The PvE rival objective must not appear as a second victory condition.
    const matchBar = await alpha.locator(".match-bar").innerText();
    assert.doesNotMatch(matchBar, /RIVAL INTEGRITY/, "rival integrity has no place in PvP");
    assert.match(matchBar, /OPPONENT HULL/, "PvP is decided by opponent hull");

    // P must not pause a live match.
    await alpha.keyboard.press("KeyP");
    await alpha.waitForTimeout(700);
    assert.match(
      await alpha.locator(".coach-strip").innerText(),
      /NO PAUSE|MATCH CONTINUES/,
      "a live match cannot be paused"
    );

    // Collisions spend the server-held shield before any hull is lost.
    const hullOf = () => alpha.locator(".pvp-side.you > span > i").innerText();
    const startHull = await hullOf();
    await alpha.keyboard.down("ArrowUp");
    await alpha.waitForFunction(
      () => !/SHIELD 100%/.test(document.querySelector(".pvp-side.you small")?.textContent ?? "SHIELD 100%"),
      null, { timeout: 20_000 }
    );
    const shieldLine = await alpha.locator(".pvp-side.you small").innerText();
    const hullAfter = await hullOf();
    await alpha.keyboard.up("ArrowUp");

    assert.equal(hullAfter, startHull, "hull must be untouched while the shield absorbs");
    assert.doesNotMatch(shieldLine, /SHIELD 100%/, "the shield should have taken the hit");

    // Shield state is shared, not local: the opponent sees it too.
    assert.match(
      await bravo.locator(".pvp-side.them small").innerText(),
      /SHIELD \d+%/,
      "each player sees the opponent's shield"
    );

    assert.deepEqual(errors, [], "no console errors in either browser");
  } finally {
    await browser.close();
    service.stop();
  }
});
