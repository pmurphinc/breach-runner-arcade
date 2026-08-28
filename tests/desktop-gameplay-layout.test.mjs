import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const desktopGameplay = readFileSync(new URL("../app/desktop-gameplay.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

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

  assert.doesNotMatch(desktopGameplay, /1120px|980px/);
  assert.match(desktopGameplay, /canonical immersive arena shell/);
  assert.doesNotMatch(desktopGameplay, /!important/);
});
