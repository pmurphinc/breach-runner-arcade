import fs from "node:fs";

const path = new URL("../app/game.tsx", import.meta.url);
let source = fs.readFileSync(path, "utf8");

function replaceRequired(from, to) {
  if (!source.includes(from)) throw new Error(`Phase 1 cleanup source no longer contains expected text: ${from}`);
  source = source.split(from).join(to);
}

// End-game and combat labels: keep compatibility ids internal, never player-facing.
replaceRequired('wormhole_contact: "WORMHOLE CONTACT",', 'wormhole_contact: "RIFT CONTACT",');
replaceRequired('beam: "BEAM WEAPON",', 'beam: "SWEEP BEAM",');
replaceRequired('nuke_blast: "NUKE BLAST",', 'nuke_blast: "CORE BOMB BLAST",');
replaceRequired('mines_collision: "MINE COLLISION",', 'mines_collision: "VOID MINE COLLISION",');
replaceRequired('heatseeker_collision: "HEAT SEEKER COLLISION",', 'heatseeker_collision: "TRACKER SWARM COLLISION",');
replaceRequired('inflator_collision: "INFLATOR COLLISION",', 'inflator_collision: "PLASMA BLOOM COLLISION",');
replaceRequired('ufo_collision: "UFO COLLISION",', 'ufo_collision: "RAIDER DRONE COLLISION",');
replaceRequired('turret_collision: "TURRET COLLISION",', 'turret_collision: "ORBITAL SENTRY COLLISION",');
replaceRequired('gunship_collision: "GUNSHIP COLLISION",', 'gunship_collision: "ASSAULT FRIGATE COLLISION",');
replaceRequired('scarab_collision: "SCARAB COLLISION",', 'scarab_collision: "SCAVENGER COLLISION",');
replaceRequired('wallcrawler_collision: "WALLCRAWLER COLLISION",', 'wallcrawler_collision: "RIM CRAWLER COLLISION",');
replaceRequired('ghost_collision: "GHOST COLLISION",', 'ghost_collision: "PHASE SHADE COLLISION",');
replaceRequired('artillery_collision: "ARTILLERY COLLISION",', 'artillery_collision: "SIEGE BATTERY COLLISION",');
replaceRequired(
  '  enemy_collision: "HOSTILE COLLISION",',
  '  minelayer_collision: "MINE CARRIER COLLISION",\n  emp_collision: "PULSE SCRAMBLER COLLISION",\n  beam_collision: "SWEEP BEAM COLLISION",\n  nuke_collision: "CORE BOMB COLLISION",\n  enemy_collision: "HOSTILE COLLISION",'
);

// Rift terminology in player-facing guidance and result copy.
replaceRequired('"RIVAL WORMHOLE"', '"RIVAL RIFT"');
replaceRequired('target.includes("WORMHOLE")', 'target.includes("RIFT")');
replaceRequired('AIM AT THE WORMHOLE // PRESS E OR PUP TO SEND', 'AIM AT THE RIFT // PRESS E OR PUP TO SEND');
replaceRequired('SHOOT THE WORMHOLE //', 'SHOOT THE RIFT //');
replaceRequired('Aim at the rival wormhole before firing.', 'Aim at the rival rift before firing.');
replaceRequired('Every power-up the wormhole can produce.', 'Every power-up the rift can produce.');
replaceRequired('| WORMHOLE ${wormhole} |', '| RIFT ${wormhole} |');
replaceRequired('<span>WORMHOLE {wormhole}</span>', '<span>RIFT {wormhole}</span>');
replaceRequired('return "WORMHOLE LOCKED";', 'return "RIFT LOCKED";');
replaceRequired('"Wormhole locked centre"', '"Rift locked centre"');
replaceRequired('"Wormhole moves"', '"Rift moves"');
replaceRequired('"WORMHOLE ENRAGED // MINES · UFO · SCARABS"', '"RIFT ENRAGED // VOID MINES · RAIDER DRONES · SCAVENGERS"');
replaceRequired('"WORMHOLE COLLAPSE // ARENA PURGE"', '"RIFT COLLAPSE // ARENA PURGE"');
replaceRequired('game.notice = "WORMHOLE CONTACT";', 'game.notice = "RIFT CONTACT";');
replaceRequired('ctx.fillText("RIVAL WORMHOLE",', 'ctx.fillText("RIVAL RIFT",');

// Ship special notices must match the commercial fleet identity.
replaceRequired('game.notice = "BULWARK // 3S IMMUNITY";', 'game.notice = "IMPACT GUARD // 3S IMMUNITY";');
replaceRequired('game.notice = "VECTOR OVERDRIVE // 3S";', 'game.notice = "AFTERBURN // 3S";');
replaceRequired('game.notice = "VIPER GUIDANCE // LAUNCH WITHIN 3S";', 'game.notice = "TARGET LINK // LAUNCH WITHIN 3S";');
replaceRequired('game.notice = "TURTLE CANNON";', 'game.notice = "REACTOR BURST";');
replaceRequired('game.notice = `FLASH // ${player.flashMode.toUpperCase()} FORM`;', 'game.notice = `FORM SHIFT // ${player.flashMode === "tank" ? "HEAVY" : "SCOUT"} FORM`;');
replaceRequired('game.notice = "PIRANHA ARRAY";', 'game.notice = "MISSILE FAN";');
replaceRequired('game.notice = "A/R FIELD ACTIVE // 3S";', 'game.notice = "GRAVITY PULSE // 3S";');
replaceRequired('// VIPER LOCK`', '// TARGET LINK`');
replaceRequired('"SCARAB STOLE A POWERUP"', '"SCAVENGER STOLE A POWER-UP"');

// Multiplayer lobby/HUD must map compatibility ids back to commercial display names.
replaceRequired('{net.you?.ship?.toUpperCase() ?? "—"}', '{net.you?.ship ? selectedShip(net.you.ship as ShipId).name.toUpperCase() : "—"}');
replaceRequired('{net.opponent.ship.toUpperCase()}', '{selectedShip(net.opponent.ship as ShipId).name.toUpperCase()}');
replaceRequired('INCOMING {fresh.weapon.toUpperCase()} FROM {fresh.from}', 'INCOMING {WEAPONS[fresh.weapon as PowerId]?.short ?? fresh.weapon.toUpperCase()} FROM {fresh.from}');

// Breach Runner brand surfaces and source/provenance copy.
replaceRequired(': "WORMHOLE ARCADE";', ': "BREACH RUNNER";');
replaceRequired('<span className="brand-mark" aria-hidden="true">W/02</span>', '<span className="brand-mark" aria-hidden="true">BR/01</span>');
replaceRequired('<h1>WORMHOLE <em>ARCADE</em></h1>', '<h1>BREACH <em>RUNNER</em></h1>');
replaceRequired('aria-label={`Wormhole combat arena. Hull ${hud.health} of ${hud.maxHealth}. Wormhole charge ${hud.portalCharge} percent. Rival integrity ${hud.rivalHealth} percent. ${hud.enrageActive ? "Wormhole enraged. " : ""}${queued ? `Next power-up ${WEAPONS[queued].name}.` : "Power-up bin empty."}`}', 'aria-label={`Breach Runner combat arena. Hull ${hud.health} of ${hud.maxHealth}. Rift charge ${hud.portalCharge} percent. Rival integrity ${hud.rivalHealth} percent. ${hud.enrageActive ? "Rift enraged. " : ""}${queued ? `Next power-up ${WEAPONS[queued].name}.` : "Power-up bin empty."}`}');
replaceRequired('Every rival has a wormhole orbiting your arena. Shoot it with pulse cannons to generate power-ups, collect them, then send attack power-ups back through it.', 'Every rival projects a rift into your arena. Shoot it with pulse cannons to generate power-ups, collect them, then send attack payloads back through it.');
replaceRequired('Deal 150 cannon damage to the wormhole', 'Deal 150 cannon damage to the rift');
replaceRequired('Aim at the wormhole and press E (touch: PUP)', 'Aim at the rift and press E (touch: PUP)');
replaceRequired('<div><span>WORMHOLE</span><b>{hud.portalCharge}%</b></div>', '<div><span>RIFT</span><b>{hud.portalCharge}%</b></div>');
replaceRequired('"SCANNING RIVAL WORMHOLE"', '"SCANNING RIVAL RIFT"');
replaceRequired('<span>CLIENT-VERIFIED PROTOTYPE</span>\n            <p>Flight values, game tick, cannon levels, portal charge, power-up capacity, enemy counts, and sound effects were recovered from the supplied Redux client.</p>', '<span>PROJECT RIFT // ORIGINAL BUILD</span>\n            <p>Breach Runner uses code-owned procedural visuals, original generated audio, and independently defined commercial fleet and weapon identities.</p>');
replaceRequired('<span>WORMHOLE ARCADE // PLAYABLE PROTOTYPE 0.4</span>', '<span>BREACH RUNNER // WEB PROTOTYPE 0.4</span>');

fs.writeFileSync(path, source);
console.log("Applied Phase 1 Breach Runner UI cleanup to app/game.tsx");
