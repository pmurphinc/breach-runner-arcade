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

/** Every PC gameplay rule is scoped to the mouse-and-keys shell and nothing else. */
const PC = '.app-shell\\[data-view-mode="pc"\\]:not\\(\\[data-immersive="true"\\]\\)';
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

test("desktop gameplay defeats the legacy preset cockpit grid", () => {
  // Keep the regression fixture honest: the legacy preset selector is the
  // rule that collapsed the arena after the side panels were hidden.
  assert.match(globals, /\[data-preset="fit"\]\s+\.cockpit\s*\{[^}]*grid-template-columns:/s);
  assert.match(globals, /\.ship-panel,\s*\n?\.intel-panel\s*\{\s*display:\s*none;/s);

  // The repair must be loaded after the older layout sheets and must carry
  // enough specificity to beat `[data-preset] .cockpit` without !important.
  const globalImport = layout.indexOf('import "./globals.css";');
  const desktopImport = layout.indexOf('import "./desktop-gameplay.css";');
  assert.ok(globalImport >= 0 && desktopImport > globalImport, "desktop gameplay CSS should load after globals.css");

  assert.match(
    desktopGameplay,
    /\.app-shell:not\(\[data-immersive="true"\]\)\s+\.cockpit\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
  );
  assert.doesNotMatch(desktopGameplay, /!important/);
});

test("no desktop cap re-crops the arena into a centred column", () => {
  // The three caps that produced a 952x595 canvas with 484px gutters on a
  // 1920x1080 monitor: a 1120px cockpit, a 980px play column, and the square
  // touch-budget edge in --arena-size. None of them may bound PC gameplay.
  assert.doesNotMatch(desktopRules, /1120px/);
  assert.doesNotMatch(desktopRules, /980px/);
  assert.match(desktopGameplay, /\.app-shell:not\(\[data-immersive="true"\]\)\s+\.cockpit\s*\{[^}]*width:\s*100%/s);
  assert.match(desktopGameplay, /\.app-shell:not\(\[data-immersive="true"\]\)\s+\.play-column\s*\{[^}]*width:\s*100%/s);

  // globals.css still hands non-immersive `.arena-stage` a `min(100%,
  // var(--arena-size))`. PC must overrule it rather than inherit it.
  assert.match(globals, /\.app-shell:not\(\[data-immersive="true"\]\)\s+\.arena-stage\s*\{[^}]*var\(--arena-size\)/s);
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
  const hud = desktopGameplay.match(
    new RegExp(`${PC}\\s+\\.play-column > \\.match-bar,\\s*${PC}\\s+\\.play-column > \\.coach-strip\\s*\\{([^}]*)\\}`, "s"),
  );
  assert.ok(hud, "the match bar and coaching line need a PC overlay rule");
  assert.match(hud[1], /z-index:\s*var\(--z-hud\)/);
  // Pointer-transparent, or the top of the arena would stop aiming and firing.
  assert.match(hud[1], /pointer-events:\s*none/);

  const dock = desktopGameplay.match(pcRule("\\.status-dock"));
  assert.ok(dock, "the instrument rail needs a PC overlay rule");
  assert.match(dock[1], /position:\s*absolute/);
  assert.match(dock[1], /z-index:\s*var\(--z-hud\)/);
  assert.match(dock[1], /pointer-events:\s*none/);
  // ...but the inventory itself still takes the pointer.
  assert.match(
    desktopGameplay,
    new RegExp(`${PC}\\s+\\.status-dock :is\\(button, a, input, select\\)\\s*\\{[^}]*pointer-events:\\s*auto`, "s"),
  );

  // The rules rail is the arena's own top lane; the floating HUD stacks under
  // it rather than across it.
  assert.match(globals, /\.difficulty-badge\s*\{[^}]*top:\s*8px;\s*left:\s*8px;\s*right:\s*8px/s);
  assert.match(desktopGameplay, new RegExp(`${PC}\\s+\\.play-column\\s*\\{[^}]*padding-top:`, "s"));

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
  const banner = desktopGameplay.indexOf("PC / MOUSE & KEYS FULLSCREEN ARENA");
  assert.ok(banner > 0, "the PC section should be signposted");
  const selectors = stripComments(desktopGameplay.slice(desktopGameplay.lastIndexOf("/*", banner)))
    .split("}")
    .map((block) => block.split("{")[0].trim())
    .filter(Boolean)
    .flatMap(splitSelectorGroup)
    .filter(Boolean);
  assert.ok(selectors.length > 0, "the PC section should carry rules");
  for (const selector of selectors) {
    assert.ok(
      selector.startsWith('.app-shell[data-view-mode="pc"]:not([data-immersive="true"])'),
      `${selector} is not scoped to the PC shell`,
    );
  }
});
