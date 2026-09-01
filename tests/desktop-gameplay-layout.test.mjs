import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const desktopGameplay = readFileSync(new URL("../app/desktop-gameplay.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

/** Rules only. The prose explains which caps were removed and names them. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const desktopRules = stripComments(desktopGameplay);

/** Every PC gameplay rule is scoped to the modern mouse-and-keys shell and nothing else. */
const PC = '.app-shell\\[data-view-mode="pc"\\]\\.modern-hud\\[data-immersive="true"\\]';
const pcRule = (selector) =>
  new RegExp(`${PC}\\s+${selector}\\s*\\{([^}]*)\\}`, "s");

/** Split a selector group on its top-level commas, so `:is(a, b)` survives. */
function splitSelectorGroup(group) {
  const out = [];
  let depth = 0;
  let current = "";
  for (const character of group) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  out.push(current.trim());
  return out;
}

test("desktop gameplay uses the uncapped immersive arena", () => {
  // Keep the regression fixture honest: the legacy preset selector is the
  // rule that collapsed the arena after the side panels were hidden.
  assert.match(globals, /\[data-preset="fit"\]\s+\.cockpit\s*\{[^}]*grid-template-columns:/s);
  assert.match(globals, /\.ship-panel,\s*\n?\.intel-panel\s*\{\s*display:\s*none;/s);

  // Desktop corrections remain late-loaded, but the canonical modern profile
  // now enters the immersive shell rather than a capped legacy column.
  const globalImport = layout.indexOf('import "./globals.css";');
  const desktopImport = layout.indexOf('import "./desktop-gameplay.css";');
  assert.ok(globalImport >= 0 && desktopImport > globalImport, "desktop gameplay CSS should load after globals.css");

  assert.match(
    game,
    /className=\{`app-shell modern-hud/,
  );
  assert.doesNotMatch(desktopGameplay, /1120px|980px/);
  assert.match(desktopGameplay, /modern HUD/);
  assert.doesNotMatch(desktopGameplay, /!important/);
});

test("no desktop cap re-crops the arena into a centred column", () => {
  // The old desktop column caps and the square touch-budget edge must not
  // bound PC gameplay.
  assert.doesNotMatch(desktopGameplay, /1120px|980px/);
  assert.match(desktopGameplay, new RegExp(`${PC}\\s+\\.play-column\\s*\\{[^}]*width:\\s*100%`, "s"));
  assert.match(desktopGameplay, new RegExp(`${PC}\\s+\\.play-column\\s*\\{[^}]*height:\\s*100%`, "s"));

  // globals.css still hands immersive `.arena-stage` the measured touch budget.
  // PC must overrule it rather than inherit it.
  assert.match(globals, /\[data-immersive="true"\]\s+\.arena-stage\s*\{[^}]*var\(--arena-size\)/s);
  const stage = desktopGameplay.match(pcRule("\\.arena-stage"));
  assert.ok(stage, "PC needs its own .arena-stage rule");
  assert.match(stage[1], /position:\s*absolute/);
  assert.match(stage[1], /inset:\s*0/);
  assert.doesNotMatch(stage[1], /--arena-size/);
});

test("the PC canvas takes the viewport's aspect, and the world is never stretched", () => {
  // The base rule pins the presentation to the world's own proportions.
  assert.match(globals, /\.canvas-wrap > canvas\s*\{[^}]*aspect-ratio:\s*1504\/940/s);

  const canvas = desktopGameplay.match(pcRule("\\.canvas-wrap > canvas"));
  assert.ok(canvas, "PC needs its own canvas sizing rule");
  assert.match(canvas[1], /width:\s*100%/);
  assert.match(canvas[1], /height:\s*100%/);
  assert.match(canvas[1], /aspect-ratio:\s*auto/);

  // Safe only because the backing store and the camera both follow the
  // measured rectangle: one uniform world scale, whatever shape the CSS box is.
  assert.match(game, /worldScale = targetWidth \/ VIEW_WIDTH/);
  assert.match(game, /renderViewHeight = backing\.logicalHeight/);

  // The simulation is untouched by any of this.
  assert.match(game, /const WORLD_WIDTH = 1504;/);
  assert.match(game, /const WORLD_HEIGHT = 940;/);
});

test("Full Arena still fits the whole world instead of cropping it", () => {
  // The renderer and the mouse-aim conversion must keep using the same fit,
  // and it must stay a Math.min: Math.max would crop the world on a monitor
  // wider than 1504/940.
  const fit = /Math\.min\(VIEW_WIDTH \/ game\.worldWidth, (renderViewHeight|viewHeight) \/ game\.worldHeight\)/g;
  assert.equal(game.match(fit)?.length, 2, "renderer and pointer camera must share one Full Arena fit");
  assert.doesNotMatch(game, /Math\.max\(VIEW_WIDTH \/ game\.worldWidth/);
});

test("the PC HUD floats over the arena and keeps its controls usable", () => {
  assert.match(globals, /\.modern-hud \.match-bar\s*\{[^}]*grid-template-columns:\s*auto/s);
  assert.match(globals, /\.modern-hud \.status-dock\s*\{\s*display:\s*none !important/s);
  assert.match(game, /viewProfile\.modernHud && !settings\.compactHud \? <div className="health-rails"/);
  assert.match(game, /className="touch-powerup-hud"/);

  // The rules rail is the arena's own top lane in the modern HUD.
  assert.match(globals, /\.difficulty-badge\s*\{[^}]*top:\s*8px;\s*left:\s*8px;\s*right:\s*8px/s);

  // Menus and the global controls stay above everything, and the end-of-run
  // card stays above the floating HUD.
  assert.match(globals, /--z-hud:\s*10;/);
  assert.match(globals, /--z-hud-float:\s*20;/);
  assert.match(globals, /--z-screen:\s*100;/);
  assert.match(globals, /--z-system:\s*400;/);
  assert.match(desktopGameplay, new RegExp(`${PC}\\s+\\.run-summary-layer\\s*\\{[^}]*z-index:\\s*var\\(--z-hud-float\\)`, "s"));
});

test("the fullscreen arena is PC-only, so touch and hybrid keep their layout", () => {
  // Every rule added for the fullscreen arena carries the PC scope. A bare
  // `.cockpit` or `.arena-stage` here would reach the immersive shell too.
  const selectors = stripComments(desktopGameplay)
    .split("}")
    .map((block) => block.split("{")[0].trim())
    .filter(Boolean)
    .flatMap(splitSelectorGroup)
    .filter(Boolean);
  assert.ok(selectors.length > 0, "the PC section should carry rules");
  for (const selector of selectors) {
    assert.ok(
      selector.startsWith('.app-shell[data-view-mode="pc"].modern-hud[data-immersive="true"]'),
      `${selector} is not scoped to the PC shell`,
    );
  }
});

test("Mouse & Keys uses the modern HUD without enabling touch controls", () => {
  assert.match(game, /const touchCapable = viewProfile\.touch/);
  assert.match(game, /const immersive = viewProfile\.modernHud/);
  assert.match(game, /\{touchCapable \? <div className="touch-controls"/);
  assert.match(game, /data-touch-controls=\{layout\.showTouchControls \? "on" : "off"\}/);
});
