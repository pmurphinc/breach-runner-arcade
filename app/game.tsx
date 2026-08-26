"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import {
  CATEGORY_LABELS,
  CODEX_PICKUPS,
  ENEMY_COUNTS,
  ENEMY_STATS,
  FORM_SHIFT_PROFILES,
  POWER_COLORS,
  POWER_LABELS,
  SENDABLE_POWERUPS,
  SHIPS,
  SHIP_SPECIALS,
  SHOT_LEVELS,
  WEAPONS,
  rivalDamageFor,
  type PickupId,
  type PowerId,
  type ShipId,
  type ShipSpec,
  type WeaponMeta,
} from "./game-data";
import { DIRECTIONAL, drawPowerProjectile, drawShipShape, drawWeaponGlyph } from "./weapon-art";
import {
  DIFFICULTIES,
  RULESET_IDS,
  TICK_MS,
  absorbCollisionDamage,
  absorbEnrageShield,
  activateEnrageRecovery,
  advanceWormholeAngle,
  createCollisionShield,
  createEnrageRecovery,
  createContactHazard,
  isSurvival,
  pilotSpawn,
  rulesFor,
  secondsForTicks,
  tickCollisionShield,
  tickContactHazard,
  tickEnrageRecovery,
  wormholePosition,
  type CollisionShieldState,
  type EnrageRecoveryState,
  type ContactHazardState,
  type DifficultyId,
  type DifficultyRules,
  type GameMode,
} from "./difficulty";
import {
  capabilityStore,
  resolveViewMode,
  settingsStore,
  SOUND_GAIN,
  VIEW_PROFILES,
  ZOOM_SCALE,
  type CombatHaptics,
  type SoundLevel,
  type ZoomLevel,
} from "./view-settings";
import GlobalSystemControls, { useFullscreen } from "./system-controls";
import { MenuScreen } from "./ui-system";
import {
  activeRoute,
  isOpen as menuIsOpen,
  menuButtonTarget,
  pop as popRoute,
  push as pushRoute,
  reset as resetRoute,
  CLOSED,
  INITIAL_STACK,
  type MenuRoute,
  type MenuStack,
} from "./menu-routes";
import {
  HomeScreen,
  InfoScreen,
  ModesScreen,
  PauseScreen,
  SettingsScreen,
  ShipsScreen,
} from "./main-menu";
import { PvpClient, type PvpSnapshot } from "./pvp-client";
import {
  DEFAULT_PRESET,
  SCREEN_PRESETS,
  budgetFor,
  budgetsEqual,
  readViewport,
  type LayoutBudget,
  type ScreenPreset,
} from "./layout-budget";
import { cannonPlaybackRate, hapticsAllow } from "./combat-feedback";
import { pupInventoryLayout } from "./pup-inventory";
import { RICOCHET_BOUNCES, RICOCHET_DURATION_SECONDS, reflectRicochet } from "./ricochet";
import { controllerStateForPads, EMPTY_GAMEPAD, headingDegrees, pressedOnce, type GamepadActions } from "./gamepad";
import { controllerCancelTarget, moveControllerFocus, visibleControllerControls } from "./controller-navigation";
import {
  MOVEMENT_CODES,
  applyIntent,
  facingFor,
  intentFromKeys,
  intentFromStick,
  keysFrom,
  resolveIntent,
} from "./movement";
import {
  MURPH_SITE_URL,
  createArcadeRunId,
  fetchLeaderboard,
  fetchSurvivalLeaderboard,
  loadLocalBest,
  saveLocalRun,
  saveScoreToMurph,
  saveSurvivalScoreToMurph,
  type LeaderboardEntry,
  type LocalBest,
  type RunResult,
  type SurvivalLeaderboardEntry,
} from "./arcade-scores";
import {
  loadSurvivalBoard,
  nameSurvivalRun,
  recordSurvivalRun,
  shipsOnSurvivalBoard,
  survivalEntriesForShip,
  type SurvivalEntry,
} from "./survival-board";
import { formatRunTime, normalizeInitials, settleScore } from "./run-scoring";
import {
  VIPER_GUIDANCE_SECONDS,
  hostileTrackingVector,
  steerHomingVelocity,
} from "./ship-specials";
import {
  OVERCHARGE_FLASH_TICKS,
  blastDamageAt,
  blastRadiusAt,
  blastRingRadii,
  countsTowardShotBudget,
  overchargeFor,
  overchargeSource,
  overchargeSourceColor,
  overchargeTicks,
  riderHandling,
  scrambledDamage,
  volleyHeadings,
  type OverchargeSpec,
} from "./overcharge";
import {
  VICTORY_SUCTION_FREQUENCY,
  VICTORY_TOTAL_SECONDS,
  pullVelocity,
  victorySuctionState,
  victoryVisualState,
} from "./victory-sequence";
import {
  SURVIVAL_HOSTILE_CAP,
  SURVIVAL_PALETTES,
  advanceSurvival,
  createSurvivalState,
  escalationForLevel,
  survivalBreachBonus,
  survivalBreachIntegrity,
  type SurvivalState,
} from "./survival";
import {
  BEAM_HIT_WIDTH,
  BEAM_LENGTH,
  BEAM_PICKUP_WIDTH,
  advanceBeamAngle,
  pointTouchesBeam,
  randomBeamDirection,
  type BeamDirection,
} from "./beam-motion";

const VIEW_WIDTH = 1048;
const VIEW_HEIGHT = 655;
const WORLD_WIDTH = 1504;
const WORLD_HEIGHT = 940;
/** Cannon damage the rift absorbs per power-up, before any escalation. */
const PORTAL_THRESHOLD = 150;
const DEG = Math.PI / 180;
const THRUST_ACCEL_BONUS = 0.035;
const THRUST_SPEED_BONUS = 0.25;
const STOCK_LIMIT = 10;
const ticksForSeconds = (seconds: number) => Math.round(seconds * 1000 / TICK_MS);
const wholeSecondsForTicks = (ticks: number) => Math.max(0, Math.ceil(ticks * TICK_MS / 1000));
const DEFEAT_CAUSE_LABELS: Record<string, string> = {
  wall: "ARENA WALL",
  wormhole_contact: "RIFT CONTACT",
  hostile_projectile: "HOSTILE FIRE",
  beam: "SWEEP BEAM",
  nuke_blast: "CORE BOMB BLAST",
  mines_collision: "VOID MINE COLLISION",
  heatseeker_collision: "TRACKER SWARM COLLISION",
  inflator_collision: "PLASMA BLOOM COLLISION",
  ufo_collision: "RAIDER DRONE COLLISION",
  turret_collision: "ORBITAL SENTRY COLLISION",
  gunship_collision: "ASSAULT FRIGATE COLLISION",
  scarab_collision: "SCAVENGER COLLISION",
  wallcrawler_collision: "RIM CRAWLER COLLISION",
  ghost_collision: "PHASE SHADE COLLISION",
  artillery_collision: "SIEGE BATTERY COLLISION",
  minelayer_collision: "MINE CARRIER COLLISION",
  emp_collision: "PULSE SCRAMBLER COLLISION",
  beam_collision: "SWEEP BEAM COLLISION",
  nuke_collision: "CORE BOMB COLLISION",
  enemy_collision: "HOSTILE COLLISION",
  unknown: "UNKNOWN DAMAGE",
};
const defeatCauseLabel = (cause: string) =>
  DEFEAT_CAUSE_LABELS[cause] ?? cause.replaceAll("_", " ").toUpperCase();

function finalEventLabel(run: RunResult) {
  const target = run.finalTarget ?? (run.outcome === "victory" ? "RIVAL RIFT" : "YOUR PILOT");
  if (run.finalReason === "forfeit") return `${target} LEFT THE MATCH`;
  const verb = target.includes("RIFT") ? "DESTROYED" : "ELIMINATED";
  const damage = Math.max(0, Math.round(run.finalDamage ?? 0));
  return `${target} ${verb} BY ${defeatCauseLabel(run.finalCause ?? "unknown")}${damage > 0 ? ` FOR ${damage} DAMAGE` : ""}`;
}
/** More than two nameplates at once is noise, not information. */
const MAX_NAMEPLATES = 2;
const ARENA_PALETTES: Record<DifficultyId, readonly [string, string, string]> = {
  practice: ["#102033", "#06101d", "#020409"],
  easy: ["#0b1d22", "#061016", "#020409"],
  difficult: ["#171127", "#090917", "#020409"],
  hard: ["#241014", "#0d080f", "#030305"],
  // Survival repaints itself per stage from SURVIVAL_PALETTES; this is the
  // opening one, and what the idle pre-run arena shows.
  survival: SURVIVAL_PALETTES.stable,
};

type Bullet = {
  x: number; y: number; vx: number; vy: number; damage: number; life: number; enemy: boolean; color: string;
  /**
   * Fired by a ship special rather than the pulse cannon.
   *
   * Special rounds are deliberately excluded from the live-shot budget in
   * `SHOT_LEVELS`. Counting them there is what used to make Talon's old
   * Missile Fan disable Talon's own cannon for the whole flight of the volley.
   */
  special?: boolean;
  /** Wall reflections remaining from Bankshot Matrix. Normal cannon only. */
  bouncesLeft?: number;
  /** Steering authority in radians per tick. Absent means it flies straight. */
  turnRadians?: number;
};

/**
 * One overcharged power-up detonation, anchored where it went off.
 *
 * The shape is generic on purpose: Phantom's control pulse and Talon's core
 * blast are the same entity with different numbers, so a fourth ship needs no
 * new entity type.
 */
type OverchargeBlastFx = {
  x: number; y: number; age: number; life: number;
  /** Band swept last tick, so a hostile is caught exactly once. */
  sweptTo: number;
  /** Resolved once on creation rather than re-derived every tick. */
  scrambleTicks: number;
  spec: OverchargeSpec;
};
type Pickup = { x: number; y: number; vx: number; vy: number; type: PickupId; life: number; phase: number };
type PowerShot = { x: number; y: number; vx: number; vy: number; type: PowerId; life: number; homing: boolean };
type Particle = { x: number; y: number; vx: number; vy: number; color: string; size: number; life: number; maxLife: number };
type StickPosition = { active: boolean; x: number; y: number };
type StickKind = "move" | "aim";
type SpawnKind = "hostile" | "friendly" | "transmit";
/** Short, non-blocking portal animation announcing what just came through. */
type SpawnFx = { x: number; y: number; type: PickupId; kind: SpawnKind; age: number; life: number; count: number };

type QualityMode = "auto" | "high" | "performance";

/**
 * Used for the very first render, before anything has been measured. Values
 * are conservative on purpose: a small arena that certainly fits is a better
 * first paint than a large one that has to snap smaller.
 */
const FALLBACK_BUDGET: LayoutBudget = {
  preset: DEFAULT_PRESET,
  orientation: "landscape",
  form: "desktop",
  handheld: false,
  narrow: false,
  arena: 520,
  stick: 0,
  sticks: "overlay",
  showTouchControls: false,
  panels: "scroll",
  trimmed: false,
  usableWidth: 1280,
  usableHeight: 800,
};


type Enemy = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: PowerId;
  hp: number;
  maxHp: number;
  radius: number;
  age: number;
  cooldown: number;
  phase: number;
  rotationDir?: BeamDirection;
  armed?: boolean;
  countdown?: number;
  blastRadius?: number;
  /** Ticks left flying backwards and unable to fire, from a scrambler pulse. */
  scrambled?: number;
};

type Player = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  health: number;
  maxHealth: number;
  shield: number;
  invuln: number;
  gun: number;
  thrust: number;
  retros: boolean;
  specialCooldown: number;
  emp: number;
  /** Ticks remaining on the temporary Bankshot Matrix utility. */
  ricochetTicks: number;
  /**
   * Handling rider left by an overcharge, in ticks, with its multipliers.
   *
   * One set of fields covers Starling's afterburn and Talon's post-blast
   * stagger, because a rider that halves acceleration is the same mechanism as
   * one that raises it.
   */
  riderTicks: number;
  riderTotal: number;
  riderAcceleration: number;
  riderMaxSpeed: number;
  /** Ticks left on the hull flare that marks a special as a special. */
  overchargeFlash: number;
  /** Ticks remaining in which newly launched Viper power-ups gain guidance. */
  viperGuidance: number;
  /** Ticks remaining on the Flagship's continuous attraction/repulsion field. */
  flagshipField: number;
  flashMode: "tank" | "squid";
};

type Game = {
  worldWidth: number;
  worldHeight: number;
  ship: ShipSpec;
  /** Rules in force for this run. Read by the loop; never re-derived from an id. */
  rules: DifficultyRules;
  mode: GameMode;
  /** Most recent hull-damaging hazard, used by every defeat screen. */
  lastDamageCause: string;
  lastDamageAmount: number;
  /** Final attack delivered to the rival wormhole. */
  lastRivalCause: string;
  lastRivalDamage: number;
  player: Player;
  /** Easy-mode collision shield. Null whenever the rules do not grant one. */
  collisionShield: CollisionShieldState | null;
  /** Wormhole contact episode tracking. Inert unless the hazard is enabled. */
  contact: ContactHazardState;
  /** Ticks left on the on-screen WORMHOLE CONTACT warning. */
  contactWarning: number;
  /** Decays after the shield absorbs a hit, drives the impact ripple. */
  shieldRipple: number;
  /** Decays after the shield breaks, drives the break flash. */
  shieldBreak: number;
  /** Ticks left on the SHIELD RESTORED confirmation. */
  shieldRestored: number;
  portalAngle: number;
  portalCharge: number;
  portalX: number;
  portalY: number;
  /** Decays after the portal fires, used to swell the portal on activity. */
  portalPulse: number;
  /** Simulation time that actually elapsed while the run was active. */
  elapsedTicks: number;
  /**
   * Cannon damage the rift absorbs before it sheds a power-up.
   *
   * A field rather than the old constant because Survival raises it every Rift
   * Level: the pilot's supply line is one of the things the escalation is
   * allowed to squeeze.
   */
  portalThreshold: number;
  /** Rift Survival bookkeeping. Null in every other ruleset. */
  survival: SurvivalState | null;
  /** Remaining ticks in the staged wormhole-collapse victory sequence. */
  victorySequence: number;
  /** Ensures the central blast, sound, and particle payload fire exactly once. */
  victoryExplosionFired: boolean;
  /** Hard Mode wormhole enrage, activated once at the configured integrity threshold. */
  enrageActive: boolean;
  /** Ticks until the next automatic mixed enrage wave. */
  enrageTimer: number;
  /** Heal-over-time and temporary shield state created by enrage. */
  enrageRecovery: EnrageRecoveryState;
  /** Ticks until Hard Mode's next dedicated mine pulse. */
  enrageMineTimer: number;
  bullets: Bullet[];
  pickups: Pickup[];
  enemies: Enemy[];
  /** Last host world revision applied by a co-op guest. */
  lastWorldSeq?: number;
  powers: PowerShot[];
  blasts: OverchargeBlastFx[];
  particles: Particle[];
  spawns: SpawnFx[];
  stock: PowerId[];
  score: number;
  rivalHealth: number;
  rivalMaxHealth: number;
  cycles: number;
  botTimer: number;
  shotCycle: number;
  playerShots: number;
  running: boolean;
  paused: boolean;
  result: "victory" | "defeat" | null;
  notice: string;
  noticeLife: number;
  incoming: PowerId | null;
};

type Hud = {
  health: number;
  maxHealth: number;
  shield: number;
  gun: number;
  thrust: number;
  retros: boolean;
  score: number;
  elapsedSeconds: number;
  /** Normalized rival integrity percentage for UI and saved-run compatibility. */
  rivalHealth: number;
  rivalCurrentHealth: number;
  rivalMaxHealth: number;
  portalCharge: number;
  stock: PowerId[];
  running: boolean;
  paused: boolean;
  result: Game["result"];
  deathCause: string;
  deathDamage: number;
  rivalFinalCause: string;
  rivalFinalDamage: number;
  incoming: PowerId | null;
  notice: string;
  coach: string;
  /** Rules badge: what the pilot is flying under right now. */
  mode: GameMode;
  difficulty: DifficultyId;
  difficultyName: string;
  wormholeState: "LOCKED" | "MOVING";
  /** Percentage of collision shield left, or null when the rules grant none. */
  collisionShield: number | null;
  /** Seconds left on the recharge delay. Zero when full or already restored. */
  collisionRecharge: number;
  contactHazard: boolean;
  specialName: string;
  /** Whole seconds remaining; zero means Q/SPEC is ready. */
  specialCooldown: number;
  /** True while the pilot is inside the wormhole contact radius. */
  contactActive: boolean;
  /** True while the Hard Mode rival wormhole is enraged. */
  enrageActive: boolean;
  /** Current Rift Level, or 0 when this run is not a Survival run. */
  riftLevel: number;
  /** Escalation stage name, empty outside Survival. */
  riftStage: string;
  /** Times the rift has been collapsed and reformed this Survival run. */
  breaches: number;
};

function cap(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function range(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function selectedShip(id: ShipId) {
  return SHIPS.find((ship) => ship.id === id) ?? SHIPS[1];
}

/** The weapon that `E` / PUP will fire next. The bin is last-in, first-out. */
function nextWeapon(stock: readonly PowerId[]) {
  return stock.length > 0 ? stock[stock.length - 1] : null;
}

/**
 * One line of contextual coaching for whatever the player has to do next.
 * Shown on the canvas and in the HUD whenever no event notice is playing.
 */
function coachLine(game: Game) {
  if (!game.running || game.result) return "CHOOSE A SHIP, THEN START MISSION";
  if (game.paused) return "PAUSED // PRESS P TO RESUME";
  if (game.stock.length > 0) return `AIM AT THE RIFT // PRESS E OR PUP TO SEND ${WEAPONS[game.stock[game.stock.length - 1]].short}`;
  if (game.pickups.length > 0) return "POWER-UP LOOSE // FLY OVER IT TO COLLECT";
  const remaining = Math.max(0, game.portalThreshold - game.portalCharge);
  return `SHOOT THE RIFT // ${Math.ceil(remaining)} MORE DAMAGE GENERATES A POWER-UP`;
}

function createGame(ship: ShipSpec, mode: GameMode = "pve", difficulty: DifficultyId = "difficult"): Game {
  const rules = rulesFor(mode, difficulty);
  const arena = { width: WORLD_WIDTH, height: WORLD_HEIGHT };
  const spawn = pilotSpawn(rules, arena);
  const wormhole = wormholePosition(rules, arena, 0);
  return {
    worldWidth: WORLD_WIDTH,
    worldHeight: WORLD_HEIGHT,
    ship,
    rules,
    mode,
    lastDamageCause: "unknown",
    lastDamageAmount: 0,
    lastRivalCause: "unknown",
    lastRivalDamage: 0,
    collisionShield: createCollisionShield(rules),
    contact: createContactHazard(),
    contactWarning: 0,
    shieldRipple: 0,
    shieldBreak: 0,
    shieldRestored: 0,
    player: {
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      angle: -90,
      health: ship.health,
      maxHealth: ship.health,
      shield: 0,
      invuln: 0,
      gun: ship.gun,
      thrust: ship.thrust,
      retros: ship.thrust > 0,
      specialCooldown: 0,
      emp: 0,
      ricochetTicks: 0,
      riderTicks: 0,
      riderTotal: 0,
      riderAcceleration: 1,
      riderMaxSpeed: 1,
      overchargeFlash: 0,
      viperGuidance: 0,
      flagshipField: 0,
      flashMode: "tank",
    },
    portalAngle: 0,
    portalCharge: 0,
    portalX: wormhole.x,
    portalY: wormhole.y,
    portalPulse: 0,
    elapsedTicks: 0,
    portalThreshold: PORTAL_THRESHOLD,
    survival: isSurvival(rules) ? createSurvivalState() : null,
    victorySequence: 0,
    victoryExplosionFired: false,
    enrageActive: false,
    enrageTimer: 0,
    enrageRecovery: createEnrageRecovery(),
    enrageMineTimer: 0,
    bullets: [],
    pickups: [],
    enemies: [],
    powers: [],
    blasts: [],
    particles: [],
    spawns: [],
    stock: [],
    score: 0,
    rivalHealth: rules.rivalIntegrity * (mode === "coop" ? 2 : 1),
    rivalMaxHealth: rules.rivalIntegrity * (mode === "coop" ? 2 : 1),
    cycles: 0,
    botTimer: 330,
    shotCycle: 0,
    playerShots: 0,
    running: false,
    paused: false,
    result: null,
    notice: "SYSTEM READY",
    noticeLife: 120,
    incoming: null,
  };
}

function hudFrom(game: Game): Hud {
  return {
    health: Math.max(0, Math.round(game.player.health)),
    maxHealth: game.player.maxHealth,
    shield: Math.round((game.player.shield / 450) * 100),
    gun: game.player.gun,
    thrust: game.player.thrust,
    retros: game.player.retros,
    score: game.score,
    elapsedSeconds: Math.floor(game.elapsedTicks * TICK_MS / 1000),
    rivalHealth: Math.max(0, Math.round((game.rivalHealth / game.rivalMaxHealth) * 100)),
    rivalCurrentHealth: Math.max(0, Math.round(game.rivalHealth)),
    rivalMaxHealth: game.rivalMaxHealth,
    portalCharge: Math.round((game.portalCharge / game.portalThreshold) * 100),
    stock: [...game.stock],
    running: game.running,
    paused: game.paused,
    result: game.result,
    deathCause: game.lastDamageCause,
    deathDamage: game.lastDamageAmount,
    rivalFinalCause: game.lastRivalCause,
    rivalFinalDamage: game.lastRivalDamage,
    incoming: game.incoming,
    notice: game.noticeLife > 0 ? game.notice : "",
    coach: coachLine(game),
    mode: game.mode,
    difficulty: game.rules.id,
    difficultyName: game.rules.shortName,
    wormholeState: game.rules.wormhole.kind === "locked" ? "LOCKED" : "MOVING",
    collisionShield: game.collisionShield
      ? Math.round((game.collisionShield.charge / game.collisionShield.capacity) * 100)
      : null,
    collisionRecharge: game.collisionShield ? secondsForTicks(game.collisionShield.rechargeIn) : 0,
    contactHazard: game.rules.contactHazard.enabled,
    specialName: SHIP_SPECIALS[game.ship.id].name,
    specialCooldown: wholeSecondsForTicks(game.player.specialCooldown),
    contactActive: game.contactWarning > 0,
    enrageActive: game.enrageActive,
    riftLevel: game.survival?.level ?? 0,
    riftStage: game.survival?.escalation.stage.name ?? "",
    breaches: game.survival?.breaches ?? 0,
  };
}

/** Skip a React render when nothing the HUD shows has actually moved. */
function hudEqual(a: Hud, b: Hud) {
  return a.health === b.health
    && a.maxHealth === b.maxHealth
    && a.shield === b.shield
    && a.gun === b.gun
    && a.thrust === b.thrust
    && a.retros === b.retros
    && a.score === b.score
    && a.elapsedSeconds === b.elapsedSeconds
    && a.rivalHealth === b.rivalHealth
    && a.rivalCurrentHealth === b.rivalCurrentHealth
    && a.rivalMaxHealth === b.rivalMaxHealth
    && a.portalCharge === b.portalCharge
    && a.running === b.running
    && a.paused === b.paused
    && a.result === b.result
    && a.incoming === b.incoming
    && a.notice === b.notice
    && a.coach === b.coach
    && a.mode === b.mode
    && a.difficulty === b.difficulty
    && a.wormholeState === b.wormholeState
    && a.collisionShield === b.collisionShield
    && a.collisionRecharge === b.collisionRecharge
    && a.contactHazard === b.contactHazard
    && a.specialName === b.specialName
    && a.specialCooldown === b.specialCooldown
    && a.contactActive === b.contactActive
    && a.enrageActive === b.enrageActive
    && a.riftLevel === b.riftLevel
    && a.riftStage === b.riftStage
    && a.breaches === b.breaches
    && a.stock.length === b.stock.length
    && a.stock.every((item, index) => item === b.stock[index]);
}

type RenderProfile = { detail: number; maxParticles: number; shadows: boolean; maxBackingPx: number };

function profileFor(q: number): RenderProfile {
  return {
    detail: q,
    maxParticles: Math.round(110 + q * 330),
    shadows: q >= 0.5,
    maxBackingPx: Math.round(1000 + q * 820),
  };
}

function spawnParticles(game: Game, x: number, y: number, color: string, count: number, speed: number, budget: number) {
  const room = budget - game.particles.length;
  if (room <= 0) return;
  const total = Math.min(count, room);
  for (let i = 0; i < total; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const force = Math.random() * speed;
    const life = range(18, 55);
    game.particles.push({ x, y, vx: Math.cos(angle) * force, vy: Math.sin(angle) * force, color, size: range(1, 3.4), life, maxLife: life });
  }
}

function randomPower(): PickupId {
  if (Math.random() < 1 / 3) {
    const defensive: PickupId[] = ["gun", "thrust", "retros", "shield", "clear", "health", "ricochet"];
    return defensive[Math.floor(Math.random() * defensive.length)];
  }
  return SENDABLE_POWERUPS[Math.floor(Math.random() * SENDABLE_POWERUPS.length)];
}

function makeEnemy(kind: PowerId, x: number, y: number, index: number, count: number): Enemy {
  const stats = ENEMY_STATS[kind];
  const angle = (index / Math.max(1, count)) * Math.PI * 2 + range(-0.18, 0.18);
  let speed = kind === "mines" ? 6 : kind === "heatseeker" ? 7 : range(0.8, 2.8);
  if (kind === "turret" || kind === "beam" || kind === "emp" || kind === "nuke") speed = 0;
  return {
    x: x + range(-15, 15),
    y: y + range(-15, 15),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    kind,
    hp: stats.hp,
    maxHp: stats.hp,
    radius: stats.radius,
    age: 0,
    cooldown: kind === "nuke" ? 600 : range(55, 130),
    phase: angle,
    rotationDir: kind === "beam" ? randomBeamDirection() : undefined,
    countdown: kind === "nuke" ? 600 : undefined,
    blastRadius: kind === "nuke" ? 10 : undefined,
  };
}

/** Remove dead entries in place so the render loop stops allocating new arrays. */
function compact<T>(items: T[], keep: (item: T) => boolean) {
  let write = 0;
  for (let read = 0; read < items.length; read += 1) {
    const item = items[read];
    if (!keep(item)) continue;
    if (write !== read) items[write] = item;
    write += 1;
  }
  items.length = write;
}


function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

/** Static weapon silhouette. One draw per prop change — no animation loop. */
const WeaponIcon = memo(function WeaponIcon({ id, size = 26, dim = false }: { id: PickupId; size?: number; dim?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pixels = Math.round(size * dpr);
    if (canvas.width !== pixels) { canvas.width = pixels; canvas.height = pixels; }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);
    drawWeaponGlyph(ctx, id, size * 0.37, 0, { detail: 1, alpha: dim ? 0.5 : 1 });
  }, [id, size, dim]);
  return <canvas ref={ref} className="weapon-icon" style={{ width: size, height: size }} aria-hidden="true" />;
});

/**
 * Small looping projectile demo for the weapon card. It owns a single
 * animation frame that is cancelled the moment the card closes, and renders a
 * single still frame when the viewer prefers reduced motion.
 */
function WeaponPreview({ id, reducedMotion }: { id: PickupId; reducedMotion: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = 220;
    const height = 62;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const meta = WEAPONS[id];
    let raf = 0;

    const frame = (time: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "rgba(3,11,18,.85)";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "rgba(103,213,236,.16)";
      ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
      if (meta.sendable) {
        const travel = (time / 1900) % 1;
        const x = -20 + travel * (width + 40);
        drawPowerProjectile(ctx, id, x, height / 2, 6, 0, time, 1);
      } else {
        ctx.save();
        ctx.translate(width / 2, height / 2);
        const beat = 1 + Math.sin(time * 0.004) * 0.06;
        ctx.scale(beat, beat);
        drawWeaponGlyph(ctx, id, 17, time, { detail: 1 });
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    };

    if (reducedMotion) frame(0);
    else raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [id, reducedMotion]);
  return (
    <canvas
      ref={ref}
      className="weapon-preview-canvas"
      style={{ width: 220, height: 62 }}
      role="img"
      aria-label={`Animated preview of the ${WEAPONS[id].name} projectile in motion`}
    />
  );
}

function threatBadge(meta: WeaponMeta) {
  return "▲".repeat(meta.threat) + "△".repeat(3 - meta.threat);
}

/** Reliable, code-derived facts only. Nothing here is invented. */
function weaponFacts(meta: WeaponMeta): { label: string; value: string }[] {
  if (!meta.sendable) return [{ label: "PICKUP", value: "INSTANT" }, { label: "CATEGORY", value: CATEGORY_LABELS[meta.category] }];
  const id = meta.id as PowerId;
  const stats = ENEMY_STATS[id];
  return [
    { label: "WAVE SIZE", value: `×${ENEMY_COUNTS[id]}` },
    { label: "HULL EACH", value: id === "ghost" ? "IMMUNE" : String(stats.hp) },
    { label: "RIVAL DMG", value: String(rivalDamageFor(id)) },
    { label: "THREAT", value: threatBadge(meta) },
  ];
}

function WeaponCard({
  id,
  onClose,
  variant = "popover",
  reducedMotion,
}: {
  id: PickupId;
  onClose?: () => void;
  variant?: "popover" | "inline";
  reducedMotion: boolean;
}) {
  const meta = WEAPONS[id];
  return (
    <div className={`weapon-card weapon-card-${variant}`} style={{ "--pup": meta.color } as React.CSSProperties}>
      <div className="weapon-card-head">
        <WeaponIcon id={id} size={38} />
        <div className="weapon-card-title">
          <strong>{meta.name}</strong>
          <span className={`weapon-chip cat-${meta.category}`}>{CATEGORY_LABELS[meta.category]}</span>
        </div>
        {onClose ? (
          <button type="button" className="weapon-card-close" onClick={onClose} aria-label={`Close ${meta.name} information`}>
            ✕
          </button>
        ) : null}
      </div>
      <p className="weapon-card-summary">{meta.summary}</p>
      <dl className="weapon-card-lines">
        <div><dt>BEHAVIOUR</dt><dd>{meta.behavior}</dd></div>
        <div><dt>ROLE</dt><dd>{meta.role}</dd></div>
      </dl>
      <WeaponPreview id={id} reducedMotion={reducedMotion} />
      <ul className="weapon-card-facts">
        {weaponFacts(meta).map((fact) => (
          <li key={fact.label}><span>{fact.label}</span><b>{fact.value}</b></li>
        ))}
      </ul>
      <p className="weapon-card-activate">
        {meta.sendable
          ? "ACTIVATE — KEYBOARD E · TOUCH PUP. Aim at the rival rift before firing."
          : "ACTIVATE — no key needed. Fly over the pickup and it applies at once."}
      </p>
    </div>
  );
}

const CODEX_ORDER: readonly PickupId[] = CODEX_PICKUPS;

function WeaponCodex({ onClose, reducedMotion }: { onClose: () => void; reducedMotion: boolean }) {
  const [focused, setFocused] = useState<PickupId>(CODEX_ORDER[0]);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <MenuScreen route="codex" title="Weapon Codex" onBack={onClose} wide>
      <div className="codex">
        <p className="codex-intro">Every power-up the rift can produce. Select one to read what it does.</p>
        <button ref={closeRef} type="button" className="sr-only" onClick={onClose}>Close weapon codex</button>
        <div className="codex-body">
          <ul className="codex-list" aria-label="Weapon list">
            {CODEX_ORDER.map((id) => {
              const meta = WEAPONS[id];
              return (
                <li key={id}>
                  <button
                    type="button"
                    className={focused === id ? "active" : ""}
                    style={{ "--pup": meta.color } as React.CSSProperties}
                    aria-pressed={focused === id}
                    onClick={() => setFocused(id)}
                    onMouseEnter={() => setFocused(id)}
                    onFocus={() => setFocused(id)}
                  >
                    <WeaponIcon id={id} size={26} />
                    <span>{meta.name}</span>
                    <small>{CATEGORY_LABELS[meta.category]}</small>
                  </button>
                </li>
              );
            })}
          </ul>
          <WeaponCard id={focused} variant="inline" reducedMotion={reducedMotion} />
        </div>
      </div>
    </MenuScreen>
  );
}

type RunSummary = {
  run: RunResult;
  /** This device's best after the run — may be the run itself. */
  best: LocalBest | null;
  isBest: boolean;
  /** Runs played in this browser, including the one just finished. */
  runs: number;
  /** True when the card is reporting a run saved across a sign-in redirect. */
  restored: boolean;
  /** Victory waits for classic arcade initials before any persistence. */
  awaitingInitials: boolean;
  /** Final hull-damaging hazard for defeat screens. */
  deathCause?: string;
  /**
   * Where this run landed on the device Survival board, or null when it did
   * not place. Survival is ranked by time rather than score, so it cannot
   * share `best` without the card comparing two different measurements.
   */
  survivalRank?: number | null;
  /** The device Survival board after the run, for the result card's context. */
  survivalBoard?: SurvivalEntry[];
};

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; rank: number | null }
  | { status: "error"; message: string };

const INITIALS_INPUT_SELECTOR = "#arcade-initials, #menu-player-initials";

function beginInitialsEditing() {
  document.documentElement.dataset.initialsEditing = "true";
}

function finishInitialsEditing() {
  window.setTimeout(() => {
    if (document.activeElement?.matches(INITIALS_INPUT_SELECTOR)) return;
    delete document.documentElement.dataset.initialsEditing;
    // Re-measure once the mobile keyboard has finished restoring the viewport.
    window.dispatchEvent(new Event("resize"));
  }, 450);
}

/**
 * Global board, read on open so it is never fetched for players who never
 * ask for it. A failed read is reported in place — the leaderboard is a bonus,
 * never a dependency of the game.
 */
/** Which board the leaderboard screen is showing. */
type BoardKind = "arcade" | "survival";

const SURVIVAL_ALL_SHIPS = "";

/**
 * Formats a survival duration for a board row.
 *
 * Shared by the global rows and the device rows so a run reads identically
 * whichever list it appears in.
 */
const boardTime = (seconds: number) => formatRunTime(seconds);

/**
 * The Survival board.
 *
 * Two sources, one list, in priority order: the public board when it answers,
 * and this device's board either way. The public Survival endpoint is not live
 * on the score service yet — see `docs/SURVIVAL_LEADERBOARD_API.md` — so the
 * unavailable path is the ordinary one today rather than an error case, and it
 * is worded as a status rather than a failure.
 */
function SurvivalBoard() {
  const [rows, setRows] = useState<SurvivalLeaderboardEntry[] | null>(null);
  const [globalMissing, setGlobalMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ship, setShip] = useState<string>(SURVIVAL_ALL_SHIPS);
  const [board, setBoard] = useState<SurvivalEntry[]>([]);

  // Storage is read in an effect rather than during render: the server has no
  // localStorage, and reading it while rendering would hydrate to a different
  // list than the one the server sent. Publishing through a microtask matches
  // the arcade board beside it and keeps the read out of the render pass.
  useEffect(() => {
    const stored = loadSurvivalBoard();
    queueMicrotask(() => setBoard(stored));
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setGlobalMissing(false);
    });
    void fetchSurvivalLeaderboard(25, ship || undefined).then((entries) => {
      if (cancelled) return;
      setLoading(false);
      if (entries) setRows(entries);
      else { setRows(null); setGlobalMissing(true); }
    });
    return () => { cancelled = true; };
  }, [ship]);

  // Only ships that actually have a run to show, plus All Ships. A filter that
  // offers eight ships and returns nothing for six of them is a worse list.
  const ships = useMemo(() => shipsOnSurvivalBoard(board), [board]);
  const localRows = useMemo(() => survivalEntriesForShip(board, ship), [board, ship]);

  return (
    <>
      {ships.length > 1 ? (
        <div className="board-filter" role="radiogroup" aria-label="Filter Survival board by ship">
          <button
            type="button"
            role="radio"
            aria-checked={ship === SURVIVAL_ALL_SHIPS}
            className={ship === SURVIVAL_ALL_SHIPS ? "active" : ""}
            onClick={() => setShip(SURVIVAL_ALL_SHIPS)}
          >
            ALL SHIPS
          </button>
          {ships.map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={ship === name}
              className={ship === name ? "active" : ""}
              onClick={() => setShip(name)}
            >
              {name.toUpperCase()}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? <p className="board-note">Loading the Survival board…</p> : null}
      {globalMissing && !loading ? (
        <p className="board-note">The global Survival board is not open yet. Your device board is below.</p>
      ) : null}

      {rows !== null && rows.length > 0 ? (
        <ol className="board-list">
          {rows.map((entry) => (
            <li key={entry.id}>
              <span className="board-rank">{entry.rank}</span>
              <span className="board-name">{entry.initials}</span>
              <span className="board-runs">{entry.ship} · RIFT {entry.riftLevel}</span>
              <b>{boardTime(entry.durationSeconds)}</b>
            </li>
          ))}
        </ol>
      ) : null}

      <p className="board-section">THIS DEVICE</p>
      {localRows.length === 0 ? (
        <p className="board-note">
          No Survival runs yet{ship ? ` in the ${ship}` : ""}. Survive the rift and the clock does the rest.
        </p>
      ) : (
        <ol className="board-list">
          {localRows.map((entry, index) => (
            <li key={entry.runId || `${entry.achievedAt}-${index}`}>
              <span className="board-rank">{index + 1}</span>
              <span className="board-name">{entry.initials || "—"}</span>
              <span className="board-runs">
                {entry.ship} · RIFT {entry.riftLevel}
                {entry.breaches > 0 ? ` · ${entry.breaches} BREACH${entry.breaches > 1 ? "ES" : ""}` : ""}
              </span>
              <b>{boardTime(entry.durationSeconds)}</b>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** The arcade board: settled scores from completed PvE victories. */
function ArcadeBoard() {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [best, setBest] = useState<LocalBest | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [boardLimit, setBoardLimit] = useState(10);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const localBest = loadLocalBest();
    queueMicrotask(() => {
      if (cancelled) return;
      setBest(localBest);
      if (boardLimit === 10) setEntries(null);
      setFailed(false);
      setLoading(true);
    });
    void fetchLeaderboard(boardLimit).then((rows) => {
      if (cancelled) return;
      setLoading(false);
      if (rows) setEntries(rows);
      else setFailed(true);
    });
    return () => { cancelled = true; };
  }, [boardLimit, reloadKey]);

  return (
    <>
      {failed ? <p className="board-note">The global board could not be reached. Your device score is safe.</p> : null}
      {loading && entries === null ? <p className="board-note">Loading the board…</p> : null}
      {!loading && entries !== null && entries.length === 0 ? <p className="board-note">No scores yet. Win a non-Practice PvE run to claim the first spot.</p> : null}
      {entries !== null && entries.length > 0 ? (
        <ol className="board-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <span className="board-rank">{entry.rank}</span>
              <span className="board-name">{entry.initials}</span>
              <span className="board-runs">{entry.ship} · {entry.difficulty.toUpperCase()}</span>
              <b>{entry.score.toLocaleString()}</b>
            </li>
          ))}
        </ol>
      ) : null}
      {best ? (
        <p className="board-you">
          <span>YOUR BEST ON THIS DEVICE</span>
          <b>{best.score.toLocaleString()}</b>
        </p>
      ) : null}
      {entries !== null && !failed && boardLimit === 10 && entries.length >= 10 ? (
        <button className="board-link" type="button" onClick={() => setBoardLimit(100)}>
          LOAD FULL BOARD →
        </button>
      ) : null}
      {failed ? (
        <button className="board-link" type="button" onClick={() => setReloadKey((value) => value + 1)}>
          RETRY BOARD →
        </button>
      ) : null}
    </>
  );
}

/**
 * The leaderboard screen.
 *
 * Two boards rather than one, because they rank different things: the arcade
 * board sorts settled scores from completed victories, and Survival sorts time
 * survived. A single merged list would be sorted wrongly for one of them.
 */
function Leaderboard({ onClose, initialBoard = "arcade" }: { onClose: () => void; initialBoard?: BoardKind }) {
  const [kind, setKind] = useState<BoardKind>(initialBoard);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="codex-backdrop" role="presentation" onClick={onClose}>
      <div
        className="codex board"
        data-controller-surface
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-heading"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="codex-head">
          <h2 id="board-heading">GLOBAL BOARD</h2>
          <p>
            {kind === "survival"
              ? "Rift Survival, ranked by time survived. No account or login required."
              : "Classic arcade high scores. No account or login required."}
          </p>
          <button ref={closeRef} type="button" className="codex-close" onClick={onClose} aria-label="Close leaderboard">✕</button>
        </div>
        <div className="board-tabs" role="radiogroup" aria-label="Board">
          <button
            type="button"
            role="radio"
            aria-checked={kind === "arcade"}
            className={kind === "arcade" ? "active" : ""}
            onClick={() => setKind("arcade")}
          >
            ARCADE
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={kind === "survival"}
            className={kind === "survival" ? "active" : ""}
            onClick={() => setKind("survival")}
          >
            SURVIVAL
          </button>
        </div>
        <div className="board-body">
          {kind === "survival" ? <SurvivalBoard /> : <ArcadeBoard />}
        </div>
      </div>
    </div>
  );
}

function createPreference<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  let cached: T | null = null;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Cached so repeated reads are referentially stable, as the hook requires. */
    get(): T {
      if (cached === null) {
        try {
          const stored = window.localStorage.getItem(key) as T | null;
          cached = stored && allowed.includes(stored) ? stored : fallback;
        } catch {
          cached = fallback;
        }
      }
      return cached;
    },
    getServer(): T {
      return fallback;
    },
    set(value: T) {
      cached = value;
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Preferences are a convenience; losing them costs the player nothing.
      }
      listeners.forEach((listener) => listener());
    },
  };
}

/** Relative thumbstick size, as a multiplier on the measured natural size. */
export const STICK_SIZES = { small: 0.8, medium: 1, large: 1.25 } as const;
export type StickSizeName = keyof typeof STICK_SIZES;

const presetPreference = createPreference<ScreenPreset>(
  "wormhole-arcade:screen",
  SCREEN_PRESETS,
  DEFAULT_PRESET
);
/** The ship the player last confirmed, pre-highlighted on the next visit. */
const shipPreference = createPreference<ShipId>(
  "wormhole-arcade:ship",
  SHIPS.map((ship) => ship.id),
  "wing"
);

const modePreference = createPreference<GameMode>(
  "wormhole-arcade:mode",
  ["pve", "coop", "pvp"],
  "pve"
);
/**
 * The remembered solo ruleset. PvP is always Easy rules and never reads this.
 *
 * Survival is an allowed value even though it is not in the difficulty
 * selector: it is a ruleset the player chose, and a returning player should
 * find the challenge they left, not the difficulty underneath it.
 */
const difficultyPreference = createPreference<DifficultyId>(
  "wormhole-arcade:difficulty",
  RULESET_IDS,
  "difficult"
);


/**
 * Compact live readout of the rules in force, pinned over the arena.
 *
 * While a run is under way it reports the live state from the HUD snapshot.
 * Before one starts it reports `pending` — the rules START would apply — so
 * the badge always describes the run the player is about to fly.
 */
function DifficultyBadge({
  hud,
  pending,
  pendingMode,
  live,
}: {
  hud: Hud;
  pending: DifficultyRules;
  pendingMode: GameMode;
  live: boolean;
}) {
  const activeRules = live ? DIFFICULTIES[hud.difficulty] : pending;
  const pendingShield = activeRules.collisionShield.enabled;
  const unlimitedHull = activeRules.unlimitedHull;
  const wormhole = live
    ? hud.wormholeState
    : activeRules.wormhole.kind === "locked"
      ? "LOCKED"
      : "MOVING";
  const hazardArmed = live ? hud.contactHazard : activeRules.contactHazard.enabled;
  const charge = live ? hud.collisionShield : pendingShield ? 100 : null;
  const recharge = live ? hud.collisionRecharge : 0;
  const contactActive = live && hud.contactActive;

  const shield =
    charge === null
      ? "DISABLED"
      : recharge > 0
        ? `RECHARGING ${recharge.toFixed(1)}s`
        : charge >= 100
          ? "FULL"
          : `${charge}%`;

  const gameMode = (live ? hud.mode : pendingMode) === "pvp" ? "PVP" : "PVE";
  const difficulty = gameMode === "PVP" ? "EASY" : activeRules.shortName.replace(/ MODE$/i, "");
  // Survival's Rift Level is the run's difficulty, its clock and its score all
  // at once, so it earns a slot of its own on the badge.
  const riftLevel = live ? hud.riftLevel : activeRules.id === "survival" ? 1 : 0;
  const riftStage = live && hud.riftStage ? hud.riftStage : escalationForLevel(1).stage.name;
  const contact = hazardArmed ? "HAZARD" : "SAFE";
  const shieldText = unlimitedHull
    ? "HULL UNLIMITED"
    : charge === null
      ? "NO COLLISION SHIELD"
      : `SHIELD ${shield}`;
  const status = `${gameMode} · ${difficulty}${riftLevel > 0 ? ` | RIFT LEVEL ${riftLevel} · ${riftStage}` : ""} | RIFT ${wormhole} | ${shieldText} | CONTACT ${contact}${live && hud.enrageActive ? " | ENRAGED" : ""}`;

  return (
    <div className={`difficulty-badge ${contactActive ? "hazard" : ""}`} role="status" aria-live="polite" aria-label={`Score ${hud.score}. Active rules: ${status}`}>
      <span className="rule-score">SCORE {hud.score.toLocaleString().padStart(6, "0")}</span>
      <span className="rule-time">TIME {formatRunTime(hud.elapsedSeconds)}</span>
      <span className="rule-mode">{gameMode} · {difficulty}</span>
      {riftLevel > 0 ? <span className="rule-rift-level">LEVEL {riftLevel} · {riftStage}</span> : null}
      <span>RIFT {wormhole}</span>
      <span className={charge !== null && charge <= 0 ? "warn" : ""}>{shieldText}</span>
      <span className={hazardArmed ? "warn" : ""}>CONTACT {contact}</span>
      {live && hud.enrageActive ? <span className="warn">ENRAGED</span> : null}
    </div>
  );
}

/**
 * Multiplayer lobby.
 *
 * The offline path is built first and on purpose: PvE has to stay playable
 * when the match service is unreachable, so "cannot connect" is a first-class
 * state here rather than an afterthought. Phase 6 supplies a live socket; the
 * shell and its states do not change.
 */
type LobbyStatus =
  | { kind: "offline"; reason: string }
  | { kind: "connecting" }
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "waiting"; code: string };

function MultiplayerLobby({
  status,
  net,
  onQuickMatch,
  onCreatePrivate,
  onJoinCode,
  onCancel,
  onShip,
  onReady,
  onClose,
}: {
  status: LobbyStatus;
  net: PvpSnapshot | null;
  onQuickMatch: () => void;
  onCreatePrivate: () => void;
  onJoinCode: (code: string) => void;
  onCancel: () => void;
  onShip: (ship: string) => void;
  onReady: (ready: boolean) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const busy = status.kind === "searching" || status.kind === "waiting" || status.kind === "connecting";
  const offline = status.kind === "offline";

  return (
    <div className="codex-backdrop" role="presentation" onClick={onClose}>
      <div
        className="codex lobby"
        data-controller-surface
        role="dialog"
        aria-modal="true"
        aria-labelledby="lobby-heading"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="codex-head">
          <h2 id="lobby-heading">MULTIPLAYER LOBBY</h2>
          <p>{net?.kind === "coop" ? "Two pilots share one PvE objective and win or lose together." : "Real-time 1v1 under Easy rules."} No sign-in — guests get a callsign.</p>
          <button ref={closeRef} type="button" className="codex-close" onClick={onClose} aria-label="Close lobby">✕</button>
        </div>

        <div className="lobby-body">
          {net?.opponent ? (
            <div className="lobby-match">
              <p className="lobby-status" aria-live="polite">
                {net.phase === "countdown"
                  ? `LAUNCHING IN ${Math.ceil(net.countdownMs / 1000)}…`
                  : net?.kind === "coop" ? "ALLY FOUND — CHOOSE YOUR SHIP" : "OPPONENT FOUND — CHOOSE YOUR SHIP"}
              </p>
              <div className="lobby-versus">
                <div>
                  <span>YOU</span>
                  <b>{net.name}</b>
                  <small>{net.you?.ship ? selectedShip(net.you.ship as ShipId).name.toUpperCase() : "—"}</small>
                  <i className={net.you?.ready ? "ok" : ""}>{net.you?.ready ? "READY" : "NOT READY"}</i>
                </div>
                <em aria-hidden="true">{net?.kind === "coop" ? "+" : "VS"}</em>
                <div>
                  <span>{net?.kind === "coop" ? "ALLY" : "OPPONENT"}</span>
                  <b>{net.opponent.name}</b>
                  <small>{selectedShip(net.opponent.ship as ShipId).name.toUpperCase()}</small>
                  <i className={net.opponent.ready ? "ok" : ""}>
                    {net.opponent.connected ? (net.opponent.ready ? "READY" : "NOT READY") : "DISCONNECTED"}
                  </i>
                </div>
              </div>

              <label className="lobby-ship">
                <span>YOUR SHIP</span>
                <select
                  value={net.you?.ship ?? "wing"}
                  disabled={net.phase === "countdown"}
                  onChange={(event) => onShip(event.target.value)}
                >
                  {SHIPS.map((ship) => (
                    <option key={ship.id} value={ship.id}>{ship.name} — {ship.role}</option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className={`lobby-ready ${net.you?.ready ? "on" : ""}`}
                disabled={net.phase === "countdown"}
                onClick={() => onReady(!net.you?.ready)}
              >
                {net.phase === "countdown"
                  ? "LOCKED IN"
                  : net.you?.ready
                    ? "CANCEL READY"
                    : "READY"}
              </button>
              {net.error ? <p className="lobby-status warn">{net.error}</p> : null}
              <div className="lobby-foot">
                <button type="button" onClick={onCancel}>LEAVE MATCH</button>
                <button type="button" onClick={onClose}>HIDE</button>
              </div>
            </div>
          ) : (
          <>
          <p className={`lobby-status ${offline ? "warn" : ""}`} aria-live="polite">
            {status.kind === "offline" ? `OFFLINE — ${status.reason}` : null}
            {status.kind === "connecting" ? "CONNECTING TO MATCH SERVICE…" : null}
            {status.kind === "idle" ? "CONNECTED — CHOOSE HOW TO PLAY" : null}
            {status.kind === "searching" ? "SEARCHING FOR AN OPPONENT…" : null}
            {status.kind === "waiting" ? `WAITING — SHARE CODE ${status.code}` : null}
          </p>

          {status.kind === "waiting" ? (
            <p className="lobby-code" aria-label={`Invite code ${status.code.split("").join(" ")}`}>
              {status.code}
            </p>
          ) : null}

          {net?.name ? (
            <p className="lobby-callsign">
              PLAYING AS <b>{net.name}</b> — no sign-in needed
            </p>
          ) : null}

          <div className="lobby-actions">
            <button type="button" className="primary" disabled={offline || busy} onClick={onQuickMatch}>
              QUICK MATCH
            </button>
            <button type="button" disabled={offline || busy} onClick={onCreatePrivate}>
              CREATE PRIVATE MATCH
            </button>
          </div>

          <form
            className="lobby-join"
            onSubmit={(event) => { event.preventDefault(); if (code.trim()) onJoinCode(code.trim().toUpperCase()); }}
          >
            <label htmlFor="lobby-code-input">JOIN WITH CODE</label>
            <div>
              <input
                id="lobby-code-input"
                value={code}
                disabled={offline || busy}
                onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 6))}
                placeholder="ABC123"
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                maxLength={6}
              />
              <button type="submit" disabled={offline || busy || code.trim().length === 0}>JOIN</button>
            </div>
          </form>

          <div className="lobby-foot">
            {busy ? (
              <button type="button" onClick={onCancel}>CANCEL</button>
            ) : null}
            <button type="button" onClick={onClose}>BACK</button>
          </div>

          {net?.error ? <p className="lobby-status warn">{net.error}</p> : null}

          {offline ? (
            <p className="lobby-note">
              Single-player is unaffected — close this and pick a PvE difficulty to keep flying.
            </p>
          ) : null}
          </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * PvP overlay: both pilots' hull and collision shield, the connection state,
 * and incoming-attack warnings.
 *
 * Pilot hull is the victory condition here, so it is the largest thing on the
 * panel and is labelled as hull — deliberately distinct from the wormhole
 * charge readout, which is a PvE objective and decides nothing in a match.
 */
function PvpHud({ net }: { net: PvpSnapshot }) {
  const you = net.yourCombat;
  const them = net.opponentCombat;
  const fresh = net.incoming;

  const bar = (combat: typeof you) => {
    const hullPct = combat && combat.maxHull ? (combat.hull / combat.maxHull) * 100 : 0;
    return (
      <>
        <div className="meter hull"><i style={{ width: `${hullPct}%` }} /></div>
        <div className="meter pvp-shield">
          <i style={{ width: `${combat?.shieldPct ?? 0}%` }} />
        </div>
      </>
    );
  };

  return (
    <div className="pvp-hud">
      <div className="pvp-rules">
        <b>PVP // EASY RULES</b>
        <span className={net.connected ? "ok" : "warn"}>
          {net.reconnecting ? "RECONNECTING…" : net.connected ? "LINK OK" : "LINK LOST"}
        </span>
      </div>

      <div className="pvp-side you">
        <span><em>{net.name || "YOU"}</em><i>{you ? `${Math.round(you.hull)}/${you.maxHull}` : "—"}</i></span>
        {bar(you)}
        <small>
          SHIELD {you ? (you.rechargeMs > 0 ? `RECHARGING ${(you.rechargeMs / 1000).toFixed(1)}s` : `${you.shieldPct}%`) : "—"}
        </small>
      </div>

      <div className="pvp-side them">
        <span>
          <em>{net.opponent?.name ?? "OPPONENT"}</em>
          <i>{them ? `${Math.round(them.hull)}/${them.maxHull}` : "—"}</i>
        </span>
        {bar(them)}
        <small>
          SHIELD {them ? `${them.shieldPct}%` : "—"}
          {net.opponent && !net.opponent.connected ? " · DISCONNECTED" : ""}
        </small>
      </div>

      {fresh ? (
        <p className="pvp-incoming" role="status">
          INCOMING {WEAPONS[fresh.weapon as PowerId]?.short ?? fresh.weapon.toUpperCase()} FROM {fresh.from}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Ship silhouette for the menu, drawn with the same routine the arena uses so
 * the art in the menu is literally the art in the game.
 */
const MenuShip = memo(function MenuShip({ id, size }: { id: ShipId; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size, size);
    context.save();
    context.translate(size / 2, size / 2);
    context.rotate(-Math.PI / 2);
    context.scale(size / 90, size / 90);
    context.lineWidth = 2.2;
    context.strokeStyle = "#69ecff";
    context.fillStyle = "rgba(86, 226, 255, .14)";
    drawShipShape(context, id, id === "flagship" ? 1.5 : 1.9);
    context.fill();
    context.stroke();
    context.restore();
  }, [id, size]);
  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden="true" />;
});

export default function WormholeGame() {
  const shellRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const moveStickRef = useRef<HTMLDivElement>(null);
  const aimStickRef = useRef<HTMLDivElement>(null);
  const moveStickPointer = useRef<number | null>(null);
  const aimStickPointer = useRef<number | null>(null);
  const moveHeading = useRef<number | null>(null);
  const aimHeading = useRef<number | null>(null);
  /** Isolated from keyboard, mouse and touch; disconnect clears only this ref. */
  const controllerInput = useRef<GamepadActions>(EMPTY_GAMEPAD);
  const shipId = useSyncExternalStore(
    shipPreference.subscribe,
    shipPreference.get,
    shipPreference.getServer
  );
  const setShipId = useCallback((next: ShipId) => { shipPreference.set(next); }, []);
  const gameRef = useRef<Game>(createGame(selectedShip("wing")));
  const keys = useRef<Record<string, boolean>>({});
  /** Keys released since the last tick; cleared only after a tick reads them. */
  const pendingRelease = useRef<string[]>([]);
  const [hud, setHud] = useState<Hud>(() => hudFrom(createGame(selectedShip("wing"))));
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot, settingsStore.getServerSnapshot);
  /**
   * What the device can do, measured once on mount.
   *
   * The server pass and the first client frame both assume mouse-and-keyboard,
   * then this corrects it. That ordering matters: the game renders immediately
   * either way, which is what lets the first-launch "Choose Your View" gate go
   * away. A gate that blocks the entire app before anything mounts is a worse
   * answer to a question the browser can already answer.
   */
  const capability = useSyncExternalStore(
    capabilityStore.subscribe,
    capabilityStore.getSnapshot,
    capabilityStore.getServerSnapshot
  );
  const viewMode = resolveViewMode(settings.viewMode, capability);
  const viewProfile = VIEW_PROFILES[viewMode];
  const setSetting = useCallback(<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) => settingsStore.update({ [key]: value }), []);

  /**
   * One navigation stack for every menu surface, replacing `stage`,
   * `menuOpen`, `boardOpen` and `lobbyOpen`. Two of those could be true at
   * once and nothing decided which won; a stack cannot express that.
   */
  const [menu, setMenu] = useState<MenuStack>(INITIAL_STACK);
  const route = activeRoute(menu);
  const menuOpen = menuIsOpen(menu);
  const go = useCallback((next: MenuRoute) => setMenu((stack) => pushRoute(stack, next)), []);
  const back = useCallback(() => setMenu((stack) => popRoute(stack)), []);
  const closeMenu = useCallback(() => setMenu(CLOSED), []);
  const sound = settings.sound;
  const cameraLocked = settings.cameraLock;
  const screenPreset = useSyncExternalStore(
    presetPreference.subscribe,
    presetPreference.get,
    presetPreference.getServer
  );
  const touchControlMode = viewProfile.thumbsticks && settings.thumbsticks ? "show" : "hide";
  const stickSizeName = settings.touchControlSize;
  const [budget, setBudget] = useState<LayoutBudget | null>(null);
  const [quality] = useState<QualityMode>("auto");
  const [moveStickPosition, setMoveStickPosition] = useState<StickPosition>({ active: false, x: 0, y: 0 });
  const [aimStickPosition, setAimStickPosition] = useState<StickPosition>({ active: false, x: 0, y: 0 });
  const [inspect, setInspect] = useState<{ id: PickupId; pinned: boolean } | null>(null);
  const [codexOpen, setCodexOpen] = useState(false);
  const mode = useSyncExternalStore(
    modePreference.subscribe,
    modePreference.get,
    modePreference.getServer
  );
  const difficulty = useSyncExternalStore(
    difficultyPreference.subscribe,
    difficultyPreference.get,
    difficultyPreference.getServer
  );
  /** True once a run has been launched, so the shell knows the arena is live. */
  const [launched, setLaunched] = useState(false);
  const [net, setNet] = useState<PvpSnapshot | null>(null);
  // Derived beside its state so every later effect can safely reference it.
  const netResult = net?.result ?? null;
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [initialsEntry, setInitialsEntry] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  /** Which board the leaderboard screen opens on. Sticky between visits. */
  const [boardKind, setBoardKind] = useState<BoardKind>("arcade");
  const reducedMotion = useReducedMotion();

  /** Menu and codex state for the global key handler, without re-subscribing. */
  const menuRef = useRef<MenuStack>(INITIAL_STACK);
  const menuOpenRef = useRef(false);
  const codexOpenRef = useRef(false);
  /** Route-aware Cancel target, kept stable across controller button holds. */
  const controllerCancelRef = useRef<() => void>(() => {});
  const soundRef = useRef(true);
  const soundLevelRef = useRef<SoundLevel>("medium");
  const combatHapticsRef = useRef<CombatHaptics>("both");
  const cannonHitSoundRef = useRef(true);
  const cameraRef = useRef(true);
  const zoomRef = useRef<ZoomLevel>("standard");
  const qualityRef = useRef<QualityMode>("auto");
  const reducedMotionRef = useRef(false);
  const viewProfileRef = useRef(viewProfile);
  /** CSS pixels of arena covered by the HTML HUD strip, for the canvas to skip. */
  const hudInsetRef = useRef(0);
  /**
   * How far down the canvas HUD must start on each side to clear the DOM
   * panels floating over the arena — the rules badge on the left, the PvP HUD
   * on the right. Measured from the real elements rather than hard-coded, so
   * it stays right when their contents or the type scale change.
   */
  const audioPool = useRef<Map<string, HTMLAudioElement[]>>(new Map());
  const cueAudio = useRef<AudioContext | null>(null);
  const victorySuctionAudio = useRef<{
    context: AudioContext;
    master: GainNode;
    oscillators: OscillatorNode[];
  } | null>(null);
  /** The outcome already turned into a summary, so each run is recorded once. */
  const recordedResult = useRef<Game["result"]>(null);
  /** The summary object already submitted to the public initials leaderboard. */
  const autoSavedRun = useRef<RunResult | null>(null);
  /** Ship the current run is being flown in, fixed at launch. */
  const runShipName = useRef("");
  /**
   * The live match connection. Held in a ref so the fixed-step loop can read
   * and report without re-subscribing every render.
   */
  const netRef = useRef<PvpClient | null>(null);

  useEffect(() => { menuRef.current = menu; }, [menu]);
  useEffect(() => { menuOpenRef.current = menuOpen; }, [menuOpen]);
  useEffect(() => { codexOpenRef.current = codexOpen; }, [codexOpen]);
  useEffect(() => { soundRef.current = sound; }, [sound]);
  useEffect(() => { soundLevelRef.current = settings.soundLevel; }, [settings.soundLevel]);
  useEffect(() => { combatHapticsRef.current = settings.combatHaptics; }, [settings.combatHaptics]);
  useEffect(() => { cannonHitSoundRef.current = settings.cannonHitSound; }, [settings.cannonHitSound]);
  useEffect(() => { cameraRef.current = cameraLocked; }, [cameraLocked]);
  useEffect(() => { zoomRef.current = settings.zoom; }, [settings.zoom]);
  useEffect(() => { qualityRef.current = quality; }, [quality]);
  useEffect(() => { reducedMotionRef.current = reducedMotion; }, [reducedMotion]);
  useEffect(() => { viewProfileRef.current = viewProfile; }, [viewProfile]);

  const gameActive = hud.running && !hud.result;
  // Until the first measurement lands, assume the safest shape rather than a
  // desktop one, so a handheld never flashes a layout it cannot use.
  const layout: LayoutBudget = budget ?? FALLBACK_BUDGET;
  const touchCapable = viewProfile.touch;
  const immersive = viewProfile.touch;

  // One measurement drives the whole interface. It is recomputed on every
  // event that can change the answer — resize, visualViewport changes from
  // browser chrome or pinch zoom, rotation, fold, fullscreen, and preference
  // changes — and coalesced into a single animation frame so a stream of
  // resize events cannot turn into a render storm. Equality gating means an
  // event that changes nothing costs no React work at all.
  useEffect(() => {
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    let frame = 0;
    const measure = () => {
      frame = 0;
      // A software keyboard changes visualViewport height. That must not
      // reclassify the arena while the player is entering their initials.
      if (document.documentElement.dataset.initialsEditing === "true") return;
      const viewport = readViewport(touchControlMode, STICK_SIZES[stickSizeName]);
      viewport.touch = viewProfile.touch;
      viewport.coarse = viewProfile.touch;
      const next = budgetFor(viewport, screenPreset);
      setBudget((previous) => (previous && budgetsEqual(previous, next) ? previous : next));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();

    coarsePointer.addEventListener?.("change", schedule);
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("orientationchange", schedule, { passive: true });
    document.addEventListener("fullscreenchange", schedule);
    // visualViewport is the one that notices browser chrome appearing, the
    // on-screen keyboard, and pinch zoom.
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      coarsePointer.removeEventListener?.("change", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      document.removeEventListener("fullscreenchange", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [screenPreset, stickSizeName, touchControlMode, viewProfile.touch]);

  // Page-level gesture suppression is scoped to active touch gameplay so normal
  // scrolling, zooming, and selection stay available everywhere else.
  useEffect(() => {
    hudInsetRef.current = immersive && layout.sticks === "overlay" ? 44 : 0;
  }, [immersive, layout.sticks]);

  // Touch/Hybrid reserves a real header lane above the 1.6:1 playfield.
  // Measuring the rendered HUD keeps wrapped rules and shield text out of the
  // playable canvas on phones, tablets, and foldables.
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;

    const measure = () => {
      if (!viewProfile.verticalRails) {
        wrap.style.removeProperty("--arena-playfield-top");
        wrap.style.removeProperty("--arena-canvas-width");
        wrap.style.removeProperty("--arena-canvas-height");
        return;
      }

      const wrapRect = wrap.getBoundingClientRect();
      const bottomOf = (selector: string) => {
        const element = wrap.querySelector<HTMLElement>(selector);
        if (!element) return 0;
        const rect = element.getBoundingClientRect();
        return rect.height > 0 ? Math.max(0, rect.bottom - wrapRect.top) : 0;
      };
      const hudBottom = Math.max(
        bottomOf(".difficulty-badge"),
        bottomOf(".pilot-rail"),
        bottomOf(".pilot-rail small"),
        bottomOf(".rival-rail")
      );
      const playfieldTop = Math.ceil(hudBottom) + 2;
      const availableHeight = Math.max(1, wrapRect.height - playfieldTop);
      const canvasWidth = Math.max(1, Math.floor(Math.min(wrapRect.width, availableHeight * WORLD_WIDTH / WORLD_HEIGHT)));
      const canvasHeight = Math.max(1, Math.floor(canvasWidth * WORLD_HEIGHT / WORLD_WIDTH));
      wrap.style.setProperty("--rules-bottom", `${Math.max(0, bottomOf(".difficulty-badge"))}px`);
      wrap.style.setProperty("--health-bottom", `${Math.max(0, hudBottom)}px`);
      // HTML paints above the canvas, so make canvas spawn/tracker nameplates
      // start below the inventory instead of allowing that panel to cover them.
      const inventoryBottom = bottomOf(".touch-powerup-hud");
      hudInsetRef.current = inventoryBottom > 0
        ? Math.ceil(inventoryBottom) + 8
        : immersive && layout.sticks === "overlay" ? 44 : 0;
      wrap.style.setProperty("--arena-playfield-top", `${playfieldTop}px`);
      wrap.style.setProperty("--arena-canvas-width", `${canvasWidth}px`);
      wrap.style.setProperty("--arena-canvas-height", `${canvasHeight}px`);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    for (const selector of [".difficulty-badge", ".pilot-rail", ".pilot-rail small", ".rival-rail"]) {
      const element = wrap.querySelector(selector);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [immersive, layout.arena, layout.preset, layout.sticks, mode, net?.phase, viewProfile.verticalRails]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("wh-playing", immersive);
    return () => root.classList.remove("wh-playing");
  }, [immersive]);

  /**
   * A menu is modal, so the page behind it must not scroll.
   *
   * Without this the cockpit underneath still took the wheel and kept its own
   * scrollbar: at a range of short viewports the document scrolled behind an
   * open menu, which is both the classic scroll-bleed bug and the thing the
   * brief rules out — the game's viewport should never scroll unexpectedly.
   */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("wh-menu-open", menuOpen);
    return () => root.classList.remove("wh-menu-open");
  }, [menuOpen]);

  const stopVictorySuction = useCallback((fadeSeconds = 0.035) => {
    const active = victorySuctionAudio.current;
    if (!active) return;
    victorySuctionAudio.current = null;
    const now = active.context.currentTime;
    const stopAt = now + Math.max(0.012, fadeSeconds);
    try {
      active.master.gain.cancelScheduledValues(now);
      active.master.gain.setValueAtTime(Math.max(0.0001, active.master.gain.value), now);
      active.master.gain.exponentialRampToValueAtTime(0.0001, stopAt);
      active.oscillators.forEach((oscillator) => oscillator.stop(stopAt + 0.01));
    } catch {
      // Closing or suspended mobile audio contexts can reject late automation.
    }
  }, []);

  useEffect(() => {
    const pool = audioPool.current;
    return () => {
      stopVictorySuction(0.012);
      pool.forEach((clips) => clips.forEach((clip) => { clip.pause(); clip.removeAttribute("src"); clip.load(); }));
      pool.clear();
      void cueAudio.current?.close().catch(() => undefined);
      cueAudio.current = null;
    };
  }, [stopVictorySuction]);

  /** Pooled playback: three reusable elements per clip instead of one per shot. */
  const play = useCallback((name: "fire" | "explosion" | "magic" | "thrust", volume = 0.22, playbackRate = 1) => {
    if (!soundRef.current) return;
    let clips = audioPool.current.get(name);
    if (!clips) {
      clips = Array.from({ length: 3 }, () => {
        const clip = new Audio(`/sounds/${name}.wav`);
        clip.preload = "auto";
        return clip;
      });
      audioPool.current.set(name, clips);
    }
    const clip = clips.find((item) => item.paused || item.ended) ?? clips[0];
    // The volume setting is a real gain on every effect, not a label.
    clip.volume = cap(volume * SOUND_GAIN[soundLevelRef.current], 0, 1);
    clip.playbackRate = cap(playbackRate, 0.5, 2);
    try { clip.currentTime = 0; } catch { /* Safari throws before metadata loads. */ }
    void clip.play().catch(() => undefined);
  }, []);

  /**
   * Procedural event cues avoid a large audio download while giving every
   * power-up a stable, recognizable two-note signature.
   */
  const playCue = useCallback((cue: string, volume = 0.16) => {
    if (!soundRef.current || typeof window === "undefined") return;
    const AudioContextClass = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = cueAudio.current ?? new AudioContextClass();
    cueAudio.current = context;
    void context.resume().catch(() => undefined);

    const hash = [...cue].reduce((value, character) => ((value * 33) ^ character.charCodeAt(0)) >>> 0, 5381);
    // Overcharges get a longer, lower, four-note signature than any pickup
    // cue, so a special is identifiable with the screen covered by a thumb.
    const special = cue === "rift-level"
      // Short and rising: the roadmap asks for a pulse that marks the level
      // without interrupting the fight.
      ? { frequencies: [300, 460, 700], duration: 0.38, gap: 0.05, type: "triangle" as OscillatorType }
      : cue === "wormhole-explosion"
      ? { frequencies: [72, 48, 34, 150], duration: 1.35, gap: 0.08, type: "sawtooth" as OscillatorType }
      : cue === "overcharge:swarm"
        ? { frequencies: [520, 700, 940, 1240], duration: 0.78, gap: 0.055, type: "triangle" as OscillatorType }
      : cue === "overcharge:scrambler"
        ? { frequencies: [640, 400, 250, 155], duration: 0.9, gap: 0.075, type: "sine" as OscillatorType }
      : cue === "overcharge:core"
        ? { frequencies: [110, 74, 52, 190], duration: 1.05, gap: 0.085, type: "sawtooth" as OscillatorType }
      : cue === "ricochet"
        ? { frequencies: [720, 980], duration: 0.09, gap: 0.018, type: "triangle" as OscillatorType }
      : cue === "cannon-hit"
        ? { frequencies: [185, 122], duration: 0.075, gap: 0.012, type: "square" as OscillatorType }
      : cue === "emp-hit"
        ? { frequencies: [920, 510, 260], duration: 0.34, gap: 0.035, type: "sawtooth" as OscillatorType }
      : cue === "shield-pickup"
        ? { frequencies: [420, 680, 1020], duration: 0.46, gap: 0.07, type: "sine" as OscillatorType }
      : cue === "inventory-full"
        ? { frequencies: [540, 760, 1080], duration: 0.3, gap: 0.045, type: "triangle" as OscillatorType }
      : cue === "shield-down"
          ? { frequencies: [330, 210, 95], duration: 0.62, gap: 0.08, type: "square" as OscillatorType }
          : {
              frequencies: [180 + hash % 520, 260 + (hash >>> 5) % 720],
              duration: 0.34,
              gap: 0.055,
              type: (["sine", "triangle", "square", "sawtooth"] as OscillatorType[])[hash % 4],
            };

    const start = context.currentTime;
    special.frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const noteStart = start + index * special.gap;
      const noteEnd = noteStart + special.duration / special.frequencies.length;
      oscillator.type = special.type;
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      if (cue === "wormhole-explosion" || cue === "overcharge:core") {
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(24, frequency * 0.45), noteEnd);
      }
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), noteStart + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + 0.02);
    });
  }, []);

  /**
   * Continuous victory riser: audible from the first pull frame through the
   * singularity collapse, then faded out just before the blast cue begins.
   */
  const playVictorySuction = useCallback((frequencyHz: number, remainingSeconds: number, volume = 0.085) => {
    if (!soundRef.current || victorySuctionAudio.current || typeof window === "undefined") return;
    const AudioContextClass = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = cueAudio.current ?? new AudioContextClass();
    cueAudio.current = context;
    void context.resume().catch(() => undefined);

    const start = context.currentTime + 0.01;
    const duration = Math.max(0.08, remainingSeconds - 0.06);
    const end = start + duration;
    const fadeInEnd = Math.min(end - 0.02, start + 0.12);
    const fadeOutStart = Math.max(fadeInEnd, end - 0.09);
    const master = context.createGain();
    const filter = context.createBiquadFilter();
    master.gain.setValueAtTime(0.0001, start);
    master.gain.exponentialRampToValueAtTime(volume, fadeInEnd);
    master.gain.setValueAtTime(volume, fadeOutStart);
    master.gain.exponentialRampToValueAtTime(0.0001, end);
    filter.type = "lowpass";
    filter.Q.setValueAtTime(5.5, start);
    filter.frequency.setValueAtTime(240, start);
    filter.frequency.exponentialRampToValueAtTime(6200, end);
    filter.connect(master);
    master.connect(context.destination);

    const voices = [
      { type: "sawtooth" as OscillatorType, ratio: 1, level: 0.62 },
      { type: "triangle" as OscillatorType, ratio: 1.5, level: 0.34 },
    ];
    const oscillators = voices.map((voice) => {
      const oscillator = context.createOscillator();
      const voiceGain = context.createGain();
      oscillator.type = voice.type;
      oscillator.frequency.setValueAtTime(frequencyHz * voice.ratio, start);
      oscillator.frequency.exponentialRampToValueAtTime(VICTORY_SUCTION_FREQUENCY.endHz * voice.ratio, end);
      voiceGain.gain.setValueAtTime(voice.level, start);
      oscillator.connect(voiceGain);
      voiceGain.connect(filter);
      oscillator.start(start);
      oscillator.stop(end + 0.02);
      return oscillator;
    });
    victorySuctionAudio.current = { context, master, oscillators };
  }, []);

  useEffect(() => {
    if (!sound) stopVictorySuction();
  }, [sound, stopVictorySuction]);

  const sync = useCallback(() => {
    const next = hudFrom(gameRef.current);
    setHud((previous) => (hudEqual(previous, next) ? previous : next));
  }, []);

  /* Browser regression tests can deterministically exercise empty, partial,
     and full queue presentation without changing pickup spawn behavior. */
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const seedStock = (event: Event) => {
      const detail = (event as CustomEvent<PowerId[]>).detail;
      if (!Array.isArray(detail)) return;
      gameRef.current.stock = detail.filter((id): id is PowerId => id in WEAPONS).slice(0, STOCK_LIMIT);
      sync();
    };
    window.addEventListener("breach-runner:test-stock", seedStock);
    return () => window.removeEventListener("breach-runner:test-stock", seedStock);
  }, [sync]);

  /** Sends a completed initials-tagged victory to the public arcade board. */
  const saveRun = useCallback(async (run: RunResult) => {
    setSaveState({ status: "saving" });
    const result = await saveScoreToMurph(run);

    if (result.status === "saved") {
      setSaveState({ status: "saved", rank: result.rank });
      return;
    }

    setSaveState({ status: "error", message: result.message });
  }, []);

  /**
   * Sends a completed initials-tagged Survival run to the public Survival
   * board.
   *
   * The endpoint is not live yet, so this ordinarily reports the failure state
   * — which is why the device board is the one the result card leads with. The
   * run is never lost either way.
   */
  const saveSurvivalRunToBoard = useCallback(async (run: RunResult) => {
    setSaveState({ status: "saving" });
    const result = await saveSurvivalScoreToMurph(run);

    if (result.status === "saved") {
      setSaveState({ status: "saved", rank: result.rank });
      return;
    }

    setSaveState({ status: "error", message: result.message });
  }, []);

  // Network modes share the proven WebSocket lobby. Solo PvE never opens a socket.
  useEffect(() => {
    if (mode === "pve") {
      netRef.current?.disconnect();
      netRef.current = null;
      return;
    }
    const client = new PvpClient(mode === "coop" ? "coop" : "pvp", difficulty);
    netRef.current = client;
    const unsubscribe = client.subscribe(setNet);
    client.connect();
    return () => {
      unsubscribe();
      client.disconnect();
      netRef.current = null;
    };
  }, [difficulty, mode]);

  const chooseMode = useCallback((next: GameMode) => {
    modePreference.set(next);
    // Picking an arcade mode leaves the challenge. Survival has no co-op or
    // PvP balance behind it, and leaving the preference set would make the
    // Modes screen show a ticked challenge next to a ticked arcade mode.
    if (difficultyPreference.get() === "survival") difficultyPreference.set("difficult");
  }, []);
  const chooseDifficulty = useCallback((next: DifficultyId) => {
    difficultyPreference.set(next);
  }, []);
  /** Rift Survival is a solo challenge, so choosing it also returns to PvE. */
  const chooseSurvival = useCallback(() => {
    modePreference.set("pve");
    difficultyPreference.set("survival");
  }, []);

  // A run just ended: record it on this device and prepare leaderboard data.
  useEffect(() => {
    if (!hud.result) {
      recordedResult.current = null;
      return;
    }
    if (recordedResult.current === hud.result) return;
    recordedResult.current = hud.result;

    const settlement = settleScore(hud.score, hud.elapsedSeconds, hud.result);
    const practice = hud.difficulty === "practice";
    // Survival's score already grew with every second survived, and
    // `settleScore` only charges the time penalty on a victory — which
    // Survival, having no win condition, can never produce. So the roadmap's
    // "the normal PvE time penalty does not apply" needs no exception here.
    const survivalRun = hud.difficulty === "survival";
    const run: RunResult = {
      runId: createArcadeRunId(),
      score: settlement.finalScore,
      baseScore: settlement.baseScore,
      timePenalty: settlement.timePenalty,
      difficulty: hud.difficulty,
      outcome: hud.result,
      ship: runShipName.current,
      rivalHealth: hud.rivalHealth,
      durationSeconds: settlement.durationSeconds,
      practice,
      finalTarget: hud.result === "victory"
        ? hud.mode === "pve" || hud.mode === "coop"
          ? "RIVAL RIFT"
          : netResult?.eliminatedName ?? "OPPONENT"
        : hud.mode === "pve"
          ? "YOUR PILOT"
          : netResult?.youEliminated
            ? "YOUR PILOT"
            : hud.mode === "coop"
              ? `ALLY ${netResult?.eliminatedName ?? "PILOT"}`
              : netResult?.eliminatedName ?? "OPPONENT",
      finalCause: hud.mode === "pve"
        ? hud.result === "victory" ? hud.rivalFinalCause : hud.deathCause
        : netResult?.cause ?? "unknown",
      finalDamage: hud.mode === "pve"
        ? hud.result === "victory" ? hud.rivalFinalDamage : hud.deathDamage
        : netResult?.finalDamage ?? 0,
      finalReason: hud.mode === "pve" ? (hud.result === "victory" ? "rival" : "pilot_hull") : netResult?.reason,
      riftLevel: survivalRun ? hud.riftLevel : undefined,
      breaches: survivalRun ? hud.breaches : undefined,
    };

    const storedInitials = settings.playerInitials;
    const identifiedRun = storedInitials ? { ...run, initials: storedInitials } : run;
    setInitialsEntry(storedInitials);
    if (survivalRun) {
      // Survival keeps its own device board and stays out of the arcade one.
      const placement = recordSurvivalRun(identifiedRun);
      setSummary({
        run: identifiedRun,
        best: null,
        isBest: placement.rank === 1,
        runs: 0,
        restored: false,
        // A run that placed is worth signing, so an unnamed pilot is asked for
        // initials here exactly as a PvE victory is.
        awaitingInitials: placement.rank !== null && !storedInitials,
        deathCause: hud.deathCause,
        survivalRank: placement.rank,
        survivalBoard: placement.board,
      });
    } else if (hud.result === "victory" && hud.mode === "pve" && !practice && !storedInitials) {
      setSummary({
        run,
        best: loadLocalBest(),
        isBest: false,
        runs: 0,
        restored: false,
        awaitingInitials: true,
        deathCause: hud.deathCause,
      });
    } else if (practice) {
      setSummary({ run: identifiedRun, best: loadLocalBest(), isBest: false, runs: 0, restored: false, awaitingInitials: false, deathCause: hud.deathCause });
    } else {
      const local = saveLocalRun(identifiedRun);
      setSummary({ run: identifiedRun, best: local.best, isBest: local.isBest, runs: local.runs, restored: false, awaitingInitials: false, deathCause: hud.deathCause });
    }
    setSaveState({ status: "idle" });
  }, [hud.breaches, hud.deathCause, hud.deathDamage, hud.difficulty, hud.elapsedSeconds, hud.mode, hud.result, hud.riftLevel, hud.rivalFinalCause, hud.rivalFinalDamage, hud.rivalHealth, hud.score, netResult, settings.playerInitials]);

  // Every initials-tagged, non-Practice solo victory joins the public board.
  useEffect(() => {
    if (
      mode !== "pve" ||
      !summary ||
      summary.awaitingInitials ||
      summary.run.outcome !== "victory" ||
      summary.run.practice ||
      !summary.run.initials ||
      autoSavedRun.current === summary.run
    ) return;
    autoSavedRun.current = summary.run;
    void saveRun(summary.run);
  }, [mode, saveRun, summary]);

  // Every initials-tagged Survival run joins the public Survival board. It is
  // a separate effect from the arcade one because it is a separate board with
  // a separate ordering, and the arcade submitter rejects a run with no
  // victory to settle.
  useEffect(() => {
    if (
      !summary ||
      summary.awaitingInitials ||
      summary.run.difficulty !== "survival" ||
      !summary.run.initials ||
      summary.survivalRank === null ||
      autoSavedRun.current === summary.run
    ) return;
    autoSavedRun.current = summary.run;
    void saveSurvivalRunToBoard(summary.run);
  }, [saveSurvivalRunToBoard, summary]);

  // Before a run, keep the idle arena matching the selection so the preview
  // shows exactly what START will produce (EASY re-centres the wormhole at
  // once). Mutating the ref is enough: the canvas reads it every frame, so no
  // React state has to change for the preview to update.
  useEffect(() => {
    const game = gameRef.current;
    if (game.running || game.result) return;
    gameRef.current = createGame(selectedShip(shipId), mode, difficulty);
  }, [difficulty, mode, shipId]);

  const start = useCallback(() => {
    stopVictorySuction();
    const game = createGame(selectedShip(shipId), mode, difficulty);
    game.running = true;
    game.notice = "ENTERING NEW GROUND";
    gameRef.current = game;
    keys.current = {};
    moveStickPointer.current = null;
    aimStickPointer.current = null;
    moveHeading.current = null;
    aimHeading.current = null;
    setMoveStickPosition({ active: false, x: 0, y: 0 });
    setAimStickPosition({ active: false, x: 0, y: 0 });
    setInspect(null);
    setCodexOpen(false);
    setSummary(null);
    setSaveState({ status: "idle" });
    setInitialsEntry("");
    runShipName.current = game.ship.name;
    sync();
    canvasWrapRef.current?.focus({ preventScroll: true });
    setLaunched(true);
    closeMenu();
    play("magic", 0.28);
  }, [closeMenu, difficulty, mode, play, shipId, stopVictorySuction, sync]);

  // The server decides when the match is live. When it says so, launch the
  // local arena; the client never starts a PvP run on its own timing.
  const netPhase = net?.phase ?? null;
  useEffect(() => {
    if (netPhase !== "active") return;
    const game = gameRef.current;
    if (game.mode !== "pve" && game.running && !game.result) return;
    start();
  }, [netPhase, start]);

  // Hull is reconciled from the server, never trusted from local arithmetic,
  // and only the server's result ends a PvP match.
  const serverHull = net?.yourCombat?.hull ?? null;
  useEffect(() => {
    const game = gameRef.current;
    if (game.mode === "pve" || serverHull === null) return;
    game.player.health = serverHull;
  }, [serverHull]);

  const coopRival = net?.rival ?? null;
  useEffect(() => {
    if (!coopRival) return;
    const game = gameRef.current;
    if (game.mode !== "coop") return;
    game.rivalHealth = coopRival.hull;
    game.rivalMaxHealth = coopRival.maxHull;
    game.score = coopRival.score;
  }, [coopRival]);

  useEffect(() => {
    if (!netResult) return;
    const game = gameRef.current;
    if (game.mode === "pve") return;
    if (game.mode === "coop" && netResult.outcome === "victory") {
      // Reuse the full Release C collapse/explosion sequence for a shared win.
      game.rivalHealth = 0;
      game.victorySequence = ticksForSeconds(VICTORY_TOTAL_SECONDS);
      game.victoryExplosionFired = false;
      game.notice = "CO-OP VICTORY // REALITY LOCKED";
      game.noticeLife = 180;
      return;
    }
    game.running = false;
    game.result = netResult.outcome === "victory" ? "victory" : "defeat";
    game.notice =
      netResult.reason === "forfeit"
        ? `${netResult.opponent} DID NOT RETURN`
        : netResult.outcome === "victory"
          ? `${netResult.opponent} DESTROYED`
          : game.mode === "coop" ? "CO-OP TEAM DESTROYED" : "SHIP DESTROYED";
    game.noticeLife = 180;
  }, [netResult]);

  useEffect(() => {
    if (net?.rematch?.status !== "starting") return;
    queueMicrotask(() => {
      setSummary(null);
      setMenu(resetRoute("lobby"));
    });
  }, [net?.rematch?.status]);

  const confirmInitials = useCallback(() => {
    const initials = normalizeInitials(initialsEntry);
    if (initials.length !== 3 || !summary?.awaitingInitials) return;

    const run = { ...summary.run, initials };
    setSetting("playerInitials", initials);

    if (run.difficulty === "survival") {
      // The run is already on the board; it was recorded before the pilot had
      // a name. Re-stamp that row rather than adding a second copy of it.
      const placement = nameSurvivalRun(run.runId, initials);
      setSummary({
        ...summary,
        run,
        awaitingInitials: false,
        survivalRank: placement.rank,
        survivalBoard: placement.board,
      });
      (document.activeElement as HTMLElement | null)?.blur();
      return;
    }

    const local = saveLocalRun(run);
    setSummary({
      ...summary,
      run,
      best: local.best,
      isBest: local.isBest,
      runs: local.runs,
      awaitingInitials: false,
    });
    (document.activeElement as HTMLElement | null)?.blur();
  }, [initialsEntry, setSetting, summary]);

  /**
   * Pause, as one rule for every mode.
   *
   * PvE freezes the simulation. A network match cannot freeze — the opponent
   * keeps playing — so the same screen opens and says so rather than pretending
   * the world stopped. Either way the player lands on the same pause surface,
   * so Menu means one thing everywhere.
   */
  const setPaused = useCallback((paused: boolean) => {
    const game = gameRef.current;
    if (!game.running || game.result) return;
    if (game.mode !== "pve") {
      game.notice = game.mode === "coop" ? "CO-OP // TEAM PLAY CONTINUES" : "PVP // MATCH CONTINUES";
      game.noticeLife = 90;
      sync();
      return;
    }
    if (game.paused === paused) return;
    game.paused = paused;
    game.notice = paused ? "SIMULATION PAUSED" : "SYSTEMS ONLINE";
    game.noticeLife = 90;
    sync();
  }, [sync]);

  /**
   * The one Menu action, shared by the global button, P and Escape.
   *
   * Open during a run means Pause; open otherwise means Home; open while
   * something is already open means close. Because every entry point calls
   * this, the button cannot mean different things on different screens.
   */
  const toggleMenu = useCallback(() => {
    // Computed outside the updater on purpose: pausing is a side effect, and
    // React may invoke a state updater more than once.
    const next = menuButtonTarget(
      menuRef.current,
      gameRef.current.running && !gameRef.current.result
    );
    setPaused(menuIsOpen(next));
    setMenu(next);
  }, [setPaused]);

  /** Fullscreen state, owned by the global layer and derived from the browser. */
  const fullscreen = useFullscreen(useCallback(() => shellRef.current, []));

  /**
   * Play, from anywhere in the menu.
   *
   * Network modes need a lobby before a run exists, so Play routes there
   * instead of launching into nothing. Solo launches straight away — the
   * remembered mode, difficulty and ship are already on screen, so there is
   * nothing left to confirm.
   */
  const launchFromMenu = useCallback(() => {
    if (mode === "pve") { start(); return; }
    setMenu(resetRoute("lobby"));
  }, [mode, start]);

  /** Back out of the menu: resume the run if there is one, else stay home. */
  const resumeOrClose = useCallback(() => {
    if (gameRef.current.running && !gameRef.current.result) {
      setPaused(false);
      closeMenu();
      canvasWrapRef.current?.focus({ preventScroll: true });
      return;
    }
    setMenu(resetRoute("home"));
  }, [closeMenu, setPaused]);

  const openSettings = useCallback(() => {
    setCodexOpen(false);
    if (activeRoute(menuRef.current) === "settings") return;
    const game = gameRef.current;
    if (game.running && !game.result && !menuIsOpen(menuRef.current)) {
      // setPaused freezes solo only; network matches keep their established
      // live behavior while sharing the same Pause → Settings return path.
      setPaused(true);
      setMenu(["pause", "settings"]);
      return;
    }
    setMenu((stack) => pushRoute(stack, "settings"));
  }, [setPaused]);

  const controllerCancel = useCallback(() => controllerCancelRef.current(), []);
  useEffect(() => {
    controllerCancelRef.current = () => {
      const target = controllerCancelTarget({ codex: codexOpen, summary: Boolean(summary), route });
      if (target === "close-codex") { setCodexOpen(false); return; }
      // A result has no inert cockpit behind it. Cancel leaves its valid action
      // surface in place instead of dismissing or navigating underneath it.
      if (target === "hold-summary" || target === "none") return;
      if (target === "resume") { resumeOrClose(); return; }
      back();
    };
  }, [back, codexOpen, resumeOrClose, route, summary]);

  /**
   * End the current run, then go somewhere.
   *
   * Every exit from a live run funnels through here, which is what keeps the
   * interface honest. Changing ship or mode used to write the new preference
   * while the old game object stayed alive and resumable: the menu would then
   * describe one ship and the simulation run another, and switching mode tore
   * down and rebuilt the match client underneath a run the player could still
   * Back into. Ending the run first makes that state unreachable.
   *
   * The leave decision reads the *running game's* mode rather than the stored
   * preference, so a network match is always left through the client that
   * actually owns it.
   */
  const endRun = useCallback((next: MenuRoute) => {
    const game = gameRef.current;
    if (game.mode !== "pve") netRef.current?.leave();
    game.running = false;
    game.paused = false;
    stopVictorySuction();
    setSummary(null);
    setLaunched(false);
    gameRef.current = createGame(selectedShip(shipId), mode, difficulty);
    sync();
    setMenu(resetRoute(next));
  }, [difficulty, mode, shipId, stopVictorySuction, sync]);

  /** Abandon the current run and return to the main menu. */
  const quitRun = useCallback(() => endRun("home"), [endRun]);

  const renderShip = useCallback(
    (id: ShipId, size: number) => <MenuShip id={id} size={size} />,
    []
  );

  const setControl = useCallback((code: string, active: boolean) => {
    keys.current[code] = active;
  }, []);

  const releaseStick = useCallback((kind: StickKind, pointerId?: number) => {
    const pointer = kind === "move" ? moveStickPointer : aimStickPointer;
    if (pointerId !== undefined && pointer.current !== pointerId) return;
    pointer.current = null;
    if (kind === "move") {
      moveHeading.current = null;
      setControl("ArrowUp", false);
      setMoveStickPosition({ active: false, x: 0, y: 0 });
    } else {
      aimHeading.current = null;
      setControl("Space", false);
      setAimStickPosition({ active: false, x: 0, y: 0 });
    }
  }, [setControl]);

  const updateStick = useCallback((kind: StickKind, clientX: number, clientY: number) => {
    const stick = kind === "move" ? moveStickRef.current : aimStickRef.current;
    if (!stick) return;
    const rect = stick.getBoundingClientRect();
    const maxTravel = Math.max(28, rect.width * 0.29);
    let x = clientX - (rect.left + rect.width / 2);
    let y = clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(x, y);
    if (distance > maxTravel) {
      const clamp = maxTravel / distance;
      x *= clamp;
      y *= clamp;
    }

    if (distance > maxTravel * 0.08) {
      if (kind === "move") moveHeading.current = Math.atan2(y, x) / DEG;
      else aimHeading.current = Math.atan2(y, x) / DEG;
    }
    setControl(kind === "move" ? "ArrowUp" : "Space", true);
    if (kind === "move") setMoveStickPosition({ active: true, x, y });
    else setAimStickPosition({ active: true, x, y });
  }, [setControl]);

  const engageStick = useCallback((kind: StickKind, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const pointer = kind === "move" ? moveStickPointer : aimStickPointer;
    if (pointer.current !== null) return;
    pointer.current = event.pointerId;
    if (kind === "move") moveHeading.current = gameRef.current.player.angle;
    else aimHeading.current = gameRef.current.player.angle;
    setControl(kind === "move" ? "ArrowUp" : "Space", true);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!reducedMotionRef.current && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(8);
    updateStick(kind, event.clientX, event.clientY);
  }, [setControl, updateStick]);

  const moveStick = useCallback((kind: StickKind, event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = kind === "move" ? moveStickPointer : aimStickPointer;
    if (pointer.current !== event.pointerId) return;
    event.preventDefault();
    updateStick(kind, event.clientX, event.clientY);
  }, [updateStick]);

  const updateMouseAim = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "touch") return;
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    // Convert the cursor from CSS pixels into arena coordinates, then undo the
    // active camera transform. This keeps mouse aim exact in both ship-lock and
    // full-arena camera modes.
    const screenX = ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH;
    const screenY = ((event.clientY - rect.top) / rect.height) * VIEW_HEIGHT;
    const game = gameRef.current;
    const player = game.player;
    const locked = cameraRef.current;
    const camScale = locked ? ZOOM_SCALE[zoomRef.current] : Math.min(VIEW_WIDTH / game.worldWidth, VIEW_HEIGHT / game.worldHeight);
    const camX = locked ? cap(VIEW_WIDTH / 2 - player.x * camScale, VIEW_WIDTH - game.worldWidth * camScale, 0) : (VIEW_WIDTH - game.worldWidth * camScale) / 2;
    const camY = locked ? cap(VIEW_HEIGHT / 2 - player.y * camScale, VIEW_HEIGHT - game.worldHeight * camScale, 0) : (VIEW_HEIGHT - game.worldHeight * camScale) / 2;
    const worldX = (screenX - camX) / camScale;
    const worldY = (screenY - camY) / camScale;
    aimHeading.current = (Math.atan2(worldY - player.y, worldX - player.x) * 180) / Math.PI;
  }, []);

  const handleArenaPointerMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    updateMouseAim(event);
  }, [updateMouseAim]);

  const handleArenaPointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "touch" || (event.button !== 0 && event.button !== 2)) return;
    event.preventDefault();
    updateMouseAim(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    keys.current[event.button === 0 ? "MousePrimary" : "MouseSecondary"] = true;
  }, [updateMouseAim]);

  const handleArenaPointerUp = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "touch") return;
    const cancelled = event.type === "pointercancel";
    if (!cancelled && event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    // Defer release until the fixed game tick has observed even a very quick
    // click, matching the keyboard tap handling. A cancelled pointer releases
    // both triggers so a lost capture can never leave a weapon firing.
    if (cancelled) pendingRelease.current.push("MousePrimary", "MouseSecondary");
    else pendingRelease.current.push(event.button === 0 ? "MousePrimary" : "MouseSecondary");
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }, []);

  useEffect(() => {
    // Every key the game claims, so none of them scrolls the page. Movement
    // comes from the shared list, so WASD and the arrows stay in step.
    const gameKeys = [...MOVEMENT_CODES, "Space", "KeyE", "KeyQ", "KeyP"] as string[];
    const down = (event: KeyboardEvent) => {
      const code = event.code;
      const target = event.target as HTMLElement | null;
      // Text entry keeps every key. Space and Enter also stay with a focused
      // button or link so it can still be activated from the keyboard.
      const editing = Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
      const activating = (code === "Space" || code === "Enter") && Boolean(target?.closest("button, a[href]"));
      if (editing || activating) return;

      // A menu is open: it owns the keyboard. Escape and P still close it, but
      // no key reaches the simulation, so arrow keys used to walk a menu can
      // never fly the ship behind it.
      if (menuOpenRef.current) {
        if (code === "Escape" || (code === "KeyP" && !event.repeat)) {
          event.preventDefault();
          toggleMenu();
        }
        return;
      }

      if (code === "Escape") {
        setInspect(null);
        if (codexOpenRef.current) { setCodexOpen(false); return; }
        event.preventDefault();
        toggleMenu();
        return;
      }
      if (gameKeys.includes(code)) event.preventDefault();
      if (code === "Enter" && (!gameRef.current.running || gameRef.current.result)) start();
      if (code === "KeyP" && !event.repeat) { toggleMenu(); return; }
      keys.current[code] = true;
    };
    const up = (event: KeyboardEvent) => { pendingRelease.current.push(event.code); };
    const blur = () => {
      keys.current = {};
      pendingRelease.current.length = 0;
      moveStickPointer.current = null;
      aimStickPointer.current = null;
      moveHeading.current = null;
      aimHeading.current = null;
      setMoveStickPosition({ active: false, x: 0, y: 0 });
      setAimStickPosition({ active: false, x: 0, y: 0 });
    };
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [start, toggleMenu]);

  // Controllers are optional and hot-pluggable. Gameplay consumes actions,
  // never vendor button labels; standard Xbox and PlayStation pads therefore
  // share the same map without changing the saved view/input preference.
  useEffect(() => {
    let frame = 0;
    let previous = EMPTY_GAMEPAD;
    let lastMenuMove = 0;
    const poll = (now: number) => {
      const action = controllerStateForPads(Array.from(navigator.getGamepads?.() ?? []));
      controllerInput.current = action;
      const controls = visibleControllerControls();
      if (controls.length > 0) {
        const direction = action.menuY || action.menuX;
        if (direction && (!previous.menuX && !previous.menuY || now - lastMenuMove > 220)) {
          lastMenuMove = now;
          moveControllerFocus(controls, action.menuX, action.menuY);
        }
        if (pressedOnce(action.confirm, previous.confirm)) (document.activeElement as HTMLElement)?.click?.();
        if (pressedOnce(action.cancel, previous.cancel)) controllerCancel();
      } else {
        const pupStep = pressedOnce(action.nextPup, previous.nextPup) ? 1 : pressedOnce(action.previousPup, previous.previousPup) ? -1 : 0;
        if (pupStep) {
          const stock = gameRef.current.stock;
          if (stock.length) {
            setInspect((currentInspect) => {
              const current = currentInspect ? stock.lastIndexOf(currentInspect.id as PowerId) : stock.length - 1;
              return { id: stock[(Math.max(0, current) + pupStep + stock.length) % stock.length], pinned: true };
            });
          }
        }
      }
      if (pressedOnce(action.pause, previous.pause)) toggleMenu();
      previous = action;
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => { cancelAnimationFrame(frame); controllerInput.current = EMPTY_GAMEPAD; };
  }, [controllerCancel, toggleMenu]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let raf = 0;
    let previous = performance.now();
    let accumulator = 0;
    let hudDelay = 0;
    let lastGunFeedbackTick = -999;

    const vibrateCombat = (event: "gun" | "hull") => {
      if (reducedMotionRef.current || !hapticsAllow(combatHapticsRef.current, event)) return;
      if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
      navigator.vibrate(event === "gun" ? 9 : 24);
    };

    const cannonImpactFeedback = (game: Game, bullet: Bullet) => {
      if (bullet.enemy || bullet.special || game.cycles - lastGunFeedbackTick < 2) return;
      lastGunFeedbackTick = game.cycles;
      vibrateCombat("gun");
      if (cannonHitSoundRef.current) playCue("cannon-hit", 0.075);
    };

    // Rendering geometry. The 1048 × 655 viewport is the same 1.6:1
    // shape as the authoritative 1504 × 940 world.
    const initialRect = canvas.getBoundingClientRect();
    let cssWidth = Math.max(1, initialRect.width || VIEW_WIDTH);
    let cssHeight = Math.max(1, initialRect.height || VIEW_HEIGHT);
    let worldScale = 1;
    let cssScale = 1;
    let needsResize = true;

    const touchDevice = navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;
    const densePanel = (window.devicePixelRatio || 1) > 2;
    let autoQ = touchDevice || densePanel ? 0.55 : 1;
    let appliedQ = -1;
    let profile = profileFor(autoQ);
    let frameAverage = 16.7;
    let samples = 0;

    const applyProfile = () => {
      const mode = qualityRef.current;
      const q = mode === "high" ? 1 : mode === "performance" ? 0.25 : autoQ;
      if (q === appliedQ) return;
      appliedQ = q;
      profile = profileFor(q);
      needsResize = true;
    };
    applyProfile();

    const applyResize = () => {
      needsResize = false;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const targetWidth = Math.max(420, Math.min(profile.maxBackingPx, Math.round(cssWidth * dpr)));
      const targetHeight = Math.max(263, Math.round(targetWidth * VIEW_HEIGHT / VIEW_WIDTH));
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }
      worldScale = targetWidth / VIEW_WIDTH;
      cssScale = targetWidth / cssWidth;
    };

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      const height = entries[0]?.contentRect.height ?? 0;
      if ((width > 0 && Math.abs(width - cssWidth) > 0.5) || (height > 0 && Math.abs(height - cssHeight) > 0.5)) {
        cssWidth = Math.max(1, width);
        cssHeight = Math.max(1, height);
        needsResize = true;
      }
    });
    observer.observe(canvas);
    const onDprChange = () => { needsResize = true; };
    window.addEventListener("resize", onDprChange, { passive: true });
    window.addEventListener("orientationchange", onDprChange, { passive: true });

    const burst = (game: Game, x: number, y: number, color: string, count: number, speed: number) => {
      const scale = reducedMotionRef.current ? 0.35 : 0.45 + profile.detail * 0.55;
      spawnParticles(game, x, y, color, Math.max(2, Math.round(count * scale)), speed, profile.maxParticles);
    };

    const pushSpawn = (game: Game, kind: SpawnKind, type: PickupId, x: number, y: number, count: number) => {
      game.spawns.push({ x, y, type, kind, age: 0, life: kind === "hostile" ? 145 : 115, count });
      game.portalPulse = 1;
    };

    /**
     * Terminal hull path. Every source of hull loss ends up here.
     *
     * In PvP the local number is a prediction only: hull is reconciled from
     * the server on every state message, and the server alone declares a
     * result. The client never ends a PvP match on its own arithmetic.
     */
    const applyHullDamage = (game: Game, amount: number) => {
      const player = game.player;
      if (game.rules.unlimitedHull) {
        player.health = player.maxHealth;
        game.notice = "SIMULATION // HULL LOCKED";
        game.noticeLife = 55;
        return;
      }
      if (amount > 0) vibrateCombat("hull");
      player.health -= amount;
      if (game.mode !== "pve") {
        player.health = Math.max(0, player.health);
        return;
      }
      if (player.health > 0) return;
      player.health = 0;
      game.running = false;
      game.result = "defeat";
      game.notice = "SHIP DESTROYED";
      burst(game, player.x, player.y, "#ffb346", 70, 13);
    };

    /**
     * Tells the server what just hit us. It decides what that costs; the
     * `source` split matches the single-player one exactly, so the collision
     * shield covers impacts only on both sides of the wire.
     */
    const report = (game: Game, source: "collision" | "impact", amount: number, cause: string) => {
      if (game.mode !== "pve") netRef.current?.reportDamage(source, amount, cause);
    };

    /**
     * Non-collision damage: projectiles, beams and blasts.
     *
     * Deliberately does NOT consult the Easy collision shield — that shield
     * covers impacts only, and routing weapon fire through it would quietly
     * turn it into blanket immunity.
     */
    const damagePlayer = (game: Game, amount: number, cause = "hostile_projectile") => {
      const player = game.player;
      if (game.result || player.invuln > 0 || player.shield > 0) return;
      player.invuln = 24;
      burst(game, player.x, player.y, "#ff5570", 18, 7);
      play("explosion", 0.24);
      game.lastDamageCause = cause;
      game.lastDamageAmount = Math.min(player.health, amount);
      report(game, "impact", amount, cause);
      applyHullDamage(game, amount);
    };

    /**
     * Collision damage: walls and hostile bodies.
     *
     * Existing immunity wins first (post-hit i-frames, collectible shield), so
     * the collision shield is never spent while the pilot is already immune.
     * Whatever the collision shield cannot absorb overflows to hull.
     */
    const damageCollision = (game: Game, amount: number, cause = "enemy_collision") => {
      const player = game.player;
      if (game.result || player.invuln > 0 || player.shield > 0) return;

      const shield = game.collisionShield;
      if (!shield) {
        damagePlayer(game, amount, cause);
        return;
      }

      // Report the raw collision, not the post-shield remainder: the server
      // keeps its own shield and must be the one to decide how much of this
      // reaches hull.
      report(game, "collision", amount, cause);
      const hit = absorbCollisionDamage(shield, amount, game.rules);
      if (hit.absorbed > 0) {
        game.shieldRipple = 1;
        play("magic", 0.14);
      }
      if (hit.broke) {
        game.shieldBreak = 1;
        game.notice = "COLLISION SHIELD DOWN";
        game.noticeLife = 90;
        burst(game, player.x, player.y, "#64eaff", 26, 9);
        playCue("shield-down", 0.2);
      }
      if (hit.toHull <= 0) return;

      player.invuln = 24;
      game.lastDamageCause = cause;
      game.lastDamageAmount = Math.min(player.health, hit.toHull);
      burst(game, player.x, player.y, "#ff5570", 18, 7);
      play("explosion", 0.24);
      applyHullDamage(game, hit.toHull);
    };

    /**
     * HARD MODE wormhole contact. Not a collision, so the collision shield
     * never applies; collectible defensive power-ups still do.
     */
    const damageContact = (game: Game, amount: number) => {
      if (game.result || game.player.shield > 0) return;
      burst(game, game.player.x, game.player.y, "#ff5ac8", 10, 6);
      play("explosion", 0.18);
      game.lastDamageCause = "wormhole_contact";
      game.lastDamageAmount = Math.min(game.player.health, amount);
      report(game, "impact", amount, "wormhole_contact");
      applyHullDamage(game, amount);
    };

    const addIncoming = (game: Game, power: PowerId, sizeBonus = 0) => {
      const count = ENEMY_COUNTS[power] * (game.mode === "coop" ? 2 : 1) + Math.max(0, sizeBonus);
      for (let i = 0; i < count; i += 1) game.enemies.push(makeEnemy(power, game.portalX, game.portalY, i, count));
      game.incoming = power;
      game.notice = `INCOMING // ${WEAPONS[power].short}`;
      game.noticeLife = 140;
      pushSpawn(game, "hostile", power, game.portalX, game.portalY, count);
      burst(game, game.portalX, game.portalY, POWER_COLORS[power], 26, 9);
      playCue(`spawn:${power}`, 0.15);
    };

    const spawnEnrageWave = (game: Game) => {
      const enrage = game.rules.wormholeEnrage;
      if (!enrage.enabled || game.mode === "pvp" || game.result) return;
      if (game.mode === "coop" && netRef.current?.state.you?.id !== netRef.current?.state.hostId) return;

      for (const { enemy, count: baseCount } of enrage.wave) {
        const count = baseCount * (game.mode === "coop" ? 2 : 1);
        for (let i = 0; i < count; i += 1) {
          game.enemies.push(makeEnemy(enemy, game.portalX, game.portalY, i, count));
        }
        pushSpawn(game, "hostile", enemy, game.portalX, game.portalY, count);
        playCue(`spawn:${enemy}`, 0.14);
      }

      game.incoming = "ufo";
      game.notice = "RIFT ENRAGED // VOID MINES · RAIDER DRONES · SCAVENGERS";
      game.noticeLife = 180;
      game.portalPulse = 1;
      burst(game, game.portalX, game.portalY, "#ff263f", 52, 12);
      play("explosion", 0.36);
    };

    /**
     * One extra hazard burst from the rift, outside the ordinary wave cycle.
     *
     * Survival's mine storms and sweep beams are not new hostiles — they are
     * the existing ones on their own schedule, which is the whole reason the
     * mode needed no new combat code.
     */
    const spawnSurvivalHostiles = (game: Game, kind: PowerId, count: number, label: string) => {
      if (count <= 0) return;
      for (let i = 0; i < count; i += 1) {
        game.enemies.push(makeEnemy(kind, game.portalX, game.portalY, i, count));
      }
      pushSpawn(game, "hostile", kind, game.portalX, game.portalY, count);
      game.notice = `${label} // ${WEAPONS[kind].short} ×${count}`;
      game.noticeLife = 110;
      burst(game, game.portalX, game.portalY, POWER_COLORS[kind], 22, 8);
      playCue(`spawn:${kind}`, 0.14);
    };

    /**
     * One tick of Rift Survival.
     *
     * Everything here is scheduling: the level clock, the three hazard
     * cadences and the survived-second score. What those cadences produce is
     * ordinary — `addIncoming`, `makeEnemy`, and a rules object the loop was
     * already reading every tick — so raising the difficulty means handing the
     * loop different numbers, not running it down a second code path.
     */
    const tickSurvival = (game: Game) => {
      const survival = game.survival;
      if (!survival || game.result) return;

      // What a level-up means is decided in `advanceSurvival`, as data. All
      // that happens here is applying it.
      const levelUp = advanceSurvival(survival, game.elapsedTicks * TICK_MS / 1000);
      if (levelUp) {
        game.rules = levelUp.rules;
        game.portalThreshold = levelUp.escalation.powerUpCharge;

        // Enrage arrives on the clock here rather than at an integrity
        // threshold, and every later level refreshes the rift's regeneration
        // and its temporary shield.
        if (game.rules.wormholeEnrage.enabled) {
          game.enrageActive = true;
          game.enrageTimer = game.rules.wormholeEnrage.waveIntervalTicks;
          activateEnrageRecovery(game.enrageRecovery, game.rules, game.rivalMaxHealth);
        }

        game.notice = levelUp.notice;
        game.noticeLife = levelUp.stageChanged ? 170 : 120;
        game.portalPulse = 1;
        burst(
          game,
          game.portalX,
          game.portalY,
          levelUp.stageChanged ? "#ff4fd8" : "#68f2ff",
          levelUp.stageChanged ? 44 : 22,
          10
        );
        playCue("rift-level", levelUp.stageChanged ? 0.26 : 0.18);
      }

      const escalation = survival.escalation;

      // Time survived is the score, so it is paid by the second while the run
      // is alive rather than settled at the end — and a minute deep in the run
      // is worth more than the first one.
      survival.secondIn -= 1;
      if (survival.secondIn <= 0) {
        survival.secondIn = ticksForSeconds(1);
        game.score += escalation.secondScore;
      }

      // A full arena skips the wave it was about to spawn instead of queuing
      // another one behind it. An endless mode has no other brake.
      const crowded = game.enemies.length >= SURVIVAL_HOSTILE_CAP;

      survival.waveIn -= 1;
      if (survival.waveIn <= 0) {
        survival.waveIn = escalation.waveIntervalTicks;
        if (!crowded) {
          const pool = escalation.wavePool;
          addIncoming(game, pool[Math.floor(Math.random() * pool.length)], escalation.waveSizeBonus);
        }
      }

      if (escalation.mineStormIntervalTicks > 0) {
        survival.mineStormIn -= 1;
        if (survival.mineStormIn <= 0) {
          survival.mineStormIn = escalation.mineStormIntervalTicks;
          if (!crowded) spawnSurvivalHostiles(game, "mines", escalation.mineStormCount, "MINE STORM");
        }
      }

      // Beams are exempt from the crowding skip on purpose. There are only ever
      // one or two of them, they are anchored to the rift rather than chasing
      // the pilot, and they are the stage's signature threat: the cap exists to
      // stop swarms, not to hide the hazard the player is meant to be dodging.
      if (escalation.beamIntervalTicks > 0) {
        survival.beamIn -= 1;
        if (survival.beamIn <= 0) {
          survival.beamIn = escalation.beamIntervalTicks;
          spawnSurvivalHostiles(
            game,
            "beam",
            escalation.beamCount,
            escalation.beamCount > 1 ? "DOUBLE SWEEP" : "SWEEP BEAM"
          );
        }
      }
    };

    const destroyEnemy = (game: Game, enemy: Enemy, guaranteedDrop = false) => {
      enemy.hp = 0;
      game.score += enemy.kind === "nuke" ? 600 : enemy.kind === "gunship" ? 300 : 100;
      burst(game, enemy.x, enemy.y, POWER_COLORS[enemy.kind], 18, 8);
      play("explosion", 0.16);
      if (enemy.kind !== "ghost" && enemy.kind !== "beam" && enemy.kind !== "emp" && enemy.kind !== "mines" && (guaranteedDrop || Math.random() < 0.48)) {
        game.pickups.push({ x: enemy.x, y: enemy.y, vx: range(-0.7, 0.7), vy: range(-0.7, 0.7), type: randomPower(), life: 900, phase: range(0, 6) });
      }
    };

    /**
     * The rift has been driven to zero integrity in Survival.
     *
     * There is no victory to award — the mode is endless — so a breach is a
     * reward instead: the arena is swept, the run banks a bonus that scales
     * with how deep it has gone, and the rift reforms tougher. It is the one
     * thing a Survival pilot can do to the rift rather than merely survive.
     */
    const breachRift = (game: Game) => {
      const survival = game.survival;
      if (!survival) return;

      survival.breaches += 1;
      game.score += survivalBreachBonus(survival.level, survival.breaches - 1);
      game.rivalMaxHealth = survivalBreachIntegrity(survival.breaches);
      game.rivalHealth = game.rivalMaxHealth;
      game.enrageRecovery = createEnrageRecovery();
      if (game.rules.wormholeEnrage.enabled) {
        activateEnrageRecovery(game.enrageRecovery, game.rules, game.rivalMaxHealth);
      }

      for (const enemy of game.enemies) destroyEnemy(game, enemy);
      game.bullets = game.bullets.filter((bullet) => !bullet.enemy);
      game.incoming = null;
      game.portalPulse = 1;
      game.notice = `RIFT BREACHED ×${survival.breaches} // IT REFORMS STRONGER`;
      game.noticeLife = 180;
      burst(game, game.portalX, game.portalY, "#ffffff", 70, 14);
      burst(game, game.portalX, game.portalY, "#ff4fd8", 50, 11);
      playCue("wormhole-explosion", 0.2);
    };

    const spawnEnemyBullet = (game: Game, enemy: Enemy, speed = 5, damage = 10) => {
      const dx = game.player.x - enemy.x;
      const dy = game.player.y - enemy.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      game.bullets.push({ x: enemy.x, y: enemy.y, vx: (dx / d) * speed, vy: (dy / d) * speed, damage, life: 170, enemy: true, color: "#ff596f" });
    };

    /**
     * Fires one overcharged power-up.
     *
     * Everything specific to a ship lives in its `OverchargeSpec`, so this
     * function is what makes the pattern reusable: giving a fourth frame an
     * overcharge is a data entry, not another branch down in `activateSpecial`.
     */
    const fireOvercharge = (game: Game, spec: OverchargeSpec) => {
      const player = game.player;
      const timing = overchargeTicks(spec);
      const sourceColor = overchargeSourceColor(spec);

      if (spec.volley) {
        const volley = spec.volley;
        for (const heading of volleyHeadings(player.angle, volley.count, volley.spreadDegrees)) {
          const angle = heading * DEG;
          game.bullets.push({
            x: player.x + Math.cos(angle) * 16,
            y: player.y + Math.sin(angle) * 16,
            vx: Math.cos(angle) * volley.speed + player.vx,
            vy: Math.sin(angle) * volley.speed + player.vy,
            damage: volley.damage,
            life: volley.lifeTicks,
            enemy: false,
            color: spec.accent,
            special: true,
            turnRadians: volley.turnRadians,
          });
        }
      }

      if (spec.blast) {
        game.blasts.push({
          x: player.x,
          y: player.y,
          age: 0,
          life: timing.blast,
          sweptTo: 0,
          scrambleTicks: timing.scramble,
          spec,
        });
      }

      // Set unconditionally: a spec with no rider has to clear any rider the
      // previous activation left running, rather than silently inheriting it.
      player.riderTicks = spec.rider ? timing.rider : 0;
      player.riderTotal = player.riderTicks;
      player.riderAcceleration = spec.rider ? spec.rider.accelerationScale : 1;
      player.riderMaxSpeed = spec.rider ? spec.rider.maxSpeedScale : 1;
      if (timing.invuln > 0) player.invuln = Math.max(player.invuln, timing.invuln);

      // A special that shoves its own ship says so in its spec rather than
      // being named here, so this stays free of per-ship branching.
      if (spec.recoil !== undefined) {
        player.vx *= spec.recoil;
        player.vy *= spec.recoil;
      }

      player.overchargeFlash = timing.flash;
      // The HUD's SPECIAL readout already carries the ability name, so the
      // notice spends its line on the thing the player has to learn: which
      // ordinary power-up this is the overcharged build of.
      game.notice = `SPECIAL // ${overchargeSource(spec).toUpperCase()}`;
      // The escalation is the point of the pattern, so the effect leads with
      // the pickup's own colour before the ship accent takes over.
      burst(game, player.x, player.y, sourceColor, 34, 9);
      burst(game, player.x, player.y, spec.accent, 26, 13);
      playCue(`overcharge:${spec.id}`, 0.3);
    };

    const activateSpecial = (game: Game, controllerPressed = false) => {
      const player = game.player;
      const pressed = Boolean(keys.current.KeyQ) || controllerPressed;
      if (!pressed) {
        keys.current.__specialLatch = false;
        return;
      }
      if (keys.current.__specialLatch) return;
      keys.current.__specialLatch = true;

      const spec = SHIP_SPECIALS[game.ship.id];
      if (player.specialCooldown > 0) {
        game.notice = `${spec.name} // READY IN ${wholeSecondsForTicks(player.specialCooldown)}S`;
        game.noticeLife = 55;
        return;
      }

      const ship = game.ship.id;
      const overcharge = overchargeFor(ship);
      if (overcharge) {
        fireOvercharge(game, overcharge);
      } else if (ship === "tank") {
        player.invuln = Math.max(player.invuln, ticksForSeconds(3));
        game.notice = "IMPACT GUARD // 3S IMMUNITY";
      } else if (ship === "rabbit") {
        player.viperGuidance = ticksForSeconds(VIPER_GUIDANCE_SECONDS);
        game.notice = "TARGET LINK // LAUNCH WITHIN 3S";
      } else if (ship === "turtle") {
        game.enemies.forEach((enemy) => {
          if (enemy.kind !== "ghost") destroyEnemy(game, enemy);
        });
        player.health = Math.max(1, player.health - (Math.random() < 0.75 ? 20 : 0));
        game.notice = "REACTOR BURST";
      } else if (ship === "flash") {
        player.flashMode = player.flashMode === "tank" ? "squid" : "tank";
        game.notice = `FORM SHIFT // ${player.flashMode === "tank" ? "HEAVY" : "SCOUT"} FORM`;
      } else if (ship === "flagship") {
        player.flagshipField = ticksForSeconds(3);
        game.notice = "GRAVITY PULSE // 3S";
      }

      player.specialCooldown = ticksForSeconds(spec.cooldownSeconds);
      game.noticeLife = 90;
      if (!overcharge) {
        burst(game, player.x, player.y, "#68f2ff", 26, 8);
        play("magic", 0.22);
      }
    };

    /**
     * Advances one overcharged detonation and applies it to whatever the
     * expanding band reaches this tick.
     *
     * Sweeping a band — everything between last tick's radius and this one's —
     * rather than testing the whole disc is how a hostile is caught exactly
     * once, and it is the same technique the ordinary CORE BOMB already uses.
     */
    const updateBlast = (game: Game, fx: OverchargeBlastFx) => {
      const blast = fx.spec.blast;
      if (!blast) { fx.age = fx.life; return; }
      fx.age += 1;
      const previous = fx.sweptTo;
      const radius = blastRadiusAt(fx.age, blast);
      fx.sweptTo = radius;
      if (radius <= previous) return;

      const scrambleTicks = fx.scrambleTicks;
      for (const enemy of game.enemies) {
        if (enemy.hp <= 0) continue;
        const dx = enemy.x - fx.x;
        const dy = enemy.y - fx.y;
        const d = Math.hypot(dx, dy);
        if (d > radius || d <= previous) continue;

        if (blast.knockback > 0) {
          const away = Math.max(1, d);
          enemy.vx += (dx / away) * blast.knockback;
          enemy.vy += (dy / away) * blast.knockback;
        }
        // A Phase Shade is immune to fire by design; scrambling one is still
        // fair game, because scramble steers rather than damages.
        if (scrambleTicks > 0) enemy.scrambled = Math.max(enemy.scrambled ?? 0, scrambleTicks);

        const damage = blastDamageAt(d, blast);
        if (damage <= 0 || enemy.kind === "ghost") continue;
        enemy.hp -= scrambledDamage(damage, (enemy.scrambled ?? 0) > 0);
        burst(game, enemy.x, enemy.y, fx.spec.accent, 6, 4);
        if (enemy.hp <= 0) destroyEnemy(game, enemy, blast.guaranteedDrops);
      }
    };

    const updateEnemy = (game: Game, enemy: Enemy) => {
      const player = game.player;
      enemy.age += 1;
      // A scrambled hostile flies its approach backwards and its weapon timer
      // stops, so the pulse buys real space rather than only looking dramatic.
      const scrambled = (enemy.scrambled ?? 0) > 0;
      if (scrambled) enemy.scrambled = (enemy.scrambled ?? 0) - 1;
      else enemy.cooldown -= 1;
      const tracking = hostileTrackingVector(enemy.x, enemy.y, player.x, player.y, scrambled);
      const dx = tracking.dx;
      const dy = tracking.dy;
      const d = Math.max(1, Math.hypot(dx, dy));

      if (enemy.kind === "heatseeker") {
        const desired = Math.atan2(dy, dx);
        const current = Math.atan2(enemy.vy, enemy.vx);
        let delta = desired - current;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const angle = current + cap(delta, -16 * DEG, 16 * DEG);
        enemy.vx = Math.cos(angle) * 7;
        enemy.vy = Math.sin(angle) * 7;
      } else if (enemy.kind === "ufo") {
        enemy.vx += (dx / d) * 0.2;
        enemy.vy += (dy / d) * 0.2;
        const speed = Math.hypot(enemy.vx, enemy.vy);
        if (speed > 5) { enemy.vx = (enemy.vx / speed) * 5; enemy.vy = (enemy.vy / speed) * 5; }
        if (!scrambled && enemy.age % 150 === 0) {
          for (let i = 0; i < 3; i += 1) game.enemies.push(makeEnemy("heatseeker", enemy.x, enemy.y, i, 3));
        }
      } else if (enemy.kind === "inflator") {
        if (enemy.age % 2 === 0) { enemy.radius += 0.35; enemy.hp += 1; }
        enemy.vx += (dx / d) * 0.025;
        enemy.vy += (dy / d) * 0.025;
      } else if (enemy.kind === "mines") {
        if (enemy.age >= 40) { enemy.vx = 0; enemy.vy = 0; enemy.armed = true; }
      } else if (enemy.kind === "gunship" || enemy.kind === "artillery" || enemy.kind === "turret") {
        enemy.phase += enemy.kind === "turret" ? 0.025 : 0.006;
        if (enemy.kind === "turret") {
          enemy.x = game.portalX + Math.cos(enemy.phase) * 68;
          enemy.y = game.portalY + Math.sin(enemy.phase) * 42;
        } else {
          enemy.vx += Math.cos(enemy.phase) * 0.03;
          enemy.vy += Math.sin(enemy.phase) * 0.03;
        }
        if (!scrambled && enemy.cooldown <= 0) {
          spawnEnemyBullet(game, enemy, enemy.kind === "artillery" ? 7 : 5, enemy.kind === "artillery" ? 16 : 10);
          enemy.cooldown = enemy.kind === "gunship" ? 28 : 45;
        }
      } else if (enemy.kind === "minelayer") {
        enemy.vx = Math.cos(enemy.age * 0.04) * 3.5;
        enemy.vy = Math.sin(enemy.age * 0.021) * 3.5;
        if (!scrambled && enemy.age % 95 === 0) game.enemies.push(makeEnemy("mines", enemy.x, enemy.y, 0, 1));
      } else if (enemy.kind === "scarab") {
        const pickup = game.pickups[0];
        if (pickup) {
          const pdx = pickup.x - enemy.x;
          const pdy = pickup.y - enemy.y;
          const pd = Math.max(1, Math.hypot(pdx, pdy));
          enemy.vx += (pdx / pd) * 0.2;
          enemy.vy += (pdy / pd) * 0.2;
          if (pd < 18) { pickup.life = 0; game.notice = "SCAVENGER STOLE A POWER-UP"; game.noticeLife = 70; }
        }
      } else if (enemy.kind === "wallcrawler") {
        if (enemy.x <= 12) { enemy.x = 12; enemy.vx = 0; enemy.vy = 4; }
        if (enemy.y >= game.worldHeight - 12) { enemy.y = game.worldHeight - 12; enemy.vx = 4; enemy.vy = 0; }
        if (enemy.x >= game.worldWidth - 12) { enemy.x = game.worldWidth - 12; enemy.vx = 0; enemy.vy = -4; }
        if (enemy.y <= 12) { enemy.y = 12; enemy.vx = -4; enemy.vy = 0; }
        if (!scrambled && enemy.age % 35 === 0) spawnEnemyBullet(game, enemy, 6, 10);
      } else if (enemy.kind === "ghost") {
        if (enemy.age % 130 === 0) { enemy.vx = range(-2.5, 2.5); enemy.vy = range(-2.5, 2.5); }
      } else if (enemy.kind === "emp") {
        enemy.blastRadius = (enemy.blastRadius ?? 0) + (!scrambled && enemy.age > 65 ? 8 : 0);
        enemy.x = player.x;
        enemy.y = player.y;
        if ((enemy.blastRadius ?? 0) > 0 && (enemy.blastRadius ?? 0) >= d) {
          const newlyScrambled = player.emp <= 0;
          player.emp = 150;
          if (newlyScrambled) {
            game.notice = "SCRAMBLED // CONTROLS REVERSED";
            game.noticeLife = 150;
            playCue("emp-hit", 0.15);
          }
        }
        if ((enemy.blastRadius ?? 0) > 320) enemy.hp = 0;
      } else if (enemy.kind === "beam") {
        enemy.phase = advanceBeamAngle(enemy.phase, enemy.rotationDir ?? 1);
        enemy.x = game.portalX;
        enemy.y = game.portalY;
        if (!scrambled && enemy.age > 45 && enemy.age < 365) {
          if (
            enemy.age % 16 === 0
            && pointTouchesBeam(game.portalX, game.portalY, enemy.phase, player.x, player.y, BEAM_HIT_WIDTH)
          ) {
            damagePlayer(game, 8, "beam");
          }
          for (const pickup of game.pickups) {
            if (
              pickup.life > 0
              && pointTouchesBeam(game.portalX, game.portalY, enemy.phase, pickup.x, pickup.y, BEAM_PICKUP_WIDTH)
            ) {
              pickup.life = 0;
              burst(game, pickup.x, pickup.y, "#ffffff", 10, 4);
            }
          }
        }
        if (enemy.age >= 365) enemy.hp = 0;
      } else if (enemy.kind === "nuke") {
        enemy.countdown = (enemy.countdown ?? 0) - 1;
        if ((enemy.countdown ?? 0) <= 0) {
          const previousRadius = enemy.blastRadius ?? 10;
          enemy.blastRadius = previousRadius + 30;
          if (d <= (enemy.blastRadius ?? 0) && d > previousRadius && player.shield <= 0) damagePlayer(game, Math.max(5, 40 * (1 - (enemy.blastRadius ?? 0) / 1000)), "nuke_blast");
          if ((enemy.blastRadius ?? 0) > 1000) enemy.hp = 0;
        }
      }

      const anchored = enemy.kind === "turret" || enemy.kind === "beam" || enemy.kind === "emp" || enemy.kind === "nuke";
      if (!anchored) {
        enemy.x += enemy.vx;
        enemy.y += enemy.vy;
      }
      if (enemy.x < 4 || enemy.x > game.worldWidth - 4) enemy.vx *= -1;
      if (enemy.y < 4 || enemy.y > game.worldHeight - 4) enemy.vy *= -1;
      enemy.x = cap(enemy.x, 4, game.worldWidth - 4);
      enemy.y = cap(enemy.y, 4, game.worldHeight - 4);

      const collisionRadius = enemy.kind === "nuke" && (enemy.countdown ?? 0) <= 0 ? 0 : enemy.radius;
      if (collisionRadius > 0 && d < collisionRadius + 12) {
        damageCollision(game, enemy.kind === "mines" ? 20 : enemy.kind === "inflator" ? 18 : enemy.kind === "heatseeker" ? 10 : 8, `${enemy.kind}_collision`);
        if (enemy.kind !== "ufo" && enemy.kind !== "ghost" && enemy.kind !== "wallcrawler" && enemy.kind !== "gunship") enemy.hp = 0;
        enemy.vx *= -1;
        enemy.vy *= -1;
      }
    };

    const tick = () => {
      const game = gameRef.current;
      if (!game.running || game.paused || game.result) return;
      const player = game.player;
      if (game.victorySequence > 0) {
        const visual = victoryVisualState(game.victorySequence, TICK_MS);
        const suction = victorySuctionState(game.victorySequence, TICK_MS);
        if (suction.active && !victorySuctionAudio.current) {
          playVictorySuction(suction.frequencyHz, suction.remainingSeconds);
        } else if (!suction.active && victorySuctionAudio.current) {
          stopVictorySuction(0.018);
        }
        game.victorySequence -= 1;
        game.portalPulse = 1;
        player.vx = 0;
        player.vy = 0;

        const freezeObject = (item: { vx: number; vy: number }) => {
          item.vx = 0;
          item.vy = 0;
        };
        function pullObject<T extends { x: number; y: number; vx: number; vy: number }>(item: T, strength: number) {
          const pulled = pullVelocity(item.x, item.y, item.vx, item.vy, game.portalX, game.portalY, strength);
          item.vx = pulled.vx;
          item.vy = pulled.vy;
          item.x += item.vx;
          item.y += item.vy;
          return pulled.distance > 16;
        }

        if (visual.phase === "freeze") {
          game.notice = "RIVAL ELIMINATED // REALITY LOCKED";
          for (const item of game.enemies) freezeObject(item);
          for (const item of game.pickups) freezeObject(item);
          for (const item of game.bullets) freezeObject(item);
          for (const item of game.powers) freezeObject(item);
          for (const item of game.particles) freezeObject(item);
          if (game.victorySequence % 5 === 0) {
            burst(game, game.portalX, game.portalY, game.victorySequence % 10 === 0 ? "#ffffff" : "#ff4fd8", 8, 4);
          }
        } else if (visual.phase === "pull") {
          game.notice = "RIFT COLLAPSE // ARENA PURGE";
          const strength = 0.8 + visual.phaseProgress * 3.6;
          game.enemies = game.enemies.filter((item) => pullObject(item, strength));
          game.pickups = game.pickups.filter((item) => pullObject(item, strength));
          game.bullets = game.bullets.filter((item) => pullObject(item, strength));
          game.powers = game.powers.filter((item) => pullObject(item, strength));
          game.particles = game.particles.filter((item) => {
            const keep = pullObject(item, strength * 0.8);
            item.life -= 1;
            return keep && item.life > 0;
          });
          game.spawns = game.spawns.filter((item) => {
            const dx = game.portalX - item.x;
            const dy = game.portalY - item.y;
            item.x += dx * (0.035 + visual.phaseProgress * 0.08);
            item.y += dy * (0.035 + visual.phaseProgress * 0.08);
            return Math.hypot(dx, dy) > 18;
          });
          if (game.victorySequence % 7 === 0) {
            const radius = range(60, 180);
            const angle = range(0, Math.PI * 2);
            game.particles.push({
              x: game.portalX + Math.cos(angle) * radius,
              y: game.portalY + Math.sin(angle) * radius,
              vx: -Math.cos(angle) * range(2, 5),
              vy: -Math.sin(angle) * range(2, 5),
              color: game.victorySequence % 14 === 0 ? "#ffffff" : "#ff5ac8",
              size: range(1.5, 4),
              life: 55,
              maxLife: 55,
            });
          }
        } else if (visual.phase === "collapse") {
          game.notice = "SINGULARITY COLLAPSE // STAND CLEAR";
          game.enemies.length = 0;
          game.pickups.length = 0;
          game.bullets.length = 0;
          game.powers.length = 0;
          game.blasts.length = 0;
          game.spawns.length = 0;
          game.particles = game.particles.filter((item) => {
            const keep = pullObject(item, 5 + visual.phaseProgress * 5);
            item.life -= 1;
            return keep && item.life > 0;
          });
          if (game.victorySequence % 3 === 0) {
            const radius = range(45, 150) * (1 - visual.phaseProgress * 0.6);
            const angle = range(0, Math.PI * 2);
            game.particles.push({
              x: game.portalX + Math.cos(angle) * radius,
              y: game.portalY + Math.sin(angle) * radius,
              vx: -Math.cos(angle) * range(4, 9),
              vy: -Math.sin(angle) * range(4, 9),
              color: game.victorySequence % 9 === 0 ? "#68f2ff" : "#ffffff",
              size: range(2, 5),
              life: 40,
              maxLife: 40,
            });
          }
        } else {
          game.notice = "RIVAL DESTROYED";
          if (!game.victoryExplosionFired) {
            game.victoryExplosionFired = true;
            game.particles.length = 0;
            burst(game, game.portalX, game.portalY, "#ffffff", 180, 24);
            burst(game, game.portalX, game.portalY, "#68f2ff", 120, 18);
            burst(game, game.portalX, game.portalY, "#ff4fd8", 120, 14);
            playCue("wormhole-explosion", 0.24);
            if (!reducedMotionRef.current && typeof navigator !== "undefined" && "vibrate" in navigator) {
              navigator.vibrate([120, 45, 180, 55, 320]);
            }
          }
          for (const particle of game.particles) {
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.vx *= 0.965;
            particle.vy *= 0.965;
            particle.life -= 1;
          }
          game.particles = game.particles.filter((particle) => particle.life > 0);
        }

        game.noticeLife = game.victorySequence;
        if (game.victorySequence <= 0) {
          game.running = false;
          game.result = "victory";
          game.notice = "RIVAL ELIMINATED";
          game.noticeLife = 180;
          // The victory branch returns before the normal end-of-tick HUD sync.
          // Publish the terminal state immediately so touch/mobile clients render
          // the end-game menu after the collapse animation.
          sync();
        }
        return;
      }

      game.cycles += 1;
      game.elapsedTicks += 1;
      if (game.mode === "coop" && game.cycles % 5 === 0) {
        netRef.current?.reportPosition(player.x, player.y, player.angle);
      }
      game.shotCycle -= 1;
      game.botTimer -= 1;
      game.noticeLife = Math.max(0, game.noticeLife - 1);
      game.portalPulse = Math.max(0, game.portalPulse - 0.012);
      player.invuln = Math.max(0, player.invuln - 1);
      const shieldWasActive = player.shield > 0;
      player.shield = Math.max(0, player.shield - 1);
      if (shieldWasActive && player.shield === 0) playCue("shield-down", 0.18);
      player.specialCooldown = Math.max(0, player.specialCooldown - 1);
      player.riderTicks = Math.max(0, player.riderTicks - 1);
      if (player.riderTicks === 0) { player.riderAcceleration = 1; player.riderMaxSpeed = 1; }
      player.overchargeFlash = Math.max(0, player.overchargeFlash - 1);
      player.viperGuidance = Math.max(0, player.viperGuidance - 1);
      player.emp = Math.max(0, player.emp - 1);
      player.ricochetTicks = Math.max(0, player.ricochetTicks - 1);
      // Wormhole motion is a rule, not a constant: EASY locks it dead centre
      // while DIFFICULT and HARD MODE keep the original orbit.
      game.portalAngle = advanceWormholeAngle(game.rules, game.portalAngle);
      const wormhole = wormholePosition(game.rules, { width: game.worldWidth, height: game.worldHeight }, game.portalAngle);
      game.portalX = wormhole.x;
      game.portalY = wormhole.y;

      // Survival re-derives `game.rules` on every Rift Level, so its clock has
      // to run before anything that reads them this tick.
      tickSurvival(game);

      if (game.enrageActive && game.rules.wormholeEnrage.enabled) {
      const enrage = game.rules.wormholeEnrage;
      const authority = game.mode !== "coop" || netRef.current?.state.you?.id === netRef.current?.state.hostId;
      if (authority) {
        const healed = tickEnrageRecovery(game.enrageRecovery, game.rivalHealth, game.rivalMaxHealth);
        game.rivalHealth = Math.min(game.rivalMaxHealth, game.rivalHealth + healed);
        game.enrageTimer -= 1;
        if (game.enrageTimer <= 0) {
          game.enrageTimer = enrage.waveIntervalTicks;
          spawnEnrageWave(game);
        }
        if (enrage.minePulseIntervalTicks > 0) {
          game.enrageMineTimer -= 1;
          if (game.enrageMineTimer <= 0) {
            game.enrageMineTimer = enrage.minePulseIntervalTicks;
            const count = enrage.minePulseCount * (game.mode === "coop" ? 2 : 1);
            for (let i = 0; i < count; i += 1) game.enemies.push(makeEnemy("mines", game.portalX, game.portalY, i, count));
            pushSpawn(game, "hostile", "mines", game.portalX, game.portalY, count);
            playCue("spawn:mines", 0.14);
          }
        }
      }
    }

    game.shieldRipple = Math.max(0, game.shieldRipple - 0.06);
      game.shieldBreak = Math.max(0, game.shieldBreak - 0.04);
      game.shieldRestored = Math.max(0, game.shieldRestored - 1);
      game.contactWarning = Math.max(0, game.contactWarning - 1);

      // The collision shield recharges on a timer alone: no position test and
      // no wormhole test, so it comes back anywhere in the arena.
      if (game.collisionShield && tickCollisionShield(game.collisionShield, game.rules).restored) {
        game.shieldRestored = 100;
        game.notice = "SHIELD RESTORED";
        game.noticeLife = 90;
        play("magic", 0.2);
      }

      // HARD MODE only: overlapping the wormhole burns hull in visible ticks,
      // capped per contact episode and gated on a genuine exit before the next.
      const contact = tickContactHazard(
        game.contact,
        game.rules,
        dist(player, { x: game.portalX, y: game.portalY }),
        player.maxHealth
      );
      if (contact.overlapping) game.contactWarning = 24;
      if (contact.entered) {
        game.notice = "RIFT CONTACT";
        game.noticeLife = 110;
      }
      if (contact.damage > 0) damageContact(game, contact.damage);

      const controller = controllerInput.current;
      const controllerAimHeading = headingDegrees(controller.aimX, controller.aimY);
      const controllerMoveHeading = headingDegrees(controller.moveX, controller.moveY);
      const firingHeading = controllerAimHeading ?? aimHeading.current;
      let fire = keys.current.Space || keys.current.MousePrimary || controller.fireMain;
      const launch = keys.current.KeyE || keys.current.MouseSecondary || controller.firePup;

      // Resolve the input source before combining it. Stick and keys feed one
      // intent and one flight model, so Touch, PC and Hybrid fly identically.
      const stickIntent = intentFromStick(moveHeading.current);
      const keyboardIntent = intentFromKeys(keysFrom(keys.current));
      const controllerIntent = intentFromStick(controllerMoveHeading);
      let intent = resolveIntent(controllerIntent, resolveIntent(stickIntent, keyboardIntent));
      if (player.emp > 0) {
        // EMP still scrambles the pilot: the requested direction is inverted
        // and the trigger swaps with movement, as it always has.
        if (intent.active && intent.heading !== null) {
          intent = { ...intent, heading: intent.heading + 180 };
        }
        if (game.cycles % 3 === 0) {
          const swap = intent.active;
          fire = swap || fire;
          if (fire) intent = { active: false, heading: null, magnitude: 0 };
        }
      }

      const handling = game.ship.id === "flash" ? FORM_SHIFT_PROFILES[player.flashMode] : game.ship;
      const baseMaxSpeed = handling.maxSpeed + player.thrust * THRUST_SPEED_BONUS;
      const baseAcceleration = handling.acceleration + player.thrust * THRUST_ACCEL_BONUS;
      const specialHandling = riderHandling(
        baseAcceleration,
        baseMaxSpeed,
        player.riderTicks > 0
          ? { seconds: 0, accelerationScale: player.riderAcceleration, maxSpeedScale: player.riderMaxSpeed }
          : null,
      );
      const maxSpeed = specialHandling.maxSpeed;
      const acceleration = specialHandling.acceleration;

      const moved = applyIntent(
        { vx: player.vx, vy: player.vy },
        intent,
        { acceleration, maxSpeed },
        { retros: player.retros }
      );
      player.vx = moved.vx;
      player.vy = moved.vy;

      // Rift Collapse opens a gravity well. It is applied as acceleration
      // before the speed clamp, so it can drag a pilot off course but can
      // never carry them faster than their own frame flies.
      const gravity = game.survival?.escalation.gravityPull ?? 0;
      if (gravity > 0) {
        const dx = game.portalX - player.x;
        const dy = game.portalY - player.y;
        const pull = Math.max(1, Math.hypot(dx, dy));
        player.vx += (dx / pull) * gravity;
        player.vy += (dy / pull) * gravity;
      }

      if (intent.active && intent.heading !== null && game.cycles % 3 === 0) {
        const exhaust = intent.heading * DEG;
        burst(game, player.x - Math.cos(exhaust) * 14, player.y - Math.sin(exhaust) * 14, "#63efff", 2, 2.5);
      }

      // The hull turns toward travel unless the player is aiming, and keeps its
      // last heading when nothing is held.
      player.angle = facingFor(
        intent,
        firingHeading === null ? null : player.emp > 0 ? firingHeading + 180 : firingHeading,
        player.angle
      );

      const playerSpeed = Math.hypot(player.vx, player.vy);
      if (playerSpeed > maxSpeed) { player.vx = (player.vx / playerSpeed) * maxSpeed; player.vy = (player.vy / playerSpeed) * maxSpeed; }
      player.x += player.vx;
      player.y += player.vy;
      if (player.x < 12 || player.x > game.worldWidth - 12) { player.x = cap(player.x, 12, game.worldWidth - 12); player.vx *= -0.55; damageCollision(game, 2, "wall"); }
      if (player.y < 12 || player.y > game.worldHeight - 12) { player.y = cap(player.y, 12, game.worldHeight - 12); player.vy *= -0.55; damageCollision(game, 2, "wall"); }

      if (fire && game.shotCycle <= 0 && game.playerShots < SHOT_LEVELS[player.gun].maxShots) {
        const shot = SHOT_LEVELS[player.gun];
        const offsets = shot.shots === 2 ? [-0.05, 0.05] : [0];
        offsets.forEach((offset) => {
          const angle = player.angle * DEG + offset;
          game.bullets.push({ x: player.x + Math.cos(angle) * 12, y: player.y + Math.sin(angle) * 12, vx: Math.cos(angle) * 10 + player.vx, vy: Math.sin(angle) * 10 + player.vy, damage: shot.damage, life: 110, enemy: false, color: shot.color, bouncesLeft: player.ricochetTicks > 0 ? RICOCHET_BOUNCES : 0 });
          game.playerShots += 1;
        });
        game.shotCycle = shot.delay;
        play("fire", 0.12, cannonPlaybackRate(player.gun));
      }

      if (launch && game.stock.length > 0 && !keys.current.__launchLatch) {
        keys.current.__launchLatch = true;
        const type = game.stock.pop()!;
        const angle = player.angle * DEG;
        const homing = game.ship.id === "rabbit" && player.viperGuidance > 0;
        game.powers.push({ x: player.x + Math.cos(angle) * 12, y: player.y + Math.sin(angle) * 12, vx: Math.cos(angle) * 10 + player.vx, vy: Math.sin(angle) * 10 + player.vy, type, life: homing ? 320 : 160, homing });
        game.notice = homing ? `${WEAPONS[type].short} // TARGET LINK` : `${WEAPONS[type].short} ARMED`;
        game.noticeLife = 75;
        burst(game, player.x, player.y, POWER_COLORS[type], 10, 4);
        play("fire", 0.2);
      }
      if (!launch) keys.current.__launchLatch = false;
      activateSpecial(game, controller.special);

      // The Flagship field is continuous rather than a one-tick impulse, so
      // enemy steering and pickup drag cannot erase the special immediately.
      if (player.flagshipField > 0) {
        player.flagshipField -= 1;
        for (const pickup of game.pickups) {
          const dx = player.x - pickup.x;
          const dy = player.y - pickup.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          if (d > 520) continue;
          const strength = 0.12 + (1 - d / 520) * 0.28;
          pickup.vx = cap(pickup.vx + (dx / d) * strength, -7, 7);
          pickup.vy = cap(pickup.vy + (dy / d) * strength, -7, 7);
        }
        for (const enemy of game.enemies) {
          if (enemy.hp <= 0) continue;
          const dx = enemy.x - player.x;
          const dy = enemy.y - player.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          if (d > 360) continue;
          const strength = 0.18 + (1 - d / 360) * 0.42;
          enemy.vx += (dx / d) * strength;
          enemy.vy += (dy / d) * strength;
        }
        if (player.flagshipField % 12 === 0) {
          burst(game, player.x, player.y, "#68f2ff", 5, 3);
        }
      }

      game.bullets.forEach((bullet) => {
        if (bullet.turnRadians && !bullet.enemy) {
          // Overcharged trackers hunt the nearest hostile. With the arena clear
          // they steer for the rift instead, where a player round already
          // counts toward the next power-up, so the volley is never wasted.
          let targetX = game.portalX;
          let targetY = game.portalY;
          let closest = Infinity;
          for (const enemy of game.enemies) {
            if (enemy.hp <= 0 || enemy.kind === "ghost") continue;
            const d = dist(bullet, enemy);
            if (d < closest) { closest = d; targetX = enemy.x; targetY = enemy.y; }
          }
          const guided = steerHomingVelocity(bullet.x, bullet.y, bullet.vx, bullet.vy, targetX, targetY, bullet.turnRadians);
          bullet.vx = guided.vx;
          bullet.vy = guided.vy;
        }
        bullet.x += bullet.vx;
        bullet.y += bullet.vy;
        bullet.life -= 1;
        if (!bullet.enemy && !bullet.special && (bullet.bouncesLeft ?? 0) > 0) {
          const reflected = reflectRicochet(
            bullet.x,
            bullet.y,
            bullet.vx,
            bullet.vy,
            game.worldWidth,
            game.worldHeight,
            bullet.bouncesLeft ?? 0,
          );
          if (reflected.bounced) {
            bullet.x = reflected.x;
            bullet.y = reflected.y;
            bullet.vx = reflected.vx;
            bullet.vy = reflected.vy;
            bullet.bouncesLeft = reflected.bouncesLeft;
            burst(game, bullet.x, bullet.y, "#73f6b0", 5, 3);
            playCue("ricochet", 0.065);
          }
        }
        if (bullet.enemy) {
          if (dist(bullet, player) < 13) { bullet.life = 0; damagePlayer(game, bullet.damage, "hostile_projectile"); }
          return;
        }
        if (dist(bullet, { x: game.portalX, y: game.portalY }) < 43) {
          bullet.life = 0;
          game.portalCharge += bullet.damage;
          game.portalPulse = Math.max(game.portalPulse, 0.4);
          burst(game, bullet.x, bullet.y, "#ff5ac8", 4, 2.5);
          cannonImpactFeedback(game, bullet);
          if (game.portalCharge > game.portalThreshold) {
            game.portalCharge = 0;
            const type = randomPower();
            game.pickups.push({ x: game.portalX + range(-28, 28), y: game.portalY + range(-28, 28), vx: range(-1.2, 1.2), vy: range(-1.2, 1.2), type, life: 900, phase: range(0, 6) });
            game.notice = `${WEAPONS[type].short} READY TO COLLECT`;
            game.noticeLife = 100;
            pushSpawn(game, "friendly", type, game.portalX, game.portalY, 1);
            playCue(`spawn:${type}`, 0.17);
          }
        }
        for (const enemy of game.enemies) {
          if (enemy.hp <= 0 || bullet.life <= 0 || enemy.kind === "ghost") continue;
          if (dist(bullet, enemy) < enemy.radius + 4) {
            bullet.life = 0;
            enemy.hp -= scrambledDamage(bullet.damage, (enemy.scrambled ?? 0) > 0);
            burst(game, bullet.x, bullet.y, POWER_COLORS[enemy.kind], 4, 2.5);
            cannonImpactFeedback(game, bullet);
            if (enemy.hp <= 0) destroyEnemy(game, enemy);
          }
        }
      });

      game.powers.forEach((power) => {
        if (power.homing) {
          const guided = steerHomingVelocity(power.x, power.y, power.vx, power.vy, game.portalX, game.portalY);
          power.vx = guided.vx;
          power.vy = guided.vy;
        }
        power.x += power.vx;
        power.y += power.vy;
        power.life -= 1;
        if (dist(power, { x: game.portalX, y: game.portalY }) < 48) {
          power.life = 0;
          pushSpawn(game, "transmit", power.type, game.portalX, game.portalY, 0);
          burst(game, game.portalX, game.portalY, POWER_COLORS[power.type], 38, 11);
          play("magic", 0.32);

          if (game.mode !== "pve") {
            // PvP transmits to the opponent; co-op applies the same power-up
            // to the server-owned shared wormhole.
            netRef.current?.transmit(power.type);
            game.notice = game.mode === "coop"
              ? `${WEAPONS[power.type].short} SENT // TEAM HIT`
              : `${WEAPONS[power.type].short} SENT TO OPPONENT`;
            game.noticeLife = 115;
          } else {
            const damage = rivalDamageFor(power.type);
              const enrageHit = absorbEnrageShield(game.enrageRecovery, damage);
              const integrityDamage = enrageHit.toIntegrity;
              game.lastRivalCause = power.type;
              game.lastRivalDamage = Math.min(game.rivalHealth, integrityDamage);
              game.rivalHealth -= integrityDamage;
              game.score += 750 + damage * 10;
              game.notice = enrageHit.absorbed > 0
                ? `${WEAPONS[power.type].short} SENT // RIFT SHIELD −${Math.round(enrageHit.absorbed)}${integrityDamage > 0 ? ` // RIVAL −${Math.round(integrityDamage)}` : ""}`
                : `${WEAPONS[power.type].short} SENT // RIVAL −${damage}`;
              game.noticeLife = 115;

              const enrage = game.rules.wormholeEnrage;
            if (
              enrage.enabled
              && !game.enrageActive
              && game.rivalHealth > 0
              && game.rivalHealth <= enrage.thresholdFraction * game.rivalMaxHealth
            ) {
              game.enrageActive = true;
              game.enrageTimer = enrage.waveIntervalTicks;
              game.enrageMineTimer = enrage.minePulseIntervalTicks;
              activateEnrageRecovery(game.enrageRecovery, game.rules, game.rivalMaxHealth);
              spawnEnrageWave(game);
            }

            if (game.rivalHealth <= 0 && game.survival) {
              // Survival has no win condition, so a collapsed rift is a reward
              // rather than an ending: the arena clears and the rift reforms.
              breachRift(game);
            } else if (game.rivalHealth <= 0) {
              game.rivalHealth = 0;
              game.victorySequence = ticksForSeconds(VICTORY_TOTAL_SECONDS);
              game.victoryExplosionFired = false;
              game.enrageActive = false;
              game.enrageTimer = 0;
              game.enrageMineTimer = 0;
              game.enrageRecovery = createEnrageRecovery();
              game.incoming = null;
              game.notice = "RIVAL ELIMINATED // REALITY LOCKED";
              game.noticeLife = game.victorySequence;
            }
          }
        }
        for (const enemy of game.enemies) {
          if (enemy.hp <= 0 || power.life <= 0) continue;
          if (dist(power, enemy) < enemy.radius + 10) { power.life = 0; destroyEnemy(game, enemy); }
        }
      });

      game.pickups.forEach((pickup) => {
        pickup.x += pickup.vx;
        pickup.y += pickup.vy;
        pickup.vx *= 0.995;
        pickup.vy *= 0.995;
        pickup.phase += 0.08;
        pickup.life -= 1;
        if (dist(pickup, player) < 25) {
          pickup.life = 0;
          game.score += 50;
          const type = pickup.type;
          if (type === "gun") player.gun = Math.min(3, player.gun + 1);
          else if (type === "thrust") player.thrust = Math.min(3, player.thrust + 1);
          else if (type === "retros") player.retros = true;
          else if (type === "shield") player.shield = Math.max(450, player.shield + 200);
          else if (type === "clear") game.enemies.forEach((enemy) => destroyEnemy(game, enemy));
          else if (type === "health") player.health = Math.min(player.maxHealth, player.health + 30);
          else if (type === "ricochet") player.ricochetTicks = ticksForSeconds(RICOCHET_DURATION_SECONDS);
          else if (game.stock.length < STOCK_LIMIT) {
            const wasBelowCapacity = game.stock.length === STOCK_LIMIT - 1;
            game.stock.push(type);
            if (wasBelowCapacity) playCue("inventory-full", 0.2);
          }
          else { game.notice = "POWERUP BIN FULL"; game.noticeLife = 75; return; }
          game.notice = `${WEAPONS[type].short} COLLECTED`;
          game.noticeLife = 100;
          burst(game, pickup.x, pickup.y, POWER_COLORS[type], 16, 5);
          if (type === "shield") playCue("shield-pickup", 0.18);
          else play("magic", 0.25);
        }
      });

      const coopNetwork = netRef.current?.state;
      const coopIsHost = game.mode === "coop"
        && Boolean(coopNetwork?.you?.id)
        && coopNetwork?.you?.id === coopNetwork?.hostId;
      if (game.mode === "coop" && !coopIsHost && coopNetwork?.world
        && coopNetwork.world.seq !== game.lastWorldSeq) {
        const world = coopNetwork.world;
        game.lastWorldSeq = world.seq;
        game.portalX = world.portalX;
        game.portalY = world.portalY;
        game.portalAngle = world.portalAngle;
        game.enrageActive = world.enrageActive;
        game.enemies = world.enemies.map((enemy) => ({ ...enemy })) as unknown as Enemy[];
        const localShots = game.bullets.filter((bullet) => !bullet.enemy);
        game.bullets = localShots.concat(world.enemyBullets.map((bullet) => ({ ...bullet })) as unknown as Bullet[]);
      }

      if (game.mode === "pvp") {
        // No bot in PvP: every hostile wave is something the opponent chose to
        // send. The server tags deliveries, so a resend never spawns twice.
        for (const attack of netRef.current?.drainIncoming() ?? []) {
          addIncoming(game, attack.weapon as PowerId);
          game.notice = `${WEAPONS[attack.weapon as PowerId].short} FROM ${attack.from}`;
          game.noticeLife = 140;
        }
      } else if (
        // Survival schedules its own waves from the escalation table, so the
        // PvE scheduler stands down rather than spawning alongside it.
        !game.survival
        && (game.mode !== "coop" || coopIsHost)
        && game.botTimer <= 0
        && game.running
      ) {
        const pool: PowerId[] = game.cycles < 1800 ? ["heatseeker", "mines", "ufo", "inflator"] : SENDABLE_POWERUPS;
        const attack = pool[Math.floor(Math.random() * pool.length)];
        addIncoming(game, attack);
        game.botTimer = Math.max(330, 580 - Math.floor(game.cycles / 140));
      }

      game.blasts.forEach((fx) => updateBlast(game, fx));
      game.enemies.forEach((enemy) => { if (enemy.hp > 0) updateEnemy(game, enemy); });
      if (coopIsHost && game.cycles % 6 === 0) {
        netRef.current?.reportWorld({
          portalX: game.portalX,
          portalY: game.portalY,
          portalAngle: game.portalAngle,
          enrageActive: game.enrageActive,
          enemies: game.enemies.slice(0, 128).map((enemy) => ({ ...enemy })),
          enemyBullets: game.bullets.filter((bullet) => bullet.enemy).slice(0, 256).map((bullet) => ({ ...bullet })),
        });
      }
      game.particles.forEach((particle) => {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vx *= 0.96;
        particle.vy *= 0.96;
        particle.life -= 1;
      });
      game.spawns.forEach((spawn) => { spawn.age += 1; });

      // In-place compaction: no new arrays are allocated every tick.
      let liveShots = 0;
      compact(game.bullets, (item) => {
        const alive = item.life > 0 && item.x > -30 && item.x < game.worldWidth + 30 && item.y > -30 && item.y < game.worldHeight + 30;
        if (alive && countsTowardShotBudget(item)) liveShots += 1;
        return alive;
      });
      game.playerShots = liveShots;
      compact(game.pickups, (item) => item.life > 0);
      compact(game.powers, (item) => item.life > 0 && item.x > -30 && item.x < game.worldWidth + 30 && item.y > -30 && item.y < game.worldHeight + 30);
      compact(game.enemies, (item) => item.hp > 0);
      compact(game.blasts, (item) => item.age < item.life);
      compact(game.particles, (item) => item.life > 0);
      compact(game.spawns, (item) => item.age < item.life);
      if (game.incoming && game.noticeLife <= 0) game.incoming = null;

      if (pendingRelease.current.length > 0) {
        for (const code of pendingRelease.current) keys.current[code] = false;
        pendingRelease.current.length = 0;
      }

      hudDelay += 1;
      if (hudDelay >= 7 || game.result) { hudDelay = 0; sync(); }
    };

    // Star field positions are deterministic, so build them once instead of
    // recomputing 85 modulo pairs on every frame.
    const stars = Array.from({ length: 85 }, (_, i) => ({
      x: (i * 83.17) % VIEW_WIDTH,
      y: (i * 47.31) % VIEW_HEIGHT,
      size: i % 11 === 0 ? 2 : 1,
      cyan: i % 8 === 0,
    }));
    // Sparse, non-colliding world landmarks. They move with the camera to make
    // flight readable, but stay faint enough to remain behind combat.
    const backgroundRocks = Array.from({ length: 11 }, (_, i) => ({
      x: 90 + (i * 317.3) % (WORLD_WIDTH - 180),
      y: 80 + (i * 191.7) % (WORLD_HEIGHT - 160),
      radius: 34 + (i % 4) * 18,
      sides: 7 + (i % 3),
      rotation: (i * 0.73) % (Math.PI * 2),
      drift: 0.00001 * (i % 2 === 0 ? 1 : -1),
    }));

    const drawPortal = (game: Game, time: number, detail: number) => {
      const charge = cap(game.portalCharge / game.portalThreshold, 0, 1);
      const swell = 1 + game.portalPulse * 0.18;
      const victory = game.victorySequence > 0 ? victoryVisualState(game.victorySequence, TICK_MS) : null;
      const collapseScale = victory ? victory.portalScale : 1;
      ctx.save();
      ctx.translate(game.portalX, game.portalY);
      ctx.scale(swell * collapseScale, swell * collapseScale);
      if (victory?.phase === "freeze") ctx.globalAlpha = 0.35 + Math.abs(Math.sin(time * 0.035)) * 0.65;
      ctx.globalCompositeOperation = "lighter";
      const step = detail >= 0.5 ? 4 : 8;
      for (let radius = 30; radius < 60; radius += step) {
        ctx.strokeStyle = game.enrageActive
          ? (radius % 8 === 0 ? "rgba(255,38,63,.78)" : "rgba(255,112,42,.48)")
          : (radius % 8 === 0 ? "rgba(255,84,194,.42)" : "rgba(125,80,255,.3)");
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, radius, radius / 2, time * 0.0015 + radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      // HARD MODE: a hazard ring on the exact radius that costs hull, so the
      // dangerous edge is somewhere the pilot can actually see.
      const hazard = game.rules.contactHazard;
      if (hazard.enabled) {
        ctx.save();
        ctx.scale(1 / swell, 1 / swell);
        const pulse = 0.5 + Math.sin(time * 0.006) * 0.2;
        ctx.globalAlpha = game.contactWarning > 0 ? 0.9 : 0.45 + pulse * 0.2;
        ctx.strokeStyle = game.contactWarning > 0 ? "#ff5570" : "#ff9a4d";
        ctx.lineWidth = game.contactWarning > 0 ? 3 : 2;
        ctx.setLineDash([9, 7]);
        ctx.beginPath();
        ctx.arc(0, 0, hazard.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 55);
      glow.addColorStop(0, "rgba(255,255,255,.95)");
      glow.addColorStop(.12, game.enrageActive ? "rgba(255,28,48,.98)" : "rgba(255,76,190,.9)");
      glow.addColorStop(.48, game.enrageActive ? "rgba(148,12,20,.68)" : "rgba(73,31,116,.45)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 55, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Charge ring: the same number the HUD shows, read straight off the portal.
      ctx.save();
      ctx.translate(game.portalX, game.portalY);
      // The charge ring is rift hardware: pull and collapse it with the rift
      // instead of leaving a full-size progress indicator over the blast.
      ctx.scale(collapseScale, collapseScale);
      if (victory?.phase === "blast") ctx.globalAlpha = Math.max(0, 1 - victory.phaseProgress * 4);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(233,251,255,.14)";
      ctx.beginPath();
      ctx.arc(0, 0, 64, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = game.enrageActive ? "#ff263f" : charge > 0.75 ? "#b2ff62" : "#ff70cc";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(0, 0, 64, -Math.PI / 2, -Math.PI / 2 + charge * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };

    const drawEnemy = (game: Game, enemy: Enemy, time: number, detail: number) => {
      const color = POWER_COLORS[enemy.kind];

      if (enemy.kind === "nuke" && (enemy.countdown ?? 0) <= 0) {
        ctx.save();
        ctx.translate(enemy.x, enemy.y);
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = color;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, enemy.blastRadius ?? 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(0, (enemy.blastRadius ?? 0) - 14), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        return;
      }

      if (enemy.kind === "beam" && enemy.age > 45) {
        ctx.save();
        ctx.translate(enemy.x, enemy.y);
        ctx.rotate(enemy.phase);
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = color;
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(BEAM_LENGTH, 0);
        ctx.stroke();
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(BEAM_LENGTH, 0);
        ctx.stroke();
        ctx.restore();
      }

      if (enemy.kind === "emp") {
        ctx.save();
        ctx.translate(enemy.x, enemy.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(0, 0, enemy.blastRadius ?? enemy.age * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(enemy.x, enemy.y);
      if (profile.shadows) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 7;
      }
      if (DIRECTIONAL.has(enemy.kind)) {
        const heading = enemy.kind === "beam"
          ? enemy.phase
          : Math.atan2(enemy.vy, enemy.vx);
        ctx.rotate(heading);
      }
      drawWeaponGlyph(ctx, enemy.kind, enemy.radius, time, {
        detail,
        charge: enemy.kind === "nuke" ? cap((enemy.countdown ?? 0) / 600, 0, 1) : undefined,
      });
      ctx.restore();

      ctx.save();
      ctx.translate(enemy.x, enemy.y);
      if (enemy.kind === "mines" && enemy.armed) {
        // Armed mines flash so the hazard is unmistakable before contact.
        ctx.globalAlpha = 0.35 + Math.abs(Math.sin(time * 0.006)) * 0.5;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, enemy.radius + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (enemy.kind === "nuke") {
        ctx.fillStyle = "#fff0b8";
        ctx.font = "800 15px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(Math.max(0, Math.ceil((enemy.countdown ?? 0) * TICK_MS / 1000))), 0, enemy.radius + 16);
      }
      if (enemy.maxHp > 5 && enemy.hp < enemy.maxHp && enemy.hp > 0 && enemy.kind !== "nuke") {
        ctx.fillStyle = "rgba(0,0,0,.7)";
        ctx.fillRect(-17, enemy.radius + 8, 34, 4);
        ctx.fillStyle = color;
        ctx.fillRect(-17, enemy.radius + 8, 34 * cap(enemy.hp / enemy.maxHp, 0, 1), 4);
      }
      ctx.restore();
    };

    /** World-space portion of the wormhole spawn sequence. */
    const drawSpawnFx = (spawn: SpawnFx, time: number, detail: number) => {
      const p = cap(spawn.age / spawn.life, 0, 1);
      const color = POWER_COLORS[spawn.type];
      ctx.save();
      ctx.translate(spawn.x, spawn.y);
      ctx.globalCompositeOperation = "lighter";

      if (spawn.kind === "transmit") {
        // Outbound: the cradle collapses into the portal.
        const radius = 78 * (1 - p) + 12;
        ctx.strokeStyle = color;
        ctx.globalAlpha = 1 - p;
        ctx.lineWidth = 3 + (1 - p) * 4;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = (1 - p) * 0.9;
        drawWeaponGlyph(ctx, spawn.type, 8 + (1 - p) * 16, time, { detail, outline: true, color: "#ffffff" });
      } else {
        const hostile = spawn.kind === "hostile";
        // Shock ring leaving the portal mouth.
        ctx.strokeStyle = hostile ? color : "#8dffd0";
        ctx.globalAlpha = Math.max(0, 1 - p) * 0.9;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, 26 + p * 120, 0, Math.PI * 2);
        ctx.stroke();
        if (detail >= 0.35) {
          ctx.globalAlpha = Math.max(0, 0.75 - p) * 0.8;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, 26 + p * 78, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Silhouette forming inside the mouth during the first half.
        if (p < 0.55) {
          const grow = p / 0.55;
          ctx.globalAlpha = Math.sin(grow * Math.PI) * 0.95;
          drawWeaponGlyph(ctx, spawn.type, 12 + grow * 22, time, {
            detail,
            outline: true,
            color: hostile ? "#ffffff" : "#c7ffe6",
            lineWidth: 2,
          });
        }
        // Directional launch burst, thrown away from the arena centre.
        if (hostile && detail >= 0.35 && p < 0.5) {
          const away = Math.atan2(spawn.y - WORLD_HEIGHT / 2, spawn.x - WORLD_WIDTH / 2) + Math.PI;
          ctx.rotate(away);
          ctx.globalAlpha = (1 - p * 2) * 0.55;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(0, -14);
          ctx.lineTo(70 + p * 90, -30);
          ctx.lineTo(70 + p * 90, 30);
          ctx.lineTo(0, 14);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    };

    /**
     * One overcharged detonation.
     *
     * Deliberately the same visual grammar as the pickup it came from — an
     * expanding ring leaving a bright core — drawn bigger, with more rings and
     * a ship-coloured accent so it can never be mistaken for the normal
     * version. Ring count and the radial accents both fall away with the
     * detail setting, so a phone draws two strokes where a desktop draws ten.
     */
    const drawOverchargeBlast = (fx: OverchargeBlastFx, detail: number) => {
      const blast = fx.spec.blast;
      if (!blast) return;
      const life = cap(fx.age / Math.max(1, fx.life), 0, 1);
      const fade = (1 - life) ** 1.4;
      if (fade <= 0.01) return;
      const source = overchargeSourceColor(fx.spec);

      ctx.save();
      ctx.translate(fx.x, fx.y);
      ctx.globalCompositeOperation = "lighter";

      const rings = blastRingRadii(fx.age, blast);
      const drawn = detail < 0.35 ? 1 : detail < 0.6 ? Math.min(2, rings.length) : rings.length;
      for (let index = 0; index < drawn; index += 1) {
        const radius = rings[index];
        if (radius <= 1) continue;
        // The leading edge carries the ship accent; the rings trailing it stay
        // in the source power-up's colour, which is what ties the two together.
        ctx.strokeStyle = index === 0 ? fx.spec.accent : source;
        ctx.globalAlpha = fade * (index === 0 ? 0.95 : 0.42 / index);
        ctx.lineWidth = index === 0 ? 5 + fade * 6 : 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Radial energy accents, only where there is budget for them.
      if (detail >= 0.6 && rings[0] > 4) {
        const spokes = 12;
        ctx.strokeStyle = fx.spec.accent;
        ctx.globalAlpha = fade * 0.3;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < spokes; i += 1) {
          const angle = (i / spokes) * Math.PI * 2 + fx.age * 0.02;
          ctx.moveTo(Math.cos(angle) * rings[0] * 0.62, Math.sin(angle) * rings[0] * 0.62);
          ctx.lineTo(Math.cos(angle) * rings[0], Math.sin(angle) * rings[0]);
        }
        ctx.stroke();
      }

      // Core flash, brightest on the first few frames.
      const core = Math.max(0, 1 - fx.age / 14);
      if (core > 0) {
        ctx.globalAlpha = core * 0.9;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(0, 0, 16 + core * 46, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    const drawScene = (time: number, detail: number) => {
      const game = gameRef.current;
      const player = game.player;
      const quiet = reducedMotionRef.current;
      const shipOvercharge = overchargeFor(game.ship.id);

      ctx.setTransform(worldScale, 0, 0, worldScale, 0, 0);
      // Survival repaints the arena as it escalates, so the stage a run has
      // reached is legible before a single word of HUD is read.
      const palette = game.survival
        ? SURVIVAL_PALETTES[game.survival.escalation.stage.id]
        : ARENA_PALETTES[game.rules.id];
      const gradient = ctx.createRadialGradient(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, 10, VIEW_WIDTH / 2, VIEW_HEIGHT / 2, VIEW_WIDTH * .58);
      gradient.addColorStop(0, palette[0]);
      gradient.addColorStop(.58, palette[1]);
      gradient.addColorStop(1, palette[2]);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

      for (const star of stars) {
        const environmentTime = game.cycles * TICK_MS;
        const alpha = quiet || detail < 0.5 ? 0.3 : .22 + Math.sin(environmentTime * .001 + star.x) * .18;
        ctx.fillStyle = star.cyan ? `rgba(103,232,255,${alpha})` : `rgba(255,255,255,${alpha})`;
        ctx.fillRect(star.x, star.y, star.size, star.size);
      }

      // One batched path for the whole grid instead of 42 stroke calls.
      ctx.strokeStyle = "rgba(86, 176, 200, .055)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 30; x < VIEW_WIDTH; x += 30) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, VIEW_HEIGHT);
      }
      for (let y = 30; y < VIEW_HEIGHT; y += 30) {
        ctx.moveTo(0, y);
        ctx.lineTo(VIEW_WIDTH, y);
      }
      ctx.stroke();

      const locked = cameraRef.current;
      const camScale = locked ? ZOOM_SCALE[zoomRef.current] : Math.min(VIEW_WIDTH / game.worldWidth, VIEW_HEIGHT / game.worldHeight);
      const camX = locked ? cap(VIEW_WIDTH / 2 - player.x * camScale, VIEW_WIDTH - game.worldWidth * camScale, 0) : (VIEW_WIDTH - game.worldWidth * camScale) / 2;
      const camY = locked ? cap(VIEW_HEIGHT / 2 - player.y * camScale, VIEW_HEIGHT - game.worldHeight * camScale, 0) : (VIEW_HEIGHT - game.worldHeight * camScale) / 2;
      const viewLeft = -camX / camScale;
      const viewTop = -camY / camScale;
      const viewRight = (VIEW_WIDTH - camX) / camScale;
      const viewBottom = (VIEW_HEIGHT - camY) / camScale;
      const visible = (x: number, y: number, r: number) =>
        x + r > viewLeft && x - r < viewRight && y + r > viewTop && y - r < viewBottom;

      const victoryCamera = game.victorySequence > 0 ? victoryVisualState(game.victorySequence, TICK_MS) : null;
      const shake = quiet ? 0 : victoryCamera?.shake ?? 0;
      const shakeX = shake ? Math.sin(time * 0.071) * shake : 0;
      const shakeY = shake ? Math.cos(time * 0.093) * shake * 0.72 : 0;
      ctx.save();
      ctx.translate(camX + shakeX, camY + shakeY);
      ctx.scale(camScale, camScale);

      for (const rock of backgroundRocks) {
        if (!visible(rock.x, rock.y, rock.radius + 20)) continue;
        ctx.save();
        ctx.translate(rock.x, rock.y);
        ctx.rotate(rock.rotation + game.cycles * TICK_MS * rock.drift);
        ctx.globalAlpha = detail < 0.5 ? 0.035 : 0.065;
        ctx.fillStyle = "#5a7180";
        ctx.strokeStyle = "rgba(112, 175, 190, .22)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let side = 0; side < rock.sides; side += 1) {
          const angle = (side / rock.sides) * Math.PI * 2;
          const uneven = side % 2 === 0 ? 1 : 0.78;
          const x = Math.cos(angle) * rock.radius * uneven;
          const y = Math.sin(angle) * rock.radius * uneven;
          if (side === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      drawPortal(game, time, detail);
      for (const spawn of game.spawns) drawSpawnFx(spawn, time, detail);

      // Friendly pickups sit in a bright hexagonal cradle so they never read as
      // an incoming hostile hull.
      for (const pickup of game.pickups) {
        if (!visible(pickup.x, pickup.y, 26)) continue;
        const color = POWER_COLORS[pickup.type];
        ctx.save();
        ctx.translate(pickup.x, pickup.y);
        if (profile.shadows) { ctx.shadowColor = color; ctx.shadowBlur = 12; }
        ctx.strokeStyle = "rgba(233,251,255,.85)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = 0; i < 6; i += 1) {
          const a = (i / 6) * Math.PI * 2 + pickup.phase * 0.35;
          const x = Math.cos(a) * 19;
          const y = Math.sin(a) * 19;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = `${color}22`;
        ctx.fill();
        drawWeaponGlyph(ctx, pickup.type, 11, time, { detail });
        ctx.restore();
      }

      for (const enemy of game.enemies) {
        const reach = enemy.kind === "beam" || enemy.kind === "emp" || enemy.kind === "nuke" ? 1200 : enemy.radius + 24;
        if (!visible(enemy.x, enemy.y, reach)) continue;
        drawEnemy(game, enemy, time, detail);
      }

      // Pulse-cannon rounds: thin bright darts with a white core.
      for (const bullet of game.bullets) {
        if (!visible(bullet.x, bullet.y, 20)) continue;
        const tailX = bullet.x - bullet.vx * 2.2;
        const tailY = bullet.y - bullet.vy * 2.2;
        ctx.save();
        if (bullet.enemy) {
          ctx.strokeStyle = "rgba(10,2,6,.85)";
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(bullet.x, bullet.y);
          ctx.lineTo(tailX, tailY);
          ctx.stroke();
          ctx.strokeStyle = bullet.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(bullet.x, bullet.y);
          ctx.lineTo(tailX, tailY);
          ctx.stroke();
          ctx.fillStyle = "#ffe7ec";
          ctx.beginPath();
          ctx.arc(bullet.x, bullet.y, 2.4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          if (profile.shadows) { ctx.shadowColor = bullet.color; ctx.shadowBlur = bullet.special ? 13 : 7; }
          const bankshot = !bullet.special && (bullet.bouncesLeft ?? 0) > 0;
          ctx.strokeStyle = bankshot ? "#73f6b0" : bullet.color;
          ctx.lineWidth = bullet.special ? 4.4 : bankshot ? 3.4 : 2.6;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(bullet.x, bullet.y);
          ctx.lineTo(tailX, tailY);
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = "rgba(255,255,255,.9)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(bullet.x, bullet.y);
          ctx.lineTo(tailX + (bullet.x - tailX) * 0.45, tailY + (bullet.y - tailY) * 0.45);
          ctx.stroke();
        }
        ctx.restore();
      }

      for (const fx of game.blasts) {
        if (!visible(fx.x, fx.y, (fx.spec.blast?.radius ?? 0) + 20)) continue;
        drawOverchargeBlast(fx, detail);
      }

      for (const power of game.powers) {
        if (!visible(power.x, power.y, 40)) continue;
        ctx.save();
        if (profile.shadows) { ctx.shadowColor = POWER_COLORS[power.type]; ctx.shadowBlur = 14; }
        drawPowerProjectile(ctx, power.type, power.x, power.y, power.vx, power.vy, time, detail);
        ctx.restore();
      }

      for (const particle of game.particles) {
        ctx.globalAlpha = cap(particle.life / Math.max(1, particle.maxLife), 0, 1);
        ctx.fillStyle = particle.color;
        ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
      }
      ctx.globalAlpha = 1;

      if (player.health > 0) {
        ctx.save();
        // A player hull must never inherit transparent or destructive canvas
        // state from an earlier arena effect. Form Shift can be triggered
        // repeatedly during long Switchback runs, so the player draw owns
        // an explicit visible render-state boundary every frame.
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.shadowBlur = 0;
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        ctx.translate(player.x, player.y);
        ctx.rotate(player.angle * DEG);
        // Phantom's pulse phases the hull out while it lands, so the frame
        // reads as untouchable rather than merely lucky.
        if (shipOvercharge?.id === "scrambler" && player.riderTicks > 0) {
          ctx.globalAlpha = 0.42 + Math.sin(time * 0.02) * 0.12;
        }
        ctx.strokeStyle = player.invuln > 0 ? "#ffffff" : "#69ecff";
        ctx.fillStyle = "rgba(86, 226, 255, .12)";
        if (profile.shadows) { ctx.shadowColor = "#62eaff"; ctx.shadowBlur = 10; }
        ctx.lineWidth = 2;
        drawShipShape(ctx, game.ship.id, (game.ship.id === "flagship" ? .82 : 1) * 1.15);
        ctx.fill();
        ctx.stroke();
        if (player.shield > 0 || player.invuln > 0) {
          ctx.strokeStyle = player.invuln > 0 ? "#ffffff" : "#76a7ff";
          ctx.globalAlpha = .7;
          ctx.beginPath();
          ctx.arc(0, 0, game.ship.id === "flagship" ? 30 : 22, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();

        if (player.emp > 0) {
          ctx.save();
          ctx.translate(player.x, player.y);
          const pulse = 0.55 + Math.sin(time * 0.025) * 0.2;
          ctx.strokeStyle = "#7fb6ff";
          ctx.lineWidth = 2.4;
          ctx.globalAlpha = pulse;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.arc(0, 0, 31 + Math.sin(time * 0.018) * 3, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 0.95;
          ctx.fillStyle = "#dce8ff";
          ctx.font = "800 12px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.fillText(`SCRAMBLED ${(player.emp * TICK_MS / 1000).toFixed(1)}s`, 0, -38);
          ctx.restore();
        }

        if (player.ricochetTicks > 0) {
          ctx.save();
          ctx.translate(player.x, player.y);
          ctx.strokeStyle = "#73f6b0";
          ctx.globalAlpha = 0.42;
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 7]);
          ctx.beginPath();
          ctx.arc(0, 0, 36 + Math.sin(time * 0.014) * 2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 0.92;
          ctx.fillStyle = "#c8ffe5";
          ctx.font = "800 12px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.fillText(`BANKSHOT ${(player.ricochetTicks * TICK_MS / 1000).toFixed(1)}s`, 0, player.emp > 0 ? 52 : 44);
          ctx.restore();
        }

        const teammate = netRef.current?.state.teammate;
        if (game.mode === "coop" && teammate) {
          const allyPulse = 32 + Math.sin(time * 0.01) * 4;
          const allyAngle = teammate.angle * DEG;
          ctx.save();
          ctx.strokeStyle = "rgba(182,255,87,.38)";
          ctx.lineWidth = 3;
          ctx.setLineDash([7, 9]);
          ctx.beginPath();
          ctx.moveTo(player.x, player.y);
          ctx.lineTo(teammate.x, teammate.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.translate(teammate.x, teammate.y);
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 7;
          ctx.shadowColor = "#b6ff57";
          ctx.shadowBlur = 18;
          ctx.beginPath();
          ctx.arc(0, 0, allyPulse, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = "#b6ff57";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(0, 0, allyPulse, 0, Math.PI * 2);
          ctx.stroke();
          ctx.rotate(allyAngle);
          ctx.strokeStyle = "#ffffff";
          ctx.fillStyle = "rgba(182,255,87,.42)";
          ctx.lineWidth = 4;
          drawShipShape(ctx, teammate.ship as ShipId, (teammate.ship === "flagship" ? .82 : 1) * 1.15);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          const allyDx = teammate.x - player.x;
          const allyDy = teammate.y - player.y;
          const allyDistance = Math.hypot(allyDx, allyDy);
          if (allyDistance > 180) {
            const direction = Math.atan2(allyDy, allyDx);
            const beaconX = player.x + Math.cos(direction) * 72;
            const beaconY = player.y + Math.sin(direction) * 72;
            ctx.save();
            ctx.translate(beaconX, beaconY);
            ctx.rotate(direction);
            ctx.fillStyle = "#b6ff57";
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2;
            ctx.shadowColor = "#b6ff57";
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.moveTo(14, 0);
            ctx.lineTo(-8, -9);
            ctx.lineTo(-4, 0);
            ctx.lineTo(-8, 9);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
          ctx.save();
          ctx.fillStyle = "#06110a";
          ctx.strokeStyle = "#b6ff57";
          ctx.lineWidth = 2;
          const label = `ALLY · ${teammate.name}`;
          ctx.font = "900 13px monospace";
          ctx.textAlign = "center";
          const labelWidth = ctx.measureText(label).width + 16;
          ctx.fillRect(teammate.x - labelWidth / 2, teammate.y - 49, labelWidth, 22);
          ctx.strokeRect(teammate.x - labelWidth / 2, teammate.y - 49, labelWidth, 22);
          ctx.fillStyle = "#b6ff57";
          ctx.fillText(label, teammate.x, teammate.y - 33);
          ctx.restore();
        }

        // Muzzle flare on the hull itself. Short, bright and in the ship's
        // own accent, so an overcharge is legible as a SPECIAL from the first
        // frame rather than only once the ring has grown.
        if (shipOvercharge && player.overchargeFlash > 0) {
          const flash = player.overchargeFlash / OVERCHARGE_FLASH_TICKS;
          ctx.save();
          ctx.translate(player.x, player.y);
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = shipOvercharge.accent;
          ctx.globalAlpha = flash * 0.85;
          ctx.lineWidth = 2 + flash * 4;
          ctx.beginPath();
          ctx.arc(0, 0, 26 + (1 - flash) * 54, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // The handling rider, whichever direction it runs in: a tight halo for
        // a boost, a heavy dashed drag ring for Talon's post-blast stagger.
        if (shipOvercharge && player.riderTicks > 0) {
          const rider = player.riderTicks / Math.max(1, player.riderTotal);
          const dragging = player.riderMaxSpeed < 1;
          ctx.save();
          ctx.translate(player.x, player.y);
          ctx.globalAlpha = 0.2 + rider * 0.25;
          ctx.strokeStyle = shipOvercharge.accent;
          ctx.lineWidth = dragging ? 3 : 2;
          if (dragging) ctx.setLineDash([6, 8]);
          ctx.beginPath();
          ctx.arc(0, 0, (dragging ? 36 : 30) + Math.sin(time * 0.018) * 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        if (player.viperGuidance > 0) {
          ctx.save();
          ctx.translate(player.x, player.y);
          ctx.globalAlpha = 0.3;
          ctx.strokeStyle = "#b6ff57";
          ctx.setLineDash([5, 7]);
          ctx.beginPath();
          ctx.arc(0, 0, 34, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        if (player.flagshipField > 0) {
          const life = player.flagshipField / ticksForSeconds(3);
          const phase = 1 - life;
          ctx.save();
          ctx.translate(player.x, player.y);
          ctx.globalAlpha = 0.35 + life * 0.45;
          ctx.strokeStyle = "#68f2ff";
          ctx.lineWidth = 2;
          if (profile.shadows) { ctx.shadowColor = "#68f2ff"; ctx.shadowBlur = 14; }
          for (let ring = 0; ring < 3; ring += 1) {
            const radius = 48 + ((phase * 90 + ring * 34) % 110);
            ctx.globalAlpha = (0.22 + life * 0.34) * (1 - (radius - 48) / 150);
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.setLineDash([7, 9]);
          ctx.globalAlpha = 0.32 + life * 0.28;
          ctx.beginPath();
          ctx.arc(0, 0, 178, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Collision shield: a ring whose weight tracks remaining charge, plus
        // a ripple on absorption and a flash on break. Drawn unrotated so it
        // reads as a bubble around the hull rather than part of the ship.
        const shield = game.collisionShield;
        if (shield) {
          const ringRadius = game.ship.id === "flagship" ? 34 : 27;
          const fraction = shield.charge / shield.capacity;
          ctx.save();
          ctx.translate(player.x, player.y);
          if (fraction > 0) {
            ctx.globalAlpha = 0.35 + fraction * 0.45;
            ctx.strokeStyle = "#64eaff";
            ctx.lineWidth = 1 + fraction * 2.2;
            if (profile.shadows) { ctx.shadowColor = "#64eaff"; ctx.shadowBlur = 8; }
            ctx.beginPath();
            ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            // Broken: a dashed ghost ring so the loss is legible at a glance.
            ctx.globalAlpha = 0.3;
            ctx.strokeStyle = "#7c94a0";
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 7]);
            ctx.beginPath();
            ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          if (game.shieldRipple > 0) {
            ctx.globalAlpha = game.shieldRipple * 0.7;
            ctx.strokeStyle = "#d6fbff";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, ringRadius + (1 - game.shieldRipple) * 16, 0, Math.PI * 2);
            ctx.stroke();
          }
          if (game.shieldBreak > 0) {
            ctx.globalAlpha = game.shieldBreak * 0.85;
            ctx.strokeStyle = "#ffb346";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, ringRadius + (1 - game.shieldBreak) * 30, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();
        }
      }
      ctx.restore();

      return { camScale, camX, camY };
    };

    /**
     * HUD pass. Drawn in CSS pixels rather than arena units so every readout
     * keeps the same on-screen size whether the arena is 320px or 900px wide.
     */
    const drawOverlay = (time: number, camera: { camScale: number; camX: number; camY: number }) => {
      const game = gameRef.current;
      const W = cssWidth;
      const H = cssHeight;
      ctx.setTransform(cssScale, 0, 0, cssScale, 0, 0);
      ctx.textBaseline = "middle";

      const base = cap(W / 655, 0.96, 1.3);
      const fs = (size: number) => Math.max(11.5, Math.round(size * base * 10) / 10);
      const mono = (weight: number, size: number) => `${weight} ${fs(size)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      const pad = Math.round(fs(12));
      const top = pad + hudInsetRef.current;

      const fit = (text: string, maxWidth: number) => {
        if (ctx.measureText(text).width <= maxWidth) return text;
        let clipped = text;
        while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) clipped = clipped.slice(0, -1);
        return `${clipped}…`;
      };

      const panel = (x: number, y: number, w: number, h: number, stroke: string) => {
        ctx.fillStyle = "rgba(2,7,12,.86)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      };


      // Next weapon in the bin, mirrored by the HTML inventory below the arena.
      const queued = nextWeapon(game.stock);
      if (queued && game.running && !game.result && viewProfileRef.current.canvasQueue) {
        const meta = WEAPONS[queued];
        const chipH = Math.round(fs(12) * 3);
        const chipW = cap(W * 0.4, 176, 250);
        const chipX = W - pad - chipW;
        const chipY = H - pad - chipH;
        panel(chipX, chipY, chipW, chipH, `${meta.color}66`);
        ctx.save();
        ctx.translate(chipX + chipH * 0.5, chipY + chipH * 0.5);
        drawWeaponGlyph(ctx, queued, chipH * 0.28, time, { detail: profile.detail });
        ctx.restore();
        ctx.textAlign = "left";
        ctx.fillStyle = "#8fb2bb";
        ctx.font = mono(700, 11.5);
        ctx.fillText("NEXT — PRESS E / PUP", chipX + chipH, chipY + fs(12) * 0.95);
        ctx.fillStyle = meta.color;
        ctx.font = mono(800, 13);
        ctx.fillText(fit(meta.name, chipW - chipH - pad), chipX + chipH, chipY + fs(12) * 2.15);
      }

      // Spawn nameplates. One short line each, glyph first, in a fixed stack
      // under the HUD band: a plate that always appears in the same place is
      // far quicker to read than one that chases the portal around the arena.
      const plateH = Math.round(fs(13) * 2.2);
      const firstPlate = Math.max(0, game.spawns.length - MAX_NAMEPLATES);
      for (let i = firstPlate; i < game.spawns.length; i += 1) {
        const spawn = game.spawns[i];
        const meta = WEAPONS[spawn.type];
        const p = cap(spawn.age / spawn.life, 0, 1);
        // Hold at full strength for most of the life, then fade quickly.
        const alpha = p < 0.08 ? p / 0.08 : cap((1 - p) / 0.22, 0, 1);
        const label = spawn.kind === "hostile"
          ? `${meta.short}${spawn.count > 1 ? ` ×${spawn.count}` : ""}  ${threatBadge(meta)}`
          : spawn.kind === "friendly"
            ? `${meta.short}  READY`
            : `${meta.short}  SENT  −${spawn.count}`;
        const accent = spawn.kind === "hostile" ? "#ff6a80" : spawn.kind === "friendly" ? "#8dffd0" : meta.color;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = mono(800, 13);
        const iconW = plateH;
        const plateW = Math.round(ctx.measureText(label).width + iconW + pad * 1.4);
        const plateX = Math.round((W - plateW) / 2);
        const plateY = Math.round(top + (i - firstPlate) * (plateH + 6));
        panel(plateX, plateY, plateW, plateH, `${accent}aa`);
        ctx.save();
        ctx.translate(plateX + iconW * 0.5, plateY + plateH * 0.5);
        drawWeaponGlyph(ctx, spawn.type, plateH * 0.3, time, { detail: profile.detail });
        ctx.restore();
        ctx.textAlign = "left";
        ctx.fillStyle = spawn.kind === "hostile" ? "#ffd9de" : "#eafcff";
        ctx.fillText(label, plateX + iconW, plateY + plateH / 2);
        ctx.restore();
      }

      // Rival wormhole label follows the portal.
      const portalX = (game.portalX * camera.camScale + camera.camX) * (W / VIEW_WIDTH);
      const portalY = (game.portalY * camera.camScale + camera.camY) * (W / VIEW_WIDTH);
      if (game.victorySequence > 0) {
        const visual = victoryVisualState(game.victorySequence, TICK_MS);
        const reduced = reducedMotionRef.current;
        ctx.save();
        ctx.translate(portalX, portalY);
        ctx.globalCompositeOperation = "lighter";

        if (visual.phase === "freeze" || visual.phase === "pull") {
          const flash = reduced ? 0.7 : 0.35 + Math.abs(Math.sin(time * 0.035)) * 0.65;
          ctx.globalAlpha = flash;
          ctx.strokeStyle = visual.phase === "freeze" ? "#ffffff" : "#ff4fd8";
          ctx.lineWidth = 3;
          for (let ring = 0; ring < 3; ring += 1) {
            ctx.beginPath();
            ctx.arc(0, 0, (42 + ring * 22) * visual.portalScale, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else if (visual.phase === "collapse") {
          const dot = Math.max(2.5, 28 * visual.portalScale);
          ctx.globalAlpha = 0.75 + visual.phaseProgress * 0.25;
          ctx.fillStyle = "#ffffff";
          ctx.shadowColor = "#ff4fd8";
          ctx.shadowBlur = 26;
          ctx.beginPath();
          ctx.arc(0, 0, dot, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#68f2ff";
          ctx.globalAlpha = 1 - visual.phaseProgress;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, 72 * (1 - visual.phaseProgress), 0, Math.PI * 2);
          ctx.stroke();
        } else {
          const p = visual.phaseProgress;
          const coreLife = Math.max(0, 1 - p * 2.6);
          ctx.globalAlpha = coreLife;
          ctx.fillStyle = "#ffffff";
          ctx.shadowColor = "#ffffff";
          ctx.shadowBlur = 42;
          ctx.beginPath();
          ctx.arc(0, 0, 18 + p * 55, 0, Math.PI * 2);
          ctx.fill();

          const waveProgresses = [p, Math.max(0, p - 0.16) / 0.84, Math.max(0, p - 0.34) / 0.66];
          waveProgresses.forEach((wave, index) => {
            if (wave <= 0 || wave >= 1) return;
            ctx.globalAlpha = (1 - wave) * (index === 1 ? 0.9 : 0.72);
            ctx.strokeStyle = index === 0 ? "#ffffff" : index === 1 ? "#68f2ff" : "#ff4fd8";
            ctx.lineWidth = Math.max(1, 7 - wave * 5);
            ctx.beginPath();
            ctx.arc(0, 0, 20 + wave * (reduced ? 150 : 310), 0, Math.PI * 2);
            ctx.stroke();
          });
        }
        ctx.restore();
      }

      if (game.spawns.length === 0 && portalX > -60 && portalX < W + 60 && portalY > -60 && portalY < H + 60) {
        ctx.font = mono(700, 11.5);
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(244,226,255,.9)";
        ctx.fillText("RIVAL RIFT", cap(portalX, 60, W - 60), cap(portalY + 82 * camera.camScale * (W / VIEW_WIDTH), 12, H - 12));
      }

      // Player-hit feedback: a brief red rim, never a full-screen wash.
      const invuln = game.player.invuln;
      if (invuln > 0 && game.player.health > 0 && profile.detail >= 0.35) {
        const strength = cap(invuln / 24, 0, 1) * 0.55;
        const vignette = ctx.createRadialGradient(W / 2, W / 2, W * 0.32, W / 2, W / 2, W * 0.72);
        vignette.addColorStop(0, "rgba(255,60,90,0)");
        vignette.addColorStop(1, `rgba(255,60,90,${strength})`);
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, W, W);
      }

      if (!game.running || game.paused || game.result) {
        ctx.fillStyle = "rgba(1,4,8,.82)";
        ctx.fillRect(0, 0, W, W);
        ctx.textAlign = "center";
        const title = game.paused ? "PAUSED"
          : game.result === "victory" ? "RIVAL ELIMINATED"
            : game.result === "defeat" ? game.survival ? "RUN ENDED" : "SHIP DESTROYED"
              : "BREACH RUNNER";
        ctx.fillStyle = game.result === "victory" ? "#b8ff72" : game.result === "defeat" ? "#ff7285" : "#eafcff";
        const titleSize = cap(W * 0.072, 24, 46);
        ctx.font = `900 ${titleSize}px Arial, Helvetica, sans-serif`;
        ctx.fillText(fit(title, W - 32), W / 2, W / 2 - titleSize * 0.6);
        ctx.fillStyle = "#c6e3ea";
        ctx.font = mono(700, 13.5);
        const line = game.paused ? "PRESS P TO RESUME"
          : game.result && game.survival
            ? `SURVIVED ${formatRunTime(Math.floor(game.elapsedTicks * TICK_MS / 1000))}  ·  RIFT LEVEL ${game.survival.peakLevel}`
            : game.result ? `SCORE ${game.score.toLocaleString()}  ·  PRESS ENTER OR RUN AGAIN`
              : "CHOOSE A SHIP, THEN START MISSION";
        ctx.fillText(fit(line, W - 32), W / 2, W / 2 + fs(13.5) * 0.6);
        ctx.fillStyle = "#8bacb5";
        ctx.font = mono(700, 12);
        const hint = touchDevice
          ? "LEFT STICK FLY  ·  RIGHT STICK AIM + FIRE  ·  PUP SENDS A POWER-UP"
          : "WASD THRUST  ·  MOUSE AIM  ·  LMB CANNON  ·  RMB POWER-UP  ·  Q SPECIAL";
        ctx.fillText(fit(hint, W - 24), W / 2, W / 2 + fs(13.5) * 2.4);
      }

      if (!viewProfileRef.current.touch) {
        ctx.strokeStyle = "rgba(101,232,255,.32)";
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, W - 2, W - 2);
      }
    };

    const loop = (now: number) => {
      const delta = now - previous;
      previous = now;
      accumulator += Math.min(50, delta);
      frameAverage += (Math.min(60, delta) - frameAverage) * 0.05;
      samples += 1;
      if (samples >= 90) {
        samples = 0;
        // Auto quality tracks measured frame cost, not a one-off device guess.
        if (qualityRef.current === "auto") {
          if (frameAverage > 23 && autoQ > 0.25) autoQ = Math.max(0.25, autoQ - 0.25);
          else if (frameAverage < 15.5 && autoQ < 1) autoQ = Math.min(1, autoQ + 0.15);
        }
      }
      applyProfile();
      if (needsResize) applyResize();
      while (accumulator >= TICK_MS) { tick(); accumulator -= TICK_MS; }
      const camera = drawScene(now, profile.detail);
      drawOverlay(now, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", onDprChange);
      window.removeEventListener("orientationchange", onDprChange);
    };
  }, [play, playCue, playVictorySuction, stopVictorySuction, sync, viewMode]);

  const currentShip = selectedShip(shipId);
  const pendingRules = rulesFor(mode, difficulty);
  const lobbyStatus: LobbyStatus =
    !net || net.phase === "offline"
      ? { kind: "offline", reason: net?.offlineReason || "connecting to the match service" }
      : net.phase === "connecting"
        ? { kind: "connecting" }
        : net.phase === "searching"
          ? { kind: "searching" }
          : net.phase === "waiting" && net.code
            ? { kind: "waiting", code: net.code }
            : { kind: "idle" };
  /** True once a run is actually under way, so the badge reads live state. */
  const badgeLive = hud.running && !hud.result;
  const opponentHullPct = net?.opponentCombat?.maxHull
    ? (net.opponentCombat.hull / net.opponentCombat.maxHull) * 100
    : 0;
  const healthPct = hud.maxHealth ? hud.health / hud.maxHealth * 100 : 0;
  const queued = nextWeapon(hud.stock);
  const guidance = hud.notice || hud.coach;

  const stockCounts = useMemo(() => {
    const counts = new Map<PowerId, number>();
    hud.stock.forEach((item) => counts.set(item, (counts.get(item) ?? 0) + 1));
    return counts;
  }, [hud.stock]);

  const controlProps = (code: string) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      setControl(code, true);
      if (!reducedMotion && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(8);
    },
    onPointerUp: () => setControl(code, false),
    onPointerCancel: () => setControl(code, false),
    onPointerLeave: () => setControl(code, false),
    onLostPointerCapture: () => setControl(code, false),
  });

  const touchUtility = (mirrored = false) => (
    <div className={`touch-utility ${mirrored ? "touch-utility-mirrored" : ""}`} aria-label={mirrored ? "Mirrored left-side actions" : "Right-side actions"}>
      <button className="touch-pup" type="button" disabled={!gameActive || !queued} aria-label={queued ? `Fire power-up ${WEAPONS[queued].name}. Same as keyboard E.` : "Fire power-up. Bin is empty. Same as keyboard E."} {...controlProps("KeyE")}><b>PUP</b><small>E</small></button>
      <button className="touch-special" type="button" aria-label={`${hud.specialName}. ${hud.specialCooldown > 0 ? `Ready in ${hud.specialCooldown} seconds.` : "Ready."} Same as keyboard Q.`} disabled={!gameActive || hud.specialCooldown > 0} {...controlProps("KeyQ")}><b>SPEC</b><small>{hud.specialCooldown > 0 ? `${hud.specialCooldown}S` : "READY"}</small></button>
      <button className="touch-pause" type="button" aria-label="Pause, opens the menu" onClick={toggleMenu}><b aria-hidden="true">Ⅱ</b><small>P</small></button>
    </div>
  );

  const pinSlot = useCallback((id: PickupId) => {
    setInspect((current) => (current && current.id === id && current.pinned ? null : { id, pinned: true }));
  }, []);
  const hoverSlot = useCallback((id: PickupId) => {
    setInspect((current) => (current?.pinned ? current : { id, pinned: false }));
  }, []);
  const unhoverSlot = useCallback(() => {
    setInspect((current) => (current && !current.pinned ? null : current));
  }, []);


  // No first-launch gate. `viewMode` always resolves — the player's override if
  // they set one, the device's measured capability otherwise — so the game
  // renders on the first frame instead of blocking behind a question the
  // browser can answer itself.

  return (
    <main
      ref={shellRef}
      className={`app-shell ${touchCapable ? "touch-capable" : ""} compact-menu`}
      data-view-mode={viewMode}
      data-immersive={immersive ? "true" : "false"}
      data-orientation={layout.orientation}
      data-form={layout.form}
      data-sticks={layout.sticks}
      data-preset={layout.preset}
      data-panels={layout.panels}
      data-touch-controls={layout.showTouchControls ? "on" : "off"}
      data-touch-height={settings.touchControlHeight}
      style={{
        // Every size the interface uses comes from the one measurement, so
        // CSS never has to guess and cannot disagree with the shell.
        "--arena-size": `${layout.arena}px`,
        "--stick": `${layout.stick}px`,
        "--usable-h": `${layout.usableHeight}px`,
      } as React.CSSProperties}
    >
      <p className="sr-only" aria-live="polite">{guidance}</p>

      <header className="topbar">
        <div className="brand">
          <div>
            <img
              className="brand-logo"
              src="/branding/breach_runner_logo.webp"
              alt="Breach Runner"
              width={800}
              height={320}
            />
            <a className="brand-home" href={MURPH_SITE_URL} target="_blank" rel="noopener noreferrer">
              ← MURPH TOURNAMENTS
            </a>
          </div>
        </div>
        {/*
          Nothing else lives in this bar.

          Menu and Fullscreen belong to the global system layer, which no
          screen can cover — duplicating them per screen is exactly how they
          went missing before. RESTART used to sit here too, styled as the
          brightest control on screen despite being the one that throws the
          run away; it now lives where it belongs, in the pause menu and on
          the end-game card. It also sat underneath the global layer, which
          intercepted its clicks.
        */}
      </header>

      <section className="cockpit">
        <aside className="panel ship-panel">
          <div className="eyebrow">MISSION</div>
          <div className="mission-summary">
            <p>
              <span>MODE</span>
              <b>{mode === "pvp" ? "PVP 1V1" : mode === "coop" ? `PVE CO-OP · ${DIFFICULTIES[difficulty].shortName}` : DIFFICULTIES[difficulty].shortName}</b>
            </p>
            <div>
              <button type="button" onClick={() => go("ships")}>CHANGE SHIP</button>
              <button type="button" onClick={() => go("modes")}>CHANGE MODE</button>
            </div>
          </div>
          <div className="eyebrow">CURRENT SHIP</div>
          <div className="selected-ship">
            <div className="ship-icon" aria-hidden="true"><span className={`ship-glyph ${currentShip.id}`} /></div>
            <div><h2>{currentShip.name}</h2><p>{currentShip.role}</p></div>
          </div>
          <p className="ship-description">{currentShip.special}</p>
          <div className="data-grid">
            <div><span>HULL</span><b>{currentShip.health}</b></div>
            <div><span>RESPONSE</span><b>{currentShip.turn}°</b></div>
            <div><span>TOP SPEED</span><b>{currentShip.maxSpeed}</b></div>
            <div><span>ACCELERATION</span><b>{currentShip.acceleration}</b></div>
          </div>
          <div className="controls">
            <div className="eyebrow">FLIGHT CONTROL</div>
            <dl>
              <div><dt>MOVE UP</dt><dd>W / ↑</dd></div>
              <div><dt>MOVE DOWN</dt><dd>S / ↓</dd></div>
              <div><dt>MOVE LEFT</dt><dd>A / ←</dd></div>
              <div><dt>MOVE RIGHT</dt><dd>D / →</dd></div>
              <div><dt>AIM</dt><dd>MOUSE</dd></div>
              <div><dt>PULSE CANNON</dt><dd>MOUSE 1 / SPACE</dd></div>
              <div><dt>FIRE POWER-UP</dt><dd>MOUSE 2 / E</dd></div>
              <div><dt>SHIP SPECIAL</dt><dd>Q</dd></div>
              <div><dt>PAUSE</dt><dd>P</dd></div>
            </dl>
          </div>
        </aside>

        <section className="play-column">
          <div className="match-bar">
            <div className="score"><span>SCORE</span><b>{hud.score.toLocaleString().padStart(6, "0")}</b></div>
            <div className="match-hull"><span>HULL</span><div className="meter hull"><i style={{ width: `${healthPct}%` }} /></div><b>{hud.health}</b></div>
            {mode === "pvp" ? (
              // Rival integrity is the PvE objective and decides nothing in a
              // match. Showing it here would read as a second, contradictory
              // victory condition, so PvP shows the one that actually counts.
              <div className="rival pvp">
                <span>OPPONENT HULL</span>
                <div className="meter">
                  <i style={{ width: `${opponentHullPct}%` }} />
                </div>
                <b>{net?.opponentCombat ? Math.round(net.opponentCombat.hull) : "—"}</b>
              </div>
            ) : (
              <div className={`rival ${hud.enrageActive ? "enraged" : ""}`}><span>{hud.enrageActive ? "RIVAL INTEGRITY // ENRAGED" : "RIVAL INTEGRITY"}</span><div className="meter"><i style={{ width: `${hud.rivalHealth}%` }} /></div><b>{hud.rivalCurrentHealth}/{hud.rivalMaxHealth} · {hud.rivalHealth}%</b></div>
            )}
          </div>
          <p className={`coach-strip ${hud.notice ? "alert" : ""}`}>
            <span aria-hidden="true">▸</span>{guidance}
          </p>
          <div className="arena-stage">
            <div className="canvas-wrap" ref={canvasWrapRef} tabIndex={-1}>
              <canvas
                ref={canvasRef}
                width={VIEW_WIDTH}
                height={VIEW_HEIGHT}
                onPointerMove={handleArenaPointerMove}
                onPointerDown={handleArenaPointerDown}
                onPointerUp={handleArenaPointerUp}
                onPointerCancel={handleArenaPointerUp}
                onContextMenu={(event) => event.preventDefault()}
                role="img"
                aria-label={`Breach Runner combat arena. Hull ${hud.health} of ${hud.maxHealth}. Rift charge ${hud.portalCharge} percent. Rival integrity ${hud.rivalHealth} percent. ${hud.enrageActive ? "Rift enraged. " : ""}${queued ? `Next power-up ${WEAPONS[queued].name}.` : "Power-up bin empty."}`}
              />
              {viewProfile.verticalRails ? <div className="health-rails" aria-label={`Pilot hull ${hud.health} of ${hud.maxHealth}. Shield ${hud.shield ? `${hud.shield} percent${hud.shield < 100 ? ", recharging" : ", ready"}` : "disabled"}. ${mode === "pvp" ? `Opponent hull ${net?.opponentCombat ? Math.round(net.opponentCombat.hull) : "unavailable"}` : `Rival integrity ${hud.rivalCurrentHealth} of ${hud.rivalMaxHealth}`}.`}>
                <div className="health-rail pilot-rail"><span>HULL {hud.health}/{hud.maxHealth}</span><i className="rail-fill hull-fill" style={{ width: `${healthPct}%` }} /><i className="rail-fill shield-fill" style={{ width: `${hud.shield}%` }} /><small>{hud.shield ? `SHIELD ${hud.shield}% ${hud.shield < 100 ? "RECHARGING" : "READY"}` : "SHIELD DISABLED"}</small></div>
                <div className={`health-rail rival-rail ${hud.enrageActive ? "enraged" : ""}`}><span>{mode === "pvp" ? "OPPONENT" : "RIVAL"} {mode === "pvp" ? (net?.opponentCombat ? Math.round(net.opponentCombat.hull) : "—") : `${hud.rivalCurrentHealth}/${hud.rivalMaxHealth}`}</span><i className="rail-fill rival-fill" style={{ width: `${mode === "pvp" ? opponentHullPct : hud.rivalHealth}%` }} /></div>
              </div> : null}
              {/*
                Compact touch inventory, mounted in the arena rather than in the
                control dock. The dock is a fixed bar pinned to the bottom edge in
                portrait, so positioning against it pushed this off the bottom of the
                screen; it also sits outside the element that carries --rules-bottom,
                so the offset silently fell back to a guess. Here it shares the health
                rails' coordinate space and reads the measured value.
              */}
              <div
                className="touch-powerup-hud"
                role="status"
                aria-label={queued
                  ? `${hud.stock.length} of ${STOCK_LIMIT} power-ups stored. ${WEAPONS[queued].name} fires next.`
                  : `0 of ${STOCK_LIMIT} power-ups stored.`}
              >
                <ol className="touch-powerup-slots" aria-label="Stored power-ups in loading order">
                  {pupInventoryLayout(hud.stock, STOCK_LIMIT).stored.map((itemId, index) => {
                    const item = itemId as PickupId | null;
                    const meta = item ? WEAPONS[item] : null;
                    return (
                      <li
                        key={index}
                        className={`touch-powerup-slot ${meta ? "occupied" : "empty"}`}
                        style={{ "--pup": meta?.color ?? "var(--muted)" } as React.CSSProperties}
                        aria-label={meta ? `${meta.name}${index === STOCK_LIMIT - 2 ? ", loads next" : ""}` : "Empty slot"}
                      >
                        {meta ? (
                          <button type="button" onClick={() => pinSlot(meta.id)} aria-label={`View ${meta.name}`}>
                            <WeaponIcon id={meta.id} size={22} />
                          </button>
                        ) : <span aria-hidden="true" />}
                      </li>
                    );
                  })}
                </ol>
                {(() => {
                  const loaded = pupInventoryLayout(hud.stock, STOCK_LIMIT).loaded;
                  const meta = loaded ? WEAPONS[loaded] : null;
                  return <div className={`touch-powerup-loaded ${meta ? "occupied" : "empty"}`} style={{ "--pup": meta?.color ?? "var(--muted)" } as React.CSSProperties}>
                    <small>LOADED PUP <b>{hud.stock.length}/{STOCK_LIMIT}</b></small>
                    {meta ? <button type="button" onClick={() => pinSlot(meta.id)} aria-label={`View loaded ${meta.name}`}>
                      <WeaponIcon id={meta.id} size={28} /><strong>{meta.name}</strong>
                    </button> : <span aria-label="No PUP loaded">—</span>}
                  </div>;
                })()}
                <p className={`pup-notification ${hud.notice ? "alert" : ""}`} aria-live="polite">
                  <span aria-hidden="true">▸</span>{guidance}
                </p>
              </div>
              <div className="pilot-health">
                <span><em>PILOT HULL</em><b>{hud.health}/{hud.maxHealth}</b></span>
                <div className="meter hull"><i style={{ width: `${healthPct}%` }} /></div>
              </div>
              <DifficultyBadge hud={hud} pending={pendingRules} pendingMode={mode} live={badgeLive} />
              {mode === "pvp" && net && (net.phase === "active" || net.phase === "finished") ? (
                <PvpHud net={net} />
              ) : null}
              <i className="reticle tl" aria-hidden="true" /><i className="reticle tr" aria-hidden="true" />
              <i className="reticle bl" aria-hidden="true" /><i className="reticle br" aria-hidden="true" />
              {summary ? (
                <div className="run-summary-layer">
                  <section className="run-summary" data-controller-surface aria-live="polite" aria-label="Run result">
                    {!summary.awaitingInitials ? <button className="run-close" type="button" onClick={() => setSummary(null)} aria-label="Dismiss run summary">✕</button> : null}
                    <p className="run-outcome" data-outcome={summary.run.outcome}>
                      {summary.restored ? "LAST RUN"
                        : summary.run.difficulty === "survival" ? `RIFT LEVEL ${summary.run.riftLevel ?? 1} REACHED`
                          : summary.run.practice ? "PRACTICE COMPLETE"
                            : summary.run.outcome === "victory" ? "RIVAL ELIMINATED" : "SHIP DESTROYED"}
                    </p>
                    {/*
                      Survival is scored on time, so time is what the card
                      leads with. The base/penalty settlement below it belongs
                      to the arcade modes and would only ever read as zero here.
                    */}
                    {summary.run.difficulty === "survival" ? (
                      <>
                        <p className="run-score"><span>SURVIVED</span><b>{formatRunTime(summary.run.durationSeconds)}</b></p>
                        <div className="score-settlement">
                          <span>RIFT LEVEL <b>{summary.run.riftLevel ?? 1}</b></span>
                          <span>BREACHES <b>{summary.run.breaches ?? 0}</b></span>
                          <span>SCORE <b>{summary.run.score.toLocaleString()}</b></span>
                        </div>
                        <p className="run-meta">
                          {summary.survivalRank === 1
                            ? "NEW DEVICE BEST"
                            : summary.survivalRank
                              ? `DEVICE RANK #${summary.survivalRank}${
                                  summary.survivalBoard?.[0]
                                    ? ` · BEST ${formatRunTime(summary.survivalBoard[0].durationSeconds)}`
                                    : ""
                                }`
                              : summary.survivalBoard?.[0]
                                ? `OFF THE BOARD · BEST ${formatRunTime(summary.survivalBoard[0].durationSeconds)}`
                                : "FIRST SURVIVAL RUN ON THIS DEVICE"}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="run-score"><span>FINAL SCORE</span><b>{summary.run.score.toLocaleString()}</b></p>
                        <div className="score-settlement">
                          <span>BASE <b>{(summary.run.baseScore ?? summary.run.score).toLocaleString()}</b></span>
                          <span>TIME <b>{formatRunTime(summary.run.durationSeconds)}</b></span>
                          <span>PENALTY <b>−{(summary.run.timePenalty ?? 0).toLocaleString()}</b></span>
                        </div>
                        <p className="run-meta">
                          {summary.isBest ? "NEW DEVICE BEST" : summary.best ? `DEVICE BEST ${summary.best.score.toLocaleString()}` : "FIRST RUN ON THIS DEVICE"}
                        </p>
                      </>
                    )}

                    {summary.awaitingInitials ? (
                      <form
                        className="initials-entry"
                        onSubmit={(event) => {
                          event.preventDefault();
                          confirmInitials();
                        }}
                      >
                        <label htmlFor="arcade-initials">ENTER YOUR INITIALS</label>
                        <input
                          id="arcade-initials"
                          value={initialsEntry}
                          maxLength={3}
                          inputMode="text"
                          enterKeyHint="done"
                          autoCapitalize="characters"
                          autoComplete="off"
                          spellCheck={false}
                          onFocus={beginInitialsEditing}
                          onBlur={finishInitialsEditing}
                          onChange={(event) => setInitialsEntry(normalizeInitials(event.target.value))}
                          aria-describedby="initials-help"
                        />
                        <small id="initials-help">{initialsEntry.length}/3 · LETTERS OR NUMBERS</small>
                        <button type="submit" className="run-action primary" disabled={initialsEntry.length !== 3}>LOCK SCORE</button>
                      </form>
                    ) : summary.run.practice ? (
                      <div className="run-save"><p className="run-status">PRACTICE RUN // NOT SAVED TO LEADERBOARDS</p></div>
                    ) : summary.run.difficulty === "survival" ? (
                      <div className="run-save">
                        <p className="run-status ok">
                          {summary.survivalRank
                            ? `RANKED #${summary.survivalRank} ON THIS DEVICE`
                            : "RUN SAVED ON THIS DEVICE"}
                        </p>
                        {/*
                          The public Survival board is not open yet, so a
                          submission ordinarily reports the failure state. Say
                          that plainly instead of dressing it as an error the
                          player could act on.
                        */}
                        {summary.run.initials && saveState.status === "saving" ? <p className="run-status">SENDING TO THE SURVIVAL BOARD…</p> : null}
                        {summary.run.initials && saveState.status === "saved" ? (
                          <p className="run-status ok">
                            SURVIVAL BOARD UPDATED{saveState.rank ? ` · #${saveState.rank}` : ""}
                          </p>
                        ) : null}
                        {summary.run.initials && saveState.status === "error" ? (
                          <p className="run-status">GLOBAL SURVIVAL BOARD NOT OPEN YET</p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="run-save">
                        <p className="run-status ok">
                          {summary.run.initials
                            ? `SCORE LOCKED // ${summary.run.initials} · SAVED ON THIS DEVICE`
                            : "RUN SAVED ON THIS DEVICE"}
                        </p>
                        {summary.run.outcome === "victory" && mode === "pve" && saveState.status === "saving" ? <p className="run-status">ADDING SCORE TO GLOBAL BOARD…</p> : null}
                        {summary.run.outcome === "victory" && mode === "pve" && saveState.status === "saved" ? (
                          <p className="run-status ok">
                            GLOBAL BOARD UPDATED{saveState.rank ? ` · #${saveState.rank}` : ""}
                          </p>
                        ) : null}
                        {summary.run.outcome === "victory" && mode === "pve" && saveState.status === "error" ? (
                          <>
                            <p className="run-status warn">{saveState.message}</p>
                            <button type="button" className="run-action" onClick={() => void saveRun(summary.run)}>TRY BOARD AGAIN</button>
                          </>
                        ) : null}
                      </div>
                    )}

                    <div className={`death-info ${summary.run.outcome === "victory" ? "victory" : ""}`} role="status">
                      <strong>FINAL EVENT</strong>
                      <span>{finalEventLabel(summary.run)}</span>
                    </div>

                    <div className="run-links" aria-label="End game actions">
                      {summary.awaitingInitials ? (
                        <p className="run-links-note" role="status">LOCK SCORE TO CONTINUE</p>
                      ) : null}
                      <button
                        type="button"
                        className="run-action primary"
                        disabled={summary.awaitingInitials || (mode !== "pve" && Boolean(net?.rematch?.you))}
                        onClick={() => {
                          if (mode === "pve") start();
                          else netRef.current?.requestRematch();
                        }}
                      >
                        {mode !== "pve" && net?.rematch?.you
                          ? net.rematch.opponent ? "REMATCH STARTING" : mode === "coop" ? "WAITING FOR ALLY" : "WAITING FOR OPPONENT"
                          : "RUN AGAIN"}
                      </button>
                      <button
                        type="button"
                        disabled={summary.awaitingInitials || (mode !== "pve" && Boolean(net?.rematch?.you))}
                        onClick={() => {
                          if (mode === "pve") setSummary(null);
                          go("ships");
                        }}
                      >
                        CHANGE SHIP
                      </button>
                      <button
                        type="button"
                        disabled={summary.awaitingInitials}
                        onClick={() => {
                          if (mode !== "pve") netRef.current?.leave();
                          setSummary(null);
                          setMenu(resetRoute("modes"));
                        }}
                      >
                        CHANGE GAME MODE
                      </button>
                      {/*
                        Each result card links to the board its run is actually
                        ranked on. Sending a Survival run to the arcade board
                        would be sending the player to look for a result that
                        was never submitted there.
                      */}
                      {mode === "pve" ? (
                        <button
                          type="button"
                          className="run-board-link"
                          disabled={summary.awaitingInitials}
                          onClick={() => {
                            setBoardKind(summary.run.difficulty === "survival" ? "survival" : "arcade");
                            go("leaderboard");
                          }}
                        >
                          {summary.run.difficulty === "survival" ? "SURVIVAL BOARD" : "GLOBAL BOARD"}
                        </button>
                      ) : null}
                    </div>
                  </section>
                </div>
              ) : null}
            </div>
            <div className="touch-controls" aria-label="Twin-stick touch controls">
              <div className="touch-flight">
                <div
                  ref={moveStickRef}
                  className={`virtual-stick move-stick ${moveStickPosition.active ? "active" : ""}`}
                  role="application"
                  aria-label="Movement thumbstick. Press to thrust and aim in any direction to fly that way. Release to coast."
                  onPointerDown={(event) => engageStick("move", event)}
                  onPointerMove={(event) => moveStick("move", event)}
                  onPointerUp={(event) => releaseStick("move", event.pointerId)}
                  onPointerCancel={(event) => releaseStick("move", event.pointerId)}
                  onLostPointerCapture={(event) => releaseStick("move", event.pointerId)}
                >
                  <span className="stick-axis stick-axis-x" aria-hidden="true" />
                  <span className="stick-axis stick-axis-y" aria-hidden="true" />
                  <span className="stick-label stick-label-up" aria-hidden="true">MOVE</span>
                  <span className="stick-label stick-label-side" aria-hidden="true">DRIVE</span>
                  <span className="stick-knob" style={{ transform: `translate(calc(-50% + ${moveStickPosition.x}px), calc(-50% + ${moveStickPosition.y}px))` }} aria-hidden="true"><i /></span>
                </div>
                {touchUtility(true)}
              </div>
              <div className="touch-action">
                <div
                  ref={aimStickRef}
                  className={`virtual-stick aim-stick ${aimStickPosition.active ? "active" : ""}`}
                  role="application"
                  aria-label="Weapon thumbstick. Press and aim in any direction to fire the pulse cannon continuously."
                  onPointerDown={(event) => engageStick("aim", event)}
                  onPointerMove={(event) => moveStick("aim", event)}
                  onPointerUp={(event) => releaseStick("aim", event.pointerId)}
                  onPointerCancel={(event) => releaseStick("aim", event.pointerId)}
                  onLostPointerCapture={(event) => releaseStick("aim", event.pointerId)}
                >
                  <span className="stick-axis stick-axis-x" aria-hidden="true" />
                  <span className="stick-axis stick-axis-y" aria-hidden="true" />
                  <span className="stick-label stick-label-up" aria-hidden="true">FIRE</span>
                  <span className="stick-label stick-label-side" aria-hidden="true">AIM</span>
                  <span className="stick-knob" style={{ transform: `translate(calc(-50% + ${aimStickPosition.x}px), calc(-50% + ${aimStickPosition.y}px))` }} aria-hidden="true"><i /></span>
                </div>
                {touchUtility()}
              </div>
            </div>

            <div className="status-dock">
            <div className="vitals">
              <span>HULL <b>{hud.health}/{hud.maxHealth}</b></span>
              <div className="meter hull"><i style={{ width: `${healthPct}%` }} /></div>
              <span>SHIELD <b>{hud.shield}%</b></span>
              <div className="meter shield"><i style={{ width: `${hud.shield}%` }} /></div>
              <span>SPECIAL <b>{hud.specialCooldown > 0 ? `${hud.specialName} ${hud.specialCooldown}S` : `${hud.specialName} READY`}</b></span>
            </div>
            <div className="power-bin">
              <div className="bin-label">
                <span>POWER-UP BIN <b className="bin-count">{hud.stock.length}/{STOCK_LIMIT}</b></span>
                <small>FIRE WITH <b>E</b> / <b>PUP</b></small>
              </div>
              <ul className="bin-slots" aria-label="Power-up bin. The last collected power-up fires first.">
                {Array.from({ length: STOCK_LIMIT }, (_, index) => {
                  const item = hud.stock[index];
                  if (!item) {
                    return (
                      <li key={index} className="slot empty">
                        <span className="slot-index" aria-hidden="true">{index + 1}</span>
                        <small>EMPTY</small>
                      </li>
                    );
                  }
                  const meta = WEAPONS[item];
                  const isNext = index === hud.stock.length - 1;
                  const duplicates = stockCounts.get(item) ?? 1;
                  return (
                    <li key={index} className={`slot loaded ${isNext ? "next" : ""}`} style={{ "--pup": meta.color } as React.CSSProperties}>
                      <button
                        type="button"
                        aria-label={`Slot ${index + 1}: ${meta.name}, ${CATEGORY_LABELS[meta.category]}${isNext ? ", fires next with E or PUP" : ""}${duplicates > 1 ? `, ${duplicates} held` : ""}. Activate for details.`}
                        aria-expanded={inspect?.id === item && inspect.pinned}
                        onClick={() => pinSlot(item)}
                        onMouseEnter={() => hoverSlot(item)}
                        onMouseLeave={unhoverSlot}
                        onFocus={() => hoverSlot(item)}
                        onBlur={unhoverSlot}
                      >
                        {isNext ? <em className="slot-next" aria-hidden="true">NEXT</em> : <span className="slot-index" aria-hidden="true">{index + 1}</span>}
                        <WeaponIcon id={item} size={24} />
                        <b className="slot-name">{meta.name}</b>
                        <b className="slot-short">{meta.short}</b>
                        <b className="slot-abbr">{meta.abbr}</b>
                        <small className={`slot-cat cat-${meta.category}`}>{CATEGORY_LABELS[meta.category]}{duplicates > 1 ? ` ×${duplicates}` : ""}</small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            {inspect ? (
              <div className="weapon-card-layer">
                <WeaponCard id={inspect.id} reducedMotion={reducedMotion} onClose={() => setInspect(null)} />
              </div>
            ) : null}
            </div>
          </div>
        </section>

        <aside className="panel intel-panel">
          <div className="eyebrow">MISSION INTEL</div>
          <h2>SURVIVE<br />THE VOID</h2>
          <p>Every rival projects a rift into your arena. Shoot it with pulse cannons to generate power-ups, collect them, then send attack payloads back through it.</p>
          <ol>
            <li><span>01</span><div><b>CHARGE</b><small>Deal 150 cannon damage to the rift</small></div></li>
            <li><span>02</span><div><b>COLLECT</b><small>Fly over the generated power-up</small></div></li>
            <li><span>03</span><div><b>TRANSMIT</b><small>Aim at the rift and press E (touch: PUP)</small></div></li>
          </ol>
          <div className="intel-card">
            <div><span>GUN</span><b>MK {hud.gun + 1}/4</b></div>
            <div><span>THRUST</span><b>MK {hud.thrust}/3</b></div>
            <div><span>RETROS</span><b>{hud.retros ? "ONLINE" : "OFFLINE"}</b></div>
            <div><span>RIFT</span><b>{hud.portalCharge}%</b></div>
          </div>
          <div className={`incoming-card ${hud.incoming ? "hot" : ""}`}>
            <span>THREAT MONITOR</span>
            <b>{hud.incoming ? POWER_LABELS[hud.incoming] : "SECTOR CLEAR"}</b>
            <small>{hud.incoming ? `${CATEGORY_LABELS[WEAPONS[hud.incoming].category]} · THREAT ${threatBadge(WEAPONS[hud.incoming])}` : "SCANNING RIVAL RIFT"}</small>
          </div>
        </aside>
      </section>

      {/*
        The global system layer. Rendered last and pinned to --z-system so it
        paints above every screen, modal and HUD element, and rendered exactly
        once so no screen has to remember to include it.
      */}
      <GlobalSystemControls
        menuOpen={menuOpen}
        onToggleMenu={toggleMenu}
        onOpenSettings={openSettings}
        fullscreen={fullscreen.active}
        fullscreenSupported={fullscreen.supported}
        onToggleFullscreen={() => { void fullscreen.toggle(); }}
        dimmed={gameActive && !menuOpen}
      />

      {route === "home" ? (
        <HomeScreen
          mode={mode}
          difficulty={difficulty}
          ship={shipId}
          running={launched && gameActive}
          onLaunch={launchFromMenu}
          go={go}
          back={back}
          close={resumeOrClose}
        />
      ) : null}

      {route === "pause" ? (
        <PauseScreen
          // The live run's own mode, not the stored preference: the pause
          // screen must describe the simulation actually running.
          mode={hud.mode}
          pausable={hud.mode === "pve"}
          onRestart={start}
          onQuit={quitRun}
          onEndRunAndChangeShip={() => endRun("ships")}
          onEndRunAndChangeMode={() => endRun("modes")}
          go={go}
          back={back}
          close={resumeOrClose}
        />
      ) : null}

      {route === "modes" ? (
        <ModesScreen
          mode={mode}
          difficulty={difficulty}
          onMode={chooseMode}
          onDifficulty={chooseDifficulty}
          onSurvival={chooseSurvival}
          onLaunch={launchFromMenu}
          go={go}
          back={back}
          close={resumeOrClose}
        />
      ) : null}

      {route === "ships" ? (
        <ShipsScreen
          ship={shipId}
          onSelect={(id) => { setShipId(id); netRef.current?.chooseShip(id); }}
          onLaunch={launchFromMenu}
          renderShip={renderShip}
          go={go}
          back={back}
          close={resumeOrClose}
        />
      ) : null}

      {route === "settings" ? (
        <SettingsScreen
          viewMode={viewMode}
          storedViewMode={settings.viewMode}
          onViewMode={(next) => setSetting("viewMode", next)}
          thumbsticks={settings.thumbsticks}
          onThumbsticks={(next) => setSetting("thumbsticks", next)}
          touchSize={stickSizeName}
          onTouchSize={(next) => setSetting("touchControlSize", next)}
          touchHeight={settings.touchControlHeight}
          onTouchHeight={(next) => setSetting("touchControlHeight", next)}
          sound={sound}
          onSound={(next) => setSetting("sound", next)}
          soundLevel={settings.soundLevel}
          onSoundLevel={(next) => setSetting("soundLevel", next)}
          combatHaptics={settings.combatHaptics}
          onCombatHaptics={(next) => setSetting("combatHaptics", next)}
          cannonHitSound={settings.cannonHitSound}
          onCannonHitSound={(next) => setSetting("cannonHitSound", next)}
          cameraLock={cameraLocked}
          onCameraLock={(next) => setSetting("cameraLock", next)}
          zoom={settings.zoom}
          onZoom={(next) => setSetting("zoom", next)}
          initials={settings.playerInitials}
          onInitials={(next) => setSetting("playerInitials", normalizeInitials(next))}
          go={go}
          back={back}
          close={resumeOrClose}
        />
      ) : null}

      {route === "info" ? (
        <InfoScreen
          viewMode={viewMode}
          onCodex={() => setCodexOpen(true)}
          go={go}
          back={back}
          close={resumeOrClose}
        />
      ) : null}

      {route === "leaderboard" ? <Leaderboard onClose={back} initialBoard={boardKind} /> : null}

      {route === "lobby" ? (
        <MultiplayerLobby
          status={lobbyStatus}
          net={net}
          onQuickMatch={() => netRef.current?.quickMatch()}
          onCreatePrivate={() => netRef.current?.createPrivate()}
          onJoinCode={(code) => netRef.current?.join(code)}
          onCancel={() => netRef.current?.cancel()}
          onShip={(ship) => { setShipId(ship as ShipId); netRef.current?.chooseShip(ship); }}
          onReady={(ready) => netRef.current?.setReady(ready)}
          onClose={back}
        />
      ) : null}

      {/* Above the screens: a dialog opened from one of them. */}
      {codexOpen ? <WeaponCodex onClose={() => setCodexOpen(false)} reducedMotion={reducedMotion} /> : null}
    </main>
  );
}
