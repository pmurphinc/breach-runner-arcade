/**
 * Classic Wormhole's mode plumbing and ruleset.
 *
 * The mode is a peer of PvE, co-op and PvP rather than a difficulty, because it
 * pins its own physics instead of scaling an existing ruleset. These hold that
 * distinction — and, more importantly, hold Classic apart from Easy, which it
 * would be very easy to quietly re-alias during a future balance pass.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CLASSIC_RULES, DIFFICULTIES, PVP_RULES, isOfflineMode, rulesFor } from "../app/difficulty.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const menu = readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");

test("classic is a mode, not a difficulty", () => {
  for (const difficulty of ["easy", "difficult", "hard", "practice", "survival"]) {
    assert.equal(rulesFor("classic", difficulty), CLASSIC_RULES, "the difficulty selector cannot move Classic");
  }
});

test("the mode id is stable in code, saves and payloads", () => {
  // The player-facing string is one label in MODE_INFO and can change without a
  // migration; the id must not. The engine still accepts it everywhere even
  // though the menu no longer offers it -- see the shelving test below.
  assert.ok(game.includes("[\"pve\", \"coop\", \"team\", \"pvp\", \"classic\"]"), "the remembered mode accepts it");
  assert.ok(menu.includes("export const ALL_MODE_IDS: GameMode[] = [\"pve\", \"coop\", \"pvp\", \"team\", \"classic\"];"));
  assert.ok(menu.includes("label: \"Classic Wormhole\""));
});

/**
 * Classic Wormhole is shelved, not deleted.
 *
 * It was built to imitate the original's 1v1 and there is no opponent for it:
 * the versus version needed a shared arena, and that was rejected. A mode that
 * cannot deliver its own premise does not belong on the menu. Everything it
 * produced stays -- square arenas, the orbiting portal model, the reference
 * drop table and the compact HUD are all load-bearing in other modes now, so
 * deleting the mode would break things that have nothing to do with Classic.
 *
 * These assertions are what make "shelved" different from "half-removed":
 * unreachable from the menu, fully intact underneath.
 */
test("Classic is off the menu but intact underneath", () => {
  // 2v2 joined the menu after Classic left it; what matters here is that
  // Classic is absent, not the exact length of the list.
  assert.ok(menu.includes("export const MODE_ORDER: GameMode[] = [\"pve\", \"coop\", \"pvp\", \"team\"];"), "not offered");
  assert.ok(!menu.match(/MODE_ORDER: GameMode[] = [[^]]*"classic"/), "and Classic specifically is not in it");
  const pveScreen = menu.slice(menu.indexOf("export function PveModesScreen"), menu.indexOf("Roster selection inside a lobby"));
  assert.ok(pveScreen.includes("Classic Wormhole is shelved -- see MODE_ORDER"), "the card is commented out, with the reason");
  assert.ok(pveScreen.indexOf("{/* Classic Wormhole is shelved") < pveScreen.indexOf("data-mode=\"classic\""), "the card sits inside that comment, not beside it");
  // Still reachable in code: the ruleset, the drop table and the ships all
  // answer for "classic" exactly as before.
  assert.equal(rulesFor("classic", "easy"), CLASSIC_RULES);
  assert.ok(menu.includes("label: \"Classic Wormhole\""), "the label survives for when it returns");
});

test("Classic keeps none of the modern safety systems", () => {
  assert.equal(CLASSIC_RULES.collisionShield.enabled, false);
  assert.equal(CLASSIC_RULES.contactHazard.enabled, false);
  assert.equal(CLASSIC_RULES.wormholeEnrage.enabled, false);
  assert.equal(CLASSIC_RULES.unlimitedHull, false, "Classic is not a practice mode");
});

test("the rift orbits at the reference rate", () => {
  assert.equal(CLASSIC_RULES.wormhole.kind, "orbit");
  assert.equal(CLASSIC_RULES.wormhole.degreesPerTick, 0.5);
});

test("walls rebound at the reference coefficient and cost nothing", () => {
  assert.equal(CLASSIC_RULES.wall.bounce, -0.5);
  assert.equal(CLASSIC_RULES.wall.damage, 0, "a wall costs speed in Classic, not hull");
  // Every other ruleset keeps what Breach Runner has always done.
  for (const id of ["practice", "easy", "difficult", "hard", "survival"]) {
    assert.equal(DIFFICULTIES[id].wall.bounce, -0.55);
    assert.equal(DIFFICULTIES[id].wall.damage, 2);
  }
});

test("wall behaviour is read from the rules, not hardcoded in the loop", () => {
  assert.match(game, /player\.vx \*= game\.rules\.wall\.bounce/);
  assert.match(game, /player\.vy \*= game\.rules\.wall\.bounce/);
  assert.doesNotMatch(game, /player\.v[xy] \*= -0\.55/, "the old constant must be gone");
  // A zero-damage wall must not report a hit at all, or Classic would log
  // collisions the pilot never took.
  assert.match(game, /if \(game\.rules\.wall\.damage > 0\) damageCollision\(game, game\.rules\.wall\.damage, "wall"\)/);
});

test("Classic is its own object, so retuning Easy cannot move it", () => {
  assert.notEqual(CLASSIC_RULES, DIFFICULTIES.easy);
  assert.notEqual(CLASSIC_RULES, PVP_RULES);
  // Easy locks its rift and shields the pilot; Classic does neither. If these
  // ever agree, someone has re-aliased Classic.
  assert.notEqual(CLASSIC_RULES.wormhole.kind, DIFFICULTIES.easy.wormhole.kind);
  assert.notEqual(CLASSIC_RULES.collisionShield.enabled, DIFFICULTIES.easy.collisionShield.enabled);
});

test("solo Classic launches straight, skipping the difficulty screen", () => {
  // There is nothing for that screen to choose: Classic pins its own rules.
  assert.match(game, /if \(next === "classic"\) start\(undefined, "classic"\)/);
  assert.match(menu, /data-mode="classic"/);
  assert.match(menu, /onMode: \(mode: "pve" \| "coop" \| "classic"\) => void/);
});

test("kills are counted where hostiles actually die", () => {
  // Classic ranks by kills, not points. Counted in every mode because it costs
  // nothing; only the Classic rail displays it.
  assert.match(game, /const destroyEnemy = \(game: Game, enemy: Enemy, guaranteedDrop = false\) => \{\s*\n\s*enemy\.hp = 0;\s*\n\s*game\.kills \+= 1;/);
  assert.match(game, /kills: game\.kills,/);
  assert.match(game, /kills: 0,/, "a fresh run starts at zero");
});

test("the Classic rail reports kills and banked upgrades, not difficulty tiers", () => {
  // Difficulty tiers, the collision shield and the contact hazard are systems
  // Classic does not have; showing them would describe things the pilot cannot
  // use.
  assert.match(game, /activeMode === "classic"\s*\n\s*\? `CLASSIC \| KILLS/);
  assert.match(game, /GUN ×\$\{hud\.gun\}/);
  assert.match(game, /THRUST ×\$\{hud\.thrust\}/);
  assert.match(game, /hud\.retros > 0 \? "RETROS" : null/);
  // The other modes keep the rail they had.
  assert.match(game, /\| RIFT LEVEL \$\{riftLevel\}/);
});

test("self-destruct is Classic-only and lands on a tick", () => {
  assert.match(game, /"KeyK"/);
  assert.match(game, /live\.mode === "classic" && live\.running && !live\.result\) live\.selfDestruct = true/);
  // A flag rather than a hull write: the key handler is outside the simulation,
  // and an instant-death key has no business in a scored run.
  assert.match(game, /if \(game\.selfDestruct\) \{\s*\n\s*game\.selfDestruct = false;/);
  assert.match(game, /damagePlayer\(game, game\.player\.health, "self_destruct"\)/);
  assert.match(game, /selfDestruct: false,/);
});

test("solo Classic is offline: no socket, no server hull, and it pauses", () => {
  // Adding a fourth GameMode meant every `mode === "pve"` check silently
  // excluded Classic. At the network seams that made solo Classic dial a
  // WebSocket it cannot use, accept a server-owned hull that does not exist,
  // and refuse to pause because the menu believed a match was still running.
  assert.equal(isOfflineMode("pve"), true);
  assert.equal(isOfflineMode("classic"), true);
  assert.equal(isOfflineMode("coop"), false);
  assert.equal(isOfflineMode("pvp"), false);
  assert.match(game, /if \(isOfflineMode\(mode\)\) \{/, "the socket is never opened");
  assert.match(game, /if \(isOfflineMode\(game\.mode\) \|\| serverHull === null\) return;/);
  assert.match(game, /pausable=\{isOfflineMode\(hud\.mode\)\}/);
  assert.match(game, /if \(isOfflineMode\(mode\)\) \{ start\(\); return; \}/, "it launches straight, not via the lobby");
  // Scoring stays strictly PvE: Classic has its own balance and does not
  // belong on the PvE board.
  assert.match(game, /mode === "pve" && saveState\.status === "saving"/);
});

test("Classic earns its retros instead of starting with them", () => {
  // The reference ships retros as a power-up. Starting with reverse thrust both
  // skipped a reward and made the upgrade strip claim RETROS from tick zero.
  assert.match(game, /retros: mode === "classic" \? 0 : ship\.thrust > 0 \? 1 : 0,/);
});

test("Classic's visible rail matches its accessible label", () => {
  // The rail renders its own spans; editing only the aria string left the
  // visible readout still advertising a difficulty tier, a collision shield and
  // a contact hazard that Classic does not have.
  assert.match(game, /\{activeMode === "classic" \? \(/);
  assert.match(game, /<span className="rule-mode">CLASSIC<\/span>/);
  assert.match(game, /<span className="rule-rift-level">KILLS \{live \? hud\.kills : 0\}<\/span>/);
  assert.match(game, /\{upgrades \? <span className="rule-context">\{upgrades\}<\/span> : null\}/);
});
