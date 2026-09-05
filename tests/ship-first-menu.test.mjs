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
  assert.match(menu, /<MenuActionButton icon="✦" label="Ships" detail="Choose your hull" onClick=\{\(\) => go\("ships"\)\} \/>/);
});

test("Home keeps setup choices available without showing them inline", () => {
  // Home is intentionally compact: setup choices are reachable later, but no
  // longer compete with Play for vertical space on short or narrow screens.
  assert.ok(!menu.includes("SelectedShipPreview"), "not the old bespoke preview card");
  assert.ok(!css.includes("selected-ship-preview"));

  const home = screen("HomeScreen", "GameTypeScreen");
  assert.doesNotMatch(home, /label=\"Difficulty\"|label=\"Ship\"/, "Home does not inline setup choices");
  assert.doesNotMatch(home, /renderShip\(ship/, "Home does not inline ship art");
  assert.ok(home.includes("detail=\"Choose difficulty and ship after selecting a mode\""), "Home points to later setup");
  assert.ok(home.includes("label=\"Ships\""), "the Ships destination remains on the command deck");
  assert.ok(home.includes("onClick={() => go(\"ships\")}"), "Ships remains reachable");

  // The mode list is still not a place to think about hulls. It is one screen
  // now, so there is one to check.
  assert.doesNotMatch(screen("GameTypeScreen", "LobbyShipPicker"), /ship={|go\("ships"\)/,
    "the mode list must not ask about ships");
});

test("every launch summary row is itself the button, and says nothing about it", () => {
  // No standing CHANGE control sits beside a card that already looks pressable
  // — and no visible CHANGE label inside one either. A row per setting, each
  // captioned "CHANGE", made the screen read as a form to fill in before
  // playing rather than a summary of what is about to happen; that is exactly
  // how a player described it. The row is still the button, and still says so
  // to a screen reader through its aria-label.
  const ui = readFileSync(new URL("../app/ui-system.tsx", import.meta.url), "utf8");
  const at = ui.indexOf("export function SummaryRow");
  const row = ui.slice(at, at + 2000);
  assert.ok(row.includes("className=\"summary-row\""), "the row itself is the button");
  assert.ok(!row.includes("className=\"summary-cue\""), "and paints no CHANGE caption");
  assert.ok(row.includes("aria-label={`${label}: ${value}. ${actionLabel}.`}"), "but still announces itself");
  assert.ok(!row.includes("className=\"summary-action\""), "the standalone action button is gone");
  assert.ok(!css.includes(".summary-action {"), "and so is its styling");
  assert.ok(css.includes("button.summary-row {"), "styled as a button");
});

/**
 * A session opens on Solo PvE, whatever was played last.
 *
 * Every other preference is remembered because a returning pilot wants what
 * they had. The mode is the exception: remembering it meant someone who tried a
 * duel once opened the game days later already committed to a mode they had to
 * notice and undo before they could just fly. Solo PvE is the one mode the game
 * can always deliver — no lobby, no second player, no waiting.
 */
test("the game mode does not survive a reload", () => {
  // Sliced rather than matched across newlines: the file is CRLF, and a
  // literal spanning line breaks is brittle for no benefit.
  const modeAt = game.indexOf("const modePreference = createPreference");
  assert.ok(modeAt > 0, "the mode preference is still here");
  const modePref = game.slice(modeAt, modeAt + 220);
  assert.ok(modePref.includes('"pve",'), "it falls back to Solo PvE");
  assert.ok(modePref.includes("false"), "and opts out of persistence");

  // The opt-out is real on both sides: nothing is read back, nothing is written.
  assert.ok(game.includes("if (!persist) return (cached = fallback);"), "a fresh session ignores storage");
  assert.ok(game.includes("if (persist) {"), "and never writes the mode back");

  // Everything else still persists, so this is a deliberate exception rather
  // than preferences quietly becoming session-only across the board.
  const shipAt = game.indexOf("const shipPreference = createPreference");
  const shipPref = game.slice(shipAt, shipAt + 220);
  assert.ok(!shipPref.includes("false"), "the ship is still remembered");
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

/**
 * Every mode is on one screen.
 *
 * Choosing used to take two taps: a PvP-or-PvE fork, then a list inside the
 * branch. The first tap asked something nobody is thinking in — you sit down
 * wanting Rift Run, or a duel, not "PvE" — and Home had already shown the mode,
 * so pressing it opened a screen asking a broader question than the one being
 * answered. One list answers it in one tap.
 */
test("one screen offers every mode, in one tap", () => {
  const root = screen("GameTypeScreen", "LobbyShipPicker");

  // Identified by the modes it offers rather than the copy it renders, since
  // the labels come from MODE_INFO.
  for (const mode of ["pve", "rift-run", "survival", "coop", "pvp", "team"]) {
    assert.match(root, new RegExp(`id: "${mode}"`), `the mode catalog must define ${mode}`);
  }
  assert.match(root, /MODE_INFO\.pve\.label/);
  assert.match(root, /MODE_INFO\.coop\.label/);
  assert.match(root, /RIFT_RUN_TITLE/);
  assert.equal((root.match(/className=\{`mode-launch-card/g) ?? []).length, 1, "the six cards are rendered by one structured catalog");
  assert.ok(!root.includes('data-mode="classic"'), "Classic is parked, not offered");

  // The fork screens are gone, not merely bypassed.
  assert.ok(!menu.includes("export function PvpModesScreen"), "no PvP branch screen");
  assert.ok(!menu.includes("export function PveModesScreen"), "no PvE branch screen");
  assert.ok(!game.includes("PvpModesScreen"), "and nothing renders them");
  assert.ok(!game.includes("PveModesScreen"));
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
