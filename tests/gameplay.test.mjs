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

  // The launch flow runs through the ship-selection scene: confirm a ship,
  // choose the difficulty in Mission Setup, then launch.
  await page.waitForSelector(".detail-select", { timeout: 15_000 });
  await page.locator(".detail-select").click();
  await page.waitForTimeout(800);
  await page.locator(".mission-setup [role=radio]", { hasText: difficulty }).first().click();
  await page.waitForTimeout(250);
  await page.locator(".setup-launch").click();
  await page.waitForTimeout(500);
  return { context, page };
}

const hullOf = (page) =>
  page.locator(".pilot-health b").innerText().then((text) => Number(text.split("/")[0]));

const badgeOf = (page) =>
  page.locator(".difficulty-badge").innerText().then((text) => text.replace(/\s+/g, " "));

/**
 * Hold a movement direction; the caller decides when to stop by polling.
 * Movement is direct now, so "up" simply drives the ship at the top wall.
 */
async function hold(page, code = "ArrowUp") {
  await page.keyboard.down(code);
}
async function release(page, code = "ArrowUp") {
  await page.keyboard.up(code);
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

    await hold(page);

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
    await hold(page);
    const worn = await waitFor(page, ({ badge }) => !/SHIELD FULL/.test(badge));
    assert.ok(worn, "ship never reached the wall");
    await release(page);

    // Fly clear. A ship left resting on the wall keeps taking collision
    // damage, which correctly keeps restarting the timer — so the test has to
    // actually leave before it can measure the recharge. With direct movement
    // that is simply the opposite direction.
    await hold(page, "ArrowDown");
    await page.waitForTimeout(2200);
    await release(page, "ArrowDown");
    // Let any residual drift settle so the ship is genuinely clear of the wall
    // before the recharge window is measured.
    await page.waitForTimeout(600);

    // Now in open space, and nowhere near the centred wormhole: the shield
    // must come back on the timer alone.
    const restored = await waitFor(page, ({ badge }) => /SHIELD FULL/.test(badge), 12000);
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
    await hold(page);
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

test("PRACTICE: repeated wall contact never reduces hull", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page } = await openGame(browser, "PRACTICE");
    const startingHull = await hullOf(page);
    await hold(page);
    await page.waitForTimeout(5000);
    await release(page);
    assert.equal(await hullOf(page), startingHull, "practice hull must remain locked");
    assert.match(await badgeOf(page), /PRACTICE/);
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

/**
 * Where the ship actually is, from the cyan hull on the canvas.
 *
 * The centroid also catches canvas HUD text, which drags it slightly, so
 * callers measure every direction against a no-input baseline rather than
 * against zero.
 */
const shipAt = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector(".canvas-wrap canvas");
    const context = canvas.getContext("2d");
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sx = 0;
    let sy = 0;
    let total = 0;
    for (let y = 0; y < canvas.height; y += 2) {
      for (let x = 0; x < canvas.width; x += 2) {
        const i = (y * canvas.width + x) * 4;
        const cyan = Math.min(data[i + 1], data[i + 2]) - data[i];
        if (cyan > 60) { sx += x * cyan; sy += y * cyan; total += cyan; }
      }
    }
    return total ? { x: sx / total / canvas.width, y: sy / total / canvas.height } : null;
  });

test("WASD and the arrows move the ship in world space", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page } = await openGame(browser, "DIFFICULT");

    // Arena camera, so screen movement maps to world movement. The settings
    // panel is collapsed on every device, so open the menu to reach it.
    // Arena camera, so screen movement maps to world movement. It lives in
    // the settings drawer now.
    await page.locator(".top-menu-toggle").click();
    await page.waitForTimeout(300);
    // Scope to the camera group: "ARENA FOCUS" in the screen-preset group
    // also contains "ARENA", and matching that would change the preset.
    await page
      .locator('.settings-drawer .segmented', { hasText: "CAMERA" })
      .locator('[role=radio]', { hasText: "ARENA" })
      .click();
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    const drive = async (codes, ms = 1100) => {
      await page.locator(".start-button").click();
      await page.waitForTimeout(500);
      const before = await shipAt(page);
      for (const code of codes) await page.keyboard.down(code);
      await page.waitForTimeout(ms);
      for (const code of codes) await page.keyboard.up(code);
      const after = await shipAt(page);
      return { dx: after.x - before.x, dy: after.y - before.y };
    };

    const baseline = await drive([]);
    const relative = async (codes) => {
      const raw = await drive(codes);
      return { dx: raw.dx - baseline.dx, dy: raw.dy - baseline.dy };
    };

    const up = await relative(["KeyW"]);
    assert.ok(up.dy < -0.02, `W should move up, got dy=${up.dy.toFixed(3)}`);

    const down = await relative(["KeyS"]);
    assert.ok(down.dy > 0.02, `S should move down, got dy=${down.dy.toFixed(3)}`);

    const left = await relative(["KeyA"]);
    assert.ok(left.dx < -0.02, `A should move left, got dx=${left.dx.toFixed(3)}`);

    const right = await relative(["KeyD"]);
    assert.ok(right.dx > 0.02, `D should move right, got dx=${right.dx.toFixed(3)}`);

    const arrow = await relative(["ArrowUp"]);
    assert.ok(arrow.dy < -0.02, "the up arrow must move up exactly like W");

    const diagonal = await relative(["KeyW", "KeyD"]);
    assert.ok(diagonal.dx > 0.02 && diagonal.dy < -0.02, "W+D should move up and right");

    // Diagonal *speed* is deliberately not compared here. This measurement is
    // a pixel centroid sampled over about a second of live play, with enemies,
    // particles and wall bounces all moving in frame, so the ratio drifts
    // enough to flake. movement.test.mjs asserts normalization exactly against
    // the maths (< 1e-9, at the first tick and at top speed); what the browser
    // uniquely proves is that the keys reach the ship at all, which is what
    // the direction assertions above cover.

    const cancelled = await relative(["KeyW", "KeyS"]);
    assert.ok(Math.abs(cancelled.dy) < 0.03, `W+S should cancel, got dy=${cancelled.dy.toFixed(3)}`);

    // Game keys must never scroll the page.
    const scrolled = await page.evaluate(() => window.scrollY || document.documentElement.scrollTop);
    assert.equal(scrolled, 0, "movement keys must not scroll the page");

    // And the on-screen reference must describe the new model.
    const controls = await page.locator(".controls").innerText();
    assert.match(controls, /MOVE UP/);
    assert.doesNotMatch(controls, /ROTATE/, "the rotate instruction must be gone");

    await context.close();
  } finally {
    await browser.close();
  }
});
