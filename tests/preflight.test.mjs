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
    assert.equal(await page.locator(".carousel-dots button").count(), 8, "carousel exposes all eight ships");
    assert.equal(await page.locator(".carousel-model canvas").count(), 1, "one large ship model stays central");
    assert.equal(await page.locator(".carousel-stat").count(), 6, "six coloured stat cards surround the model");
    assert.equal(await page.locator('[data-stat="hull"]').count(), 1);
    assert.equal(await page.locator('[data-stat="maxSpeed"]').count(), 1);
    assert.match(await page.locator(".carousel-special").innerText(), /SPECIAL/);
    assert.equal(await page.locator('[data-ship]', { hasText: /RANK/ }).count(), 0);

    // Arrows and keyboard cycle the carousel without launching.
    await page.locator('[data-ship="tank"]').click();
    await page.locator(".ship-carousel").focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);
    assert.match(await page.locator(".carousel-title h3").innerText(), /Wing/);
    await page.keyboard.press("KeyA");
    await page.waitForTimeout(150);
    assert.match(await page.locator(".carousel-title h3").innerText(), /Tank/);
    await page.locator(".carousel-arrow.next").click();
    assert.match(await page.locator(".carousel-title h3").innerText(), /Wing/);
    assert.ok(await page.locator(".ship-select").isVisible(), "browsing never launches");

    // Confirm, then Mission Setup owns mode and difficulty, then launch.
    await page.locator('[data-ship="wing"]').click();
    await page.locator(".ship-carousel").focus();
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
    const selectBounds = await page.locator(".detail-select").boundingBox();
    assert.ok(selectBounds, "SELECT SHIP must be rendered");
    assert.ok(selectBounds.y >= 0 && selectBounds.y + selectBounds.height <= 844, "SELECT SHIP must stay inside the phone/Fold viewport");
    assert.ok(
      (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0,
      "no horizontal overflow on a phone"
    );

    await page.locator('[data-ship="squid"]').tap();
    await page.waitForTimeout(250);
    assert.match(await page.locator(".carousel-title").innerText(), /Squid/);
    assert.ok(await page.locator(".ship-select").isVisible(), "a tap must never launch the match");

    const tooSmall = await page.evaluate(() =>
      [...document.querySelectorAll(".carousel-arrow, .detail-select")]
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

test("changing display settings never resets the match", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page, errors } = await openShell(browser, { width: 1440, height: 900 });
    await enterArena(page);

    // Take real damage first. A running match legitimately keeps changing
    // hull, so the only way to detect a reset is to be below full and check
    // that the value is not restored.
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(4500);
    await page.keyboard.up("ArrowUp");
    await page.keyboard.down("Space");
    await page.waitForTimeout(1500);
    await page.keyboard.up("Space");

    const readRun = () =>
      page.evaluate(() => ({
        score: document.querySelector(".score b")?.textContent?.trim() ?? "",
        hull: document.querySelector(".pilot-health b")?.textContent?.trim() ?? "",
        running: !document.querySelector(".launch-scene"),
      }));

    const before = await readRun();
    assert.equal(before.running, true, "should be in the arena");

    const openDrawer = async () => {
      await page.locator(".top-menu-toggle").click();
      await page.waitForTimeout(300);
    };
    const closeDrawer = async () => {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    };
    const pick = async (group, option) => {
      await page
        .locator(".settings-drawer .segmented", { hasText: group })
        .locator("[role=radio]", { hasText: option })
        .click();
      await page.waitForTimeout(400);
    };

    // Every one of these is a pure presentation change.
    await openDrawer();
    await pick("SCREEN FIT", "ARENA FOCUS");
    await pick("SCREEN FIT", "BALANCED");
    await pick("CAMERA", "ARENA");
    await pick("RENDER QUALITY", "PERF");
    await pick("SOUND", "OFF");
    await closeDrawer();

    const damaged = Number(before.hull.split("/")[0]);
    const maxHull = Number(before.hull.split("/")[1]);
    assert.ok(damaged < maxHull, `the ship should be damaged before the check, was ${before.hull}`);

    const after = await readRun();
    assert.equal(after.running, true, "the match must still be running");

    // A reset would restore the ship to full hull. The match continuing is
    // fine — hull may keep falling — so the test is that it never goes back up.
    const nowHull = Number(after.hull.split("/")[0]);
    assert.ok(
      nowHull <= damaged,
      `hull rose from ${damaged} to ${nowHull}: the match was reset by a display change`
    );

    // The preset really did change, so this was not a no-op.
    assert.equal(await page.evaluate(() => document.querySelector(".app-shell")?.dataset.preset), "balanced");

    assert.deepEqual(errors, [], "no console errors and no resize loop");
    await context.close();
  } finally {
    await browser.close();
  }
});

test("fullscreen keeps every essential control reachable", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ["--start-fullscreen"],
  });
  try {
    const { context, page, errors } = await openShell(browser, { width: 1920, height: 1080 });
    await enterArena(page);

    // Request fullscreen the way the player would, from the drawer.
    await page.locator(".top-menu-toggle").click();
    await page.waitForTimeout(300);
    await page.locator(".drawer-wide").click();
    await page.waitForTimeout(700);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);

    const report = await page.evaluate((selectors) => {
      const vw = window.visualViewport?.width ?? innerWidth;
      const vh = window.visualViewport?.height ?? innerHeight;
      const offscreen = [];
      for (const [selector, name] of selectors) {
        const el = [...document.querySelectorAll(selector)].find((c) => {
          const b = c.getBoundingClientRect();
          return b.width > 0 && b.height > 0;
        });
        if (!el) { offscreen.push(`${name}: no visible copy`); continue; }
        const r = el.getBoundingClientRect();
        if (r.bottom > vh + 1 || r.top < -1 || r.right > vw + 1 || r.left < -1) offscreen.push(name);
      }
      return { offscreen, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    }, ESSENTIALS);

    assert.deepEqual(report.offscreen, [], "fullscreen must not push a control off screen");
    assert.ok(report.overflowX <= 0);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("the canvas HUD is never drawn underneath the panels floating over it", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page, errors } = await openShell(browser, { width: 1440, height: 900 });
    await enterArena(page);
    // Let a mission notice appear; it is the readout that used to be hidden.
    await page.waitForTimeout(1200);

    const overlap = await page.evaluate(() => {
      const wrap = document.querySelector(".canvas-wrap");
      const canvas = wrap.querySelector("canvas");
      const badge = wrap.querySelector(".difficulty-badge");
      if (!badge) return { checked: false };

      const wrapRect = wrap.getBoundingClientRect();
      const badgeRect = badge.getBoundingClientRect();
      // Map the badge onto the canvas backing store.
      const scaleX = canvas.width / wrapRect.width;
      const scaleY = canvas.height / wrapRect.height;
      const x0 = Math.max(0, Math.round((badgeRect.left - wrapRect.left) * scaleX));
      const y0 = Math.max(0, Math.round((badgeRect.top - wrapRect.top) * scaleY));
      const w = Math.round(badgeRect.width * scaleX);
      const h = Math.round(badgeRect.height * scaleY);

      const data = canvas.getContext("2d").getImageData(x0, y0, w, h).data;
      // HUD panels are outlined in cyan (blue and green well above red) and
      // filled almost opaque. The arena behind is near-black with faint stars.
      let panelPixels = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (b > r + 40 && g > r + 25 && b > 90) panelPixels += 1;
      }
      return { checked: true, panelPixels, sampled: w * h };
    });

    assert.ok(overlap.checked, "the rules badge should be present");
    // A hidden notice panel paints thousands of these; an empty arena a handful.
    const ratio = overlap.panelPixels / overlap.sampled;
    assert.ok(
      ratio < 0.02,
      `the canvas HUD is drawn behind the rules badge (${(ratio * 100).toFixed(1)}% of that area is HUD panel)`
    );

    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});
