/**
 * Phone HUD, control and end-game geometry.
 *
 * These are bounding-box tests, not screenshots: every assertion reads the
 * rectangle the browser actually laid out after the whole cascade — globals.css
 * then arena-hud.css then mirrored-touch-actions.css — because most of the
 * faults this file guards against were later rules quietly winning against
 * earlier ones.
 *
 * Playwright is not a repository dependency, so this skips when it is absent.
 * Run it with:  node --test tests/mobile-hud.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const CHROME = process.env.WORMHOLE_TEST_CHROME
  ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SETTINGS_KEY = "wormhole-arcade:settings:v1";

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

const PORTRAIT = [
  { name: "phone portrait", width: 390, height: 844 },
  { name: "narrow portrait", width: 344, height: 882 },
  { name: "tall android portrait", width: 412, height: 915 },
];

const LANDSCAPE = [
  { name: "phone landscape", width: 844, height: 390 },
  { name: "wide phone landscape", width: 932, height: 430 },
  { name: "short phone landscape", width: 740, height: 360 },
];

/**
 * Headless Chromium cannot be given a display cutout, and `env()` has no
 * scriptable override. The shell publishes every inset as a custom property
 * and every phone rule reads the property rather than `env()` directly, so
 * redefining the four properties reproduces a cutout for layout purposes.
 */
function insetScript(insets) {
  return [
    insets,
    (values) => {
      const style = document.createElement("style");
      const entries = Object.entries(values)
        .map(([side, px]) => `--safe-${side}:${px}px;`)
        .join("");
      style.textContent = `:root{${entries}}`;
      const attach = () => document.head.append(style);
      if (document.head) attach();
      else document.addEventListener("DOMContentLoaded", attach);
    },
  ];
}

let service;

async function startService() {
  if (service) return service;
  const port = 8900 + Math.floor(Math.random() * 300);
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
  service = { base, stop: () => child.kill("SIGKILL") };
  return service;
}

/** A phone context sitting in a live run, with the given player settings. */
async function openArena(browser, { width, height, settings = {}, insets } = {}) {
  const { base } = await startService();
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("https://murphtournaments.com/**", (r) =>
    r.fulfill({ json: { signedIn: false, player: null } })
  );
  await page.addInitScript(([key, value]) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  }, [SETTINGS_KEY, {
    touchControlSize: "medium",
    touchControlHeight: "middle",
    mirrorTouchActions: false,
    thumbsticks: true,
    ...settings,
  }]);
  if (insets) {
    const [values, fn] = insetScript(insets);
    await page.addInitScript(fn, values);
  }
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator(".menu-footer .play-button").click();
  await page.waitForTimeout(1200);
  return { context, page, errors };
}

/**
 * Everything a phone layout assertion needs, in one round trip.
 *
 * Utility offsets are normalised against the stick they orbit — divided by the
 * stick's own width — so the same numbers describe a small stick and a large
 * one, and portrait and landscape can be compared directly. The left cluster's
 * X is reflected, because a mirrored cluster is the same shape.
 */
const readLayout = (page) => page.evaluate(() => {
  const rect = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    if (getComputedStyle(el).visibility === "hidden") return null;
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
  };
  const cluster = (side) => {
    const root = side === "left" ? ".touch-flight" : ".touch-action";
    const stick = rect(`${root} .virtual-stick`);
    if (!stick) return null;
    const cx = stick.x + stick.w / 2;
    const cy = stick.y + stick.h / 2;
    const out = { stick };
    for (const key of ["pause", "special", "pup"]) {
      const button = rect(`${root} .touch-${key}`);
      if (!button) { out[key] = null; continue; }
      const dx = (button.x + button.w / 2 - cx) / stick.w;
      out[key] = {
        x: Number((side === "left" ? -dx : dx).toFixed(3)),
        y: Number(((button.y + button.h / 2 - cy) / stick.w).toFixed(3)),
        w: button.w,
        h: button.h,
        rect: button,
      };
    }
    return out;
  };
  const root = getComputedStyle(document.documentElement);
  const inset = (name) => Number.parseFloat(root.getPropertyValue(`--safe-${name}`)) || 0;
  const bands = {
    rules: rect(".difficulty-badge"),
    health: rect(".health-rails"),
    inventory: rect(".touch-powerup-hud"),
  };
  const present = Object.values(bands).filter(Boolean);
  return {
    viewport: { w: innerWidth, h: innerHeight },
    safe: { top: inset("top"), right: inset("right"), bottom: inset("bottom"), left: inset("left") },
    orientation: document.querySelector(".app-shell")?.dataset.orientation ?? null,
    form: document.querySelector(".app-shell")?.dataset.form ?? null,
    bands,
    hudBottom: present.length ? Math.max(...present.map((b) => b.bottom)) : 0,
    system: rect(".system-controls"),
    canvas: rect(".canvas-wrap > canvas"),
    wrap: rect(".canvas-wrap"),
    right: cluster("right"),
    left: cluster("left"),
    /** The top of everything the player's thumbs own at the bottom of a phone. */
    deckTop: Math.min(...[
      ".touch-action .virtual-stick",
      ".touch-action .touch-pause",
      ".touch-action .touch-special",
      ".touch-action .touch-pup",
      ".touch-flight .virtual-stick",
    ].map((s) => rect(s)?.y ?? Infinity)),
    inventoryRows: (() => {
      const slots = [...document.querySelectorAll(".touch-powerup-slot")];
      return new Set(slots.map((s) => Math.round(s.getBoundingClientRect().y))).size;
    })(),
    loadedCard: rect(".touch-powerup-loaded") !== null,
  };
});

const overlaps = (a, b) =>
  a && b && a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;

test("phone portrait orbits its utility buttons exactly as landscape does", { skip, timeout: 300_000 }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const size of ["small", "medium", "large"]) {
      const settings = { touchControlSize: size, mirrorTouchActions: true };
      const shots = {};
      for (const [label, width, height] of [["portrait", 390, 844], ["landscape", 844, 390]]) {
        const { context, page } = await openArena(browser, { width, height, settings });
        shots[label] = await readLayout(page);
        await context.close();
      }

      for (const key of ["pause", "special", "pup"]) {
        const portrait = shots.portrait.right[key];
        const landscape = shots.landscape.right[key];
        assert.ok(portrait && landscape, `${size}: ${key} must be laid out in both orientations`);
        // Pause and Special are pure percentages of the stick, so they match to
        // the pixel. The power-up offset carries a fixed clearance term as well
        // as the stick radius, so its normalised X drifts a little between two
        // different stick sizes; it is still the same arc, not a second layout.
        assert.ok(
          Math.abs(portrait.x - landscape.x) <= 0.08,
          `${size}: ${key} X ${portrait.x} in portrait vs ${landscape.x} in landscape`
        );
        assert.ok(
          Math.abs(portrait.y - landscape.y) <= 0.02,
          `${size}: ${key} Y ${portrait.y} in portrait vs ${landscape.y} in landscape`
        );
        // A vertical column above the stick is the failure this replaced.
        assert.ok(
          portrait.x < -0.2,
          `${size}: ${key} must orbit outside the stick, not stack over it (x ${portrait.x})`
        );
        assert.ok(portrait.h >= 44 && portrait.w >= 44, `${size}: ${key} lost its 44px target`);
      }

      // Mirroring is a real second cluster in the opposite stick's orbit.
      for (const shot of Object.values(shots)) {
        for (const key of ["pause", "special", "pup"]) {
          const right = shot.right[key];
          const left = shot.left[key];
          assert.ok(left, `${size}: mirrored ${key} must be visible when mirroring is on`);
          assert.ok(
            Math.abs(left.x - right.x) < 0.01 && Math.abs(left.y - right.y) < 0.01,
            `${size}: mirrored ${key} is not the reflection of the right cluster`
          );
        }
      }

      // Every utility button orbits its stick: its centre is outside the stick
      // disc, in every orientation and at every control size. A 44px button on
      // a small stick can still clip the disc's edge — that is the arrangement
      // landscape has always had — but a button centred on or above the stick
      // is the column this replaced.
      for (const [label, shot] of Object.entries(shots)) {
        for (const side of ["right", "left"]) {
          const radius = shot[side].stick.w / 2;
          for (const key of ["pause", "special", "pup"]) {
            const button = shot[side][key];
            const distance = Math.hypot(button.x, button.y) * shot[side].stick.w;
            assert.ok(
              distance > radius,
              `${size}: ${label} ${side} ${key} sits on its stick (${Math.round(distance)}px from a ${Math.round(radius)}px radius)`
            );
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
});

test("phone portrait fills the arena from the HUD down to the control deck", { skip, timeout: 300_000 }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const cases = [];
    for (const view of PORTRAIT) cases.push({ ...view, settings: {} });
    for (const height of ["low", "middle", "high"]) {
      cases.push({ ...PORTRAIT[0], name: `phone portrait, ${height} controls`, settings: { touchControlHeight: height } });
    }
    cases.push({
      ...PORTRAIT[0],
      name: "phone portrait with a camera cutout",
      settings: {},
      insets: { top: 47, right: 0, bottom: 34, left: 0 },
    });

    const heights = [];
    for (const { name, width, height, settings, insets } of cases) {
      const { context, page } = await openArena(browser, { width, height, settings, insets });
      const layout = await readLayout(page);
      await context.close();

      assert.equal(layout.orientation, "portrait", `${name}: expected a portrait layout`);
      assert.ok(layout.canvas, `${name}: the arena canvas must be laid out`);

      // Below the measured HUD, and clear of the top cutout.
      assert.ok(
        layout.canvas.y >= layout.hudBottom - 0.5,
        `${name}: arena starts at ${layout.canvas.y}, above the HUD bottom ${layout.hudBottom}`
      );
      assert.ok(
        layout.canvas.y >= layout.safe.top,
        `${name}: arena reaches into the top safe area`
      );
      assert.ok(
        layout.canvas.y - layout.hudBottom <= 24,
        `${name}: ${Math.round(layout.canvas.y - layout.hudBottom)}px of dead space under the HUD`
      );

      // Down to the control deck, without reaching into it.
      assert.ok(
        layout.canvas.bottom <= layout.deckTop + 0.5,
        `${name}: arena bottom ${layout.canvas.bottom} runs into the controls at ${layout.deckTop}`
      );
      const gap = layout.deckTop - layout.canvas.bottom;
      assert.ok(
        gap <= Math.max(40, layout.viewport.h * 0.06),
        `${name}: ${Math.round(gap)}px of inert space between the arena and the controls`
      );
      assert.ok(
        layout.canvas.bottom <= layout.viewport.h - layout.safe.bottom,
        `${name}: arena reaches into the bottom safe area`
      );

      // The whole point: most of the screen is arena.
      const share = layout.canvas.h / layout.viewport.h;
      assert.ok(share >= 0.45, `${name}: arena is only ${Math.round(share * 100)}% of the viewport`);
      heights.push({ name, canvas: layout.canvas.h, deckTop: layout.deckTop });
    }

    // Raising the controls has to cost the arena its height, and lowering them
    // has to give it back — a control deck the arena does not respond to is
    // how the dead strip appeared in the first place.
    const [low, middle, high] = heights.slice(PORTRAIT.length, PORTRAIT.length + 3);
    assert.ok(
      low.canvas > middle.canvas && middle.canvas > high.canvas,
      `the arena must follow the control height: ${JSON.stringify([low, middle, high])}`
    );
  } finally {
    await browser.close();
  }
});

test("phone landscape keeps its HUD shallow without dropping a readout", { skip, timeout: 300_000 }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const cases = LANDSCAPE.map((view) => ({ ...view, insets: undefined }));
    cases.push({
      ...LANDSCAPE[0],
      name: "phone landscape with a side cutout",
      insets: { top: 0, right: 44, bottom: 0, left: 44 },
    });

    for (const { name, width, height, insets } of cases) {
      const { context, page } = await openArena(browser, { width, height, insets });
      const layout = await readLayout(page);
      const badge = (await page.locator(".difficulty-badge").innerText()).replace(/\s+/g, " ");
      await context.close();

      assert.equal(layout.orientation, "landscape", `${name}: expected a landscape layout`);

      // Shallower, and bounded as a share of a viewport that has no height to
      // spare. The pre-existing layout spent 136px of 390 — over a third.
      const usable = layout.viewport.h - layout.safe.top - layout.safe.bottom;
      assert.ok(
        layout.hudBottom <= 104,
        `${name}: HUD is ${Math.round(layout.hudBottom)}px deep`
      );
      assert.ok(
        layout.hudBottom / usable <= 0.26,
        `${name}: HUD takes ${Math.round((layout.hudBottom / usable) * 100)}% of the usable height`
      );

      // Shallower by compression, not by deletion.
      assert.match(badge, /SCORE/, `${name}: score left the HUD`);
      assert.match(badge, /TIME/, `${name}: time left the HUD`);
      assert.match(badge, /PVE|CO-OP|VERSUS|SURVIVAL/i, `${name}: mode left the HUD`);
      assert.ok(layout.bands.health, `${name}: hull/rival rails left the HUD`);
      assert.ok(layout.bands.inventory, `${name}: the power-up inventory left the HUD`);
      assert.ok(layout.loadedCard, `${name}: the loaded power-up card left the HUD`);
      assert.equal(layout.inventoryRows, 1, `${name}: the inventory must stay one row`);

      // Bands may not collide with each other or with the global controls.
      const bands = Object.entries(layout.bands).filter(([, b]) => b);
      for (let i = 0; i < bands.length; i += 1) {
        for (let j = i + 1; j < bands.length; j += 1) {
          assert.ok(
            !overlaps(bands[i][1], bands[j][1]),
            `${name}: ${bands[i][0]} overlaps ${bands[j][0]}`
          );
        }
        assert.ok(
          !overlaps(bands[i][1], layout.system),
          `${name}: ${bands[i][0]} runs under the Menu/Fullscreen controls`
        );
        assert.ok(
          bands[i][1].x >= layout.safe.left - 0.5 && bands[i][1].right <= layout.viewport.w - layout.safe.right + 0.5,
          `${name}: ${bands[i][0]} reaches into a side safe area`
        );
      }
      assert.ok(layout.system.h >= 44, `${name}: the global controls lost their 44px target`);

      // Nothing from the HUD may descend into a thumb zone.
      for (const [label, band] of bands) {
        assert.ok(
          band.bottom <= layout.deckTop,
          `${name}: ${label} descends into the control deck`
        );
      }
    }
  } finally {
    await browser.close();
  }
});

/** Drive a run until it ends. Wall contact is the quickest reliable death. */
async function playUntilSummary(page) {
  await page.keyboard.down("ArrowUp");
  await page.waitForSelector(".run-summary", { timeout: 180_000 });
  await page.keyboard.up("ArrowUp");
  await page.waitForTimeout(400);
}

/**
 * Every requirement the end-game menu has to meet at one viewport.
 *
 * `.run-close` is excluded from the 44px rule on purpose: it is the optional
 * dismiss affordance, not one of the continuation actions, and it has been a
 * 30px chip on every platform since it was introduced.
 */
const checkSummary = (page, label) => page.evaluate((name) => {
  const card = document.querySelector(".run-summary");
  if (!card) return { name, failures: [`${name}: no run summary is showing`] };
  const box = card.getBoundingClientRect();
  const root = getComputedStyle(document.documentElement);
  const inset = (side) => Number.parseFloat(root.getPropertyValue(`--safe-${side}`)) || 0;
  const top = inset("top");
  const bottom = innerHeight - inset("bottom");
  const failures = [];

  if (card.scrollHeight > card.clientHeight + 1) {
    failures.push(`${name}: the summary scrolls (${card.scrollHeight} > ${card.clientHeight})`);
  }
  if (box.top < top - 0.5) failures.push(`${name}: summary top ${box.top} is above the usable viewport`);
  if (box.bottom > bottom + 0.5) failures.push(`${name}: summary bottom ${box.bottom} is below the usable viewport`);

  const actions = [...card.querySelectorAll("button, input")]
    .filter((el) => !el.classList.contains("run-close"));
  if (!actions.length) failures.push(`${name}: the summary offers no actions at all`);
  for (const el of actions) {
    const r = el.getBoundingClientRect();
    const text = (el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 20);
    if (r.top < -0.5 || r.bottom > innerHeight + 0.5 || r.left < -0.5 || r.right > innerWidth + 0.5) {
      failures.push(`${name}: "${text}" is outside the viewport`);
    }
    if (r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5) {
      failures.push(`${name}: "${text}" is outside the summary card`);
    }
    if (r.height < 44) failures.push(`${name}: "${text}" is only ${Math.round(r.height)}px tall`);
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit !== el && !el.contains(hit)) {
      failures.push(`${name}: "${text}" is covered by .${String(hit?.className || hit?.tagName).split(" ")[0]}`);
    }
  }
  return { name, failures, overflow: card.scrollHeight - card.clientHeight };
}, label);

/** Sweep every supported phone size without replaying the run. */
async function sweep(page, stage) {
  const failures = [];
  for (const view of [...PORTRAIT, ...LANDSCAPE]) {
    await page.setViewportSize({ width: view.width, height: view.height });
    await page.waitForTimeout(600);
    const result = await checkSummary(page, `${stage} @ ${view.name} ${view.width}x${view.height}`);
    failures.push(...result.failures);
  }
  return failures;
}

test("a finished arcade run offers every action without scrolling", { skip, timeout: 600_000 }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { base } = await startService();
    const context = await browser.newContext({
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.route("https://murphtournaments.com/**", (r) =>
      r.fulfill({ json: { signedIn: false, player: null } })
    );
    await page.goto(base, { waitUntil: "networkidle" });
    await page.locator(".summary-action").first().click();
    await page.waitForTimeout(400);
    await page.locator('.option-choices [data-choice="difficult"]').first().click();
    await page.waitForTimeout(250);
    await page.locator(".menu-footer .play-button").click();
    await page.waitForTimeout(800);
    await playUntilSummary(page);

    assert.equal(await page.locator(".initials-entry").count(), 0, "a defeat does not ask for initials");
    assert.deepEqual(await sweep(page, "defeat"), []);

    /*
     * A PvE victory and a failed board submission render the same card with
     * more lines in `.run-save`: a submission status, and on failure a warning
     * plus TRY BOARD AGAIN. Adding exactly those nodes measures the tallest
     * card the component can produce without waiting out a second full run.
     */
    await page.evaluate(() => {
      const save = document.querySelector(".run-save");
      const status = document.createElement("p");
      status.className = "run-status ok";
      status.textContent = "GLOBAL BOARD UPDATED · #4";
      const warn = document.createElement("p");
      warn.className = "run-status warn";
      warn.textContent = "COULD NOT REACH THE GLOBAL BOARD. CHECK YOUR CONNECTION.";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "run-action";
      retry.textContent = "TRY BOARD AGAIN";
      save.append(status, warn, retry);
      document.querySelector(".run-outcome").textContent = "RIVAL ELIMINATED";
      document.querySelector(".death-info").classList.add("victory");
    });
    await page.waitForTimeout(300);
    assert.deepEqual(await sweep(page, "victory with a failed submission"), []);

    await context.close();
  } finally {
    await browser.close();
  }
});

test("a placing run fits its initials prompt, before and after locking", { skip, timeout: 600_000 }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const { base } = await startService();
    const context = await browser.newContext({
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.route("https://murphtournaments.com/**", (r) =>
      r.fulfill({ json: { signedIn: false, player: null } })
    );
    await page.goto(base, { waitUntil: "networkidle" });
    await page.locator(".summary-action").first().click();
    await page.waitForTimeout(400);
    await page.locator(".mode-card[data-mode='survival']").click();
    await page.waitForTimeout(250);
    await page.locator(".menu-footer .play-button").click();
    await page.waitForTimeout(800);
    await playUntilSummary(page);

    assert.equal(await page.locator(".initials-entry").count(), 1, "a placing run asks for initials");
    assert.match(
      await page.locator(".run-links-note").innerText(),
      /LOCK SCORE/,
      "the reason the actions are disabled has to be visible too"
    );
    assert.deepEqual(await sweep(page, "initials pending"), []);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await page.locator(".initials-entry input").fill("ABC");
    await page.locator(".initials-entry button[type=submit]").click();
    await page.waitForTimeout(600);
    assert.equal(await page.locator(".initials-entry").count(), 0, "locking clears the prompt");
    assert.deepEqual(await sweep(page, "initials locked"), []);

    await context.close();
  } finally {
    await browser.close();
  }
});

test.after(() => service?.stop());
