/**
 * Phantom's LANCE OVERCHARGE, and what a special is allowed to destroy.
 *
 * A beam that destroys everything it touches is one bad predicate away from
 * destroying the power-ups the whole game is about, or the pilot holding it.
 * So the rules are checked twice over: once as data — which kinds die, which
 * are immune, how long the beam lasts — and once against the loop's source,
 * which is the only way to prove the loop never even *looks* at the pickups
 * and the friendly rounds it must leave alone.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { ENEMY_STATS, SENDABLE_POWERUPS, SHIPS, SHIP_SPECIALS } from "../app/game-data.ts";
import { TICK_MS } from "../app/difficulty.ts";
import { BEAM_LENGTH, pointTouchesBeam } from "../app/beam-motion.ts";
import { playerBeamMuzzle } from "../app/player-beam.ts";
import {
  BEAM_IMMUNE,
  PHANTOM_BEAM_SECONDS,
  beamDestroysHostile,
  blastAnnihilates,
  blastRadiusAt,
  blastSweepReached,
  overchargeFor,
  overchargeTicks,
} from "../app/overcharge.ts";

const game = await readFile(new URL("../app/game.tsx", import.meta.url), "utf8");
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const gameCode = stripComments(game);
const beamTick = gameCode.slice(
  gameCode.indexOf("const tickPlayerBeam"),
  gameCode.indexOf("const updateBlast"),
);

const lance = overchargeFor("squid");
const beam = lance.beam;

/* ------------------------------------------------------------ duration -- */

test("the lance lasts four seconds, from one constant", () => {
  assert.equal(PHANTOM_BEAM_SECONDS, 4);
  assert.equal(beam.seconds, PHANTOM_BEAM_SECONDS);
  assert.equal(overchargeTicks(lance).beam, Math.round(4000 / TICK_MS));

  // Four seconds of simulation ticks, counted the way the loop counts them.
  let ticks = overchargeTicks(lance).beam;
  let elapsed = 0;
  while (ticks > 0) {
    ticks -= 1;
    elapsed += TICK_MS;
  }
  assert.ok(Math.abs(elapsed / 1000 - 4) < 0.05, `beam ran for ${elapsed / 1000}s`);
});

test("the loop burns the beam down a tick at a time and puts it out", () => {
  assert.match(beamTick, /player\.beamTicks -= 1/);
  assert.match(beamTick, /if \(player\.beamTicks <= 0\) \{\s*player\.beam = null/);
  assert.match(gameCode, /player\.beamTicks = timing\.beam/);
  // And the arena sweep at the end of a run puts it out too, since the beam is
  // player state rather than a world object the sweep would clear on its own.
  assert.match(gameCode, /game\.blasts\.length = 0;\s*player\.beam = null;\s*player\.beamTicks = 0;/);
});

test("the special the player presses is the beam, on Phantom alone", () => {
  assert.equal(SHIP_SPECIALS.squid.name, lance.name);
  assert.equal(lance.ship, "squid");
  for (const ship of SHIPS) {
    if (ship.id === "squid") continue;
    assert.ok(!overchargeFor(ship.id)?.beam, `${ship.id} must not have grown a beam`);
  }
  // Fired from the ordinary Q/SPEC path, not a second activation route.
  assert.match(gameCode, /if \(spec\.beam\) \{/);
  assert.match(gameCode, /const overcharge = overchargeFor\(ship\);\s*if \(overcharge\) \{\s*fireOvercharge/);
});

/* -------------------------------------------------------------- aiming -- */

test("the beam fires along the ship's aim and tracks it for the duration", () => {
  // Re-derived from the hull and the current facing every tick, which is what
  // makes it follow the aim rather than being fixed where it was fired.
  assert.match(beamTick, /const angle = player\.angle \* DEG/);
  assert.match(beamTick, /const muzzle = playerBeamMuzzle\(game\.ship\.id, player\)/);
  assert.match(beamTick, /pointTouchesBeam\(muzzle\.x, muzzle\.y, angle, enemy\.x, enemy\.y,/);
  assert.match(beamTick, /pointTouchesBeam\(muzzle\.x, muzzle\.y, angle, bullet\.x, bullet\.y,/);
  assert.doesNotMatch(beamTick, /pointTouchesBeam\(player\.x, player\.y/);
  assert.doesNotMatch(beamTick, /beam\.x|beam\.y|fx\.x/);

  // Straight ahead is hit; behind and off to the side are not.
  const hit = (x, y, angle) => pointTouchesBeam(0, 0, angle, x, y, beam.width, beam.length);
  assert.equal(hit(300, 0, 0), true);
  assert.equal(hit(-300, 0, 0), false, "nothing behind the ship is touched");
  assert.equal(hit(300, beam.width * 4, 0), false, "nor anything well off the line");
  assert.equal(hit(beam.length + 40, 0, 0), false, "and it has a finite reach");
  // Turning the ship turns the beam.
  assert.equal(hit(0, 300, Math.PI / 2), true);
});

test("visual and damage beams share Phantom's canonical muzzle origin", () => {
  const player = { x: 125, y: 240, angle: 0 };
  const muzzle = playerBeamMuzzle("squid", player);
  assert.notDeepEqual(muzzle, { x: player.x, y: player.y });
  assert.ok(muzzle.x > player.x, "zero-degree Phantom muzzle is forward of its center");

  const render = gameCode.slice(gameCode.indexOf("if (player.health > 0 && player.beam && player.beamTicks > 0)"), gameCode.indexOf("if (player.health > 0) {", gameCode.indexOf("if (player.health > 0 && player.beam && player.beamTicks > 0)")));
  assert.match(render, /const muzzle = playerBeamMuzzle\(game\.ship\.id, player\)/);
  assert.match(render, /ctx\.translate\(muzzle\.x, muzzle\.y\)/);
  assert.doesNotMatch(render, /ctx\.translate\(player\.x, player\.y\)/);
  assert.match(render, /ctx\.rotate\(player\.angle \* DEG\)/);
  assert.match(render, /ctx\.lineTo\(beam\.length, 0\)/);
});

test("the beam is readable without covering the arena", () => {
  // The arena is 1504 x 940. A line eleven units either side of the aim reads
  // as a lance; anything approaching the arena's width would be a screen wipe.
  assert.ok(beam.width > 4, "too thin to see or to aim with");
  assert.ok(beam.width < 30, "a beam, not a wall");
  assert.ok(beam.length < BEAM_LENGTH, "shorter than the rift's own sweep beam");
  assert.ok(beam.length > 400, "but long enough to be worth aiming");
  // Drawn with the existing two-pass beam stroke rather than a new renderer.
  assert.match(gameCode, /ctx\.rotate\(player\.angle \* DEG\);[\s\S]{0,400}ctx\.lineTo\(beam\.length, 0\)/);
});

/* ------------------------------------------------------- what it kills -- */

test("every hostile the beam touches is destroyed, except the one that cannot be shot", () => {
  const destroyed = SENDABLE_POWERUPS.filter((kind) => beamDestroysHostile(kind, beam));
  const spared = SENDABLE_POWERUPS.filter((kind) => !beamDestroysHostile(kind, beam));

  // The kinds the brief names by hand, plus everything else hostile.
  for (const kind of ["ufo", "gunship", "inflator", "nuke", "mines", "wallcrawler", "artillery", "turret", "beam", "emp", "heatseeker", "minelayer", "scarab"]) {
    assert.ok(destroyed.includes(kind), `${kind} must die to the beam`);
  }
  // A Phase Shade is unkillable by fire by design, and stays that way.
  assert.deepEqual(spared, ["ghost"]);
  assert.deepEqual([...BEAM_IMMUNE], ["ghost"]);

  // Health is irrelevant: a Rim Crawler carries 150 and a bloom grows without
  // limit, and both die on contact.
  assert.ok(ENEMY_STATS.wallcrawler.hp > 100);
  assert.equal(beamDestroysHostile("wallcrawler", beam), true);
  assert.equal(beamDestroysHostile("inflator", beam), true);
});

test("the kill runs the ordinary death path rather than reaching past it", () => {
  // Enough damage to guarantee it, through `damageEnemy` — so the explosion,
  // the drop, the score and the co-op hooks all happen exactly as they would
  // from a cannon round.
  assert.match(beamTick, /const lethal = Math\.max\(1, enemy\.hp\)/);
  assert.match(beamTick, /damageEnemy\(game, enemy, lethal\)/);
  assert.doesNotMatch(beamTick, /enemy\.hp = 0/);
  assert.doesNotMatch(beamTick, /destroyEnemy\(/);
  // A co-op guest reports the hit instead of applying it, like every other
  // damage source in the loop.
  assert.match(beamTick, /reportEnemyHit\(enemyIdentity\(game, enemy\), lethal, "overcharge"\)/);
});

test("hostile fire is burned out of the air; friendly fire is not", () => {
  assert.equal(beam.clearsHostileFire, true);
  // The bullet loop considers only rounds already flagged as the enemy's.
  assert.match(beamTick, /if \(!bullet\.enemy \|\| bullet\.life <= 0\) continue/);
});

test("power-ups survive the beam", () => {
  // This is the rule that matters most, and the only way to be sure of it is
  // that the loop never looks at the pickups at all. The rift's own SWEEP BEAM
  // does destroy them, so the pattern was there to copy by accident.
  assert.doesNotMatch(beamTick, /pickup/i);
  assert.doesNotMatch(beamTick, /game\.pickups/);
  // For contrast: the hostile beam that does eat power-ups is a different
  // block entirely, and still does.
  assert.match(gameCode, /pointTouchesBeam\(game\.portalX, game\.portalY, enemy\.phase, pickup\.x/);
});

test("the pilot, allies and friendly objects are never candidates", () => {
  // Only hostiles and hostile rounds are iterated. The player, the player's
  // own bullets, the launched power-ups, the spawn nameplates and the arena
  // decoration are not reachable from this function.
  const iterated = beamTick.match(/for \(const \w+ of ([\w.]+)\)/g) ?? [];
  assert.deepEqual(iterated, ["for (const enemy of game.enemies)", "for (const bullet of game.bullets)"]);
  assert.doesNotMatch(beamTick, /damagePlayer|damageCollision|player\.health/);
  assert.doesNotMatch(beamTick, /game\.powers|game\.spawns|game\.particles/);
});

/* ------------------------------------ Talon versus the Plasma Bloom ----- */

test("a Plasma Bloom inside Talon's blast dies, however long it has grown", () => {
  const core = overchargeFor("hunter").blast;
  assert.equal(blastAnnihilates("inflator", core), true);

  // A bloom twenty seconds into its life: health well past the 95 the blast
  // lands at its centre, and a body a hundred units across.
  const grown = { hp: ENEMY_STATS.inflator.hp + 660, radius: ENEMY_STATS.inflator.radius + 115 };
  const dealt = blastAnnihilates("inflator", core)
    ? Math.max(core.damage, grown.hp)
    : core.damage;
  assert.ok(dealt >= grown.hp, "the blast has to actually finish it");

  // The loop applies exactly that, through the normal damage path.
  const blastBody = gameCode.slice(gameCode.indexOf("const updateBlast"), gameCode.indexOf("const updateEnemy"));
  assert.match(blastBody, /blastAnnihilates\(enemy\.kind, blast\)\s*\?\s*Math\.max\(falloff, enemy\.hp\)/);
  assert.match(blastBody, /damageEnemy\(game, enemy, damage, blast\.guaranteedDrops\)/);
  assert.doesNotMatch(blastBody, /enemy\.hp = 0/);
});

test("a Plasma Bloom outside Talon's blast is untouched", () => {
  const core = overchargeFor("hunter").blast;
  const bloomRadius = ENEMY_STATS.inflator.radius;

  // Sweep the whole detonation and see which blooms it ever reaches.
  const reached = (distance) => {
    let previous = 0;
    for (let age = 1; age <= core.expandTicks * 3; age += 1) {
      const radius = blastRadiusAt(age, core);
      if (radius <= previous) continue;
      if (blastSweepReached(distance, bloomRadius, previous, radius)) return true;
      previous = radius;
    }
    return false;
  };

  assert.equal(reached(0), true, "one on top of Talon");
  assert.equal(reached(core.radius - 1), true, "one just inside the rim");
  assert.equal(reached(core.radius + bloomRadius + 60), false, "one clearly outside it");
  // The boundary is the blast's own drawn radius, not a hidden second number.
  assert.equal(reached(core.radius + bloomRadius + 0.5), false);
});

test("the blast reaches what the player watched it engulf, and only once", () => {
  const core = overchargeFor("hunter").blast;
  let previous = 0;
  let hits = 0;
  for (let age = 1; age <= core.expandTicks * 3; age += 1) {
    const radius = blastRadiusAt(age, core);
    if (radius <= previous) continue;
    if (blastSweepReached(core.radius * 0.6, 40, previous, radius)) hits += 1;
    previous = radius;
  }
  assert.equal(hits, 1, "a hostile must be swept exactly once, or it takes the blast twice");
});

test("Talon's reach against everything else is unchanged", () => {
  const core = overchargeFor("hunter").blast;
  // No global buff: the blast's own numbers are untouched by the bloom fix.
  assert.equal(core.radius, 340);
  assert.equal(core.damage, 95);
  assert.equal(core.edgeDamage, 45);
  // And a bloom's own health is not quietly lowered for everyone else.
  assert.equal(ENEMY_STATS.inflator.hp, 30);
  // A bloom still inflates on the same two-tick cadence. What changed is that
  // its drawn size is now derived from health instead of advancing separately,
  // so cannon fire visibly deflates it — see bloomRadiusForHp.
  assert.match(gameCode, /enemy\.kind === "inflator"[\s\S]{0,120}enemy\.hp \+= 1/);
  assert.match(gameCode, /enemy\.radius = bloomRadiusForHp\(enemy\.hp\)/);
  assert.doesNotMatch(gameCode, /enemy\.radius \+= 0\.35/, "size must not advance independently of health again");
});
