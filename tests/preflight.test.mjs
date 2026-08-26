/**
 * Preflight browser tests: the main menu, the screen presets, and the pause
 * and settings screens.
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
    // Off-network noise from the production metadataBase host: the favicon
    // fetch cannot resolve or validate a certificate in a sandbox.
    const offNetwork = /ERR_TUNNEL_CONNECTION_FAILED|ERR_CERT_AUTHORITY_INVALID|ERR_NAME_NOT_RESOLVED/;
    if (m.type() === "error" && !offNetwork.test(m.text())) errors.push(m.text());
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

/** Walk from the main menu into the arena. */
async function enterArena(page) {
  await page.locator(".menu-footer .play-button").click();
  await page.waitForTimeout(900);
}

/** Open a ship from the main menu's Ships destination. */
async function openShips(page) {
  await page.locator(".menu-nav button", { hasText: "Ships" }).click();
  await page.waitForTimeout(400);
}

test("the main menu is the launch experience", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page, errors } = await openShell(browser);

    // The menu is what a player meets first — not a device question, and not
    // a ship picker with no way back to anything.
    assert.equal(
      await page.evaluate(() => document.querySelector(".menu-screen")?.dataset.route),
      "home",
      "the game must open on the main menu"
    );
    assert.match(await page.locator(".menu-header h2").innerText(), /BREACH RUNNER/i);

    // Play carries the whole launch decision inline, so a returning player
    // presses one button instead of walking three full-screen steps.
    const summary = (await page.locator(".play-summary").innerText()).replace(/\s+/g, " ");
    assert.match(summary, /Mode/i);
    assert.match(summary, /Difficulty/i);
    assert.match(summary, /Ship/i);
    assert.equal(await page.locator(".menu-nav button").count(), 4, "four secondary destinations");

    // Ships is a destination, and browsing never launches.
    await openShips(page);
    assert.equal(await page.locator(".ship-card").count(), 8, "all eight ships are offered");
    await page.locator(".ship-card").nth(3).click();
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(() => document.querySelector(".menu-screen")?.dataset.route),
      "ships",
      "choosing a ship must never launch the game"
    );
    assert.match(await page.locator(".ship-detail h3").innerText(), /\w/);
    assert.ok((await page.locator(".ship-stats li").count()) >= 6, "the focused ship shows its stats");
    assert.match(await page.locator(".ship-special").innerText(), /Special/i);

    // Back returns to the menu, and the choice is remembered on the Play panel.
    const chosen = await page.locator(".ship-detail h3").innerText();
    await page.locator(".menu-back").click();
    await page.waitForTimeout(300);
    assert.match((await page.locator(".play-summary").innerText()), new RegExp(chosen, "i"));

    await enterArena(page);
    assert.equal(await page.locator(".menu-screen").count(), 0, "launching enters the arena");
    // The global layer survives the transition.
    assert.ok(await page.locator(".system-menu").isVisible());
    assert.ok(await page.locator(".system-fullscreen").isVisible());

    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("on touch, tapping a ship inspects and only Play commits", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { context, page, errors } = await openShell(browser, { width: 390, height: 844, touch: true });

    const play = await page.locator(".menu-footer .play-button").boundingBox();
    assert.ok(play, "Play must be rendered");
    assert.ok(play.y >= 0 && play.y + play.height <= 844, "Play must stay inside the phone viewport");
    assert.ok(
      (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0,
      "no horizontal overflow on a phone"
    );

    await openShips(page);
    await page.locator(".ship-card").nth(2).tap();
    await page.waitForTimeout(250);
    assert.equal(
      await page.evaluate(() => document.querySelector(".menu-screen")?.dataset.route),
      "ships",
      "a tap must never launch the match"
    );

    const tooSmall = await page.evaluate(() =>
      [...document.querySelectorAll(".ship-card, .menu-back, .play-button, .system-button")]
        .filter((el) => el.getBoundingClientRect().height < 44).length
    );
    assert.equal(tooSmall, 0, "touch targets must be at least 44px");

    await page.locator(".menu-footer .play-button").tap();
    await page.waitForTimeout(900);
    assert.equal(await page.locator(".menu-screen").count(), 0, "Play is what commits");

    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

test("the primary action stays visible on wide and short touch screens", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  const viewports = [
    { name: "Fire tablet portrait", width: 800, height: 1280 },
    { name: "Fire tablet landscape", width: 1280, height: 800 },
    { name: "Fold unfolded", width: 900, height: 1010 },
    { name: "phone landscape", width: 844, height: 390 },
  ];
  try {
    for (const viewport of viewports) {
      const { context, page, errors } = await openShell(browser, { ...viewport, touch: true });
      const report = await page.locator(".menu-footer .play-button").evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        return {
          visible: rect.width > 0 && rect.height >= 44,
          top: rect.top,
          bottom: rect.bottom,
          viewportHeight,
          touchClass: document.querySelector(".app-shell")?.classList.contains("touch-capable"),
        };
      });
      assert.equal(report.touchClass, true, `${viewport.name} must use touch-capable layout`);
      assert.equal(report.visible, true, `${viewport.name} must render a usable Play button`);
      // Pinned in the footer rather than sitting in the scrolling region, so
      // it is on screen at every height a phone can produce.
      assert.ok(report.top >= 0 && report.bottom <= report.viewportHeight,
        `${viewport.name} Play escaped viewport: ${JSON.stringify(report)}`);

      await enterArena(page);

      if (viewport.width >= 900 && viewport.height >= 600 && viewport.width > viewport.height) {
        const arenaWidth = await page.locator(".arena-stage").evaluate(
          (arena) => arena.getBoundingClientRect().width
        );
        const minimumUsefulWidth = Math.min(viewport.height * 0.55, viewport.width * 0.5);
        assert.ok(arenaWidth >= minimumUsefulWidth,
          `${viewport.name} arena collapsed to ${arenaWidth}px; expected at least ${minimumUsefulWidth}px`);
      }

      if (viewport.name === "Fold unfolded") {
        const foldFit = await page.evaluate(() => {
          const vh = window.visualViewport?.height ?? innerHeight;
          const selectors = [".arena-stage", ".touch-flight", ".touch-action", ".touch-powerup-hud"];
          const bounds = selectors.map((selector) => {
            const el = document.querySelector(selector);
            if (!el) return { selector, missing: true };
            const rect = el.getBoundingClientRect();
            return { selector, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height, vh };
          });
          const move = document.querySelector(".touch-flight")?.getBoundingClientRect();
          const fire = document.querySelector(".touch-action")?.getBoundingClientRect();
          const queue = document.querySelector(".touch-powerup-hud")?.getBoundingClientRect();
          return {
            bounds,
            queueBetweenSticks: Boolean(move && fire && queue && queue.left >= move.right - 1 && queue.right <= fire.left + 1),
            desktopBinVisible: Boolean(document.querySelector(".power-bin")?.getBoundingClientRect().height),
          };
        });
        for (const item of foldFit.bounds) {
          assert.equal(item.missing, undefined, `${item.selector} must exist on the unfolded Fold`);
          assert.ok(item.top >= -1 && item.bottom <= item.vh + 1,
            `${item.selector} escaped the unfolded Fold viewport: ${JSON.stringify(item)}`);
        }
        assert.equal(foldFit.queueBetweenSticks, true, "touch power-up queue must fit between the sticks");
        assert.equal(foldFit.desktopBinVisible, false, "the five-slot desktop bin stays hidden in touch view");
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});

test("touch-stick height has safe symmetric computed geometry in every arrangement", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  const cases = [
    { name: "phone portrait docked", width: 390, height: 844, sticks: "docked" },
    { name: "phone landscape overlay", width: 844, height: 390, sticks: "overlay" },
    { name: "tablet landscape overlay", width: 1280, height: 800, sticks: "overlay" },
    { name: "tablet landscape gutter", width: 1280, height: 800, sticks: "gutter" },
    { name: "fold cover docked", width: 344, height: 882, sticks: "docked" },
  ];
  try {
    for (const sample of cases) {
      const { context, page, errors } = await openShell(browser, { ...sample, touch: true });
      const positions = [];
      for (const height of ["low", "middle", "high"]) {
        await page.evaluate((next) => {
          const key = "wormhole-arcade:settings:v1";
          const stored = JSON.parse(localStorage.getItem(key) || "{}");
          localStorage.setItem(key, JSON.stringify({ ...stored, version: 1, viewMode: "touch", thumbsticks: true, touchControlHeight: next }));
        }, height);
        await page.reload({ waitUntil: "networkidle" });
        await page.waitForTimeout(300);
        await enterArena(page);
        await page.locator(".app-shell").evaluate((shell, sticks) => { shell.dataset.sticks = sticks; }, sample.sticks);
        await page.waitForTimeout(100);

        const geometry = await page.evaluate(() => {
          const rect = (selector) => {
            const box = document.querySelector(selector)?.getBoundingClientRect();
            return box ? { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height } : null;
          };
          const overlaps = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
          const move = rect(".touch-flight .virtual-stick");
          const aim = rect(".touch-action .virtual-stick");
          const protectedHud = [rect(".health-rails"), rect(".touch-powerup-hud"), rect(".pup-notification"), rect(".system-controls")];
          const interactive = [
            move, aim,
            ...[...document.querySelectorAll(".touch-controls .touch-utility button")].map((item) => {
              const box = item.getBoundingClientRect();
              return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height };
            }),
          ];
          return {
            move, aim,
            inside: interactive.every((box) => box && box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1),
            clear: interactive.every((control) => protectedHud.every((hud) => !overlaps(control, hud))),
          };
        });
        assert.ok(geometry.move && geometry.aim, `${sample.name} ${height} must render both sticks`);
        assert.ok(Math.abs(geometry.move.top - geometry.aim.top) <= 1, `${sample.name} ${height} sides are not symmetric`);
        assert.equal(geometry.inside, true, `${sample.name} ${height} escaped the safe viewport`);
        assert.equal(geometry.clear, true, `${sample.name} ${height} overlapped protected HUD`);
        positions.push(geometry.move.top);
      }
      assert.ok(positions[0] > positions[1] && positions[1] > positions[2], `${sample.name} heights did not move low → middle → high: ${positions}`);

      await page.evaluate(() => {
        const key = "wormhole-arcade:settings:v1";
        const stored = JSON.parse(localStorage.getItem(key) || "{}");
        localStorage.setItem(key, JSON.stringify({ ...stored, thumbsticks: false, touchControlHeight: "high" }));
      });
      await page.reload({ waitUntil: "networkidle" });
      await enterArena(page);
      const hidden = await page.evaluate(() => ({
        stick: getComputedStyle(document.querySelector(".virtual-stick")).display,
        lift: getComputedStyle(document.querySelector(".app-shell")).getPropertyValue("--touch-lift"),
        size: getComputedStyle(document.querySelector(".app-shell")).getPropertyValue("--stick"),
      }));
      assert.equal(hidden.stick, "none", `${sample.name} hidden stick remained visible`);
      assert.match(hidden.size.trim(), /^0px$/, `${sample.name} hidden sticks retained movable size`);
      assert.equal(hidden.lift.trim(), "0px", `${sample.name} hidden sticks retained height lift`);
      assert.deepEqual(errors, []);
      await context.close();
    }
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
  [".system-menu", "global menu control"],
  [".bin-slots, .status-dock, .touch-powerup-hud", "power-up inventory"],
  [".match-bar, .difficulty-badge", "HUD"],
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

      await page.locator(".system-menu").click();
      await page.waitForTimeout(350);
      const panel = page.locator(".menu-panel");
      assert.ok(await panel.isVisible(), "the menu should open");
      assert.equal(
        await page.evaluate(() => document.querySelector(".menu-screen")?.dataset.route),
        "pause",
        "Menu during a run opens Pause"
      );

      // Pause offers the run-level actions, and each destination is reached
      // once rather than duplicated across screens.
      const text = (await panel.innerText()).replace(/\s+/g, " ");
      // Labels are uppercased by CSS, so innerText comes back uppercase.
      const upper = text.toUpperCase();
      for (const action of ["RESUME", "SETTINGS", "GAME INFO"]) {
        assert.ok(upper.includes(action), `missing pause action: ${action}`);
      }
      // Solo PvE keeps Restart, which is a client-side start().
      assert.ok(upper.includes("RESTART RUN"), "solo play can restart its own run");
      // Ship and mode changes are destructive and must say so: reaching them
      // without ending the run is what let the menu describe one ship while
      // the simulation ran another.
      assert.ok(upper.includes("END RUN & CHANGE SHIP"), "changing ship must end the run");
      assert.ok(upper.includes("END RUN & CHANGE MODE"), "changing mode must end the run");
      assert.ok(upper.includes("QUIT TO MAIN MENU"), "abandoning the run must be explicit");
      assert.equal(
        await panel.locator('[aria-label="Choose a ship"]').count(),
        0,
        "the ship grid belongs to the Ships screen, not the pause menu"
      );
      assert.doesNotMatch(text, /EVERY RIVAL HAS A WORMHOLE/, "no long paragraph in the menu");

      // The content region scrolls on its own; the page does not.
      const scroll = await page.evaluate(() => {
        const body = document.querySelector(".menu-content");
        body.scrollTop = 99999;
        return {
          scrolled: body.scrollTop,
          canScroll: body.scrollHeight > body.clientHeight,
          pageScroll: document.documentElement.scrollTop,
        };
      });
      if (scroll.canScroll) assert.ok(scroll.scrolled > 0, "the menu content must scroll");
      assert.equal(scroll.pageScroll, 0, "the page itself must not scroll");

      // Header and footer are pinned, so the primary action never leaves.
      const pinned = await page.evaluate(() => {
        const head = document.querySelector(".menu-header").getBoundingClientRect();
        const foot = document.querySelector(".menu-footer")?.getBoundingClientRect();
        return { headTop: head.top, footBottom: foot ? foot.bottom : 0, vh: innerHeight };
      });
      assert.ok(pinned.headTop >= -1, "the header stays inside the viewport");
      assert.ok(pinned.footBottom <= pinned.vh + 1, "the footer stays inside the viewport");

      assert.ok(
        await page.evaluate(() => document.querySelector(".menu-panel").contains(document.activeElement)),
        "focus should move into the menu"
      );
      // The trap spans the screen and the global system layer, and nothing else.
      for (let i = 0; i < 40; i += 1) await page.keyboard.press("Tab");
      assert.ok(
        await page.evaluate(() => {
          const a = document.activeElement;
          return Boolean(a?.closest(".menu-panel") || a?.closest(".system-controls"));
        }),
        "focus must stay inside the menu or the global controls"
      );

      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      assert.equal(await page.locator(".menu-screen").count(), 0, "Escape should close it");

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
        running: !document.querySelector(".menu-screen"),
      }));

    const before = await readRun();
    assert.equal(before.running, true, "should be in the arena");

    const openDrawer = async () => {
      await page.locator(".system-menu").click();
      await page.waitForTimeout(300);
    };
    const closeDrawer = async () => {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    };
    const pick = async (group, option) => {
      await page
        .locator(".option-row", { hasText: group })
        .locator("[role=radio]", { hasText: option })
        .click();
      await page.waitForTimeout(400);
    };
    // Matched on the exact accessible name: several switches share a word now
    // ("Sound" also appears in "Cannon Hit Sound"), and a substring match picks
    // up more than one of them.
    const toggle = async (label) => {
      await page.getByRole("switch", { name: label, exact: true }).click();
      await page.waitForTimeout(400);
    };

    // Every one of these is a pure presentation change, reached through the
    // pause menu's Settings destination — and none may disturb the run.
    await openDrawer();
    await page.locator(".pause-actions button", { hasText: "Settings" }).click();
    await page.waitForTimeout(400);
    await pick("Volume", "Low");
    await pick("Input", "Both");
    await pick("Input", "Auto");
    // The camera is a Perspective choice now; it used to be a Camera lock
    // switch. Full Arena is the one that clears cameraLock, which is what the
    // stored-settings assertion below reads back.
    await pick("Perspective", "Full Arena");
    await toggle("Sound");
    await closeDrawer();
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

    // The settings really did change, so this was not a no-op. Read them back
    // from the store rather than from a preset no UI can reach.
    const stored = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("wormhole-arcade:settings:v1") || "{}"); }
      catch { return {}; }
    });
    assert.equal(stored.soundLevel, "low", "the volume change should have been stored");
    assert.equal(stored.cameraLock, false, "the camera-lock toggle should have been stored");
    assert.equal(stored.sound, false, "the sound toggle should have been stored");

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

    // Request fullscreen the way the player would: from the global control,
    // which is reachable during a run without opening anything first.
    await page.locator(".system-fullscreen").click();
    await page.waitForTimeout(800);
    assert.match(
      await page.locator(".system-fullscreen .system-text").innerText(),
      /Exit Fullscreen/i,
      "the control must reflect the state the browser reports"
    );

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

test("touch HUD mirrors action geometry, renders the full queue, and keeps canvas behind controls", { skip, timeout: 120_000 }, async () => {
  const browser = await playwright.chromium.launch({ executablePath: CHROME });
  try {
    for (const viewport of [
      { name: "phone portrait", width: 390, height: 844 },
      { name: "Fold cover", width: 344, height: 882 },
      { name: "tablet portrait", width: 800, height: 1280 },
      { name: "touch landscape", width: 1280, height: 800 },
    ]) {
      const { context, page, errors } = await openShell(browser, { ...viewport, touch: true });
      await page.evaluate(() => {
        const key = "wormhole-arcade:settings:v1";
        const settings = JSON.parse(localStorage.getItem(key) || "{}");
        localStorage.setItem(key, JSON.stringify({ ...settings, viewMode: "touch", thumbsticks: true, mirrorTouchActions: true }));
      });
      await page.reload({ waitUntil: "networkidle" });
      await enterArena(page);

      const geometry = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
        const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
        const moveRect = rect(".move-stick");
        const fireRect = rect(".aim-stick");
        const move = center(moveRect);
        const fire = center(fireRect);
        const pairs = ["touch-pause", "touch-special", "touch-pup"].map((name) => {
          const leftRect = rect(`.touch-flight .${name}`);
          const rightRect = rect(`.touch-action .${name}`);
          const left = center(leftRect);
          const right = center(rightRect);
          const leftDelta = { x: left.x - move.x, y: left.y - move.y };
          const rightDelta = { x: right.x - fire.x, y: right.y - fire.y };
          const outside = (delta, button) => Math.hypot(delta.x, delta.y) >= moveRect.width / 2 + Math.min(button.width, button.height) / 2 - 2;
          return { name, leftDelta, rightDelta, leftOutside: outside(leftDelta, leftRect), rightOutside: outside(rightDelta, rightRect) };
        });
        const canvas = rect(".canvas-wrap canvas");
        const wrap = rect(".canvas-wrap");
        return { pairs, canvasBottom: canvas.bottom, wrapBottom: wrap.bottom };
      });
      for (const pair of geometry.pairs) {
        assert.ok(Math.abs(pair.leftDelta.x + pair.rightDelta.x) <= 2, `${viewport.name} ${pair.name} X offsets are not mirrored: ${JSON.stringify(pair)}`);
        assert.ok(Math.abs(pair.leftDelta.y - pair.rightDelta.y) <= 2, `${viewport.name} ${pair.name} Y offsets differ: ${JSON.stringify(pair)}`);
        assert.ok(pair.leftOutside && pair.rightOutside, `${viewport.name} ${pair.name} overlaps a stick: ${JSON.stringify(pair)}`);
      }
      assert.ok(Math.abs(geometry.canvasBottom - geometry.wrapBottom) <= 2, `${viewport.name} canvas stops above arena bottom: ${JSON.stringify(geometry)}`);

      for (const count of [0, 4, 10]) {
        await page.evaluate((amount) => {
          const ids = ["heatseeker", "turret", "mines", "scarab", "ghost", "artillery", "minelayer", "emp", "beam", "nuke"];
          window.dispatchEvent(new CustomEvent("breach-runner:test-stock", { detail: ids.slice(0, amount) }));
        }, count);
        await page.waitForTimeout(60);
        const state = await page.evaluate(() => ({
          count: document.querySelector(".touch-powerup-count")?.textContent,
          occupied: document.querySelectorAll(".touch-powerup-slot.occupied").length,
          next: document.querySelectorAll(".touch-powerup-slot.next").length,
          pupDisabled: [...document.querySelectorAll(".touch-pup")].map((button) => button.disabled),
          pupClasses: [...document.querySelectorAll(".touch-pup")].map((button) => button.className),
          specClasses: [...document.querySelectorAll(".touch-special")].map((button) => button.className),
        }));
        assert.equal(state.count, `${count}/10`);
        assert.equal(state.occupied, count, `${viewport.name} must show all ${count} occupied entries`);
        assert.equal(state.next, count ? 1 : 0);
        assert.deepEqual(state.pupDisabled, [count === 0, count === 0], "both PUP copies must share inventory state");
        assert.equal(new Set(state.pupClasses).size, 1, "PUP copies must use the same class styling");
        assert.equal(new Set(state.specClasses).size, 1, "SPEC copies must use the same class styling");
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
