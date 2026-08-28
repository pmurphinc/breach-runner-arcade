import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const desktopGameplay = readFileSync(new URL("../app/desktop-gameplay.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

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
  assert.match(
    desktopGameplay,
    /\.app-shell:not\(\[data-immersive="true"\]\)\s+\.play-column\s*\{[^}]*width:\s*min\(100%,\s*980px\)[^}]*margin-inline:\s*auto/s,
  );
  assert.doesNotMatch(desktopGameplay, /!important/);
});
