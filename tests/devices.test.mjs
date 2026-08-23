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
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => {
        if (m.type() === "error" && !m.text().includes("ERR_TUNNEL_CONNECTION_FAILED")) {
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

      const reachable = await page.evaluate(() => {
        const visible = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        return (
          visible(document.querySelector('.ship-panel [role="radiogroup"]')) ||
          visible(document.querySelector(".top-menu-toggle"))
        );
      });
      assert.ok(reachable, "the mode selector must be reachable");

      await page.locator(".top-menu-toggle").click();
      for (const tab of ["play", "display", "controls", "info"]) {
        await page.locator(`#menu-tab-${tab}`).click();
        const fit = await page.evaluate((id) => {
          const drawer = document.querySelector(".settings-drawer");
          const body = document.querySelector(".drawer-body");
          const panel = document.querySelector(`#menu-panel-${id}`);
          const close = document.querySelector(".drawer-close");
          const back = document.querySelector(".drawer-primary");
          const inside = (el) => {
            const r = el.getBoundingClientRect();
            return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
          };
          return {
            drawer: inside(drawer), panel: inside(panel), close: inside(close), back: inside(back),
            overflow: body.scrollHeight - body.clientHeight,
            horizontal: drawer.scrollWidth - drawer.clientWidth,
          };
        }, tab);
        assert.ok(fit.drawer && fit.panel && fit.close && fit.back, `${tab} menu controls leave viewport: ${JSON.stringify(fit)}`);
        assert.ok(fit.overflow <= 0, `${tab} menu has ${fit.overflow}px scrollable overflow`);
        assert.ok(fit.horizontal <= 0, `${tab} menu has horizontal overflow`);
      }
      const controlsFit = await page.evaluate(() => [...document.querySelectorAll(".top-menu-toggle,.top-start,.top-fullscreen,.top-pause")].map((el) => {
        const r = el.getBoundingClientRect();
        return { visible: r.width > 0 && r.height >= 44, inside: r.left >= -1 && r.right <= innerWidth + 1 };
      }));
      assert.ok(controlsFit.every((control) => control.visible && control.inside), `top controls do not fit: ${JSON.stringify(controlsFit)}`);
      await page.locator(".drawer-close").click();

      assert.deepEqual(errors, [], "console errors");
      await context.close();
    } finally {
      await browser.close();
      service.stop();
    }
  });
}
