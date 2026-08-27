/**
 * Off-screen markers, measured where they are actually painted.
 *
 * `offscreen-indicators.test.mjs` proves the geometry, and all of it passed
 * while left and right markers were invisible in the running game. It could
 * not have caught that: the maths was never wrong, the rectangle it was being
 * given was. On the immersive layouts the arena canvas is deliberately drawn
 * wider than the box that clips it — `min-width: 100%` on an element that
 * keeps the world's aspect ratio, inside a wrapper with `overflow: hidden` —
 * so the outermost strip of canvas never reaches the glass. The canvas is
 * handed its wrapper's exact height, so only the width overhangs, and only the
 * left and right markers were being thrown away.
 *
 * So this file measures the drawn result rather than the arithmetic. It hooks
 * the 2D context before the game loads, records where every marker's ink
 * actually lands in canvas pixels, works out the visible playfield from the
 * live layout on its own, and asserts the two agree.
 *
 * Playwright is not a repository dependency, so these skip when it or a dev
 * server is unavailable. Run them with:
 *   npx vite --port 5199
 *   WORMHOLE_TEST_URL=http://localhost:5199/ node --test tests/offscreen-render.test.mjs
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

/**
 * The presentation width the renderer draws in. Every marker is counter-scaled
 * out of the camera, which leaves its transform at exactly the canvas backing
 * width over this — the signature the hook below picks markers out by.
 */
const VIEW_WIDTH = 1048;

/**
 * `standard` zoom is camera scale 1, which makes a marker's transform
 * indistinguishable from the rest of the arena's. Every case here runs at a
 * zoom the pilot can actually pick, and one that keeps the two apart.
 */
const ZOOM = "closer";

/**
 * Hooks the canvas before any game code runs and records, for every path the
 * renderer fills or strokes at marker scale, where its ink lands in canvas
 * pixels. Nothing in the game is aware of this; it reads the same transform
 * the browser is about to rasterise with.
 */
const INSTRUMENT = `(() => {
  window.__markers = [];
  const P = CanvasRenderingContext2D.prototype;
  const raw = { beginPath: P.beginPath, moveTo: P.moveTo, lineTo: P.lineTo,
    arc: P.arc, ellipse: P.ellipse, fill: P.fill, stroke: P.stroke };
  const paths = new WeakMap();
  const points = (ctx) => { let a = paths.get(ctx); if (!a) { a = []; paths.set(ctx, a); } return a; };
  P.beginPath = function () { paths.set(this, []); return raw.beginPath.apply(this, arguments); };
  P.moveTo = function (x, y) { points(this).push([x, y]); return raw.moveTo.apply(this, arguments); };
  P.lineTo = function (x, y) { points(this).push([x, y]); return raw.lineTo.apply(this, arguments); };
  P.arc = function (x, y, r) { points(this).push([x - r, y - r], [x + r, y + r]); return raw.arc.apply(this, arguments); };
  P.ellipse = function (x, y, rx, ry) { points(this).push([x - rx, y - ry], [x + rx, y + ry]); return raw.ellipse.apply(this, arguments); };
  const record = (ctx) => {
    const path = points(ctx);
    if (!path.length) return;
    const m = ctx.getTransform();
    const reference = window.__markerScale;
    if (!reference || Math.abs(Math.hypot(m.a, m.b) - reference) > 0.01) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, reach = 0;
    for (const [x, y] of path) {
      reach = Math.max(reach, Math.abs(x), Math.abs(y));
      const dx = m.a * x + m.c * y + m.e, dy = m.b * x + m.d * y + m.f;
      minX = Math.min(minX, dx); maxX = Math.max(maxX, dx);
      minY = Math.min(minY, dy); maxY = Math.max(maxY, dy);
    }
    if (reach > 40) return;
    window.__markers.push({ frame: window.__frame | 0, anchorX: m.e, anchorY: m.f,
      minX, minY, maxX, maxY, playfield: window.__frameField,
      shape: path.map(([x, y]) => x + "," + y).join("|") });
    if (window.__markers.length > 6000) window.__markers.splice(0, 3000);
  };
  P.fill = function () { record(this); return raw.fill.apply(this, arguments); };
  P.stroke = function () { record(this); return raw.stroke.apply(this, arguments); };
  // The part of the arena the pilot can see, in canvas pixels — worked out
  // from the live layout here rather than read back out of the renderer, so
  // this is a genuine second opinion on where a marker is allowed to be. Taken
  // every frame, because a HUD row appearing resizes the arena mid-run and a
  // marker has to be judged against the playfield it was actually drawn into.
  window.__playfield = () => {
    const canvas = document.querySelector(".canvas-wrap > canvas");
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    if (!(box.width > 0)) return null;
    let left = Math.max(box.left, 0), top = Math.max(box.top, 0);
    let right = Math.min(box.right, window.innerWidth), bottom = Math.min(box.bottom, window.innerHeight);
    for (let node = canvas.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX === "visible" && style.overflowY === "visible") continue;
      const rect = node.getBoundingClientRect();
      if (style.overflowX !== "visible") { left = Math.max(left, rect.left); right = Math.min(right, rect.right); }
      if (style.overflowY !== "visible") { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom); }
    }
    const perCssPixel = canvas.width / box.width;
    return {
      width: canvas.width, height: canvas.height,
      left: (left - box.left) * perCssPixel, top: (top - box.top) * perCssPixel,
      right: (right - box.left) * perCssPixel, bottom: (bottom - box.top) * perCssPixel,
    };
  };
  const rAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => rAF((t) => {
    window.__frame = (window.__frame | 0) + 1;
    const canvas = document.querySelector(".canvas-wrap > canvas");
    if (canvas) window.__markerScale = canvas.width / ${VIEW_WIDTH};
    window.__frameField = window.__playfield();
    return cb(t);
  });
})();`;

/**
 * The Rift marker's identity mark: the flattened ring only it draws. Reading
 * its two extremes back out of the recorded path is how a Rift marker is told
 * apart from a hostile's or a PUP's without the game exporting anything.
 */
const RIFT_RING = "-14,-4.5|2,4.5";

/** One marker instance: every path drawn around the same anchor in one frame. */
function markerInstances(records) {
  const byAnchor = new Map();
  for (const record of records) {
    const key = `${record.frame}|${Math.round(record.anchorX)}|${Math.round(record.anchorY)}`;
    const seen = byAnchor.get(key) ?? {
      frame: record.frame, anchorX: record.anchorX, anchorY: record.anchorY,
      playfield: record.playfield,
      minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, shapes: [],
    };
    seen.minX = Math.min(seen.minX, record.minX); seen.maxX = Math.max(seen.maxX, record.maxX);
    seen.minY = Math.min(seen.minY, record.minY); seen.maxY = Math.max(seen.maxY, record.maxY);
    seen.shapes.push(record.shape);
    byAnchor.set(key, seen);
  }
  // A marker drawn while the layout was mid-reflow has no playfield to be
  // judged against, so it is not evidence either way.
  return [...byAnchor.values()].filter((marker) => marker.playfield);
}

const inside = (marker) => {
  const field = marker.playfield;
  return marker.minX >= field.left - 0.5 && marker.maxX <= field.right + 0.5
    && marker.minY >= field.top - 0.5 && marker.maxY <= field.bottom + 0.5;
};

const describeMarker = (marker) => {
  const field = marker.playfield;
  return `marker ink [${marker.minX.toFixed(1)}, ${marker.minY.toFixed(1)} .. ${marker.maxX.toFixed(1)}, ${marker.maxY.toFixed(1)}]`
    + ` vs visible playfield [${field.left.toFixed(1)}, ${field.top.toFixed(1)}`
    + ` .. ${field.right.toFixed(1)}, ${field.bottom.toFixed(1)}]`
    + ` of a ${field.width} x ${field.height} canvas`;
};

/** Launches a run in one device shape, with the arena already instrumented. */
async function openArena(browser, { width, height, viewMode, touch }) {
  const context = await browser.newContext({
    viewport: { width, height }, hasTouch: touch, isMobile: touch,
  });
  await context.route("https://murphtournaments.com/**", (route) =>
    route.fulfill({ json: { signedIn: false, player: null } }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(({ viewMode, zoom }) => {
    localStorage.setItem("wormhole-arcade:settings:v1", JSON.stringify({
      version: 1, viewMode, cameraLock: true, zoom, sound: false, soundLevel: "low",
      combatHaptics: "off", cannonHitSound: false, aimGuide: "off", thumbsticks: false,
      touchControlSize: "medium", touchControlHeight: "middle",
      mirrorTouchActions: false, playerInitials: "",
    }));
  }, { viewMode, zoom: ZOOM });
  await page.addInitScript(INSTRUMENT);
  await page.goto(URL_UNDER_TEST, { waitUntil: "networkidle" });
  await page.waitForSelector(".menu-screen[data-route='home']", { timeout: 20_000 });
  await page.locator(".summary-action").first().click();
  await page.waitForTimeout(400);
  // PRACTICE keeps the hull locked, so a run can be flown into a wall and held
  // there for as long as a measurement needs without ending.
  await page.locator('.option-choices [data-choice="practice"]').first().click();
  await page.waitForTimeout(250);
  await page.locator(".menu-footer .play-button").click();
  await page.waitForTimeout(1200);
  return { context, page, errors };
}

/** Fly one direction until the ship is pinned against that wall. */
async function flyInto(page, key, ms = 4000) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(200);
}

/** Start a fresh recording. */
const clearMarkers = (page) => page.evaluate(() => { window.__markers.length = 0; });

/** Everything the arena drew since the recording was last cleared. */
const collect = (page) => page.evaluate(() => window.__markers.slice());

const DEVICES = [
  { name: "desktop", width: 1440, height: 900, viewMode: "pc", touch: false },
  { name: "phone landscape", width: 844, height: 390, viewMode: "touch", touch: true },
  { name: "phone portrait", width: 390, height: 844, viewMode: "touch", touch: true },
  // The shape that clips: the canvas overhangs this wrapper by hundreds of
  // pixels on each side, which is where the side markers were being lost.
  { name: "tablet portrait", width: 820, height: 1180, viewMode: "touch", touch: true },
];

test("the whole marker stays inside the visible playfield on every device", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    for (const device of DEVICES) {
      const { context, page, errors } = await openArena(browser, device);
      // Laps of the arena, recorded end to end rather than sampled: a hostile
      // drifts out of frame and back again, so any one instant is a poor
      // witness and every frame of the lap is a good one. How long it takes
      // for something to be off screen depends on how much world the device
      // shows at once, so this flies until there is evidence or gives up.
      await clearMarkers(page);
      let markers = [];
      for (let lap = 0; lap < 3 && markers.length === 0; lap += 1) {
        for (const key of ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]) {
          await flyInto(page, key, 2600);
        }
        markers = markerInstances(await collect(page));
      }
      for (const marker of markers) {
        assert.ok(
          inside(marker),
          `${device.name}: a marker was painted outside the visible playfield — ${describeMarker(marker)}`,
        );
      }
      assert.ok(markers.length > 0, `${device.name}: no markers were drawn at all, so nothing was proven`);
      assert.deepEqual(errors, [], `${device.name}: the arena logged page errors`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});

test("a Rift off the left and the right is marked where the pilot can see it", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    // The clipping layout, and the axis it clips. Flying to one wall puts the
    // Rift past the opposite edge, which is the case that used to be painted
    // into the discarded strip.
    const { context, page } = await openArena(browser, DEVICES[3]);
    for (const [key, side] of [["ArrowLeft", "right"], ["ArrowRight", "left"]]) {
      await flyInto(page, key);
      await clearMarkers(page);
      await page.waitForTimeout(400);
      const rift = markerInstances(await collect(page)).filter((marker) => marker.shapes.includes(RIFT_RING));
      assert.ok(rift.length > 0, `expected a Rift marker off the ${side} with the ship at the far wall`);
      const marker = rift[rift.length - 1];
      assert.ok(
        inside(marker),
        `the ${side}-edge Rift marker was painted outside the visible playfield — ${describeMarker(marker)}`,
      );
      // And it is genuinely on that edge, not merely somewhere legal.
      const width = marker.playfield.right - marker.playfield.left;
      const offset = side === "left"
        ? marker.anchorX - marker.playfield.left
        : marker.playfield.right - marker.anchorX;
      assert.ok(
        offset < width / 4,
        `the ${side}-edge Rift marker sat ${offset.toFixed(1)}px from the ${side} edge of a ${width.toFixed(1)}px playfield`,
      );
    }
    await context.close();
  } finally {
    await browser.close();
  }
});

test("a Rift off the top and the bottom is marked where the pilot can see it", { skip }, async () => {
  const { chromium } = playwright;
  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    // Phone landscape shows a short enough slice of the world that flying to
    // one wall puts the Rift past the opposite one — the top and bottom half
    // of the same guarantee, on the edges that always worked.
    const { context, page } = await openArena(browser, DEVICES[1]);
    for (const [key, side] of [["ArrowUp", "bottom"], ["ArrowDown", "top"]]) {
      await flyInto(page, key);
      await clearMarkers(page);
      await page.waitForTimeout(400);
      const rift = markerInstances(await collect(page)).filter((marker) => marker.shapes.includes(RIFT_RING));
      assert.ok(rift.length > 0, `expected a Rift marker off the ${side} with the ship at the far wall`);
      const marker = rift[rift.length - 1];
      assert.ok(
        inside(marker),
        `the ${side}-edge Rift marker was painted outside the visible playfield — ${describeMarker(marker)}`,
      );
      const height = marker.playfield.bottom - marker.playfield.top;
      const offset = side === "top"
        ? marker.anchorY - marker.playfield.top
        : marker.playfield.bottom - marker.anchorY;
      assert.ok(
        offset < height / 4,
        `the ${side}-edge Rift marker sat ${offset.toFixed(1)}px from the ${side} edge of a ${height.toFixed(1)}px playfield`,
      );
    }
    await context.close();
  } finally {
    await browser.close();
  }
});
