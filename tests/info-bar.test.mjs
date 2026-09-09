/**
 * What the top rail is allowed to say.
 *
 * It had grown to eleven readouts in Rift Run and eight in the arcade modes,
 * and on a 412px phone that wrapped to three lines — about 110px of a 915px
 * screen, before the hull bar, the rival bar and the payload row underneath
 * it. Measured in a browser: the same rail is 41px now.
 *
 * The rule these tests encode is a single question. **Can a pilot use this
 * number while being shot at?** A fact they chose on the way in cannot. A fact
 * already drawn somewhere better cannot. A fact that is true almost always
 * cannot. What survives is the score, how far along the run is, and the two
 * states worth interrupting for.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/** The rail's markup, both branches of it. */
const rail = game.slice(game.indexOf("function DifficultyBadge"), game.indexOf("function DifficultyBadge") + 12000);

test("the rail no longer prints CONTACT twice at once", () => {
  // A `rule-contact` span and a catch-all `rule-context` span both resolved to
  // "CONTACT SAFE", so the badge said it twice on a quiet run. Verified live
  // before the fix: "...CONTACT SAFECONTACT SAFE".
  assert.doesNotMatch(rail, /rule-context">\{context\}/, "the catch-all span is gone");
  assert.doesNotMatch(rail, /CONTACT \{contact\}/, "and contact is no longer a standing readout");
});

test("the states worth interrupting for are drawn only while true", () => {
  assert.match(rail, /\{live && hud\.contactActive \? <span className="rule-contact warn">HAZARD<\/span> : null\}/);
  assert.match(rail, /\{live && hud\.enrageActive \? <span className="rule-enraged warn">ENRAGED<\/span> : null\}/);
});

test("what the pilot chose on the way in is off the rail", () => {
  // Mode and difficulty are a decision already made, and the stage name is
  // flavour on top of a level number that is already there.
  assert.doesNotMatch(rail, /rule-mode">\{gameMode\}/, "mode · difficulty is gone");
  assert.doesNotMatch(rail, /LEVEL \{riftLevel\} · \{riftStage\}/, "the stage name is gone");
});

test("what is already drawn better is off the rail", () => {
  // The shield is the second fill on the hull bar; the rift's charge is its
  // own ring; pressure moved to the anti-camp ring in an earlier change.
  assert.doesNotMatch(rail, /rule-shield/, "the shield percentage is on the hull bar");
  assert.doesNotMatch(rail, /rule-rift">RIFT \{wormhole\}/, "the rift's state is on the rift");
  assert.doesNotMatch(rail, /PRESSURE \{hud\.riftPressure\}/);
});

test("the score keeps its slot and loses its label", () => {
  // Six padded digits in the score colour are not mistakable for anything
  // else, and the word cost as much room as two of the digits.
  assert.match(rail, /className="rule-score">\{hud\.score\.toLocaleString\(\)\.padStart\(6, "0"\)\}/);
  assert.doesNotMatch(rail, /rule-score">SCORE/);
});

/**
 * Time is kept only where it is the thing being ranked.
 *
 * Survival is scored on how long the pilot lasted, so its clock is its score.
 * Everywhere else it was a number nobody was playing for.
 */
test("the clock survives only in the mode that is scored on it", () => {
  assert.match(rail, /hud\.difficulty === "survival"\s*\n?\s*\? <span className="rule-time">\{formatRunTime\(hud\.elapsedSeconds\)\}<\/span>/);
});

/* ------------------------------------------------------------ the xp bar */

test("Rift Run's energy is a bar, not a fraction to divide", () => {
  // "ENERGY 12/28" is a number a pilot has to read and then divide, mid-fight,
  // to learn one thing: how close the next level is.
  assert.doesNotMatch(rail, /ENERGY \{Math\.floor\(riftRun\.riftEnergy\)\}/, "the text fraction is gone");
  assert.match(rail, /className="rule-xp"/);
  assert.match(rail, /riftRun\.riftEnergy \/ Math\.max\(1, riftEnergyRequiredForLevel\(riftRun\.level\)\)/);
  // Clamped, because a level's worth of energy can be banked past its own
  // threshold between the tick that earns it and the tick that spends it.
  assert.match(rail, /Math\.min\(100, Math\.round\(/);
});

test("the level number stays beside the bar", () => {
  // A bar answers "how close", which is a proportion. It cannot say "4".
  assert.match(rail, /<b>LV \{riftRun\.level\}<\/b>/);
  assert.match(css, /\.difficulty-badge \.rule-xp \{[^}]*display: inline-flex/);
  assert.match(css, /\.difficulty-badge \.rule-xp em \{[^}]*height: 100%/);
});

test("Rift Run's rail is down to what a pilot glances at", () => {
  const riftRail = rail.slice(rail.indexOf("rift-run-badge"), rail.indexOf("rift-run-badge") + 3000);
  for (const gone of ["PAYLOADS {hud.riftPupBudget}", "HARDPOINTS {active}", "SPECIAL {specialLabel}", "rule-rift-stage"]) {
    assert.ok(!riftRail.includes(gone), `${gone} should have left the rail`);
  }
  // What is left: score, depth, the level bar, and the lives inventory.
  assert.match(riftRail, /DEPTH \{riftRun\.riftBreaches\}/);
  assert.match(riftRail, /rule-rift-lives/);
});

/**
 * Nothing removed from sight is removed from the record.
 *
 * Every readout the rail dropped is still in its accessible label, which is
 * where a reader who cannot see a bar or a ring has to get it.
 */
test("the spoken label still carries everything the rail dropped", () => {
  assert.match(rail, /Special \$\{specialLabel\}/);
  assert.match(rail, /Skill tree ability \$\{spokenTree\}/);
  assert.match(rail, /\$\{Math\.floor\(riftRun\.riftEnergy\)\} of \$\{riftEnergyRequiredForLevel\(riftRun\.level\)\} energy/);
  assert.match(rail, /Rift pressure \$\{hud\.riftPressure\} percent/);
  assert.match(rail, /payloads left in this rift/);
  // …and the arcade rail's own label keeps the rules it stopped showing.
  assert.match(rail, /RIFT \$\{wormhole\} \| \$\{shieldText\} \| CONTACT \$\{contact\}/);
});

test("the spoken label does not repeat itself either", () => {
  // The first attempt at keeping the dropped readouts appended CONTACT a
  // second time, reproducing the original bug in the label.
  assert.match(rail, /const spokenContext = recharge > 0 \? ` \| SHIELD RECHARGING/);
  assert.match(rail, /: "";/);
});
