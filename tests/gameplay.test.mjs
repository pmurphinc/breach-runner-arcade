/**
 * Gameplay integration tests.
 *
 * The rule-level guarantees live in `difficulty.test.mjs` and run everywhere.
 * These cover the join between those rules and the actual game loop — that
 * wall contact really is routed through the collision shield in EASY and
 * really is not in DIFFICULT — which can only be observed by driving the
 * running game.
 *
 * Playwright is not a dependency of this repository. When it or a dev server
 * is unavailable these skip rather than fail, so `npm test` stays meaningful
 * on a bare checkout. To run them:
 *
 *   npx vite --port 5199
 *   WORMHOLE_TEST_URL=http://localhost:5199/ node --test tests/gameplay.test.mjs
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

/** Opens the game with the arcade API stubbed, so no network is required. */
async function openGame(browser, difficulty) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.route("https://murphtournaments.com/**", (route) =>
    route.fulfill({ json: { signedIn: false, player: null } })
  );
  await page.goto(URL_UNDER_TEST, { waitUntil: "networkidle" });
  await page.locator(".ship-panel [role=radio]", { hasText: difficulty }).first().click();
  await page.waitForTimeout(200);
  await page.locator(".start-button").click();
  await page.waitForTimeout(400);
  return { context, page };
}

const hullOf = (page) =>
  page.locator(".pilot-health b").innerText().then((text) => Number(text.split("/")[0]));

const badgeOf = (page) =>
  page.locator(".difficulty-badge").innerText().then((text) => text.replace(/\s+/g, " "));

/** Hold thrust; the caller decides when to stop by polling. */
async function thrust(page) {
  await page.keyboard.down("ArrowUp");
}
async function release(page) {
  await page.keyboard.up("ArrowUp");
}

/**
 * Poll until `predicate` sees what it is waiting for, or give up.
 *
 * Crossing the arena to the wall takes a couple of seconds and the exact
 * moment of contact depends on machine speed, so these tests wait for the
 * state transition rather than guessing a timestamp.
 */
async function waitFor(page, predicate, timeoutMs = 9000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = { badge: await badgeOf(page), hull: await hullOf(page) };
    if (predicate(snapshot)) return snapshot;
    await page.waitForTimeout(100);
  }
  return null;
}

test("EASY: the shield takes wall damage before the hull does", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page } = await openGame(browser, "EASY");
    const startingHull = await hullOf(page);
    assert.match(await badgeOf(page), /SHIELD FULL/, "should launch with a full shield");

    await thrust(page);

    // The instant the shield shows any wear, the hull must still be intact.
    const onFirstImpact = await waitFor(page, ({ badge }) => !/SHIELD FULL/.test(badge));
    assert.ok(onFirstImpact, "ship never reached the wall");
    assert.equal(
      onFirstImpact.hull,
      startingHull,
      `hull must be untouched while the shield absorbs (badge: ${onFirstImpact.badge})`
    );

    // Keep grinding: once the shield is spent, the overflow has to reach hull.
    const onOverflow = await waitFor(page, ({ hull }) => hull < startingHull);
    assert.ok(onOverflow, "hull never took the overflow after the shield was spent");
    await release(page);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("EASY: the shield restores four seconds after the last collision", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page } = await openGame(browser, "EASY");
    await thrust(page);
    const worn = await waitFor(page, ({ badge }) => !/SHIELD FULL/.test(badge));
    assert.ok(worn, "ship never reached the wall");
    await release(page);

    // Turn around and fly clear. A ship left resting on the wall keeps taking
    // collision damage, which correctly keeps restarting the timer — so the
    // test has to actually leave before it can measure the recharge.
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(500);
    await page.keyboard.up("ArrowLeft");
    await thrust(page);
    await page.waitForTimeout(900);
    await release(page);

    // Now in open space, and nowhere near the centred wormhole: the shield
    // must come back on the timer alone.
    const restored = await waitFor(page, ({ badge }) => /SHIELD FULL/.test(badge), 8000);
    assert.ok(
      restored,
      `shield should restore four seconds after the last collision (badge: ${await badgeOf(page)})`
    );
    await context.close();
  } finally {
    await browser.close();
  }
});

test("DIFFICULT: the same wall contact reaches hull, with no shield", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page } = await openGame(browser, "DIFFICULT");
    assert.match(await badgeOf(page), /SHIELD DISABLED/, "difficult grants no shield");

    const startingHull = await hullOf(page);
    await thrust(page);
    const hurt = await waitFor(page, ({ hull }) => hull < startingHull);
    await release(page);

    assert.ok(
      hurt,
      `hull should fall on wall contact when no shield is granted (stayed at ${startingHull})`
    );
    await context.close();
  } finally {
    await browser.close();
  }
});

test("HARD: the contact hazard is armed and the wormhole moves", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page } = await openGame(browser, "HARD MODE");
    const badge = await badgeOf(page);
    assert.match(badge, /HARD MODE/);
    assert.match(badge, /WORMHOLE MOVING/);
    assert.match(badge, /CONTACT ARMED/);
    assert.match(badge, /SHIELD DISABLED/);
    await context.close();
  } finally {
    await browser.close();
  }
});
