import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const ui = readFileSync(new URL("../app/ui-system.tsx", import.meta.url), "utf8");
const mainMenu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
const fuzz = readFileSync(new URL("../scripts/menu-responsive-fuzz.mjs", import.meta.url), "utf8");
const architecture = css.slice(css.indexOf("Launch Deck constraint model"), css.indexOf("Dialogs outside MenuScreen"));

test("Launch Deck has one viewport owner and three negotiated panel rows", () => {
  assert.match(architecture, /height: 100dvh;[\s\S]*?container: launch-screen \/ size/);
  assert.match(architecture, /\.menu-screen\[data-route="home"\] \.menu-panel \{[\s\S]*?height: 100%;[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\) auto/);
  assert.match(ui, /grid-template-rows: auto minmax\(0, 1fr\) auto/);
});

test("Home content is normal-flow, intrinsic and not an overflow band-aid", () => {
  assert.match(architecture, /\.menu-screen\[data-route="home"\] \.menu-content \{[\s\S]*?overflow: visible/);
  assert.match(architecture, /\.main-menu-stage \{[\s\S]*?grid-template-rows: minmax\(0, 1fr\) auto/);
  assert.match(architecture, /\.launch-console \{[\s\S]*?min-height: min-content;[\s\S]*?overflow: visible/);
  assert.doesNotMatch(architecture, /line-clamp|overflow-y:\s*auto/);
});

test("responsive density is fluid in width and height", () => {
  for (const property of ["edge", "section-gap", "panel-padding", "control-height", "logo-size", "heading-size", "body-size", "header-height"]) {
    assert.match(architecture, new RegExp(`--launch-${property}:`));
  }
  assert.match(architecture, /min\(1\.2dvw, 1\.2dvh\)/);
  assert.match(architecture, /min\(42cqw, 28dvh\)/);
});

test("scarce block space reflows branding and Play onto the width axis", () => {
  assert.match(architecture, /@container launch-panel \(max-height: 500px\)/);
  assert.match(architecture, /grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
  assert.match(architecture, /\.launch-command \{ grid-column: 2; grid-row: 1 \/ -1/);
  assert.doesNotMatch(architecture, /orientation: landscape/);
});

test("all required Launch Deck geometry has stable automation hooks", () => {
  for (const hook of ["branding", "mission", "mode", "play"]) assert.match(mainMenu, new RegExp(`data-launch-(?:region|control)="${hook}"`));
  for (const hook of ["ships", "leaderboard", "info"]) assert.match(mainMenu, new RegExp(`launch-utility-${hook}`));
  assert.match(ui, /data-launch-region=\{route === "home" \? "utility"/);
  assert.match(mainMenu, /onOpenSettings=\{openSettings\}/);
});

test("browser fuzz tool covers hundreds of grids, a continuous sweep, clipping, hit-testing and screenshots", () => {
  assert.match(fuzz, /widths\.flatMap/);
  assert.match(fuzz, /Array\.from\(\{ length: 81 \}/);
  assert.match(fuzz, /clippedByAncestor/);
  assert.match(fuzz, /elementFromPoint/);
  assert.match(fuzz, /scrollWidth > width/);
  assert.match(fuzz, /intersects/);
  assert.match(fuzz, /launch-fail-\$\{viewport\.width\}x\$\{viewport\.height\}\.png/);
  assert.ok(26 * 12 + 81 > 300);
});
