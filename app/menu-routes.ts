/**
 * The menu's navigation model, as a plain stack.
 *
 * Every pre-game and in-game surface used to be its own boolean on the shell
 * — `stage`, `menuOpen`, `codexOpen`, `boardOpen`, `lobbyOpen` — which meant
 * two of them could be true at once and nothing decided which won. A stack
 * cannot express that: one route is on top, Back is `pop`, and closing the
 * menu is emptying the stack.
 *
 * Pure on purpose: the whole navigation model is testable without React or a
 * browser, which is where the old "which screen is actually showing?" bugs
 * lived.
 */

/** Every menu surface. Gameplay is the absence of a route, not a route. */
export type MenuRoute =
  | "home"
  | "play"
  | "ships"
  | "modes"
  | "pvp-modes"
  | "pve-modes"
  | "difficulty"
  | "rift-run"
  | "settings"
  | "info"
  | "leaderboard"
  | "lobby"
  | "pause";

export const MENU_ROUTES: readonly MenuRoute[] = [
  "home",
  "play",
  "ships",
  "modes",
  "pvp-modes",
  "pve-modes",
  "difficulty",
  "rift-run",
  "settings",
  "info",
  "leaderboard",
  "lobby",
  "pause",
];

/**
 * Human-readable titles. One place, so the same surface is never called two
 * different things in two different screens.
 */
export const ROUTE_TITLES: Record<MenuRoute, string> = {
  home: "Breach Runner",
  play: "Launch",
  ships: "Ships",
  modes: "Game Modes",
  "pvp-modes": "PvP",
  "pve-modes": "PvE Modes",
  difficulty: "Difficulty",
  "rift-run": "Rift Run",
  settings: "Settings",
  info: "Game Info",
  leaderboard: "Leaderboard",
  lobby: "Multiplayer",
  pause: "Paused",
};

/**
 * A stack of open routes. Empty means the player is in the game with no menu
 * over it. The last entry is what renders.
 */
export type MenuStack = readonly MenuRoute[];

export const CLOSED: MenuStack = [];

/** Where a fresh browser session begins: the main menu. */
export const INITIAL_STACK: MenuStack = ["ships"];

export function isMenuRoute(value: unknown): value is MenuRoute {
  return typeof value === "string" && (MENU_ROUTES as readonly string[]).includes(value);
}

/** What is actually on screen, or null when the game is unobstructed. */
export function activeRoute(stack: MenuStack): MenuRoute | null {
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

export function isOpen(stack: MenuStack): boolean {
  return stack.length > 0;
}

/**
 * Push a route.
 *
 * Re-entering the route already on top is a no-op rather than a second copy,
 * so a double-tap on a menu item cannot build a stack the player has to
 * unwind twice.
 */
export function push(stack: MenuStack, route: MenuRoute): MenuStack {
  if (activeRoute(stack) === route) return stack;
  return [...stack, route];
}

/** Back. Popping the last entry closes the menu. */
export function pop(stack: MenuStack): MenuStack {
  return stack.slice(0, -1);
}

/** Close everything and return to the game. */
export function close(): MenuStack {
  return CLOSED;
}

/**
 * Replace the whole stack with a single route.
 *
 * Used when a screen is a destination rather than a step — choosing "Main
 * Menu" from the pause screen should not leave Pause underneath it.
 */
export function reset(route: MenuRoute): MenuStack {
  return [route];
}

/**
 * What the Menu button does, given whether a run is in progress.
 *
 * One rule, so the button means the same thing on every screen.
 *
 * The `running` check comes first, and that ordering is the point: with no run
 * there is nothing to close *to*. Closing the menu used to drop the player
 * into an inert cockpit with no game in it and no obvious way back, so Home is
 * the root state whenever no run exists — pressing Menu from any other screen
 * returns there, and pressing it on Home is a no-op rather than an exit.
 *
 * During a run the button is a straight toggle: open Pause, or close back into
 * the game.
 */
export function menuButtonTarget(stack: MenuStack, running: boolean): MenuStack {
  if (!running) return reset("home");
  return isOpen(stack) ? CLOSED : reset("pause");
}

/**
 * True when the route's own Back should read as "Resume" rather than "Back".
 * Pause is the only route reached from gameplay directly.
 */
export function isPauseRoot(stack: MenuStack): boolean {
  return stack.length === 1 && stack[0] === "pause";
}
