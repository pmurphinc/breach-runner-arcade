import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

const widths = [320, 340, 360, 375, 390, 412, 430, 480, 540, 600, 667, 720, 768, 800, 844, 900, 932, 1024, 1152, 1280, 1366, 1440, 1536, 1600, 1920, 2560];
const heights = [320, 340, 360, 375, 390, 412, 430, 480, 500, 540, 568, 600, 640, 667, 720, 768, 800, 844, 864, 900, 1024, 1080, 1180, 1440];
const cartesian = widths.flatMap((width, wi) => heights
  .filter((_, hi) => (wi + hi) % 2 === 0)
  .map((height) => ({ width, height })));
const sweep = Array.from({ length: 81 }, (_, index) => ({
  width: 320 + index * 16,
  height: 320 + index * 8,
}));
const viewports = [...cartesian, ...sweep.filter((size) => !cartesian.some((item) => item.width === size.width && item.height === size.height))];
const output = new URL("../test-results/menu-responsive/", import.meta.url);

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  throw new Error("Playwright is required for rendered menu fuzzing. Install it with `npm install -D playwright` and `npx playwright install chromium`.");
}

const server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "4173"], { stdio: ["ignore", "pipe", "pipe"] });
const waitForServer = async () => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:4173");
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("development server did not become ready");
};

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  await waitForServer();
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle" });

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(20);
    const failures = await page.evaluate(({ width, height }) => {
      const problems = [];
      const $ = (selector) => document.querySelector(selector);
      const required = {
        play: '[data-launch-control="play"]', ships: '.launch-utility-ships',
        leaderboard: '.launch-utility-leaderboard', info: '.launch-utility-info',
        settings: '.menu-settings', mission: '[data-launch-region="mission"]', mode: '[data-launch-region="mode"]',
      };
      const rects = {};
      const clippedByAncestor = (element) => {
        const rect = element.getBoundingClientRect();
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (!/(hidden|clip|auto|scroll)/.test(`${style.overflow}${style.overflowX}${style.overflowY}`)) continue;
          const box = parent.getBoundingClientRect();
          if (rect.left < box.left - 1 || rect.top < box.top - 1 || rect.right > box.right + 1 || rect.bottom > box.bottom + 1) return true;
        }
        return false;
      };
      for (const [name, selector] of Object.entries(required)) {
        const element = $(selector);
        if (!element) { problems.push(`${name}: missing`); continue; }
        const rect = element.getBoundingClientRect();
        rects[name] = rect;
        if (rect.width <= 0 || rect.height <= 0) problems.push(`${name}: zero size`);
        if (rect.left < -1 || rect.top < -1 || rect.right > width + 1 || rect.bottom > height + 1) problems.push(`${name}: outside viewport`);
        if (clippedByAncestor(element)) problems.push(`${name}: ancestor clipped`);
        if (getComputedStyle(element).pointerEvents === "none") problems.push(`${name}: pointer-events none`);
        if (["play", "ships", "leaderboard", "info", "settings"].includes(name)) {
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          if (!hit || (!element.contains(hit) && !hit.contains(element))) problems.push(`${name}: covered at center`);
        }
      }
      if (document.documentElement.scrollWidth > width || document.documentElement.scrollHeight > height) problems.push("document overflow");
      const deck = $('.menu-screen[data-route="home"]');
      if (deck && (deck.scrollWidth > deck.clientWidth + 1 || deck.scrollHeight > deck.clientHeight + 1)) problems.push("Launch Deck overflow");
      const intersects = (a, b) => a && b && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
      const regions = { header: $(".menu-header")?.getBoundingClientRect(), branding: $('[data-launch-region="branding"]')?.getBoundingClientRect(), utility: $('[data-launch-region="utility"]')?.getBoundingClientRect() };
      for (const [a, b] of [["mission", "utility"], ["play", "utility"], ["branding", "mission"]]) if (intersects(rects[a], regions[b] ?? rects[b])) problems.push(`${a}/${b}: overlap`);
      if (intersects(regions.header, regions.branding)) problems.push("header/branding: overlap");
      for (const pair of [["ships", "leaderboard"], ["leaderboard", "info"], ["ships", "info"]]) if (intersects(rects[pair[0]], rects[pair[1]])) problems.push(`${pair.join("/")}: overlap`);
      return problems;
    }, viewport);
    if (failures.length) {
      const path = new URL(`launch-fail-${viewport.width}x${viewport.height}.png`, output).pathname;
      await page.screenshot({ path, fullPage: true });
      assert.fail(`${viewport.width}x${viewport.height}: ${failures.join(", ")} (screenshot: ${path})`);
    }
  }
  console.log(`Launch Deck geometry passed ${viewports.length} rendered viewports; minimum 320x320.`);
} finally {
  await browser.close();
  server.kill("SIGTERM");
}
