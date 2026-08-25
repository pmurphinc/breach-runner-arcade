/**
 * Rift Survival, driven through the real game loop.
 *
 * The escalation curve itself is data and is checked in `survival.test.mjs`
 * without a browser. What cannot be checked there is the join: that the loop
 * actually runs the survival clock, that the badge reports the level, and that
 * the survived-second score is really being paid. A source-level assertion
 * that the loop *mentions* the escalation table is happy with code that throws
 * on its first tick — this is not.
 *
 * Playwright is not a dependency of this repository. When it or a dev server
 * is unavailable these skip rather than fail, so `npm test` stays meaningful
 * on a bare checkout. To run them:
 *
 *   npx vite --port 5199
 *   WORMHOLE_TEST_URL=http://localhost:5199/ node --test tests/survival-gameplay.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

const URL_UNDER_TEST = process.env.WORMHOLE_TEST_URL;
const CHROME = process.env.WORMHOLE_TEST_CHROME
  ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

async function loadPlaywright() {
  for (const specifier of [
    "playwright",
    "/opt/node22/lib/node_modules/playwright/index.mjs",
  ]) {
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

/** Launches a Rift Survival run through the menu the player actually uses. */
async function openSurvival(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    const text = message.text();
    // The stubbed score API is unreachable in a sandbox; that is not the
    // game failing.
    if (message.type() === "error" && !/Failed to load resource/.test(text)) {
      errors.push(`console: ${text}`);
    }
  });

  await page.route("https://murphtournaments.com/**", (route) =>
    route.fulfill({ json: { signedIn: false, player: null } })
  );
  await page.goto(URL_UNDER_TEST, { waitUntil: "networkidle" });
  await page.waitForSelector(".menu-screen[data-route='home']", { timeout: 15_000 });

  await page.locator(".summary-action").first().click();
  await page.waitForSelector(".menu-screen[data-route='modes']", { timeout: 10_000 });
  await page.locator(".mode-card[data-mode='survival']").click();
  await page.waitForTimeout(250);

  return { context, page, errors };
}

const badgeText = (page) => page.locator(".difficulty-badge").innerText();
const scoreText = async (page) => Number((await page.locator(".score b").innerText()).replace(/\D/g, ""));

test("Rift Survival is chosen from Challenges, not from the difficulty list", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page } = await openSurvival(browser);

    // Choosing the challenge takes the tick off the arcade modes and hides the
    // difficulty rows, which Survival sets from the clock instead.
    assert.equal(await page.locator(".mode-card[data-mode='survival']").getAttribute("aria-checked"), "true");
    assert.equal(await page.locator(".mode-card[data-mode='pve']").getAttribute("aria-checked"), "false");
    assert.equal(await page.locator(".option-choices").count(), 0);

    // Going back to an arcade mode leaves the challenge behind.
    await page.locator(".mode-card[data-mode='pve']").click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator(".mode-card[data-mode='survival']").getAttribute("aria-checked"), "false");
    assert.ok(await page.locator(".option-choices").count() > 0);

    await context.close();
  } finally {
    await browser.close();
  }
});

test("a Survival run reports its Rift Level and scores the seconds survived", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page, errors } = await openSurvival(browser);
    await page.locator(".play-button").click();
    await page.waitForTimeout(2000);

    const opening = await badgeText(page);
    assert.match(opening, /SURVIVAL/);
    // Rift Level 1 is Stable: the rift holds centre and nothing is armed yet.
    assert.match(opening, /LEVEL 1 · STABLE/);
    assert.match(opening, /RIFT LOCKED/);
    assert.match(opening, /CONTACT SAFE/);

    // Time survived is the score, so it has to be climbing on its own — this
    // is what fails if the survival tick throws instead of running.
    const first = await scoreText(page);
    await page.waitForTimeout(5000);
    const second = await scoreText(page);
    assert.ok(second > first, `score did not climb while surviving (${first} -> ${second})`);

    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("a Survival run ends on the pilot's hull and reports time, not a settlement", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page, errors } = await openSurvival(browser);
    await page.locator(".play-button").click();

    // An unflown pilot is destroyed inside a minute, which is the end
    // condition the mode has: there is nothing else to lose to.
    await page.waitForSelector(".run-summary", { timeout: 90_000 });
    const summary = await page.locator(".run-summary").innerText();

    assert.match(summary, /RIFT LEVEL \d+ REACHED/);
    assert.match(summary, /SURVIVED/);
    assert.match(summary, /\d\d:\d\d/);
    assert.match(summary, /BREACHES/);
    // The arcade settlement belongs to the scored modes; Survival never pays a
    // time penalty, so showing one would only ever read as zero.
    assert.doesNotMatch(summary, /PENALTY/);
    // And it does not advertise a board it was never sent to.
    assert.doesNotMatch(summary, /GLOBAL BOARD/);

    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});
