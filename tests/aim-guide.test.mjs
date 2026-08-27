import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settings = readFileSync(new URL("../app/view-settings.ts", import.meta.url), "utf8");
const menu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const guide = readFileSync(new URL("../app/aim-guide.ts", import.meta.url), "utf8");

test("Aim Guide is the only control in the existing HUD Settings tab", () => {
  const panel = menu.slice(menu.indexOf('activeTab === "hud"'), menu.indexOf('activeTab === "gameInfo"'));
  assert.match(panel, /<MenuSection title="HUD">[\s\S]*label="Aim Guide"/);
  assert.match(panel, /id: "off", label: "Off"[\s\S]*id: "short", label: "Short"[\s\S]*id: "long", label: "Long"/);
  assert.equal((panel.match(/<OptionRow/g) ?? []).length, 1);
});

test("Aim Guide defaults off and persisted values are migrated safely", () => {
  assert.match(settings, /aimGuide: "off"/);
  assert.match(settings, /isAimGuide = \(value: unknown\)[^\n]+"off"[^\n]+"short"[^\n]+"long"/);
  assert.match(settings, /aimGuide: isAimGuide\(candidate\.aimGuide\) \? candidate\.aimGuide : "off"/);
  assert.match(game, /onAimGuide=\{\(next\) => setSetting\("aimGuide", next\)\}/);
});

test("off has no segment while Short and Long use fixed world-space lengths", () => {
  assert.match(guide, /if \(guide === "off"\) return null/);
  assert.match(guide, /short: 180/);
  assert.match(guide, /long: 420/);
  assert.match(guide, /AIM_GUIDE_START = 18/);
});

test("guide consumes the cannon heading and renders in the local world pass", () => {
  assert.match(game, /aimGuideSegment\(aimGuideRef\.current, player\.x, player\.y, player\.angle \* DEG\)/);
  assert.match(game, /const angle = player\.angle \* DEG \+ offset;[\s\S]*game\.bullets\.push/);
  assert.match(game, /ctx\.translate\(camX \+ shakeX, camY \+ shakeY\);\s*ctx\.scale\(camScale, camScale\);[\s\S]*aimGuideSegment/);
  assert.match(game, /ctx\.setLineDash\(\[2, 7\]\)/);
});

test("guide is local-only and does not enter projectile or collision state", () => {
  assert.doesNotMatch(game, /aimGuideSegment\([^\n]*(teammate|opponent)/);
  assert.doesNotMatch(guide.slice(guide.indexOf("export function")), /bullets|powers|enemies|collision|netRef|report/);
  assert.doesNotMatch(settings, /aimGuide[^\n]*(network|socket|payload)/i);
});

test("the five existing Settings tabs remain in their original order", () => {
  const tabs = [...menu.matchAll(/\{ id: "(controls|audio|video|hud|gameInfo)", label: "([^"]+)" \}/g)]
    .slice(0, 5)
    .map((match) => match[2]);
  assert.deepEqual(tabs, ["Controls", "Audio", "Video", "HUD", "Game Info"]);
});
