from pathlib import Path

GAME = Path("app/game.tsx")
TEST = Path("tests/rift-run.test.mjs")

source = GAME.read_text(encoding="utf-8")
needle = '''            } else if (game.rivalHealth <= 0) {
              game.rivalHealth = 0;
              game.victorySequence = ticksForSeconds(VICTORY_TOTAL_SECONDS);'''
replacement = '''            } else if (game.rivalHealth <= 0 && riftRunRef.current) {
              const run = riftRunRef.current;
              if (game.riftReformTicks <= 0) {
                const breached = breachRiftRun(run, {
                  integrity: game.rivalHealth,
                  maximumIntegrity: game.rivalMaxHealth,
                  reformRemainingMs: 0,
                  breached: false,
                });
                const scoreDelta = breached.state.score - run.score;
                riftRunRef.current = breached.state;
                setRiftRun(breached.state);
                game.score += scoreDelta;
                game.rivalHealth = breached.runtime.integrity;
                game.rivalMaxHealth = breached.runtime.maximumIntegrity;
                game.riftReformTicks = Math.ceil(breached.runtime.reformRemainingMs / TICK_MS);
                game.notice = `RIFT BREACHED // DEPTH ${breached.state.riftBreaches}`;
                game.noticeLife = game.riftReformTicks;
                if (breached.state.pendingLevels > 0 || breached.state.hardpoints.some(point => point.status === "available")) game.paused = true;
                burst(game, game.portalX, game.portalY, "#ffffff", 40, 10);
                playCue("wormhole-explosion", .18);
              }
            } else if (game.rivalHealth <= 0) {
              game.rivalHealth = 0;
              game.victorySequence = ticksForSeconds(VICTORY_TOTAL_SECONDS);'''

count = source.count(needle)
if count != 1:
    raise RuntimeError(f"expected exactly one standard PvE victory branch, found {count}")
GAME.write_text(source.replace(needle, replacement, 1), encoding="utf-8")

tests = TEST.read_text(encoding="utf-8")
marker = 'test("Rift Run payload destruction breaches instead of starting PvE victory"'
if marker not in tests:
    tests = tests.rstrip() + '''\n\ntest("Rift Run payload destruction breaches instead of starting PvE victory", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/game.tsx", import.meta.url), "utf8"));
  const riftRunBranch = source.indexOf("else if (game.rivalHealth <= 0 && riftRunRef.current)");
  const standardVictory = source.indexOf("game.victorySequence = ticksForSeconds(VICTORY_TOTAL_SECONDS)", riftRunBranch);
  assert.ok(riftRunBranch >= 0, "Rift Run must intercept zero integrity in the payload path");
  assert.ok(standardVictory > riftRunBranch, "standard PvE victory must remain after the Rift Run continuation branch");
  assert.match(source.slice(riftRunBranch, standardVictory), /breachRiftRun\\(run/);
});\n'''
    TEST.write_text(tests, encoding="utf-8")
