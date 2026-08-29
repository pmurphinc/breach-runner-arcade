import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

test("one shared gameplay surface owns context-menu protection for every mode", () => {
  const handlers = game.match(/onContextMenu=\{\(event\) => event\.preventDefault\(\)\}/g) ?? [];
  assert.equal(handlers.length, 1, "standard, Survival, Rift Run, co-op, and PvP must not add mode-specific listeners");

  const playColumn = game.indexOf('className="play-column"');
  const handler = game.indexOf("onContextMenu=", playColumn);
  const arena = game.indexOf('className="arena-stage"', playColumn);
  const statusDock = game.indexOf('className="status-dock"', arena);
  const endOfColumn = game.indexOf("</section>", statusDock);

  assert.ok(playColumn >= 0 && playColumn < handler, "the gameplay column should own the handler");
  assert.ok(handler < arena && arena < statusDock && statusDock < endOfColumn, "the handler should cover the arena and gameplay HUD");
  assert.equal(game.slice(arena, statusDock).includes("onContextMenu="), false, "the canvas must not install a duplicate handler");
});

test("context-menu protection is scoped away from menus and editable fields", () => {
  const playColumn = game.indexOf('className="play-column"');
  const endOfCockpit = game.indexOf("\n      </section>\n\n      <BuildWatermark", playColumn);
  const menuScreens = game.indexOf('{route === "settings"');

  assert.ok(endOfCockpit > playColumn, "the gameplay surface should have a bounded element");
  assert.ok(menuScreens > endOfCockpit, "settings and its editable initials field must remain outside the protected gameplay surface");
  assert.doesNotMatch(game, /(?:window|document)\.addEventListener\(["']contextmenu["']/, "no global context-menu listener should survive gameplay");
});
