/**
 * Getting a browser test into a live run.
 *
 * These helpers exist because the menu has broken the browser suite twice now,
 * both times without CI noticing. The first time a difficulty label was renamed
 * (EASY became STABLE) and every test that clicked it stopped working; the
 * second time a menu refresh deleted `.summary-action` and `.option-choices`
 * outright, and the whole browser step sat behind an already-failing unit step
 * so nobody saw it.
 *
 * The lesson both times is the same: **a test that clicks through the menu to
 * reach the game is testing the menu.** Almost none of these tests are about
 * the menu — they want a run at a known difficulty in a known ship so they can
 * measure the arena. So they should not walk through screens that are free to
 * be redesigned.
 *
 * Two of the three preferences a run needs are plain localStorage strings, so
 * they can simply be written before the page loads. That reduces setup to one
 * click on one control that exists precisely to be clicked by automation.
 *
 * ## What still has to navigate
 *
 * The game **mode** deliberately does not persist — see `modePreference` — so a
 * PvP or co-op test cannot seed it and must open the mode screen. Those tests
 * use `openModeScreen` and are the only ones that should know a menu route
 * exists at all.
 */

/**
 * The launch control on Home.
 *
 * A `data-` hook rather than a style class, because that is the difference
 * between a selector a redesign is allowed to break and one it is not. Home's
 * Play launches whatever Home is already showing, so with the preferences
 * seeded this is the entire launch flow.
 */
/**
 * Keep the dev server's error overlay from swallowing clicks.
 *
 * These tests run against `npm run dev`, and vinext paints a full-screen
 * backdrop over the page when it wants to report something. It sits above
 * everything and intercepts pointer events, so a click on a button that is
 * visible, enabled and stable simply never lands -- Playwright retries for
 * thirty seconds and then reports a timeout on a perfectly healthy control,
 * which is a long way from the real cause.
 *
 * Hiding it conceals nothing: every one of these tests collects page errors
 * and console errors separately and asserts they are empty, so a genuine
 * failure still fails. This only stops a development affordance from
 * standing between the test and the game.
 *
 * Injected as a stylesheet at document start so it applies to an overlay
 * that appears at any later point.
 */
export async function hideDevErrorOverlay(page) {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent =
      "#__vinext_dev_error_overlay_root,[data-testid='vinext-dev-error-backdrop'],vite-error-overlay" +
      "{display:none!important;pointer-events:none!important;}";
    const attach = () => document.head?.appendChild(style);
    if (document.head) attach();
    else document.addEventListener("DOMContentLoaded", attach, { once: true });
  });
}

/**

/** Home's mode summary row, which opens the mode screen. */
/**
 * The launch control on Home.
 *
 * A `data-` hook rather than a style class, because that is the difference
 * between a selector a redesign is allowed to break and one it is not. Home's
 * Play launches whatever Home is already showing, so with the preferences
 * seeded this is the entire launch flow.
 */
export const LAUNCH_CONTROL = '[data-launch-control="play"]';

export const MODE_ROW = ".summary-row";

export const HOME_ROUTE = ".menu-screen[data-route='home']";

/**
 * localStorage keys the game reads its remembered run from.
 *
 * Kept here beside the helpers that write them so the pairing is visible; they
 * are the real keys from `createPreference` calls in `app/game.tsx`.
 */
export const DIFFICULTY_KEY = "wormhole-arcade:difficulty";
export const SHIP_KEY = "wormhole-arcade:ship";
export const SETTINGS_KEY = "wormhole-arcade:settings:v1";

/**
 * Seed the run a page will open on, before any of its scripts run.
 *
 * `controlProfile` defaults to **twin-stick**, which is deliberately not the
 * game's own default. Classic is, and under Classic the arrow keys *turn* the
 * hull rather than flying it in a screen direction — so a test that presses
 * ArrowRight to reach the right-hand wall would spin on the spot instead.
 * These tests measure the arena, not the control scheme, so they fly with the
 * scheme that maps keys to directions. Classic's own steering is covered in
 * `flight-controls.test.mjs`, where it can be checked without a browser.
 *
 * `difficulty` accepts every ruleset id, `"survival"` included — Rift Survival
 * is a difficulty rather than a mode, so a Survival test seeds it here instead
 * of clicking a card.
 *
 * Call before `page.goto`.
 */
export async function seedRun(page, { difficulty, ship, controlProfile = "twinStick" } = {}) {
  await hideDevErrorOverlay(page);
  await page.addInitScript(
    ({ difficulty: chosen, ship: hull, profile, difficultyKey, shipKey, settingsKey }) => {
      try {
        if (chosen) localStorage.setItem(difficultyKey, chosen);
        if (hull) localStorage.setItem(shipKey, hull);
        if (profile) {
          // Merged into whatever settings the calling test already wrote,
          // rather than replacing them: several tests seed a whole settings
          // object of their own and would lose it.
          let settings = {};
          try { settings = JSON.parse(localStorage.getItem(settingsKey) || "{}") ?? {}; } catch { settings = {}; }
          localStorage.setItem(settingsKey, JSON.stringify({ ...settings, version: 1, controlProfile: profile }));
        }
      } catch {
        // A browser with storage blocked still runs the game on defaults.
      }
    },
    { difficulty, ship, profile: controlProfile, difficultyKey: DIFFICULTY_KEY, shipKey: SHIP_KEY, settingsKey: SETTINGS_KEY },
  );
}

/**
 * Launch the seeded run from Home.
 *
 * Waits for Home first so a slow first paint fails as "Home never arrived"
 * rather than as a missing button, which is a much longer thing to debug.
 */
export async function launchSeededRun(page, { timeout = 20_000, settle = 900 } = {}) {
  await page.waitForSelector(HOME_ROUTE, { timeout });
  await page.locator(LAUNCH_CONTROL).click();
  await page.waitForTimeout(settle);
}

/**
 * Open the mode screen from Home. Only for tests that genuinely need a mode
 * the game will not remember across a reload.
 */
export async function openModeScreen(page, { timeout = 15_000 } = {}) {
  await page.waitForSelector(HOME_ROUTE, { timeout });
  await page.locator(MODE_ROW).first().click();
  await page.waitForSelector(".menu-screen[data-route='modes']", { timeout });
}
