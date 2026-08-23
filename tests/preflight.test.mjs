/**
 * Preflight browser tests: the ship-selection scene, the screen presets, and
 * the settings drawer.
 *
 * Playwright is not a repository dependency, so these skip when it or a dev
 * server is unavailable. Run them with:
 *   npx vite --port 5199
 *   WORMHOLE_TEST_URL=http://localhost:5199/ node --test tests/preflight.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

const URL_UNDER_TEST = process.env.WORMHOLE_TEST_URL;
const CHROME = process.env.WORMHOLE_TEST_CHROME
  ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

async function loadPlaywright() {
  for (const specifier of ["playwright", "/opt/node22/lib/node_modules/playwright/index.mjs"]) {
    try { return await import(specifier); } catch { /* try the next */ }
  }
  return null;
}

const playwright = URL_UNDER_TEST ? await loadPlaywright() : null;
const skip = !URL_UNDER_TEST
  ? "set WORMHOLE_TEST_URL to a running dev server"
  : !playwright ? "playwright is not installed" : false;

async function openShell(browser, { width, height, touch = false, preset } = {}) {
  const context = await browser.newContext({
    viewport: { width: width ?? 1440, height: height ?? 900 },
    hasTouch: touch,
    isMobile: touch,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    // The only expected error is the favicon fetch against the production
    // metadataBase host, which cannot resolve off the internet.
    if (m.type() === "error" && !m.text().includes("ERR_TUNNEL_CONNECTION_FAILED")) errors.push(m.text());
  });
  await page.route("https://murphtournaments.com/**", (r) =>
    r.fulfill({ json: { signedIn: false, player: null } })
  );
  if (preset) {
    await page.addInitScript((p) => {
      try { localStorage.setItem("wormhole-arcade:screen", p); } catch { /* private mode */ }
    }, preset);
  }
  await page.goto(URL_UNDER_TEST, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return { context, page, errors };
}

/** Walk from the selection scene into the arena. */
async function enterArena(page) {
  await page.locator(".detail-select").click();
  await page.waitForTimeout(800);
  await page.locator(".setup-launch").click();
  await page.waitForTimeout(700);
}

test("the ship-selection scene is the launch experience", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page, errors } = await openShell(browser);

    assert.ok(await page.locator(".ship-select").isVisible(), "selection must be the first thing shown");
    assert.match(await page.locator(".select-head h2").innerText(), /SELECT YOUR SHIP/);
    assert.match(await page.locator(".select-pilot").innerText(), /PILOT ONE/);
    assert.equal(await page.locator(".ship-tile").count(), 8, "every ship should be in the grid");
    assert.equal(await page.locator(".ship-tile canvas").count(), 8, "each tile draws a silhouette");

    const tile = (await page.locator(".ship-tile").first().innerText()).replace(/\s+/g, " ");
    assert.match(tile, /Tank/);
    assert.match(tile, /Heavy brawler/i, "tiles carry the role");
    assert.match(tile, /AVAILABLE|SELECTED/, "tiles carry an explicit state");

    // A locked ship stays inspectable but cannot be chosen.
    const locked = page.locator('.ship-tile[data-locked="true"]').first();
    assert.match(await locked.innerText(), /RANK/, "a locked tile states its rank");
    await locked.click();
    await page.waitForTimeout(250);
    const detail = (await page.locator(".ship-detail").innerText()).replace(/\s+/g, " ");
    assert.match(detail, /Strengths/i);
    assert.match(detail, /Hull strength/i, "locked ships remain fully inspectable");
    assert.match(detail, /Reaches RANK \d+ to unlock/, "never a bare LOCKED");
    assert.equal(await page.locator(".detail-select").isDisabled(), true);

    // Keyboard walks the real grid and focus stays visible.
    await page.locator('.ship-tile[data-ship="tank"]').click();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.ship-tile[aria-checked="true"]').getAttribute("data-ship"), "wing");
    await page.keyboard.press("KeyS");
    await page.waitForTimeout(200);
    assert.notEqual(await page.locator('.ship-tile[aria-checked="true"]').getAttribute("data-ship"), "wing");
    assert.ok(
      await page.evaluate(() => document.activeElement?.classList.contains("ship-tile")),
      "keyboard focus must stay on the grid"
    );

    // Comparison carries exact numbers, not just bars.
    await page.locator('.ship-tile[data-ship="squid"]').click();
    await page.waitForTimeout(200);
    const comparison = (await page.locator(".detail-stats").innerText()).replace(/\s+/g, " ");
    assert.match(comparison, /Compared with/);
    assert.match(comparison, /vs selected/);
    assert.match(comparison, /\d/);

    // Confirm, then Mission Setup owns mode and difficulty, then launch.
    await page.locator('.ship-tile[data-ship="wing"]').click();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(900);
    const setup = (await page.locator(".mission-setup").innerText()).replace(/\s+/g, " ");
    assert.match(setup, /GAME MODE/);
    assert.match(setup, /DIFFICULTY/);
    assert.match(setup, /The Wing/);

    await page.locator(".setup-launch").click();
    await page.waitForTimeout(700);
    assert.equal(await page.locator(".launch-scene").isVisible(), false, "launching enters the arena");

    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("on touch, tapping inspects and only SELECT SHIP commits", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page, errors } = await openShell(browser, { width: 390, height: 844, touch: true });

    assert.ok(await page.locator(".ship-select").isVisible());
    assert.ok(
      (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0,
      "no horizontal overflow on a phone"
    );

    await page.locator('.ship-tile[data-ship="squid"]').tap();
    await page.waitForTimeout(250);
    assert.match(await page.locator(".ship-detail").innerText(), /Squid/);
    assert.ok(await page.locator(".ship-select").isVisible(), "a tap must never launch the match");

    const tooSmall = await page.evaluate(() =>
      [...document.querySelectorAll(".ship-tile, .detail-select")]
        .filter((el) => el.getBoundingClientRect().height < 44).length
    );
    assert.equal(tooSmall, 0, "touch targets must be at least 44px");

    await page.locator(".detail-select").tap();
    await page.waitForTimeout(900);
    assert.ok(await page.locator(".mission-setup").isVisible(), "SELECT SHIP is what commits");

    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

const PRESET_VIEWPORTS = [
  { name: "2048x1152 desktop", width: 2048, height: 1152, touch: false },
  { name: "2048x1152 touch desktop", width: 2048, height: 1152, touch: true },
  { name: "1920x1080 desktop", width: 1920, height: 1080, touch: false },
  { name: "1366x768 laptop", width: 1366, height: 768, touch: false },
  { name: "ultrawide", width: 3440, height: 1440, touch: false },
  { name: "tablet landscape", width: 1280, height: 800, touch: true },
  { name: "tablet portrait", width: 800, height: 1280, touch: true },
  { name: "phone portrait", width: 390, height: 844, touch: true },
  { name: "phone landscape", width: 844, height: 390, touch: true },
  { name: "fold cover", width: 344, height: 882, touch: true },
  { name: "fold unfolded", width: 900, height: 1010, touch: true },
];

/** Controls that must never leave the visual viewport, whatever the preset. */
const ESSENTIALS = [
  [".start-button, .top-start", "primary action"],
  [".bin-slots, .status-dock", "power-up inventory"],
  [".match-bar", "HUD"],
  [".canvas-wrap", "arena"],
];

for (const viewport of PRESET_VIEWPORTS) {
  for (const preset of ["fit", "balanced", "arena"]) {
    test(`${viewport.name} keeps every control on screen in ${preset}`, { skip }, async () => {
      const { chromium } = playwright;
      const browser = await chromium.launch({ executablePath: CHROME });
      try {
        const { context, page, errors } = await openShell(browser, { ...viewport, preset });
        await enterArena(page);

        assert.equal(
          await page.evaluate(() => document.querySelector(".app-shell")?.dataset.preset),
          preset,
          "the stored preset should be applied"
        );

        const report = await page.evaluate((selectors) => {
          const vw = window.visualViewport?.width ?? innerWidth;
          const vh = window.visualViewport?.height ?? innerHeight;
          const offscreen = [];
          for (const [selector, name] of selectors) {
            // Several controls have a desktop copy and a compact copy; only
            // one is ever visible, so take the first that actually renders.
            const el = [...document.querySelectorAll(selector)].find((c) => {
              const b = c.getBoundingClientRect();
              return b.width > 0 && b.height > 0;
            });
            if (!el) { offscreen.push(`${name}: no visible copy`); continue; }
            const r = el.getBoundingClientRect();
            if (r.bottom > vh + 1 || r.top < -1 || r.right > vw + 1 || r.left < -1) {
              offscreen.push(`${name} at ${Math.round(r.left)},${Math.round(r.top)}`);
            }
          }
          return {
            offscreen,
            overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          };
        }, ESSENTIALS);

        assert.deepEqual(report.offscreen, [], "no essential control may leave the viewport");
        assert.ok(report.overflowX <= 0, `horizontal page scroll of ${report.overflowX}px`);
        assert.deepEqual(errors, []);
        await context.close();
      } finally {
        await browser.close();
      }
    });
  }
}

test("the settings drawer scrolls, traps focus, and restores it", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844, touch: true }]) {
      const { context, page, errors } = await openShell(browser, viewport);
      await enterArena(page);

      await page.locator(".top-menu-toggle").click();
      await page.waitForTimeout(350);
      const drawer = page.locator(".settings-drawer");
      assert.ok(await drawer.isVisible(), "the drawer should open");

      const text = (await drawer.innerText()).replace(/\s+/g, " ").toUpperCase();
      for (const section of ["PLAY", "DISPLAY", "CONTROLS & AUDIO", "GAME INFORMATION"]) {
        assert.ok(text.includes(section), `missing section: ${section}`);
      }
      assert.ok(text.includes("CHANGE SHIP") && text.includes("CHANGE MODE"));
      assert.ok(
        text.includes("FIT SCREEN") && text.includes("BALANCED") && text.includes("ARENA FOCUS"),
        "presets should be labelled rather than cycled"
      );
      assert.equal(
        await drawer.locator('[aria-label="Choose a ship"]').count(),
        0,
        "the ship grid belongs to the selection scene, not the menu"
      );
      assert.doesNotMatch(text, /EVERY RIVAL HAS A WORMHOLE/, "no long paragraph in the menu");

      // The body scrolls on its own; the page does not.
      const scroll = await page.evaluate(() => {
        const body = document.querySelector(".drawer-body");
        body.scrollTop = 99999;
        return {
          scrolled: body.scrollTop,
          canScroll: body.scrollHeight > body.clientHeight,
          pageScroll: document.documentElement.scrollTop,
        };
      });
      if (scroll.canScroll) assert.ok(scroll.scrolled > 0, "the drawer body must scroll");
      assert.equal(scroll.pageScroll, 0, "the page itself must not scroll");

      const sticky = await page.evaluate(() => ({
        headTop: document.querySelector(".drawer-head").getBoundingClientRect().top,
        footBottom: document.querySelector(".drawer-foot").getBoundingClientRect().bottom,
        vh: innerHeight,
      }));
      assert.ok(sticky.headTop >= -1 && sticky.headTop < 60, "the header stays put");
      assert.ok(sticky.footBottom <= sticky.vh + 1, "the footer stays put");

      assert.ok(
        await page.evaluate(() => document.querySelector(".settings-drawer").contains(document.activeElement)),
        "focus should move into the drawer"
      );
      for (let i = 0; i < 40; i += 1) await page.keyboard.press("Tab");
      assert.ok(
        await page.evaluate(() => document.querySelector(".settings-drawer").contains(document.activeElement)),
        "focus must be trapped inside the drawer"
      );

      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      assert.equal(await page.locator(".settings-drawer").isVisible(), false, "Escape should close it");
      assert.ok(
        await page.evaluate(() => document.activeElement?.classList.contains("top-menu-toggle")),
        "focus should return to whatever opened it"
      );

      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
