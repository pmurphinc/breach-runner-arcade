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
import { DIFFICULTIES } from "../app/difficulty.ts";

/** The badge shows themed copy, so read the expected name rather than spell it. */
const badgeName = (id) => DIFFICULTIES[id].shortName;

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

import { HOME_SHIPS, drivePilot, launchSeededRun, pilotAt, railLabel, seedRun } from "./browser-launch.mjs";

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
  // The difficulty is seeded rather than clicked. Walking the menu to reach
  // the game meant these tests were really testing the menu, and it broke
  // them twice -- once when a difficulty label was renamed, once when a
  // refresh deleted the controls outright. See `browser-launch.mjs`.
  await seedRun(page, { difficulty });
  await page.goto(URL_UNDER_TEST, { waitUntil: "networkidle" });
  await launchSeededRun(page, { timeout: 15_000, settle: 700 });
  return { context, page };
}

const hullOf = (page) =>
  page.locator(".pilot-health b").innerText().then((text) => Number(text.split("/")[0]));

/**
 * The rules rail.
 *
 * Read from the rail's accessible label rather than its visible text. The
 * visible rail was deliberately stripped back to the score, the money and the
 * two states worth interrupting a pilot for; the mode, the difficulty, the
 * rift's state, the shield and the contact readout all moved to places they
 * mean more, and the label is where the redesign kept them in words. See
 * `railLabel` in `browser-launch.mjs`.
 */
const badgeOf = (page) => railLabel(page);

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

test("gameplay suppresses context menus without consuming mouse controls", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page } = await openGame(browser, "easy");

    const cancellation = await page.evaluate(() => {
      const dispatch = (target) => target.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
      }));
      return {
        canvasAllowed: dispatch(document.querySelector(".canvas-wrap > canvas")),
        hudAllowed: dispatch(document.querySelector(".status-dock")),
        outsideAllowed: dispatch(document.querySelector(".topbar")),
      };
    });
    assert.deepEqual(cancellation, {
      canvasAllowed: false,
      hudAllowed: false,
      outsideAllowed: true,
    });

    // A real secondary pointer event must still reach the existing PUP input.
    // The contextmenu event is a separate browser event and cannot swallow it.
    // `mines`, not `mine`. The seeding hook filters the ids it is handed
    // against the weapon catalog, so a renamed id seeds nothing at all and the
    // bin simply never fills -- which is a thirty-second timeout rather than a
    // useful failure.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("breach-runner:test-stock", {
      detail: ["mines"],
    })));
    await page.waitForFunction(() => document.querySelector(".bin-count")?.textContent?.startsWith("1/"));
    const canvas = page.locator(".canvas-wrap > canvas");
    const box = await canvas.boundingBox();
    assert.ok(box, "the arena should be visible");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: "right" });
    await page.waitForFunction(() => document.querySelector(".bin-count")?.textContent?.startsWith("0/"));
    await page.mouse.up({ button: "right" });

    // Left click retains its ordinary UI behavior outside the protected play
    // column, including while the still-mounted game is paused.
    await page.locator(".system-menu").click();
    await page.waitForSelector('.menu-screen[data-route="pause"]');
    assert.equal(await page.evaluate(() => document.querySelector(".topbar")
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }))), true);
    assert.equal(await page.evaluate(() => document.querySelector(".status-dock")
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }))), false);

    // React owns no imperative document listener: once the protected element
    // is detached, it cannot leave a stale blocker behind.
    assert.equal(await page.evaluate(() => {
      const play = document.querySelector(".play-column");
      play.remove();
      return play.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
    }), true);

    await context.close();
  } finally {
    await browser.close();
  }
});

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
    const { context, page } = await openGame(browser, "easy");
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
    const { context, page } = await openGame(browser, "easy");
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
    const { context, page } = await openGame(browser, "difficult");
    assert.match(await badgeOf(page), /NO COLLISION SHIELD/, "difficult grants no shield");

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
    const { context, page } = await openGame(browser, "practice");
    const startingHull = await hullOf(page);
    await hold(page);
    await page.waitForTimeout(5000);
    await release(page);
    assert.equal(await hullOf(page), startingHull, "practice hull must remain locked");
    assert.ok((await badgeOf(page)).includes(badgeName("practice")));
    await context.close();
  } finally {
    await browser.close();
  }
});

test("HARD: the contact hazard is armed and the wormhole moves", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page } = await openGame(browser, "hard");
    const badge = await badgeOf(page);
    assert.ok(badge.includes(badgeName("hard")));
    assert.match(badge, /RIFT MOVING/);
    assert.match(badge, /CONTACT HAZARD/);
    assert.match(badge, /NO COLLISION SHIELD/);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("WASD and the arrows move the ship in world space", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page } = await openGame(browser, "easy");

    /*
      Measured in world units from the development-only pilot probe, not from
      the pixels.

      This used to take the centroid of every cyan pixel on the arena canvas.
      Hostiles are the same cyan and vastly outweigh the ship in aggregate, so
      the same keypress measured anywhere between a clear result and a tenth of
      one depending on what happened to be drifting through frame -- and the
      threshold it was compared against was a fraction of the canvas, which
      means nothing once the canvas is letterboxed differently. Asking the game
      where the ship is answers the question the test is actually asking.

      Restart between drives so each one starts from the spawn, which keeps a
      long drive from measuring a ship already pinned against a wall.
    */
    const restart = async () => {
      await page.locator(".system-menu").click();
      await page.waitForTimeout(300);
      await page.locator(".pause-actions button", { hasText: "Restart Run" }).click();
      await page.waitForTimeout(700);
    };

    const drive = async (codes, ms = 900) => {
      await restart();
      return drivePilot(page, codes, ms);
    };

    // A ship length or so of travel: far enough that a stray nudge cannot
    // produce it, short enough that no drive reaches a wall and stops.
    const MOVED = 60;

    const idle = await drive([]);
    assert.ok(
      Math.abs(idle.dx) < MOVED && Math.abs(idle.dy) < MOVED,
      `an untouched ship should hold station, drifted (${idle.dx.toFixed(1)}, ${idle.dy.toFixed(1)})`,
    );

    const up = await drive(["KeyW"]);
    assert.ok(up.dy < -MOVED, `W should move up, got dy=${up.dy.toFixed(1)}`);

    const down = await drive(["KeyS"]);
    assert.ok(down.dy > MOVED, `S should move down, got dy=${down.dy.toFixed(1)}`);

    const left = await drive(["KeyA"]);
    assert.ok(left.dx < -MOVED, `A should move left, got dx=${left.dx.toFixed(1)}`);

    const right = await drive(["KeyD"]);
    assert.ok(right.dx > MOVED, `D should move right, got dx=${right.dx.toFixed(1)}`);

    const arrow = await drive(["ArrowUp"]);
    assert.ok(arrow.dy < -MOVED, `the up arrow must move up exactly like W, got dy=${arrow.dy.toFixed(1)}`);

    const diagonal = await drive(["KeyW", "KeyD"]);
    assert.ok(
      diagonal.dx > MOVED && diagonal.dy < -MOVED,
      `W+D should move up and right, got (${diagonal.dx.toFixed(1)}, ${diagonal.dy.toFixed(1)})`,
    );

    // Diagonal *speed* is deliberately not compared here. This measurement is
    // a pixel centroid sampled over about a second of live play, with enemies,
    // particles and wall bounces all moving in frame, so the ratio drifts
    // enough to flake. movement.test.mjs asserts normalization exactly against
    // the maths (< 1e-9, at the first tick and at top speed); what the browser
    // uniquely proves is that the keys reach the ship at all, which is what
    // the direction assertions above cover.

    const cancelled = await drive(["KeyW", "KeyS"]);
    assert.ok(Math.abs(cancelled.dy) < MOVED, `W+S should cancel, got dy=${cancelled.dy.toFixed(1)}`);

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

test("a run cannot be resumed after its ship or mode is changed", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page } = await openGame(browser, "easy");

    // A run is live and the badge reports the rules it is actually running.
    const startingBadge = await badgeOf(page);
    assert.ok(
      startingBadge.includes(`PVE · ${badgeName("easy")}`),
      `expected an easy run, got ${startingBadge}`
    );
    assert.equal(
      await page.evaluate(() => document.querySelector(".menu-screen") === null),
      true,
      "the run should be unobstructed before we open the menu"
    );

    // Menu during a run opens Pause, and Pause offers no way to change the
    // configuration without saying it ends the run.
    await page.locator(".system-menu").click();
    await page.waitForTimeout(300);
    assert.equal(
      await page.evaluate(() => document.querySelector(".menu-screen")?.dataset.route ?? null),
      "pause",
      "Menu during a run must open Pause"
    );
    const pauseText = (await page.locator(".menu-panel").innerText()).toUpperCase();
    assert.ok(pauseText.includes("END RUN & CHANGE SHIP"), "changing ship must be labelled destructive");
    assert.ok(pauseText.includes("END RUN & CHANGE MODE"), "changing mode must be labelled destructive");

    // Take the destructive action.
    await page.locator(".pause-actions button", { hasText: "End Run & Change Ship" }).click();
    await page.waitForTimeout(500);
    assert.equal(
      await page.evaluate(() => document.querySelector(".menu-screen")?.dataset.route ?? null),
      "ships",
      "ending the run should land on Ships"
    );

    // Pick a different ship from the one the run was flying.
    const chosen = await page.evaluate(() => {
      const current = document.querySelector(".ship-card.active");
      const next = [...document.querySelectorAll(".ship-card")].find((card) => card !== current);
      next.click();
      return next.querySelector("b").textContent.trim();
    });
    await page.waitForTimeout(300);
    assert.match(await page.locator(".ship-detail h3").innerText(), new RegExp(chosen, "i"));

    // The old run must be gone, not merely hidden behind the menu. Pressing
    // Menu resolves to Home rather than Pause precisely because no run exists.
    await page.locator(".system-menu").click();
    await page.waitForTimeout(400);
    assert.equal(
      await page.evaluate(() => document.querySelector(".menu-screen")?.dataset.route ?? null),
      "home",
      "with the run ended, Menu must resolve to Home rather than Pause"
    );

    // Home is back to describing a run that has not started yet. It no longer
    // echoes the hull -- the round's ship is chosen in the lobby that flies it
    // -- so what is checked is the claim the test is named for: the simulation
    // is stopped, not merely hidden behind a menu. Asked of the game rather
    // than inferred from the rules rail, which is drawn on Home too and
    // describes the run that *would* start.
    const home = (await page.locator(".launch-summary-grid").innerText()).replace(/\s+/g, " ");
    assert.match(home, /Mode/i, "Home describes the mode the next run will use");
    assert.equal(
      (await pilotAt(page))?.running,
      false,
      "the ended run must not still be simulating behind Home",
    );

    // Escape must not smuggle the player back into the dead simulation.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    assert.equal(
      await page.evaluate(() => document.querySelector(".menu-screen")?.dataset.route ?? null),
      "home",
      "there is no run to escape back into"
    );

    await context.close();
  } finally {
    await browser.close();
  }
});

test("with no run, Menu returns to Home instead of an empty cockpit", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.route("https://murphtournaments.com/**", (route) =>
      route.fulfill({ json: { signedIn: false, player: null } })
    );
    await page.goto(URL_UNDER_TEST, { waitUntil: "networkidle" });
    await page.waitForSelector(".menu-screen[data-route='home']", { timeout: 15_000 });

    const routeNow = () =>
      page.evaluate(() => document.querySelector(".menu-screen")?.dataset.route ?? null);

    // Fresh launch, no run: Menu on Home is a no-op, not an exit.
    await page.locator(".system-menu").click();
    await page.waitForTimeout(400);
    assert.equal(await routeNow(), "home", "Menu on Home with no run must stay on Home");

    // From a deeper screen it returns to the root rather than closing.
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.waitForTimeout(300);
    assert.equal(await routeNow(), "settings");
    await page.locator(".system-menu").click();
    await page.waitForTimeout(400);
    assert.equal(await routeNow(), "home", "Menu from a screen with no run must return Home");

    // Same from Ships.
    await page.locator(HOME_SHIPS).click();
    await page.waitForTimeout(300);
    assert.equal(await routeNow(), "ships");
    await page.locator(".system-menu").click();
    await page.waitForTimeout(400);
    assert.equal(await routeNow(), "home", "Menu from Ships with no run must return Home");

    await context.close();
  } finally {
    await browser.close();
  }
});
