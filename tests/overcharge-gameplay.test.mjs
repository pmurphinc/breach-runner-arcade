/**
 * The overcharged specials, flown in a real browser.
 *
 * `overcharge.test.mjs` proves the numbers; this proves the button. It covers
 * the join the unit tests cannot see: that Q and the SPEC control reach the
 * same code, that a fired special actually starts its cooldown and returns to
 * ready, that the pulse cannon still works while a special is in flight, and
 * that none of it depends on the difficulty or the control scheme.
 *
 * Playwright is not a dependency of this repository, so these skip rather than
 * fail on a bare checkout. To run them:
 *
 *   npx vite --port 5199
 *   WORMHOLE_TEST_URL=http://localhost:5199/ node --test tests/overcharge-gameplay.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SHIPS, SHIP_SPECIALS } from "../app/game-data.ts";
import { overchargeFor, overchargeSource } from "../app/overcharge.ts";

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

const OVERCHARGED = SHIPS.filter((ship) => overchargeFor(ship.id));

/**
 * Launches a run in a chosen ship, difficulty and view mode.
 *
 * The view mode is written straight into the settings key the game reads on
 * boot, which is how one test can cover PC, touch and hybrid without needing
 * three different devices.
 */
async function launch(browser, { ship, difficulty = "difficult", view = "pc", cameraLock = true }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.route("https://murphtournaments.com/**", (route) =>
    route.fulfill({ json: { signedIn: false, player: null } })
  );
  await page.addInitScript(({ mode, lock }) => {
    localStorage.setItem("wormhole-arcade:settings:v1", JSON.stringify({
      version: 1,
      viewMode: mode,
      cameraLock: lock,
      sound: false,
      soundLevel: "medium",
      thumbsticks: true,
      touchControlSize: "medium",
      playerInitials: "",
    }));
  }, { mode: view, lock: cameraLock });
  await page.goto(URL_UNDER_TEST, { waitUntil: "networkidle" });
  await page.waitForSelector(".menu-screen[data-route='home']", { timeout: 15_000 });

  // Difficulty lives on the Game Modes screen, reached from the Play panel's
  // own summary row; the back control returns to home.
  await page.locator(".summary-row", { hasText: "Difficulty" }).locator(".summary-action").click();
  await page.waitForSelector(".menu-screen[data-route='modes']", { timeout: 10_000 });
  // Selected by difficulty id, not by its display label: the labels are
  // themed copy that has already been renamed once (EASY became STABLE), and
  // matching on them silently broke every browser test in the repository.
  await page.locator(`.option-choices [data-choice="${difficulty}"]`).first().click();
  await page.waitForTimeout(250);
  await page.locator(".menu-screen[data-route='modes'] .menu-back").click();
  await page.waitForSelector(".menu-screen[data-route='home']", { timeout: 10_000 });

  await page.locator(".summary-row", { hasText: "Ship" }).locator(".summary-action").click();
  await page.waitForSelector(".menu-screen[data-route='ships']", { timeout: 10_000 });
  await page.locator(".ship-card", { hasText: ship.name }).first().click();
  await page.waitForTimeout(250);
  await page.locator(".menu-footer .play-button").click();
  await page.waitForTimeout(800);
  return { context, page };
}

/** The SPECIAL readout, e.g. "SPECIAL CORE OVERCHARGE READY". */
const specialReadout = (page) =>
  page.locator(".vitals span", { hasText: "SPECIAL" }).innerText();

const noticeOf = (page) => page.locator(".coach-strip").innerText();

/**
 * Whether `pattern` shows up on the notice line within `ms`.
 *
 * The notice is one shared line, so flying over a power-up a tenth of a second
 * after pressing Q replaces "SPECIAL // ..." with "CANNON COLLECTED". Sampling
 * once is therefore a race; watching the line for a moment is not.
 */
async function noticeShows(page, pattern, ms = 2000) {
  const deadline = Date.now() + ms;
  let last = "";
  while (Date.now() < deadline) {
    last = await noticeOf(page);
    if (pattern.test(last)) return true;
    await page.waitForTimeout(60);
  }
  return last;
}

/**
 * Rift charge, as the arena's own accessible description reports it.
 *
 * Score only moves on a kill and pixel counting cannot separate a cannon round
 * from the arena's own blues, but rift charge is a discrete counter that
 * nothing except a player round reaching the rift can move. That makes it the
 * honest instrument for "is the cannon actually firing".
 */
const riftChargeOf = (page) =>
  page.locator(".canvas-wrap > canvas").getAttribute("aria-label")
    .then((label) => Number(label.match(/Rift charge (\d+) percent/)[1]));

/** Waits for the readout to come back to READY, so cooldowns are observable. */
async function waitForReady(page, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (/READY/.test(await specialReadout(page))) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

for (const ship of OVERCHARGED) {
  const spec = overchargeFor(ship.id);

  test(`${ship.name}: Q fires ${spec.name} and starts its cooldown`, { skip }, async () => {
    const browser = await playwright.chromium.launch({ executablePath: CHROME });
    try {
      // PRACTICE, because this waits out a whole cooldown parked in the open
      // and the point is the timer, not whether a 170-hull frame survives
      // being left stationary for twenty seconds.
      const { context, page } = await launch(browser, { ship, difficulty: "practice" });

      const idle = await specialReadout(page);
      assert.match(idle, new RegExp(SHIP_SPECIALS[ship.id].name), "the HUD names this ship's special");
      assert.match(idle, /READY/, "a run must start with the special available");

      await page.keyboard.press("KeyQ");

      // The notice must say SPECIAL, and must name the power-up the special is
      // an overcharged build of — that is the whole point of the pattern.
      const announced = await noticeShows(
        page,
        new RegExp(`SPECIAL // ${overchargeSource(spec).toUpperCase()}`)
      );
      assert.equal(announced, true, `notice never named the source power-up: ${announced}`);

      const busy = await specialReadout(page);
      assert.match(busy, /\d+S/, `special did not go on cooldown: ${busy}`);

      // It has to come back on its own, at roughly the advertised cooldown.
      assert.ok(
        await waitForReady(page, (spec.cooldownSeconds + 12) * 1000),
        `${spec.name} never returned to ready`
      );
      await context.close();
    } finally {
      await browser.close();
    }
  });

  test(`${ship.name}: the special cannot be spammed`, { skip }, async () => {
    const browser = await playwright.chromium.launch({ executablePath: CHROME });
    try {
      const { context, page } = await launch(browser, { ship });
      await page.keyboard.press("KeyQ");
      await page.waitForTimeout(300);
      const first = Number((await specialReadout(page)).match(/(\d+)S/)?.[1]);
      assert.ok(first > 0);

      // Hammering the key must not re-fire it or reset the timer upward.
      for (let i = 0; i < 6; i += 1) {
        await page.keyboard.press("KeyQ");
        await page.waitForTimeout(120);
      }
      const second = Number((await specialReadout(page)).match(/(\d+)S/)?.[1]);
      assert.ok(second <= first, `cooldown went backwards: ${first}S then ${second}S`);
      const refused = await noticeShows(page, /READY IN/);
      assert.equal(refused, true, `a blocked press must say why: ${refused}`);
      await context.close();
    } finally {
      await browser.close();
    }
  });

  test(`${ship.name}: the cannon keeps firing through its own special`, { skip }, async () => {
    const browser = await playwright.chromium.launch({ executablePath: CHROME });
    try {
      // PRACTICE with the camera released: hull is locked so the run cannot
      // end mid-measurement, and the rift sits still in the middle of a fully
      // visible arena, so aiming at it is just pointing at the canvas centre.
      const { context, page } = await launch(browser, {
        ship,
        difficulty: "practice",
        cameraLock: false,
      });

      // Talon's old Missile Fan spent the cannon's whole live-shot budget on
      // itself, which silently disabled the cannon for the flight of the
      // volley. Firing is measured while the special is still live, because
      // that is exactly the window the old bug covered.
      const canvas = page.locator(".canvas-wrap > canvas");
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(200);

      const before = await riftChargeOf(page);
      await page.keyboard.press("KeyQ");
      await page.waitForTimeout(120);
      await page.keyboard.down("Space");

      // Charge resets once it fills, so any movement at all counts as rounds
      // arriving; polling catches it either way.
      let moved = false;
      for (let i = 0; i < 20 && !moved; i += 1) {
        await page.waitForTimeout(150);
        moved = (await riftChargeOf(page)) !== before;
      }
      await page.keyboard.up("Space");

      assert.ok(
        moved,
        `${ship.name} put no cannon rounds into the rift while its special was live`
      );
      await context.close();
    } finally {
      await browser.close();
    }
  });
}

test("the SPEC control fires the special on touch and hybrid alike", { skip }, async () => {
  const browser = await playwright.chromium.launch({ executablePath: CHROME });
  try {
    for (const view of ["touch", "hybrid"]) {
      const { context, page } = await launch(browser, { ship: OVERCHARGED[0], view });
      const button = page.locator(".touch-special");
      await button.waitFor({ state: "visible", timeout: 10_000 });
      // The control is disabled until the run is actually live, so pressing it
      // before then would prove nothing.
      await button.locator(":scope:not([disabled])").waitFor({ timeout: 10_000 });
      assert.match(await button.innerText(), /READY/);

      // Driven through real pointer input rather than a synthetic dispatch.
      // The control captures the pointer on press, and `setPointerCapture`
      // rejects an id that no live pointer owns, so a dispatched event can
      // abort the handler before the press ever registers.
      const box = await button.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(120);
      await page.mouse.up();

      const fired = await noticeShows(page, /SPECIAL \/\//);
      assert.equal(fired, true, `${view}: SPEC did not fire the special (${fired})`);
      assert.match(await specialReadout(page), /\d+S/, `${view}: SPEC did not start the cooldown`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});

test("specials fire under every difficulty's rules", { skip }, async () => {
  const browser = await playwright.chromium.launch({ executablePath: CHROME });
  try {
    for (const difficulty of ["easy", "difficult", "hard"]) {
      for (const ship of OVERCHARGED) {
        const { context, page } = await launch(browser, { ship, difficulty });
        await page.keyboard.press("KeyQ");
        const fired = await noticeShows(page, /SPECIAL \/\//);
        assert.equal(
          fired,
          true,
          `${ship.name} could not fire its special on ${difficulty} (${fired})`
        );
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
});

test("movement, aim and the power-up launcher still work alongside the special", { skip }, async () => {
  const browser = await playwright.chromium.launch({ executablePath: CHROME });
  try {
    const { context, page } = await launch(browser, {
      ship: OVERCHARGED[0],
      difficulty: "practice",
      cameraLock: false,
    });

    // Fire the special, then prove the ordinary controls are untouched.
    await page.keyboard.press("KeyQ");
    await page.waitForTimeout(200);

    const at = () => page.evaluate(() => {
      const canvas = document.querySelector(".canvas-wrap > canvas");
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
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

    const drift = await (async () => {
      const start = await at();
      await page.waitForTimeout(900);
      const end = await at();
      return end.x - start.x;
    })();

    const before = await at();
    await page.keyboard.down("KeyD");
    await page.waitForTimeout(1200);
    await page.keyboard.up("KeyD");
    const after = await at();
    const moved = after.x - before.x - drift;
    assert.ok(moved > 0.01, `thrust must still move the ship while a special is live (${moved})`);

    // The power-up launcher is a separate control and must be unaffected.
    await page.keyboard.press("KeyE");
    await page.waitForTimeout(300);
    assert.doesNotMatch(
      await noticeOf(page),
      /READY IN/,
      "E must not be answered by the special's cooldown message"
    );
    await context.close();
  } finally {
    await browser.close();
  }
});
