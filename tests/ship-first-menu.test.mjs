/**
 * Where ship choice lives.
 *
 * This file used to pin the opposite arrangement: the game opened on the ship
 * picker, confirming a ship was step one of launching, and every screen on the
 * way to a run carried a "selected ship, tap to change" card. That made the
 * most consequential decision of a session the first one, taken with the least
 * information, and it made Rift Run's premise impossible to express — a mode
 * that issues one standard starter ship cannot sit behind a mandatory picker.
 *
 * The arrangement it pins now is:
 *
 *   Launch → Main Menu → Choose Game Mode → Lobby → Choose Ship / Ready → Round
 *
 * The main menu answers *what do you want to play?*; the lobby answers *how do
 * you want to play this round?*. Solo PvE and co-op pick their hull in place on
 * the round-setup screen, PvP picks in the multiplayer lobby, and Rift Run
 * picks nothing at all. Ships remains a browsing surface reached from Home.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const menu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const routes = readFileSync(new URL("../app/menu-routes.ts", import.meta.url), "utf8");

const screen = (name, next) => menu.slice(menu.indexOf(`export function ${name}`), menu.indexOf(`export function ${next}`));

/**
 * A session opens on Home, and Play launches from it.
 *
 * Play used to open the mode picker, which meant Home displayed your mode,
 * difficulty and ship and then Play asked you to choose a mode. A player put it
 * exactly right: "it looks like you are meant to choose game options before
 * pressing Play, but pressing Play shows you game options anyway." Home already
 * carries the whole launch decision and every row on it opens the screen that
 * changes it, so there is nothing left for a second pass to ask.
 *
 * A network mode still goes to its lobby — there it is waiting on other people,
 * not re-asking questions Home already answered.
 */
test("a session opens on Home, and Play launches what Home is showing", () => {
  assert.match(routes, /INITIAL_STACK: MenuStack = \["home"\]/);
  assert.ok(game.includes("onLaunch={launchFromMenu}"), "Home's Play is the launch");
  assert.ok(!game.includes("const beginPlayFlow"), "the detour through the mode picker is gone");
  // And the launch it calls is the one that already knew the difference.
  assert.ok(game.includes("if (isOfflineMode(mode)) { start(); return; }"), "solo starts the run");
  assert.ok(game.includes('setMenu(resetRoute("lobby"));'), "a network mode still waits in its lobby");
});

test("Ships is a browsing surface: confirming returns where it was opened from", () => {
  // Popping rather than pushing forward is what stops Ships being step one of a
  // launch. The fallback to Home exists because popping a single-entry stack
  // would drop the pilot into an inert cockpit with no run in it.
  assert.match(game, /const confirmShip = useCallback\(\s*\(\) => setMenu\(\(stack\) => \(stack\.length > 1 \? popRoute\(stack\) : resetRoute\("home"\)\)\)/);
  assert.match(game, /<ShipsScreen[\s\S]*onLaunch=\{confirmShip\}/);
  // Home still offers it, as a place to compare the fleet.
  assert.match(menu, /\{ route: "ships", label: "Ships", hint: "Compare the fleet" \}/);
});

test("Home shows the hull it will fly; the mode screens still do not", () => {
  // Ship *selection* moved into the round lobby, and the mode screens stay out
  // of it. Home is the exception, by explicit request: it summarises the whole
  // launch decision, and a summary that names the mode and the difficulty but
  // not the hull leaves out the part a returning pilot most wants to check
  // before pressing Play. It is a summary row like the other two -- reading it
  // costs nothing, and pressing it opens the same browsing surface.
  assert.ok(!menu.includes("SelectedShipPreview"), "not the old bespoke preview card");
  assert.ok(!css.includes("selected-ship-preview"));

  const home = screen("HomeScreen", "GameTypeScreen");
  assert.ok(home.includes("label=\"Ship\""), "Home names the hull");
  assert.ok(home.includes("media={renderShip(ship, 44)}"), "and draws it");
  assert.ok(home.includes("onAction={() => go(\"ships\")}"), "pressing it opens the browsing surface");

  // The mode screens are still not a place to think about hulls.
  for (const [name, next] of [["GameTypeScreen", "PvpModesScreen"], ["PvpModesScreen", "PveModesScreen"], ["PveModesScreen", "LobbyShipPicker"]]) {
    assert.doesNotMatch(screen(name, next), /ship={|go("ships")/, `${name} must not ask about ships`);
  }
});

test("every launch summary row is itself the button", () => {
  // No standing CHANGE control sits beside a card that already looks
  // pressable. One target, not two: the row is the button and the cue is
  // inside it.
  const ui = readFileSync(new URL("../app/ui-system.tsx", import.meta.url), "utf8");
  const at = ui.indexOf("export function SummaryRow");
  const row = ui.slice(at, at + 2000);
  assert.ok(row.includes("className=\"summary-row\""), "the row itself is the button");
  assert.ok(row.includes("className=\"summary-cue\""), "the cue is inside it");
  assert.ok(!row.includes("className=\"summary-action\""), "the standalone action button is gone");
  assert.ok(!css.includes(".summary-action {"), "and so is its styling");
  assert.ok(css.includes("button.summary-row {"), "styled as a button");
});

test("solo and co-op choose their hull in the round lobby, in place", () => {
  const lobby = screen("LobbyShipPicker", "DifficultyScreen");
  assert.match(lobby, /role="radiogroup" aria-label="Choose your ship"/);
  assert.match(lobby, /SHIP_ORDER\.map/);
  assert.match(lobby, /onClick=\{\(\) => onSelectShip\(id\)\}/);
  // In place: selecting does not navigate anywhere.
  assert.doesNotMatch(lobby, /go\(/);

  const setup = screen("DifficultyScreen", "RiftRunSetupScreen");
  assert.match(setup, /<LobbyShipPicker ship=\{ship\} onSelectShip=\{onSelectShip\} renderShip=\{renderShip\} \/>/);
  assert.match(setup, /title="Round Setup"/);
  // And the choice is committed the same way the multiplayer lobby commits it,
  // so a co-op ally sees the hull the round will actually fly.
  assert.match(game, /onSelectShip=\{\(id\) => \{ setShipId\(id\); netRef\.current\?\.chooseShip\(id\); \}\}/);
});

test("PvP keeps choosing its ship in the multiplayer lobby", () => {
  const lobby = game.slice(game.indexOf("function MultiplayerLobby"), game.indexOf("function GlobalSystemControls"));
  assert.match(lobby, /aria-label="Choose your ship"/);
  assert.match(lobby, /const cycleShip = \(direction: number\)/);
  assert.match(lobby, /onShip\(SHIPS\[\(index \+ direction \+ SHIPS\.length\) % SHIPS\.length\]\.id\)/);
});

test("the Rift Run lobby has no ship control of any kind", () => {
  const lobby = screen("RiftRunSetupScreen", "ShipsScreen");
  assert.doesNotMatch(lobby, /ship-grid|radiogroup|onSelect|SHIP_ORDER|RIFT_RUN_SHIPS/);
  // Its footer commits the run, not a ship.
  assert.match(lobby, />Start Run</);
  assert.doesNotMatch(lobby, /Start Run · /);
  // And the shell passes it nothing to select with.
  const mounted = game.slice(game.indexOf("<RiftRunSetupScreen"), game.indexOf("<ShipsScreen"));
  assert.doesNotMatch(mounted, /ship=|onSelect=/);
});

test("root selection contains only PvP and PvE categories", () => {
  const root = screen("GameTypeScreen", "PvpModesScreen");
  assert.equal((root.match(/className="mode-card"/g) ?? []).length, 2);
  assert.match(root, />PvP</); assert.match(root, />PvE</);
  for (const forbidden of ["Solo PvE", "PvE Co-op", "Rift Survival", "Rift Run"]) assert.doesNotMatch(root, new RegExp(forbidden));
});

test("PvP and PvE branches expose only their own modes", () => {
  const pvp = screen("PvpModesScreen", "PveModesScreen");
  assert.match(pvp, />1v1</); assert.doesNotMatch(pvp, /Solo PvE|Co-op|Survival|RIFT_RUN_TITLE/);
  const pve = screen("PveModesScreen", "LobbyShipPicker");
  // The labels come from MODE_INFO, so the screen is identified by the modes it
  // actually offers rather than by the copy it renders.
  for (const mode of ["pve", "coop", "survival", "rift-run", "classic"]) {
    assert.match(pve, new RegExp(`data-mode="${mode}"`), `PvE must offer ${mode}`);
  }
  assert.match(pve, /MODE_INFO\.pve\.label/);
  assert.match(pve, /MODE_INFO\.coop\.label/);
  assert.match(pve, /RIFT_RUN_TITLE/);
  assert.doesNotMatch(pve, />PvP</);
});

test("canonical preview animates, honors reduced motion, and cleans up", () => {
  assert.match(menu, /function MenuShipPreview/);
  assert.match(menu, /drawShipModel\(context, ship/);
  assert.match(menu, /requestAnimationFrame\(paint\)/);
  assert.match(menu, /prefers-reduced-motion: reduce/);
  assert.match(menu, /cancelAnimationFrame\(frame\)/);
});

test("selected mode remains a complete semantic button", () => {
  assert.match(menu, /className="selected-mode-card"[\s\S]*go\("pve-modes"\)/);
});

test("all ships use a compact, non-scrolling responsive grid", () => {
  assert.match(menu, /SHIP_ORDER\.map/);
  assert.match(css, /data-route="ships"\] \.menu-content \{ overflow-x: hidden; overflow-y: auto/);
  assert.match(css, /grid-template-columns: repeat\(5/);
  assert.match(css, /@container menu \(max-width: 390px\)/);
  assert.match(menu, /footer=\{[\s\S]*Confirm \{profile\.name\}/);
});
