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

import { launchSeededRun, openModeScreen, seedRun } from "./browser-launch.mjs";

const playwright = URL_UNDER_TEST ? await loadPlaywright() : null;
const skip = !URL_UNDER_TEST
  ? "set WORMHOLE_TEST_URL to a running dev server"
  : !playwright
    ? "playwright is not installed"
    : false;

/**
 * Opens the game with the score service stubbed out.
 *
 * `seed` runs before any page script, so a test can plant a device board and
 * check the screen that renders it without playing the runs first.
 */
async function openGame(browser, run) {
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
  await seedRun(page, run);
  await page.goto(URL_UNDER_TEST, { waitUntil: "networkidle" });
  await page.waitForSelector(".menu-screen[data-route='home']", { timeout: 15_000 });

  return { context, page, errors };
}

/**
 * A live Rift Survival run.
 *
 * Seeded rather than clicked: Survival is a *difficulty*, not a mode, so it
 * persists like any other ruleset and the menu never has to be walked. These
 * tests are about the arena, and every time they reached it through the menu
 * a menu change broke them.
 */
async function openSurvival(browser) {
  const opened = await openGame(browser, { difficulty: "survival" });
  await launchSeededRun(opened.page, { settle: 900 });
  return opened;
}

const badgeText = (page) => page.locator(".difficulty-badge").innerText();
const scoreText = async (page) => Number((await page.locator(".score b").innerText()).replace(/\D/g, ""));

/**
 * Survival is reached by picking it from the mode list, and picking it starts
 * the run rather than dropping the pilot on a difficulty screen.
 *
 * This used to assert that choosing Survival un-ticked the arcade modes and
 * hid the difficulty rows on the same screen. Both are gone: the mode list no
 * longer carries difficulty at all, and its cards activate on click instead of
 * behaving like radio buttons. What is still true, and still worth a browser
 * to check, is that one click on Survival puts the pilot in a Survival run.
 * That Survival stays out of the difficulty list is pinned in `survival.test.mjs`.
 */
test("picking Rift Survival from the mode list starts a Survival run", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page } = await openGame(browser);
    await openModeScreen(page);
    await page.locator("[data-mode='survival']").first().click();
    await page.waitForTimeout(900);

    assert.match(await badgeText(page), /SURVIVAL/i, "the run that started is a Survival run");

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

    // Force a deterministic hull defeat instead of relying on random Survival
    // hazards to eventually kill an idle pilot. Holding left repeatedly drives
    // the ship into the arena wall; wall impacts are real hull damage and use
    // the same defeat path this test is meant to verify.
    await page.keyboard.down("ArrowLeft");
    try {
      await page.waitForSelector(".run-summary", { timeout: 60_000 });
    } finally {
      await page.keyboard.up("ArrowLeft");
    }
    const summary = await page.locator(".run-summary").innerText();

    assert.match(summary, /RIFT LEVEL \d+ REACHED/);
    // The run is ranked on the device board, and says where it landed.
    assert.match(summary, /ON THIS DEVICE|DEVICE RANK|DEVICE BEST|OFF THE BOARD/);
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

test("the Survival board ranks by time, filters by ship, and survives a bad row", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    // A board with two ships, one unfinished row and one that is not an object
    // at all. Corrupt rows are dropped rather than taking the screen with them.
    const { context, page, errors } = await openGame(browser, () => {
      localStorage.setItem("wormhole-arcade:survival-board", JSON.stringify([
        { runId: "a", initials: "PJM", ship: "Starling", durationSeconds: 947, score: 182400, riftLevel: 16, breaches: 3, achievedAt: 10 },
        { runId: "b", initials: "ZZZ", ship: "Phantom", durationSeconds: 600, score: 90000, riftLevel: 11, breaches: 1, achievedAt: 20 },
        { runId: "c", initials: "ABC", ship: "Starling", durationSeconds: 305, score: 20000, riftLevel: 6, breaches: 0, achievedAt: 30 },
        { runId: "junk", durationSeconds: "not a number" },
        "garbage",
      ]));
    });

    await page.locator(".menu-nav button").filter({ hasText: /Leaderboard/i }).first().click();
    await page.waitForSelector(".codex.board", { timeout: 10_000 });
    await page.locator(".board-tabs button", { hasText: "SURVIVAL" }).click();
    await page.waitForTimeout(600);

    // The global board is not open yet, so the screen says so and shows the
    // device board rather than rendering an empty list.
    const all = await page.locator(".board-body").innerText();
    assert.match(all, /global Survival board is not open yet/);
    assert.match(all, /THIS DEVICE/);

    // Ranked by time, longest first — not by score, which run "a" also leads.
    const times = await page.locator(".board-list li b").allTextContents();
    assert.deepEqual(times, ["15:47", "10:00", "05:05"]);

    // Only ships with a run to show, so the filter never offers a dead end.
    assert.deepEqual(
      await page.locator(".board-filter button").allTextContents(),
      ["ALL SHIPS", "STARLING", "PHANTOM"]
    );

    await page.locator(".board-filter button", { hasText: "PHANTOM" }).click();
    await page.waitForTimeout(500);
    assert.deepEqual(await page.locator(".board-list li b").allTextContents(), ["10:00"]);
    assert.equal(await page.locator(".board-filter button[aria-checked=true]").innerText(), "PHANTOM");

    await page.locator(".board-filter button", { hasText: "STARLING" }).click();
    await page.waitForTimeout(500);
    assert.deepEqual(await page.locator(".board-list li b").allTextContents(), ["15:47", "05:05"]);

    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});
