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
 * Home's command deck.
 *
 * Every one of these used to be reached with `.menu-nav button` filtered by
 * its label. `MenuSectionNav` is not rendered any more -- Home carries these as
 * a footer deck of `MenuActionButton`s -- so that selector matches nothing, and
 * three separate suites sat on a thirty-second timeout waiting for it. Pinned
 * here by the class each button already carries, so the next rearrangement of
 * Home is one edit rather than a hunt.
 */
export const HOME_SHIPS = ".launch-utility-ships";
export const HOME_ARMORY = ".launch-utility-armory";
export const HOME_LEADERBOARD = ".launch-utility-leaderboard";
export const HOME_INFO = ".launch-utility-info";

/**
 * The rules rail, read the way it is published.
 *
 * The visible rail is deliberately sparse: the mode, the difficulty, the rift's
 * state, the shield and the contact readout were all taken off it, because each
 * is already drawn somewhere it means more -- the shield as the second fill on
 * the hull bar, the rift as its own charge ring. What the redesign kept is the
 * promise that *none of it was lost*: every one of those facts is still spoken
 * in the rail's `aria-label`.
 *
 * So these tests read the label. That is not a workaround for a missing
 * readout; it is the readout, and asserting on it is what keeps the accessible
 * description honest as the visible rail keeps changing. Uppercased because the
 * visible rail is uppercased by CSS and the label is written in sentence case,
 * and every expectation in these suites was written against the former.
 */
export const RULES_RAIL = ".difficulty-badge";

export async function railLabel(page) {
  const label = await page.locator(RULES_RAIL).first().getAttribute("aria-label");
  return (label ?? "").replace(/\s+/g, " ").toUpperCase();
}

/** The live score, read from the rail's label rather than a hidden match bar. */
export async function railScore(page) {
  const match = /SCORE (\d[\d,]*)/.exec(await railLabel(page));
  return match ? Number(match[1].replace(/,/g, "")) : NaN;
}

/**
 * The live vitals, read from the rails the pilot can actually see.
 *
 * The wide match bar above the arena and the `.status-dock` beside it are both
 * `display: none` under the modern HUD -- every mode profile sets `modernHud`,
 * so that is every device. The markup is still rendered, which is the trap:
 * `innerText` on an element that is not being rendered falls back to
 * `textContent` per spec, so a test reading the old selectors gets text back
 * and only *looks* like it is reading the HUD. What it gets is the concatenation
 * with no separators between the spans, so `HULL 280/280 SHIELD 100%` arrives as
 * `HULL 280/280SHIELD 100%` and the assertion fails on a space.
 *
 * What is drawn now is two vertical rails flanking the ship: hull and shield on
 * the left, the opponent or the rival on the right. These read them.
 */
export const HEALTH_RAILS = ".health-rails";
export const PILOT_RAIL = ".health-rail.pilot-rail";
export const RIVAL_RAIL = ".health-rail.rival-rail";

/**
 * The opponent rail, in PvP specifically.
 *
 * Both modes draw a right-hand rail; only PvP labels it OPPONENT, because
 * rival integrity is the PvE objective and decides nothing in a match. Matching
 * on the word is therefore how a test waits for *a PvP arena* to go live rather
 * than for any arena at all -- which is what the old `.match-bar .rival.pvp`
 * meant before the bar was hidden.
 */
export const PVP_RIVAL_RAIL = `${RIVAL_RAIL}:has-text("OPPONENT")`;

const collapse = (text) => (text ?? "").replace(/\s+/g, " ").trim().toUpperCase();

/** `HULL 280/280 SHIELD 100% READY` -- the pilot rail's two labels. */
export async function vitals(page) {
  return collapse(await page.locator(PILOT_RAIL).first().innerText());
}

/** `HULL 280/280` on its own, for comparing one sample against another. */
export async function hullReadout(page) {
  return collapse(await page.locator(`${PILOT_RAIL} span`).first().innerText());
}

/** `SHIELD 100% READY` / `SHIELD 62% RECHARGING` / `SHIELD DISABLED`. */
export async function shieldReadout(page) {
  return collapse(await page.locator(`${PILOT_RAIL} small`).first().innerText());
}

/** `OPPONENT 170` in PvP, `RIVAL 120/120` elsewhere. */
export async function rivalReadout(page) {
  return collapse(await page.locator(RIVAL_RAIL).first().innerText());
}

/**
 * The collision shield, which is the shield a match's server actually owns.
 *
 * There are two shields and they are easy to confuse. `hud.shield` is the
 * *power-up* shield -- a timer a pilot picks up off the floor, zero at the
 * start of every run -- and it is what the pilot rail's second line reports.
 * The collision shield is the ruleset's own damage absorber, it starts full,
 * and in a match the server holds it. Only the second one is a server fact, so
 * only the second one belongs in a test about server authority.
 *
 * It has no visible readout: the rail was cut back and the shield became the
 * second fill on the hull bar, which is a bar rather than a number. The spoken
 * label is where it is still stated in words.
 */
export async function collisionShield(page) {
  const match = /\| (SHIELD [^|]*)/.exec(await railLabel(page));
  return (match ? match[1] : "").trim();
}

/**
 * The round id the live arena is running.
 *
 * Published on the play surface rather than on the match bar: the bar is hidden
 * markup, and an attribute is the one thing that still reads correctly off a
 * hidden element, which is exactly the kind of accident that keeps a dead
 * selector alive for another year.
 */
export async function roundId(page) {
  return Number(await page.locator(".play-column").first().getAttribute("data-round-id"));
}

/**
 * Wait until a match is genuinely live.
 *
 * Not something a selector can express. The lobby is a screen drawn *over* the
 * play surface rather than instead of it, so the arena, the rails and the rules
 * badge all exist and are visible from the moment PvP is chosen -- showing the
 * pilot's menu ship at full hull, the opponent as a dash, and the pending rules
 * rather than the match's. A test that waits for a rail therefore does not wait
 * at all, and then reads the lobby's placeholder numbers as though the server
 * had sent them. That is how this suite came to assert a hull the match never
 * had.
 *
 * The round id is the server's own answer: zero until it starts one.
 */
export async function waitForLiveRound(page, { timeout = 30_000 } = {}) {
  await page.waitForFunction(
    () =>
      !document.querySelector(".lobby")
      && Number(document.querySelector(".play-column")?.dataset.roundId ?? 0) > 0,
    null,
    { timeout },
  );
}

/**
 * Where the ship actually is, in world units.
 *
 * Read from the development-only probe the shell installs rather than from the
 * pixels. The suite used to take the centroid of every cyan pixel on the arena
 * canvas, which is the same colour as the hostiles: the ship is a small part of
 * that mass, so a drifting hostile moved the measurement further than the
 * keypress being tested did, and the same input measured anywhere between a
 * clear result and a tenth of one.
 */
export async function pilotAt(page) {
  return page.evaluate(() => window.__breachRunnerPilot?.() ?? null);
}

/** Hold a set of keys for a span and report how far the ship actually moved. */
export async function drivePilot(page, codes, ms) {
  const before = await pilotAt(page);
  for (const code of codes) await page.keyboard.down(code);
  await page.waitForTimeout(ms);
  for (const code of codes) await page.keyboard.up(code);
  const after = await pilotAt(page);
  return { before, after, dx: after.x - before.x, dy: after.y - before.y };
}

/**
 * Open one of the Settings tabs.
 *
 * Settings became a tabbed screen; a control that is not on the active tab is
 * not in the DOM at all. Two suites were clicking straight at a row that only
 * exists once its tab is selected.
 */
export async function openSettingsTab(page, name) {
  await page.getByRole("tab", { name }).click();
  await page.waitForTimeout(200);
}

/**
 * localStorage keys the game reads its remembered run from.
 *
 * Kept here beside the helpers that write them so the pairing is visible; they
 * are the real keys from `createPreference` calls in `app/game.tsx`.
 */
export const DIFFICULTY_KEY = "wormhole-arcade:difficulty";
export const SHIP_KEY = "wormhole-arcade:ship";
export const SETTINGS_KEY = "wormhole-arcade:settings:v1";
export const ACCOUNTS_KEY = "breach-runner:accounts:v1";
export const SESSION_KEY = "breach-runner:session:v1";
export const PROGRESSION_KEY = "breach-runner:pilot-progression";

/**
 * A pilot who has already earned the harder rulesets.
 *
 * Volatile and Critical are gated behind winning the ruleset below them, and
 * `safeDifficulty` quietly rewrites a locked one to Stable at launch. That is
 * correct for a player and invisible to a test: a suite seeding `difficult`
 * got a Stable run, asserted against Stable's rail, and reported the mismatch
 * as "no collision shield" rather than "your difficulty never took". Seeding
 * the progression is the same move as seeding the ship -- put the game in the
 * state the test is about instead of playing three runs to reach it.
 */
export const UNLOCKED_PROGRESSION = { version: 1, completedDifficulties: ["easy", "difficult", "hard"] };

/**
 * The pilot a browser test flies as.
 *
 * Two things now depend on being signed in, and both of them are things these
 * tests take for granted: most modes are locked to everyone but a developer
 * account, and a finished run is only saved against an account. A suite that
 * measures the arena should not have to fill in a sign-up form to reach one,
 * so the session is seeded directly — the same way the difficulty and the
 * ship already are.
 *
 * The developer address is deliberate rather than convenient: it is the
 * mechanism the game itself provides for reaching an unfinished mode, so these
 * tests use the product's own door rather than a test-only back one.
 *
 * The stored credential is never exercised. A session is restored by account
 * id, so seeding one costs no key derivation; signing in with a password would
 * be a hundred and fifty thousand PBKDF2 rounds per test for a screen none of
 * them are testing.
 */
export const TEST_PILOT_EMAIL = "pmurphinc@gmail.com";
export const TEST_PILOT_ID = "browser-test-pilot";

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
export async function seedRun(
  page,
  { difficulty, ship, controlProfile = "twinStick", signedIn = true, progression = UNLOCKED_PROGRESSION } = {},
) {
  await hideDevErrorOverlay(page);
  await page.addInitScript(
    ({
      difficulty: chosen, ship: hull, profile, difficultyKey, shipKey, settingsKey,
      pilot, accountsKey, sessionKey, earned, progressionKey,
    }) => {
      try {
        if (pilot) {
          localStorage.setItem(accountsKey, JSON.stringify([pilot]));
          localStorage.setItem(sessionKey, pilot.id);
        }
        if (earned) localStorage.setItem(progressionKey, JSON.stringify(earned));
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
    {
      difficulty,
      ship,
      profile: controlProfile,
      difficultyKey: DIFFICULTY_KEY,
      shipKey: SHIP_KEY,
      settingsKey: SETTINGS_KEY,
      accountsKey: ACCOUNTS_KEY,
      sessionKey: SESSION_KEY,
      progressionKey: PROGRESSION_KEY,
      earned: progression,
      pilot: signedIn
        ? {
            version: 1,
            id: TEST_PILOT_ID,
            email: TEST_PILOT_EMAIL,
            initials: "",
            createdAt: 0,
            // Never read: the record is restored by id, and the developer flag
            // is re-derived from the email on every read.
            salt: "browser-test-salt",
            hash: "browser-test-hash",
          }
        : null,
    },
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
