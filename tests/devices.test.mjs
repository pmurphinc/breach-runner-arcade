/**
 * Responsive sweep across the device matrix the brief requires.
 *
 * Checks the things that actually break on real hardware: horizontal
 * overflow, text below the 11px readability floor, touch-target size, where
 * the thumbsticks land, and whether the rules badge and mode selector stay
 * reachable.
 *
 * Playwright is not a repository dependency, so this skips when it is absent.
 * Run it with:  node --test tests/devices.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

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

const playwright = await loadPlaywright();
const skip = playwright ? false : "playwright is not installed";

const DEVICES = [
  { name: "desktop",         width: 1440, height: 900,  touch: false },
  { name: "ultrawide",       width: 2560, height: 1080, touch: false },
  { name: "fire-tablet",     width: 1280, height: 800,  touch: true },
  { name: "android-tablet",  width: 900,  height: 1280, touch: true },
  { name: "phone-portrait",  width: 390,  height: 844,  touch: true },
  { name: "phone-landscape", width: 844,  height: 390,  touch: true },
  { name: "fold-cover",      width: 344,  height: 882,  touch: true },
  { name: "fold-unfolded",   width: 900,  height: 1010, touch: true },
];

async function startService() {
  const port = 8700 + Math.floor(Math.random() * 300);
  const child = spawn("node", ["server/start.mjs"], {
    env: { ...process.env, PORT: String(port), NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const base = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return { base, stop: () => child.kill("SIGKILL") };
}

/**
 * How long a control that is supposed to be on screen is allowed to take.
 *
 * Deliberately far below Playwright's 30s default. A destination that cannot
 * be opened is a broken menu, not a slow one, and the whole point of the
 * failure this file was repaired from was eight tests each burning 30 seconds
 * waiting for a button that no longer exists.
 */
const OPEN_TIMEOUT = 5_000;

/**
 * The main menu's destinations, addressed the way a player addresses them.
 *
 * `open` is the control's accessible name, `arrived` is the surface that
 * proves the intended destination is the one that actually opened.
 *
 * This replaces `.menu-nav button:nth-child(N)`. Settings is no longer one of
 * the secondary nav tiles — it lives on the always-present system layer next
 * to Menu and Fullscreen — so the grid holds three tiles, not four. Every
 * index past Settings had shifted: the "settings" step was silently opening
 * Game Info and passing, and the "info" step was waiting on a fourth tile that
 * does not exist. Naming the control keeps the first failure honest, and
 * asserting the arrival keeps the second one loud.
 */
const DESTINATIONS = {
  ships: { open: "Ships", arrived: ".menu-screen[data-route='ships']" },
  // The board is a modal dialog rather than a menu screen, so it has no route.
  leaderboard: { open: "Leaderboard", arrived: ".codex.board[role='dialog']" },
  settings: { open: "Open settings", arrived: ".menu-screen[data-route='settings']" },
  info: { open: "Game Info", arrived: ".menu-screen[data-route='info']" },
};

/** Open one destination and wait until that destination is the one showing. */
async function openMenuDestination(page, name) {
  const { open, arrived } = DESTINATIONS[name];
  await page.getByRole("button", { name: open }).click({ timeout: OPEN_TIMEOUT });
  await page.waitForSelector(arrived, { timeout: OPEN_TIMEOUT });
}

/** Back out of a destination, whichever way that destination closes. */
async function closeMenuDestination(page) {
  await page.locator(".menu-back, .codex-close").first().click({ timeout: OPEN_TIMEOUT });
  await page.waitForSelector(".menu-screen[data-route='home']", { timeout: OPEN_TIMEOUT });
}

for (const device of DEVICES) {
  test(`${device.name} layout holds up`, { skip, timeout: 120_000 }, async () => {
    const { chromium } = playwright;
    const service = await startService();
    const browser = await chromium.launch({ executablePath: CHROME });
    try {
      const context = await browser.newContext({
        viewport: { width: device.width, height: device.height },
        hasTouch: device.touch,
        isMobile: device.touch,
      });
      const page = await context.newPage();
      // Below Playwright's 30s default on purpose: a control this suite asks
      // for is either on screen or the layout is broken.
      page.setDefaultTimeout(10_000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => {
        // Off-network noise from the production metadataBase host: the favicon
        // fetch cannot resolve, tunnel, or validate a certificate in a sandbox.
        // Same allowance preflight.test.mjs makes; it covers the transport
        // only, so a real application error still fails the test.
        const offNetwork = /ERR_TUNNEL_CONNECTION_FAILED|ERR_CERT_AUTHORITY_INVALID|ERR_NAME_NOT_RESOLVED/;
        if (m.type() === "error" && !offNetwork.test(m.text())) {
          errors.push(m.text());
        }
      });
      await page.route("https://murphtournaments.com/**", (r) =>
        r.fulfill({ json: { signedIn: false, player: null } })
      );
      await page.goto(service.base, { waitUntil: "networkidle" });

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      assert.ok(overflow <= 0, `horizontal overflow of ${overflow}px`);

      // The main menu is the first thing every player sees.
      const homeRoute = await page.evaluate(
        () => document.querySelector(".menu-screen")?.dataset.route ?? null
      );
      assert.equal(homeRoute, "home", "the game must open on the main menu");

      const badge = await page.evaluate(() => {
        const el = document.querySelector(".difficulty-badge");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { onScreen: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 };
      });
      assert.ok(badge?.onScreen, "the rules badge must stay on screen");

      const tiny = await page.evaluate(() => {
        const bad = [];
        document.querySelectorAll("body *").forEach((el) => {
          if (!el.textContent?.trim() || el.children.length) return;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") return;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          if (parseFloat(cs.fontSize) < 11) bad.push(`${el.className || el.tagName}@${cs.fontSize}`);
        });
        return bad;
      });
      assert.deepEqual(tiny, [], "text below the 11px readability floor");

      if (device.touch) {
        const small = await page.evaluate(() => {
          const out = [];
          document
            .querySelectorAll('[role="radio"], .lobby-actions button, .touch-utility button')
            .forEach((el) => {
              const r = el.getBoundingClientRect();
              if (r.height > 0 && r.height < 44) {
                out.push(`${el.textContent.trim().slice(0, 12)}@${Math.round(r.height)}px`);
              }
            });
          return out;
        });
        assert.deepEqual(small, [], "touch targets under 44px");

        // Outer thirds always. Vertical placement differs by arrangement:
        // docked and overlay put the sticks low, while landscape "gutter"
        // centres them beside the arena at natural thumb height. That gutter
        // behaviour predates this work (commit 6e98303) and is intentional.
        const sticks = await page.evaluate(() => {
          const move = document.querySelector(".move-stick")?.getBoundingClientRect();
          const aim = document.querySelector(".aim-stick")?.getBoundingClientRect();
          if (!move || !aim || move.width === 0) return null;
          const arrangement = document.querySelector(".app-shell")?.dataset.sticks ?? "docked";
          const midline = innerHeight / 2;
          return {
            arrangement,
            moveOuterLeft: move.left + move.width / 2 < innerWidth / 3,
            aimOuterRight: aim.left + aim.width / 2 > (innerWidth * 2) / 3,
            vertical:
              arrangement === "gutter"
                ? move.top + move.height / 2 >= midline - 1 && aim.top + aim.height / 2 >= midline - 1
                : move.top > innerHeight * 0.45 && aim.top > innerHeight * 0.45,
          };
        });
        if (sticks) {
          assert.ok(sticks.moveOuterLeft && sticks.aimOuterRight, `sticks not in the outer thirds: ${JSON.stringify(sticks)}`);
          assert.ok(sticks.vertical, `sticks at the wrong height for ${sticks.arrangement}`);
        }
      }

      /**
       * The mandatory requirement, checked the way it actually fails.
       *
       * Menu and Fullscreen used to have real bounding boxes on every screen
       * while another element owned every one of their pixels, so a visibility
       * check passed and the buttons were still unusable. `elementFromPoint`
       * is the check that catches that.
       */
      const systemReach = () =>
        page.evaluate(() => {
          const probe = (selector) => {
            const el = document.querySelector(selector);
            if (!el) return "absent";
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return "zero-size";
            if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) {
              return "offscreen";
            }
            if (r.height < 44) return `under 44px (${Math.round(r.height)})`;
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return top === el || el.contains(top)
              ? "ok"
              : `covered by .${String(top?.className || top?.tagName).split(" ")[0]}`;
          };
          return { menu: probe(".system-menu"), fullscreen: probe(".system-fullscreen") };
        });

      const fits = () =>
        page.evaluate(() => {
          const panel = document.querySelector(".menu-panel");
          if (!panel) return null;
          const r = panel.getBoundingClientRect();
          return {
            inside: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
            horizontal: panel.scrollWidth - panel.clientWidth,
            pageScroll: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          };
        });

      // Home plus every destination a player can reach from it.
      const screens = ["home", "ships", "leaderboard", "settings", "info"];

      for (const name of screens) {
        if (name !== "home") {
          await openMenuDestination(page, name);
          await page.waitForTimeout(200);
        }
        const reach = await systemReach();
        assert.equal(reach.menu, "ok", `${name}: Menu ${reach.menu}`);
        assert.equal(reach.fullscreen, "ok", `${name}: Fullscreen ${reach.fullscreen}`);
        const fit = await fits();
        if (fit) {
          assert.ok(fit.inside, `${name}: menu panel leaves the viewport`);
          assert.ok(fit.horizontal <= 0, `${name}: menu panel scrolls horizontally`);
          assert.ok(fit.pageScroll <= 0, `${name}: the page itself scrolls`);
        }
        if (name !== "home") {
          await closeMenuDestination(page);
          await page.waitForTimeout(200);
        }
      }

      // Modes, reached from the Play panel's own summary row.
      await page.locator(".summary-action").first().click();
      await page.waitForTimeout(200);
      let reach = await systemReach();
      assert.equal(reach.menu, "ok", `modes: Menu ${reach.menu}`);
      assert.equal(reach.fullscreen, "ok", `modes: Fullscreen ${reach.fullscreen}`);
      await page.locator(".menu-back").click();
      await page.waitForTimeout(200);

      // Gameplay: the controls stay reachable while a run is live.
      await page.locator(".menu-footer .play-button").click();
      await page.waitForTimeout(1200);
      reach = await systemReach();
      assert.equal(reach.menu, "ok", `gameplay: Menu ${reach.menu}`);
      assert.equal(reach.fullscreen, "ok", `gameplay: Fullscreen ${reach.fullscreen}`);

      // The in-run HUD, which the menu sweep above never sees. Both readability
      // regressions this file uncovered — a 7px loaded-PUP caption and health
      // rail labels on a clamp that bottomed out at 10px — live here, and they
      // are only mounted once a run is live.
      const hud = await page.evaluate((worldAspect) => {
        const box = (selector) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 ? rect : null;
        };
        const overlaps = (a, b) =>
          !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const inViewport = (rect) =>
          !rect || (rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1);

        // A box only clips when it is the one that hides its overflow, so read
        // the computed style rather than trusting scrollHeight on its own.
        const clipped = [];
        for (const selector of [
          ".touch-powerup-loaded", ".touch-powerup-loaded small", ".touch-powerup-loaded strong",
          ".touch-powerup-loaded button", ".health-rail", ".health-rail span", ".health-rail small",
        ]) {
          for (const element of document.querySelectorAll(selector)) {
            const rect = element.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            const style = getComputedStyle(element);
            // Horizontal ellipsis is the designed behaviour for the long PUP
            // names, so only a vertical cut counts as text being lost.
            if (style.overflowY === "hidden" && element.scrollHeight > element.clientHeight) {
              clipped.push(`${element.className || element.tagName}+${element.scrollHeight - element.clientHeight}px`);
            }
          }
        }

        const tiny = [];
        document.querySelectorAll(".canvas-wrap *").forEach((element) => {
          if (!element.textContent?.trim() || element.children.length) return;
          const style = getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden") return;
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          if (parseFloat(style.fontSize) < 11) tiny.push(`${element.className || element.tagName}@${style.fontSize}`);
        });

        const small = [];
        document.querySelectorAll(".touch-utility button").forEach((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.height > 0 && rect.height < 44) {
            small.push(`${element.textContent.trim().slice(0, 12)}@${Math.round(rect.height)}px`);
          }
        });

        const wrap = document.querySelector(".canvas-wrap");
        const published = wrap
          ? {
              width: parseFloat(getComputedStyle(wrap).getPropertyValue("--arena-canvas-width")) || 0,
              height: parseFloat(getComputedStyle(wrap).getPropertyValue("--arena-canvas-height")) || 0,
            }
          : { width: 0, height: 0 };

        return {
          tiny,
          clipped,
          small,
          offscreen: [".health-rails", ".touch-powerup-hud", ".touch-powerup-loaded"]
            .filter((selector) => !inViewport(box(selector))),
          inventoryOverRails: overlaps(box(".touch-powerup-hud"), box(".health-rails")),
          hudOverControls: [".system-menu", ".system-fullscreen"].filter(
            (selector) => overlaps(box(".touch-powerup-hud"), box(selector))
              || overlaps(box(".health-rails"), box(selector))
          ),
          // The arena is a fixed-aspect window on a fixed world. HUD retuning
          // is allowed to change its own height; it is not allowed to distort
          // or resize what the player is looking through.
          aspect: published.width > 0 ? published.width / published.height : worldAspect,
          overflow: {
            x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          },
        };
      }, 1504 / 940);

      assert.deepEqual(hud.tiny, [], "in-run HUD text below the 11px readability floor");
      assert.deepEqual(hud.clipped, [], "in-run HUD text cut off by its own box");
      assert.deepEqual(hud.small, [], "in-run touch targets under 44px");
      assert.deepEqual(hud.offscreen, [], "in-run HUD leaves the viewport");
      assert.ok(!hud.inventoryOverRails, "the PUP inventory overlaps the health rails");
      assert.deepEqual(hud.hudOverControls, [], "the HUD overlaps the global controls");
      assert.ok(Math.abs(hud.aspect - 1504 / 940) < 0.01, `arena aspect drifted to ${hud.aspect}`);
      assert.ok(hud.overflow.x <= 0, `in-run horizontal overflow of ${hud.overflow.x}px`);
      assert.ok(hud.overflow.y <= 0, `in-run vertical overflow of ${hud.overflow.y}px`);

      // Menu during a run opens Pause, and Pause offers Resume.
      await page.locator(".system-menu").click();
      await page.waitForTimeout(300);
      const paused = await page.evaluate(
        () => document.querySelector(".menu-screen")?.dataset.route ?? null
      );
      assert.equal(paused, "pause", "Menu during a run must open the pause screen");
      reach = await systemReach();
      assert.equal(reach.menu, "ok", `pause: Menu ${reach.menu}`);
      assert.equal(reach.fullscreen, "ok", `pause: Fullscreen ${reach.fullscreen}`);
      await page.locator(".menu-footer .play-button").click();
      await page.waitForTimeout(300);
      const resumed = await page.evaluate(() => document.querySelector(".menu-screen") === null);
      assert.ok(resumed, "Resume must return to the game");

      assert.deepEqual(errors, [], "console errors");
      await context.close();
    } finally {
      await browser.close();
      service.stop();
    }
  });
}
