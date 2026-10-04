/**
 * Every suite runs somewhere, and no suite is listed where it cannot.
 *
 * This file exists because of a fault that cost two separate repairs without
 * either of them being noticed. Four browser suites — `devices`, `mobile-hud`,
 * `pvp-gameplay` and `menu-responsive` — were in no script that could execute
 * them. Three were listed in `npm test`, which runs *before* Playwright is
 * installed in CI, so each one reported `# skip  playwright is not installed`
 * and the step went green. The fourth was in no list at all. Between them they
 * were holding twenty real failures, including a PvP test that had never once
 * reached its first assertion.
 *
 * A skip is not a pass, and a suite nobody runs is a comment. Two rules are
 * enough to keep that from happening again:
 *
 * 1. Every `tests/*.test.mjs` file is named by a script that can run it.
 * 2. A suite that needs a browser is named only by a browser script — never by
 *    `npm test`, where it could only ever skip.
 *
 * Both are checked against package.json itself, so adding a suite and
 * forgetting to wire it is a failing test rather than silence.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const suites = readdirSync(new URL(".", import.meta.url))
  .filter((name) => name.endsWith(".test.mjs"))
  .map((name) => `tests/${name}`)
  .sort();

/**
 * Suites that cannot run without a browser.
 *
 * Detected rather than listed: a suite needs a browser exactly when it loads
 * Playwright, and reading that out of the source means a new browser suite is
 * classified correctly the moment it is written.
 */
const SELF = "tests/test-wiring.test.mjs";
const needsBrowser = new Set(
  suites.filter((suite) =>
    // This file names the markers it looks for, so it matches itself.
    suite !== SELF
    && /from "playwright"|loadPlaywright|\/playwright\//.test(
      readFileSync(new URL(`../${suite}`, import.meta.url), "utf8")
    )
  )
);

/**
 * The scripts that own suites, and whether a browser is there.
 *
 * Owners only. `test:gameplay`, `test:pvp`, `test:preflight` and
 * `test:menu-responsive` are local shortcuts into subsets of these, so counting
 * them would read every suite they name as wired twice.
 */
const RUNNERS = [
  { script: "test", browser: false },
  { script: "test:browser", browser: true },
  { script: "test:browser:devices", browser: true },
];

const namedBy = (script) => {
  const command = pkg.scripts[script];
  assert.ok(command, `package.json has no "${script}" script`);
  return new Set(command.split(/\s+/).filter((token) => token.startsWith("tests/")));
};

const wiring = RUNNERS.map((runner) => ({ ...runner, suites: namedBy(runner.script) }));

test("every suite is named by a script that can run it", () => {
  const orphans = suites.filter(
    (suite) => !wiring.some((runner) => runner.suites.has(suite))
  );
  assert.deepEqual(
    orphans,
    [],
    "these suites are in no script, so nothing ever runs them: " + orphans.join(", ")
  );
});

test("a browser suite is never listed where there is no browser", () => {
  const misplaced = [];
  for (const runner of wiring) {
    if (runner.browser) continue;
    for (const suite of runner.suites) {
      if (needsBrowser.has(suite)) misplaced.push(`${suite} in "${runner.script}"`);
    }
  }
  assert.deepEqual(
    misplaced,
    [],
    "a browser suite listed in a browserless script can only skip: " + misplaced.join(", ")
  );
});

test("every browser suite is named by a browser script", () => {
  const unrun = [...needsBrowser].filter(
    (suite) => !wiring.some((runner) => runner.browser && runner.suites.has(suite))
  ).sort();
  assert.deepEqual(unrun, [], "browser suites nothing runs: " + unrun.join(", "));
});

test("no suite is run twice", () => {
  const counts = new Map();
  for (const runner of wiring) {
    for (const suite of runner.suites) counts.set(suite, (counts.get(suite) ?? 0) + 1);
  }
  const doubled = [...counts].filter(([, n]) => n > 1).map(([suite]) => suite).sort();
  assert.deepEqual(doubled, [], "listed by more than one runner: " + doubled.join(", "));
});

/**
 * And CI has to invoke all of them.
 *
 * The scripts being right is half the guarantee; the workflow calling every one
 * of them is the other half. `npm test` was the only one of the four that CI
 * ran for most of this project's life.
 */
test("CI runs every script that owns suites", () => {
  const workflow = readFileSync(new URL("../.github/workflows/phase1-ci.yml", import.meta.url), "utf8");
  for (const { script } of RUNNERS) {
    assert.match(
      workflow,
      new RegExp(`npm run ${script.replace(/:/g, ":")}\\b|npm ${script}\\b`),
      `CI never runs "${script}", so the suites it owns do not run either`
    );
  }
});
