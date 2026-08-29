/**
 * Rift Run escalation, driven through the real game loop.
 *
 * The escalation curve itself is data and is checked in `rift-run.test.mjs`
 * without a browser. What cannot be checked there is the join: that `start`
 * really hands the loop the depth-zero ruleset, that the per-tick escalation
 * scheduler runs instead of throwing, and that the badge reports the depth and
 * stage the run is actually flying under. A source-level assertion that the
 * loop *mentions* the escalation table is happy with code that throws on its
 * first tick — this is not.
 *
 * Playwright is not a dependency of this repository. When it or a dev server
 * is unavailable these skip rather than fail, so `npm test` stays meaningful
 * on a bare checkout. To run them:
 *
 *   npx vite --port 5199
 *   WORMHOLE_TEST_URL=http://localhost:5199/ node --test tests/rift-run-gameplay.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

const URL_UNDER_TEST = process.env.WORMHOLE_TEST_URL;
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

const playwright = URL_UNDER_TEST ? await loadPlaywright() : null;
const skip = !URL_UNDER_TEST
  ? "set WORMHOLE_TEST_URL to a running dev server"
  : !playwright
    ? "playwright is not installed"
    : false;

async function openRiftRun(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    const text = message.text();
    // The stubbed score API is unreachable in a sandbox, and the dev server's
    // `getServerSnapshot` notice is React's own development warning; neither
    // is the game failing.
    const noise = /Failed to load resource|getServerSnapshot should be cached/;
    if (message.type() === "error" && !noise.test(text)) {
      errors.push(`console: ${text}`);
    }
  });

  await page.route("https://murphtournaments.com/**", (route) =>
    route.fulfill({ json: { signedIn: false, player: null } })
  );
  await page.goto(URL_UNDER_TEST, { waitUntil: "networkidle" });

  // Ships first, then game type, then the PvE challenge list, then Rift Run's
  // own setup screen — the route the player actually walks.
  await page.waitForSelector(".menu-screen[data-route='ships']", { timeout: 15_000 });
  await page.locator(".play-button").click();
  await page.waitForSelector(".menu-screen[data-route='modes']", { timeout: 10_000 });
  await page.locator(".mode-card[data-mode='pve']").click();
  await page.waitForSelector(".menu-screen[data-route='pve-modes']", { timeout: 10_000 });
  await page.locator(".mode-card[data-mode='rift-run']").click();
  await page.waitForSelector(".menu-screen[data-route='rift-run']", { timeout: 10_000 });

  return { context, page, errors };
}

const badgeText = (page) => page.locator(".difficulty-badge").innerText();

test("a Rift Run opens at depth zero and keeps ticking its escalation", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page, errors } = await openRiftRun(browser);
    await page.locator(".play-button").click();
    await page.waitForTimeout(2000);

    // An unbreached run is the arena Rift Run has always opened in, and the
    // badge names the stage it will be escalating away from.
    const opening = await badgeText(page);
    assert.match(opening, /RIFT RUN/);
    assert.match(opening, /DEPTH 0/);
    assert.match(opening, /STABLE/);
    // The sector readout it replaced never advanced past one, so nothing on
    // the rail should still be claiming otherwise.
    assert.doesNotMatch(opening, /SECTOR/);

    // The escalation scheduler runs on every tick of a Rift Run whether or not
    // the rift has been breached. Ten seconds of loop is enough for a throw in
    // it to surface as a page error and to stop the badge updating at all.
    await page.waitForTimeout(10_000);
    assert.match(await badgeText(page), /DEPTH 0/);

    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});
