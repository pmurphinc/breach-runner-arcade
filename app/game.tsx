"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { canvasBackingSize, damageVignette } from "./canvas-sizing";
import { copyText } from "./clipboard";
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
  isMajorOffscreenHazard,
  isMajorOffscreenHazardUrgent,
  rivalDamageFor,
  type PickupId,
  type PupClass,
  type PowerId,
  type ShipId,
  type ShipSpec,
  type WeaponMeta,
} from "./game-data";
import { DIRECTIONAL, drawPowerProjectile, drawWeaponGlyph } from "./weapon-art";
import { drawShipModel, preloadShipModels, SHIP_MODEL_ASSETS, shipForwardVelocity, shipMuzzleWorldPoint, shipThrusterWorldPoints } from "./ship-models";
import { unlockGameAudio } from "./game-audio";
import { playerBeamMuzzle } from "./player-beam";
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
  isOfflineMode,
} from "./difficulty";
import {
  capabilityStore,
  resolveMultiplayerName,
  resolveViewMode,
  settingsStore,
  SOUND_GAIN,
  VIEW_PROFILES,
  ZOOM_SCALE,
  type CombatHaptics,
  type AimGuide,
  type SoundLevel,
  type ZoomLevel,
} from "./view-settings";
import { aimGuideSegment } from "./aim-guide";
import { followCameraFrame } from "./camera-framing";
import { MAX_OFFSCREEN_PUP_INDICATORS, OFFSCREEN_INDICATOR_INSET, OFFSCREEN_MARKER_EXTENT, OFFSCREEN_MARKER_RADIUS, intersectBounds, isTargetOffscreen, markerBlockFor, nearestOffscreenTargets, offscreenIndicatorFor, type BlockedRegion, type CameraBounds, type OffscreenIndicator } from "./offscreen-indicators";
import GlobalSystemControls, { BuildWatermark, useFullscreen } from "./system-controls";
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
  GameTypeScreen,
  PvpModesScreen,
  PveModesScreen,
  DifficultyScreen,
  PauseScreen,
  RiftRunSetupScreen,
  SettingsScreen,
  ShipsScreen,
} from "./main-menu";
import { activeHardpointCount, unlockedHardpointCount } from "./rift-run/state";
import { riftRunStarterSpec } from "./rift-run/starter-ship";
import { RIFT_RUN_SPECIALS } from "./rift-run/specials";
import {
  RIFT_SYSTEM_LABELS,
  RIFT_RUN_SPECIAL_COOLDOWN_SCALE,
  RIFT_RUN_STARTING_PAYLOAD_SLOTS,
  cannonMarkForTier,
  retrosForTier,
  thrusterMarkForTier,
  tierNumeral,
} from "./rift-run/loadout";
import type { RiftRunState, RiftWeaponId } from "./rift-run/types";
import { RIFT_WEAPON_BY_ID, RIFT_WEAPONS } from "./rift-run/weapons";
import { createWeaponRuntime, tickWeaponRuntime, type WeaponRuntime } from "./rift-run/weapon-runtime";
import { createRunAgainRiftRun, replayForCompletedRun, type RunReplay } from "./run-replay";
import { processHardpointFire } from "./rift-run/weapon-fire";
import { admitsProjectile, applyScorched, detonateMissile, evolutionRadialHit, penetrate, projectileFromShot, SCORCHED_DAMAGE, steerMissile, targetsInFlameCone, tickScorched, type EntityId, type RiftProjectile, type ScorchedState } from "./rift-run/weapon-projectiles";
import { clearInactiveFlameFx, flameDisplayTransform, refreshFlameFx, type RiftFlameFx } from "./rift-run/flame-fx";
import { awardRiftEnergy, enemyKillEnergy, riftDamaged, riftEnergyRequiredForLevel } from "./rift-run/progression";
import { hasEnemyAttackAuthority, hostileShotVelocity, nearestPilot } from "./coop-enemy-targeting.js";
import {
  beginPupClaim,
  createPupClaimTracker,
  expirePupClaims,
  isPupClaimPending,
  isSharedArenaKind,
  resetPupClaims,
  serializePups,
  settlePupClaim,
} from "./shared-arena.js";
import { applyRiftRunCannonDamage, applyRiftRunHullWeaponDamage, RIFT_RUN_BASE_INTEGRITY } from "./rift-run/rift-damage";
import { breachRiftRun, tickRiftReform } from "./rift-run/breach";
import { createRiftDanger, clearRiftDanger, resetRiftDangerForNewRift, type RiftDangerRuntime } from "./rift-run/danger";
import { creditRiftPupBudget, ejectRiftPup, RIFT_PUP_GRACE_TICKS, RIFT_PUP_LIFE_TICKS, riftPupBudgetRemaining } from "./rift-run/pup-budget";
import { riftPhaseForIntegrity, riftPhaseNotice, riftPhaseSpawn } from "./rift-run/rift-phases";
import {
  createRiftShockwave,
  createRiftSweep,
  markRiftSweepHit,
  RIFT_PRESSURE_RADIUS,
  riftRetaliationNotice,
  riftShockwaveHits,
  riftShockwavePush,
  riftSweepHits,
  tickRiftPressure,
  tickRiftShockwave,
  tickRiftSweep,
} from "./rift-run/rift-pressure";
import {
  hazardImpactHits,
  lethalHazardActive,
  liveHazardImpacts,
  riftHazardGravity,
  riftHazardNotice,
  tickRiftHazards,
} from "./rift-run/environmental-hazards";
import { awardLifeForDepth, extraLifeNotice, respawnNotice, spendExtraLife } from "./rift-run/extra-lives";
import {
  RIFT_RUN_HOSTILE_CAP,
  createRiftRunEscalationRuntime,
  escalateRiftRunToDepth,
  riftRunBreachNotice,
  riftRunStageForDepth,
  type RiftRunEscalationRuntime,
} from "./rift-run/escalation";
import { rollUpgradeChoices } from "./rift-run/upgrade-pool";
import { riftRunHandling, riftRunHullDamage } from "./rift-run/live-modifiers";
import { applyUpgrade, chooseRiftRunSpecial } from "./rift-run/upgrade-apply";
import { claimHullGunWeapon, pendingHullGunReward } from "./rift-run/hull-gun-reward";
import { drawRiftEnergyRing } from "./rift-run/energy-ring";
import { rewardCategoryLabel } from "./rift-run/upgrades";
import { isDifficultyUnlocked, pilotProgressionStore, safeDifficulty } from "./pilot-progression";
import { PvpClient, countdownLabel, type PvpSnapshot } from "./pvp-client";
import {
  DEFAULT_PRESET,
  SCREEN_PRESETS,
  budgetFor,
  budgetsEqual,
  readViewport,
  type LayoutBudget,
  type ScreenPreset,
} from "./layout-budget";
import { cannonPlaybackRate, playCombatHaptics } from "./combat-feedback";
import { PUP_INVENTORY_CAPACITY, consumeLoadedPup, pupInventoryLayout } from "./pup-inventory";
import { TouchLayoutEditor } from "./touch-layout-editor";
import { customTouchLayoutVariables, touchElementEdge } from "./touch-profiles";
import { salvageLinkHitsPup } from "./salvage-link";
import { inventoryPayloadIconLayout, inventoryPupVisual } from "./pup-inventory-visual";
import { pupPickupSoundProfile, type PupPickupSoundProfile } from "./pup-audio";
import { RICOCHET_BOUNCES, RICOCHET_DURATION_SECONDS, reflectRicochet } from "./ricochet";
import { controllerStateForPads, EMPTY_GAMEPAD, headingDegrees, pressedOnce, type GamepadActions } from "./gamepad";
import { clearControllerFocus, controllerCancelTarget, moveControllerFocus, visibleControllerControls } from "./controller-navigation";
import {
  MOVEMENT_CODES,
  RETRO_MAX_LEVEL,
  applyIntent,
  engineHandling,
  facingFor,
  intentFromKeys,
  intentFromStick,
  keysFrom,
  resolveIntent,
} from "./movement";
import {
  PUP_GLYPH_RADIUS,
  PUP_RADIUS,
  PUP_SPIN,
  advancePup,
  drawLooseArenaPup,
  drawPupSpawnShield,
  drawPupFrame,
  pupFrameColor,
  pupCollected,
} from "./pup-world";
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
  type LeaderboardDifficulty,
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
import { suppressionBarrageRounds } from "./suppression-barrage";
import {
  VIPER_GUIDANCE_SECONDS,
  hostileTrackingVector,
  steerHomingVelocity,
} from "./ship-specials";
import {
  OVERCHARGE_FLASH_TICKS,
  beamDestroysHostile,
  blastAnnihilates,
  blastDamageAt,
  blastRadiusAt,
  blastRingRadii,
  blastSweepReached,
  countsTowardShotBudget,
  overchargeFor,
  overchargeSource,
  overchargeSourceColor,
  overchargeTicks,
  riderHandling,
  scrambledDamage,
  volleyHeadings,
  type OverchargeBeam,
  type OverchargeSpec,
} from "./overcharge";
import {
  VICTORY_SUCTION_FREQUENCY,
  VICTORY_TOTAL_SECONDS,
  pullVelocity,
  victorySuctionState,
  victoryVisualState,
} from "./victory-sequence";
import { drawRiftLabel } from "./rift-label-fx";
// The arena's colours are shared with the difficulty cards, so picking HARD
// shows the red you are about to fly in. One table, two readers.
import { ARENA_PALETTES } from "./arena-palettes";
import {
  SURVIVAL_HOSTILE_CAP,
  SURVIVAL_PALETTES,
  advanceSurvival,
  createSurvivalState,
  escalationForLevel,
  scoreRiftDamage,
  survivalBreachBonus,
  survivalBreachIntegrity,
  type SurvivalState,
} from "./survival";
import {
  BEAM_HIT_WIDTH,
  BEAM_LENGTH,
  BEAM_PICKUP_WIDTH,
  advanceBeamAngle,
  hostileBeamContact,
  pointTouchesBeam,
  randomBeamDirection,
  type BeamDirection,
} from "./beam-motion";
import { BeamAudioManager } from "./beam-audio";
import { type ArenaSize, DEFAULT_ARENA } from "./arena";
import {
  NEBULA_ALPHA,
  PARALLAX_DEPTH,
  STAR_TINTS,
  VIGNETTE,
  backdropKey,
  createBandStars,
  createMotes,
  createNebulae,
  createStars,
  moteAt,
  nebulaTints,
  parallaxPoint,
  rgba,
  starfieldBudget,
  twinkleAlpha,
  type BackdropMote,
  type BackdropStar,
  type StarfieldBudget,
} from "./starfield";
import { TRACKER_LAUNCH_JITTER, steerTracker, trackerSpeed } from "./trackers";
import {
  RAILGUN_FIRE_CUE,
  RAILGUN_IMPACT_CUE,
  RAILGUN_IMPACT_PARTICLES,
  RAILGUN_MUZZLE_PARTICLES,
  RAILGUN_PALETTE,
  RAIL_TRACE_TICKS,
  railTrace,
  railgunSlugGeometry,
  type ProceduralCue,
} from "./rift-run/railgun-fx";
import {
  PORTAL_THRESHOLD,
  type Portal,
  advancePortal,
  chargePortal,
  createPortal,
  isPortalWarpedIn,
  portalBreadcrumbs,
  stepPortalWarpIn,
} from "./portals";
import { rollClassicDrop } from "./classic-drops";
import { shipForMode } from "./classic-ships";

/**
 * Presentation-space dimensions for the letterboxed canvas.
 *
 * Distinct from the arena: VIEW_* is what the renderer draws into and what the
 * camera scales the world onto, so a square arena needs no change here. Arena
 * size itself lives in ./arena.
 */
const VIEW_WIDTH = 1048;
const VIEW_HEIGHT = 655;
/** Cannon damage the rift absorbs per power-up, before any escalation. */

/**
 * Drawn-body radii the off-screen markers reason about, in world units. They
 * match the rift glow and the ally ring so a target still half outside the
 * frame keeps its marker up.
 */
const PORTAL_VISUAL_RADIUS = 55;
const ALLY_VISUAL_RADIUS = 34;

/**
 * The hazard orange every off-screen enemy marker is drawn in.
 *
 * The same colour the arena's contact-hazard ring already uses, so "this is a
 * threat" reads the same on the edge as it does in the world — and never as
 * the Rift's magenta, the ally's green, or any of the PUP class colours.
 */
const OFFSCREEN_ENEMY_ACCENT = "#ff9a4d";

/**
 * The alarm red a major hazard's off-screen marker is drawn in.
 *
 * Deliberately a flat, saturated red rather than the hostile badge's hazard
 * orange: at marker size the pilot has to tell "something is out there" from
 * "the thing that is about to take the whole arena" at a glance, and hue is
 * the part of that pair that survives being small. It is not the Rift's
 * magenta or its enrage crimson, not the ally's green, and not a PUP class
 * colour, so a hazard cannot be mistaken for somewhere to fly toward.
 */
const OFFSCREEN_HAZARD_ACCENT = "#ff2f2f";

/**
 * The enemy badge outline in marker units: eight vertices alternating between
 * a long and a short reach, which draws as a compact four-point star.
 *
 * Precomputed once because the arena can hold far more hostiles than loose
 * PUPs, and a marker per hostile per frame is not the place to be running
 * trigonometry or building point arrays.
 */
const OFFSCREEN_ENEMY_BADGE: readonly { x: number; y: number }[] = Array.from(
  { length: 8 },
  (_, point) => {
    const reach = point % 2 === 0 ? 6.5 : 2.8;
    const spin = point * Math.PI / 4;
    return { x: Math.cos(spin) * reach, y: Math.sin(spin) * reach };
  },
);
const DEG = Math.PI / 180;
/**
 * The payload ceiling every mode but one starts at.
 *
 * Rift Run is the exception: it opens with a single slot and earns its way to
 * exactly this number, so the live ceiling is carried per-run on
 * `game.payloadCapacity` and the HUD draws `hud.payloadCapacity` slots. This
 * constant is what a run that does not earn capacity is handed at creation.
 */
const STOCK_LIMIT = PUP_INVENTORY_CAPACITY;
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
  /** Set only on Kestrel cannon rounds fired while SALVAGE LINK is active. */
  salvageLinked?: boolean;
  /** Extra barrage rounds share the center round's one logical shot budget. */
  supplemental?: boolean;
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
/**
 * A power-up's name, painted in the world where the pilot picked it up.
 *
 * Deliberately world-space and deliberately not a HUD plate: the pilot's eyes
 * are on the ship, not the notice line, so the name belongs where the pickup
 * was. It also replaces the old shared-coach-line announcement rather than
 * joining it, because one event gets one notification.
 */
type PickupLabel = { id: number; x: number; y: number; text: string; color: string; age: number; life: number };
/** Short, non-blocking portal animation announcing what just came through. */
type SpawnFx = { id: number; x: number; y: number; type: PickupId; kind: SpawnKind; age: number; life: number; count: number };

/**
 * The HUD half of a `SpawnFx`: everything the inventory-anchored notice needs,
 * and nothing that changes tick to tick, so the HUD only re-renders when a
 * plate actually appears or expires.
 */
type SpawnNotice = { id: number; type: PickupId; kind: SpawnKind; count: number; life: number };

/** Identity for React keys. Plates outlive several HUD syncs, so it must be stable. */
let nextSpawnId = 0;

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
  enemyId: number;
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
  /** True after this beam has charged the inventory penalty for its current contact. */
  playerBeamContact?: boolean;
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
  /**
   * Retro-thruster marks fitted, 0 to `RETRO_MAX_LEVEL`.
   *
   * Was a boolean, which is why the pickup did nothing for seven of the eight
   * frames: they were all seeded `true`. Seeding the mark count at the level
   * the frame already flew with keeps every hull's baseline handling exactly
   * where it was while giving the pickup somewhere to go.
   */
  retros: number;
  specialCooldown: number;
  emp: number;
  /**
   * Ticks left on a held beam special, and the spec that is firing it.
   *
   * The beam owns no position of its own: it is re-derived from the hull and
   * the ship's aim every tick, which is what makes it track.
   */
  beamTicks: number;
  beam: OverchargeBeam | null;
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
  /** Ticks remaining in Kestrel's SALVAGE LINK collection window. */
  salvageLink: number;
  /** Ticks remaining in Warden's SUPPRESSION BARRAGE window. */
  suppressionBarrage: number;
  flashMode: "tank" | "squid";
};

type Game = {
  worldWidth: number;
  worldHeight: number;
  ship: ShipSpec;
  /**
   * The frame whose Special ability is armed, or null for none at all.
   *
   * Normally the hull's own id. Rift Run separates the two: the starter frame
   * flies with no Special until the run unlocks one, and the ability it then
   * installs comes from a different frame entirely. Ability *dispatch* reads
   * this; hull geometry — muzzles, thruster points, the drawn model — always
   * reads `ship.id`, because that is what is actually on screen.
   */
  specialShip: ShipId | null;
  /**
   * Payload slots this run can hold, loaded plus stored.
   *
   * Per-run rather than a constant because Rift Run earns capacity from one
   * slot up to the shared cap while every other mode simply starts there.
   */
  payloadCapacity: number;
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
  /**
   * Hostiles destroyed this run.
   *
   * Classic's scoreboard is kills, not points: the original ranks pilots by
   * what they shot down. Tracked in every mode because it costs nothing and
   * the HUD only shows it where it means something.
   */
  kills: number;
  /** Set by the self-destruct key; spent by the loop on the next tick. */
  selfDestruct: boolean;
  /**
   * Every portal in the arena.
   *
   * Portal zero is the rift this pilot engages, and the flat portalX / portalY /
   * portalCharge fields are its projection — around sixty call sites mean
   * exactly "the rift I am shooting", and they keep working unchanged. Anything
   * that genuinely cares about there being more than one reads this list.
   *
   * Solo modes carry a single portal, so the list changes nothing for them
   * today. It is what a second pilot's portal slots into.
   */
  portals: Portal[];
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
  /**
   * Rift Run escalation bookkeeping. Null in every other mode.
   *
   * Rift Run has no clock of its own — its pressure comes from breach depth —
   * so this holds the rules the current depth is flying under and the hazard
   * cadences that depth armed.
   */
  riftEscalation: RiftRunEscalationRuntime | null;
  /**
   * Rift Run's danger systems: the rift's power-up budget, its pressure meter,
   * the environmental hazard scheduler and any retaliation in flight. Null in
   * every other mode.
   */
  riftDanger: RiftDangerRuntime | null;
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
  /** Rift-only entities stay out of standard cannon and its global shot budget. */
  riftProjectiles: RiftProjectile[];
  riftFlames: RiftFlameFx[];
  /** Inferno-only damage-over-time state, keyed by stable enemy identity. */
  riftScorched: Map<EntityId, ScorchedState>;
  /** Rift Run-only invulnerability/reform countdown; zero in standard modes. */
  riftReformTicks: number;
  pickups: Pickup[];
  enemies: Enemy[];
  nextEnemyId: number;
  /** Stable ids for loose PUPs, so a shared arena can name the one being raced for. */
  nextPupId: number;
  roundId: number;
  /** Last host world revision applied by a co-op guest. */
  lastWorldSeq?: number;
  powers: PowerShot[];
  blasts: OverchargeBlastFx[];
  particles: Particle[];
  spawns: SpawnFx[];
  pickupLabels: PickupLabel[];
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
  /** Retro marks fitted, so the readout can show the mark rather than a lamp. */
  retros: number;
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
  /** Live spawn plates, oldest first. Rendered under the PUP inventory. */
  spawnNotices: SpawnNotice[];
  /** Hostiles downed. Classic ranks by this rather than by score. */
  kills: number;
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
  /** True when no Special is installed at all — a Rift Run before its unlock. */
  specialLocked: boolean;
  /** Payload slots this run holds. Rift Run earns this; everyone else starts capped. */
  payloadCapacity: number;
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
  /** Rift Pressure, 0-100. Zero outside Rift Run. */
  riftPressure: number;
  /** Power-ups the current rift has left to shed. Zero outside Rift Run. */
  riftPupBudget: number;
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
  // Rift Run's rift pays a budget at integrity thresholds, so telling a Rift
  // Run pilot how much more damage buys a power-up would be a lie: inside a
  // band the answer is "no amount".
  if (game.riftDanger) {
    const left = riftPupBudgetRemaining(game.riftDanger.budget);
    return left > 0
      ? `BREAK THE RIFT DOWN // ${left} PAYLOAD${left === 1 ? "" : "S"} LEFT IN IT`
      : "RIFT SPENT // BREACH IT FOR A FRESH ONE";
  }
  const remaining = Math.max(0, game.portalThreshold - game.portalCharge);
  return `SHOOT THE RIFT // ${Math.ceil(remaining)} MORE DAMAGE GENERATES A POWER-UP`;
}

function createGame(
  ship: ShipSpec,
  mode: GameMode = "pve",
  difficulty: DifficultyId = "difficult",
  arena: ArenaSize = DEFAULT_ARENA,
  // Rift Run rides on the PvE mode, so the mode alone cannot say whether this
  // run starts stripped. Stated explicitly instead of inferred.
  riftRun = false
): Game {
  const rules = rulesFor(mode, difficulty);
  // Classic flies the reference handling. Resolved here rather than at every
  // read site, so the rest of the loop simply uses game.ship as it always has.
  ship = shipForMode(ship, mode);
  const spawn = pilotSpawn(rules, arena);
  const wormhole = wormholePosition(rules, arena, 0);
  return {
    worldWidth: arena.width,
    worldHeight: arena.height,
    ship,
    // A Rift Run starts with no Special installed; every other mode arms the
    // hull's own.
    specialShip: riftRun ? null : ship.id,
    payloadCapacity: riftRun ? RIFT_RUN_STARTING_PAYLOAD_SLOTS : STOCK_LIMIT,
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
      // Classic earns its retros. The reference ships them as a power-up, so
      // starting with reverse thrust both skips a reward and makes the upgrade
      // strip claim RETROS from the first tick. Every other mode is unchanged.
      retros: mode === "classic" ? 0 : ship.thrust > 0 ? 1 : 0,
      specialCooldown: 0,
      emp: 0,
      beamTicks: 0,
      beam: null,
      ricochetTicks: 0,
      riderTicks: 0,
      riderTotal: 0,
      riderAcceleration: 1,
      riderMaxSpeed: 1,
      overchargeFlash: 0,
      viperGuidance: 0,
      flagshipField: 0,
      salvageLink: 0,
      suppressionBarrage: 0,
      flashMode: "tank",
    },
    kills: 0,
    selfDestruct: false,
    portalAngle: 0,
    portalCharge: 0,
    portalX: wormhole.x,
    portalY: wormhole.y,
    portalPulse: 0,
    elapsedTicks: 0,
    portalThreshold: PORTAL_THRESHOLD,
    portals: (() => {
      // Already arrived: the existing modes have never shown a warp-in, and
      // starting one here would open every run with the rift sliding outward.
      const arrived = (portal: Portal, x: number, y: number) => ({ ...portal, warpRadius: portal.orbitRadius, x, y });
      // One rift per arena, in every mode.
      //
      // PvP briefly carried a second — the pilot's own — on the way to a shared
      // arena. Both are gone: a duel here is fought through one rift by sending
      // payloads into it, not by two pilots circling two rifts in one room. The
      // list stays plural because Classic's several-portal arena needs it.
      return [arrived(createPortal(0, "rift", arena, 0), wormhole.x, wormhole.y)];
    })(),
    survival: isSurvival(rules) ? createSurvivalState() : null,
    // Rift Run arms this in `start`, where the run itself is created.
    riftEscalation: null,
    riftDanger: riftRun ? createRiftDanger() : null,
    victorySequence: 0,
    victoryExplosionFired: false,
    enrageActive: false,
    enrageTimer: 0,
    enrageRecovery: createEnrageRecovery(),
    enrageMineTimer: 0,
    bullets: [],
    riftProjectiles: [],
    riftFlames: [],
    riftScorched: new Map(),
    riftReformTicks: 0,
    pickups: [],
    enemies: [],
    nextEnemyId: 0,
    nextPupId: 0,
    roundId: 0,
    powers: [],
    blasts: [],
    particles: [],
    spawns: [],
    pickupLabels: [],
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
    kills: game.kills,
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
    spawnNotices: game.spawns.slice(-MAX_NAMEPLATES).map(({ id, type, kind, count, life }) => ({ id, type, kind, count, life })),
    mode: game.mode,
    difficulty: game.rules.id,
    difficultyName: game.rules.shortName,
    wormholeState: game.rules.wormhole.kind === "locked" ? "LOCKED" : "MOVING",
    collisionShield: game.collisionShield
      ? Math.round((game.collisionShield.charge / game.collisionShield.capacity) * 100)
      : null,
    collisionRecharge: game.collisionShield ? secondsForTicks(game.collisionShield.rechargeIn) : 0,
    contactHazard: game.rules.contactHazard.enabled,
    specialName: game.specialShip ? SHIP_SPECIALS[game.specialShip].name : "NO SPECIAL",
    specialLocked: game.specialShip === null,
    payloadCapacity: game.payloadCapacity,
    specialCooldown: wholeSecondsForTicks(game.player.specialCooldown),
    contactActive: game.contactWarning > 0,
    enrageActive: game.enrageActive,
    riftLevel: game.survival?.level ?? 0,
    riftStage: game.survival?.escalation.stage.name ?? "",
    breaches: game.survival?.breaches ?? 0,
    riftPressure: Math.round(game.riftDanger?.pressure.pressure ?? 0),
    riftPupBudget: game.riftDanger ? riftPupBudgetRemaining(game.riftDanger.budget) : 0,
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
    // Plate contents never change once pushed, so identity settles the list.
    && a.spawnNotices.length === b.spawnNotices.length
    && a.spawnNotices.every((plate, index) => plate.id === b.spawnNotices[index].id)
    && a.mode === b.mode
    && a.difficulty === b.difficulty
    && a.wormholeState === b.wormholeState
    && a.collisionShield === b.collisionShield
    && a.collisionRecharge === b.collisionRecharge
    && a.contactHazard === b.contactHazard
    && a.specialName === b.specialName
    && a.specialLocked === b.specialLocked
    && a.payloadCapacity === b.payloadCapacity
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
    maxParticles: Math.round(150 + q * 450),
    shadows: q >= 0.5,
    maxBackingPx: Math.round(1000 + q * 820),
  };
}

/**
 * How much heavier an explosion is than a hit spark.
 *
 * A ricochet tick and a gunship going up both came through here at the same
 * weight, so a kill read as a slightly busier version of a graze. These scale
 * the count, the outward speed and the size of each fleck for bursts the caller
 * asked to be large; small bursts are left alone so the screen does not fill
 * with confetti every time a round connects.
 */
const EXPLOSION_COUNT_SCALE = 1.7;
const EXPLOSION_SPEED_SCALE = 1.22;
const EXPLOSION_SIZE_SCALE = 1.55;
/** Bursts at or above this asked-for count are explosions, not sparks. */
const EXPLOSION_MIN_COUNT = 16;

function spawnParticles(game: Game, x: number, y: number, color: string, count: number, speed: number, budget: number, sizeScale = 1) {
  const room = budget - game.particles.length;
  if (room <= 0) return;
  const total = Math.min(count, room);
  for (let i = 0; i < total; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const force = Math.random() * speed;
    const life = range(18, 55);
    game.particles.push({ x, y, vx: Math.cos(angle) * force, vy: Math.sin(angle) * force, color, size: range(1 * sizeScale, 3.4 * sizeScale), life, maxLife: life });
  }
}

/**
 * What a portal sheds, for the mode this run is in.
 *
 * Classic draws from the reference table — mostly ordnance, self-buffs that stop
 * appearing once maxed, and substitutions that arrive as the match ages. Every
 * other mode keeps Breach Runner's own even-handed roll.
 */
function dropForGame(game: Game): PickupId {
  if (game.mode !== "classic") return randomPower();
  return rollClassicDrop({
    gunMaxed: game.player.gun >= 3,
    thrustMaxed: game.player.thrust >= 3,
    retrosMaxed: game.player.retros >= RETRO_MAX_LEVEL,
    // The tick is the clock: TICK_MS per cycle, so the drop gates measure the
    // simulation's own elapsed time rather than wall time a pause would skew.
    elapsedMs: game.cycles * TICK_MS,
  });
}

function randomPower(): PickupId {
  if (Math.random() < 1 / 3) {
    const defensive: PickupId[] = ["gun", "thrust", "retros", "shield", "clear", "health", "ricochet"];
    return defensive[Math.floor(Math.random() * defensive.length)];
  }
  return SENDABLE_POWERUPS[Math.floor(Math.random() * SENDABLE_POWERUPS.length)];
}

/**
 * How long a loose power-up is untouchable after it spawns, in ticks.
 *
 * Without a grace window the burst that drops a PUP would frequently shoot it
 * back out of existence in the same breath, which reads as the drop never
 * happening. Ends well before the pilot can realistically fly over it.
 */
const PUP_SHOOT_GRACE_TICKS = RIFT_PUP_GRACE_TICKS;

/** Ticks a loose power-up survives in the arena before it expires. */
const PUP_LIFE_TICKS = RIFT_PUP_LIFE_TICKS;

/** A loose power-up can be shot once its spawn grace has elapsed. */
function pupIsShootable(pickup: Pickup) {
  return pickup.life > 0 && !pupIsProtected(pickup);
}

/**
 * Whether a power-up is still inside its spawn shield.
 *
 * Every way a loose power-up can be destroyed has to ask this, not just cannon
 * fire. It first guarded only the bullet path, which left a screen clear, a
 * scavenger and the rift's beam all able to take a drop the instant it
 * appeared -- so the protection read as not existing at all. A shield that
 * three out of four hazards ignore is not a shield.
 */
function pupIsProtected(pickup: Pickup) {
  return pickup.life > PUP_LIFE_TICKS - PUP_SHOOT_GRACE_TICKS;
}

/** 0 at the moment of spawn, 1 as the shield lapses. Drives the visual. */
function pupShieldProgress(pickup: Pickup) {
  const elapsed = PUP_LIFE_TICKS - pickup.life;
  return Math.max(0, Math.min(1, elapsed / PUP_SHOOT_GRACE_TICKS));
}

/** World units a bloom grows per point of health. */
const BLOOM_RADIUS_PER_HP = 0.35;

/**
 * A bloom's drawn size, derived from its health.
 *
 * Size and health used to advance independently, so cannon fire drained a
 * bloom's hit points while the body on screen kept inflating — the pilot got no
 * feedback that shooting it was doing anything. Tying the two together makes
 * damage visible. The floor is the size it spawned at: fire holds a bloom back
 * and eventually kills it, but never shrinks it below what came out of the rift.
 */
/**
 * A bloom's drawn and collidable size.
 *
 * Floored at the spawn radius, so a bloom is never smaller than the one that
 * arrived. Fed from the bloom's *peak* health rather than its current health
 * (see the inflator branch): a bloom that has grown keeps the size it grew to
 * even as it is shot down. Deflating a large bloom back to a small dot under
 * fire made the thing harder to hit the more damage it had taken, which reads
 * backwards -- the health bar already carries the damage.
 */
function bloomRadiusForHp(hp: number) {
  const base = ENEMY_STATS.inflator;
  return base.radius + Math.max(0, hp - base.hp) * BLOOM_RADIUS_PER_HP;
}

/**
 * A launch velocity for a dropped power-up.
 *
 * An angle and a speed, not an independent vx and vy. Rolling the two axes
 * separately clusters the result around the diagonals and can land on a pair
 * of near-zero components, which drops a PUP that barely moves -- every drop
 * ends up in the same place, right where it was made. This gives an even
 * spread of headings and guarantees a real speed on every one.
 */
function pupLaunchVelocity(minSpeed: number, maxSpeed: number) {
  const angle = Math.random() * Math.PI * 2;
  const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

function makeEnemy(kind: PowerId, x: number, y: number, index: number, count: number): Enemy {
  const stats = ENEMY_STATS[kind];
  const jitter = kind === "heatseeker" ? TRACKER_LAUNCH_JITTER : 0.18;
  const angle = (index / Math.max(1, count)) * Math.PI * 2 + range(-jitter, jitter);
  // A tracker's speed is its own, derived from its launch angle, so a swarm
  // strings out in time instead of arriving as one wall.
  let speed = kind === "mines" ? 6 : kind === "heatseeker" ? trackerSpeed(angle) : range(0.8, 2.8);
  if (kind === "turret" || kind === "beam" || kind === "emp" || kind === "nuke") speed = 0;
  return {
    enemyId: 0,
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
const WeaponIcon = memo(function WeaponIcon({ id, size = 26, dim = false, inventoryFrame = false }: { id: PickupId; size?: number; dim?: boolean; inventoryFrame?: boolean }) {
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
    if (inventoryFrame) {
      // No triangle here. The slot's own coloured border and tinted fill carry
      // Payload class identity at full slot size, so framing the glyph as well
      // only shrank it — see INVENTORY_GLYPH_SCALE.
      const visual = inventoryPupVisual(id);
      const layout = inventoryPayloadIconLayout({ width: size, height: size });
      ctx.translate(layout.centerX, layout.centerY);
      drawWeaponGlyph(ctx, visual.glyphId, layout.glyphRadius, 0, { detail: 1, alpha: dim ? 0.5 : 1 });
    } else {
      ctx.translate(size / 2, size / 2);
      drawWeaponGlyph(ctx, id, size * 0.37, 0, { detail: 1, alpha: dim ? 0.5 : 1 });
    }
  }, [id, size, dim, inventoryFrame]);
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

function WeaponCodex({ onClose, onOpenSettings, reducedMotion }: { onClose: () => void; onOpenSettings: () => void; reducedMotion: boolean }) {
  const [focused, setFocused] = useState<PickupId>(CODEX_ORDER[0]);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <MenuScreen route="codex" title="Weapon Codex" onBack={onClose} onOpenSettings={onOpenSettings} wide>
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
  /** The concrete run type that ended, retained independently of PvE mode. */
  replay: RunReplay;
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
  const [difficulty, setDifficulty] = useState<LeaderboardDifficulty | null>(null);

  const filters: readonly { value: LeaderboardDifficulty | null; label: string }[] = [
    { value: null, label: "ALL" },
    { value: "easy", label: "STABLE" },
    { value: "difficult", label: "VOLATILE" },
    { value: "hard", label: "CRITICAL" },
  ];

  const difficultyLabel = (value: LeaderboardDifficulty) =>
    value === "easy" ? "STABLE" : value === "difficult" ? "VOLATILE" : "CRITICAL";

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const localBest = loadLocalBest();
    queueMicrotask(() => {
      if (cancelled) return;
      setBest(localBest);
      if (boardLimit === 10) setEntries(null);
      setFailed(false);
      setLoading(true);
    });
    void fetchLeaderboard(boardLimit, difficulty ?? undefined, controller.signal).then((rows) => {
      if (cancelled) return;
      setLoading(false);
      if (rows) setEntries(rows);
      else setFailed(true);
    });
    return () => { cancelled = true; controller.abort(); };
  }, [boardLimit, difficulty, reloadKey]);

  const selectDifficulty = (value: LeaderboardDifficulty | null) => {
    setEntries(null);
    setFailed(false);
    setDifficulty(value);
    setBoardLimit(10);
  };

  return (
    <>
      <div className="board-filter board-difficulty-filter" role="radiogroup" aria-label="Filter Global Board by difficulty">
        {filters.map((filter) => (
          <button
            key={filter.label}
            type="button"
            role="radio"
            aria-checked={difficulty === filter.value}
            className={difficulty === filter.value ? "active" : ""}
            onClick={() => selectDifficulty(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>
      {failed ? <p className="board-note">The global board could not be reached. Your device score is safe.</p> : null}
      {loading && entries === null ? <p className="board-note">Loading the board…</p> : null}
      {!loading && entries !== null && entries.length === 0 ? <p className="board-note">No scores yet. Win a non-Practice PvE run to claim the first spot.</p> : null}
      {entries !== null && entries.length > 0 ? (
        <ol className="board-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <span className="board-rank">{entry.rank}</span>
              <span className="board-name">{entry.initials}</span>
              <span className="board-runs">
                {entry.ship}{difficulty === null ? ` · ${difficultyLabel(entry.difficulty)}` : ""}
              </span>
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
  ["pve", "coop", "pvp", "classic"],
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
  "easy"
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
  riftRun,
}: {
  hud: Hud;
  pending: DifficultyRules;
  pendingMode: GameMode;
  live: boolean;
  riftRun: RiftRunState | null;
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

  const activeMode = live ? hud.mode : pendingMode;
  const gameMode = activeMode === "pvp" ? "PVP" : activeMode === "classic" ? "CLASSIC" : "PVE";
  const difficulty = gameMode === "PVP" ? "STABLE" : activeRules.shortName.replace(/ MODE$/i, "");
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
  // Classic keeps its own rail. Difficulty tiers, the collision shield and the
  // contact hazard are all systems the mode does not have, so reporting them
  // would describe things the pilot cannot use. Kills and the permanent
  // upgrades banked so far are what the original's own readout showed.
  const upgrades = live
    ? [
        hud.gun > 0 ? `GUN ×${hud.gun}` : null,
        hud.thrust > 0 ? `THRUST ×${hud.thrust}` : null,
        hud.retros > 0 ? "RETROS" : null,
      ].filter(Boolean).join(" · ")
    : "";
  const status = activeMode === "classic"
    ? `CLASSIC | KILLS ${live ? hud.kills : 0} | RIFT ${wormhole}${upgrades ? ` | ${upgrades}` : ""}`
    : `${gameMode} · ${difficulty}${riftLevel > 0 ? ` | RIFT LEVEL ${riftLevel} · ${riftStage}` : ""} | RIFT ${wormhole} | ${shieldText} | CONTACT ${contact}${live && hud.enrageActive ? " | ENRAGED" : ""}`;
  const context = live && hud.enrageActive
    ? "ENRAGED"
    : recharge > 0
      ? `SHIELD RECHARGING ${recharge.toFixed(1)}s`
      : hazardArmed
        ? `CONTACT ${contact}`
        : "CONTACT SAFE";

  if (riftRun?.status === "active") {
    const active = activeHardpointCount(riftRun);
    // Breach depth is Rift Run's difficulty clock, so the stage it has reached
    // is derived from the run itself rather than plumbed through the HUD. It
    // takes the slot the always-1 sector readout used to hold, which keeps the
    // rail exactly as wide and as tall as the layout budget already measured.
    const depthStage = riftRunStageForDepth(riftRun.riftBreaches).name;
    // The build is the mode, so the rail reports what the run has actually
    // earned: sockets opened rather than the ship's theoretical capacity, and
    // the Special by name once one exists. `unlocked` and `active` differ
    // whenever a socket is open with no gun bolted into it yet.
    const unlocked = unlockedHardpointCount(riftRun);
    const special = riftRun.loadout.special;
    const specialLabel = special
      ? `${SHIP_SPECIALS[special.shipId].name} ${tierNumeral(special.tier)}`
      : "LOCKED";
    return (
      <div className="difficulty-badge rift-run-badge" role="status" aria-live="polite"
        aria-label={`Rift Run. Depth ${riftRun.riftBreaches}, ${depthStage}. ${riftRun.lives} extra ${riftRun.lives === 1 ? "life" : "lives"}. ${active} of ${unlocked} unlocked hardpoints armed. Special ${specialLabel}. Rift pressure ${hud.riftPressure} percent. ${hud.riftPupBudget} payloads left in this rift.`}>
        <span className="rule-score">SCORE {hud.score.toLocaleString().padStart(6, "0")}</span>
        <span className="rule-mode">RIFT RUN</span>
        <span className="rule-rift-level">LEVEL {riftRun.level}</span>
        <span className="rule-rift-level">DEPTH {riftRun.riftBreaches}</span>
        <span className="rule-rift-stage">{depthStage}</span>
        {/* Milestone-sourced only. The rail says how many are in hand because
            the whole point of the buffer is that the pilot can spend it
            deliberately rather than discover it on the death screen. */}
        <span className="rule-rift-lives">LIVES {riftRun.lives}</span>
        <span className={hud.riftPressure >= 70 ? "rule-rift-pressure hot" : "rule-rift-pressure"}>PRESSURE {hud.riftPressure}%</span>
        <span>PAYLOADS {hud.riftPupBudget}</span>
        <span>ENERGY {Math.floor(riftRun.riftEnergy)}/{riftEnergyRequiredForLevel(riftRun.level)}</span>
        <span>HARDPOINTS {active}/{unlocked}</span>
        <span>SPECIAL {specialLabel}</span>
      </div>
    );
  }

  return (
    <div className={`difficulty-badge ${contactActive ? "hazard" : ""}`} role="status" aria-live="polite" aria-label={`Score ${hud.score}. Active rules: ${status}`}>
      <span className="rule-score">SCORE {hud.score.toLocaleString().padStart(6, "0")}</span>
      <span className="rule-time">TIME {formatRunTime(hud.elapsedSeconds)}</span>
      {/* Classic gets its own visible rail, not just its own accessible label.
          The shield and contact readouts describe systems the mode does not
          have, and a difficulty tier it does not use; kills and banked
          upgrades belong there instead. */}
      {activeMode === "classic" ? (
        <>
          <span className="rule-mode">CLASSIC</span>
          <span className="rule-rift-level">KILLS {live ? hud.kills : 0}</span>
          <span className="rule-rift">RIFT {wormhole}</span>
          {upgrades ? <span className="rule-context">{upgrades}</span> : null}
        </>
      ) : (
        <>
          <span className="rule-mode">{gameMode} · {difficulty}</span>
          {riftLevel > 0 ? <span className="rule-rift-level">LEVEL {riftLevel} · {riftStage}</span> : null}
          <span className="rule-rift">RIFT {wormhole}</span>
        <span className={`rule-shield ${charge !== null && charge <= 0 ? "warn" : ""}`}>{shieldText}</span>
        <span className={`rule-contact ${hazardArmed ? "warn" : ""}`}>CONTACT {contact}</span>
          {live && hud.enrageActive ? <span className="rule-enraged warn">ENRAGED</span> : null}
          <span className="rule-context">{context}</span>
        </>
      )}
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
  const [codeCopied, setCodeCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const busy = status.kind === "searching" || status.kind === "waiting" || status.kind === "connecting";
  const offline = status.kind === "offline";
  const readyRoom = Boolean(net?.opponent);
  const result = net?.result ?? null;
  const ownShip = selectedShip((net?.you?.ship ?? "wing") as ShipId);
  const allyShip = selectedShip((net?.opponent?.ship ?? "wing") as ShipId);
  const cycleShip = (direction: number) => {
    const index = SHIPS.findIndex((ship) => ship.id === ownShip.id);
    onShip(SHIPS[(index + direction + SHIPS.length) % SHIPS.length].id);
  };
  const copyPrivateCode = async (privateCode: string) => {
    if (!await copyText(privateCode)) return;
    setCodeCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCodeCopied(false), 1800);
  };
  const finalCause = WEAPONS[result?.cause as PowerId]?.short?.toUpperCase()
    ?? defeatCauseLabel(result?.cause ?? "unknown");
  const resultEvent = net?.kind === "coop"
    ? result?.outcome === "victory"
      ? `RIVAL RIFT DESTROYED BY ${result.finisherName ? `${result.finisherName}'S ` : ""}${finalCause}`
      : `${result?.eliminatedName ?? "A PILOT"} WAS DESTROYED BY ${finalCause}`
    : `${result?.eliminatedName ?? "A PILOT"} WAS ELIMINATED BY ${finalCause} · ${result?.finisherName ?? "OPPONENT"} WON`;

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
          <h2 id="lobby-heading">{net?.kind === "coop" && readyRoom ? `PVE CO-OP // ${net?.difficulty.toUpperCase()}` : "MULTIPLAYER LOBBY"}</h2>
          <p>{net?.kind === "coop" ? "Two pilots share one PvE objective and win or lose together." : "Real-time 1v1 under Easy rules."} No sign-in — guests get a callsign.</p>
          <button ref={closeRef} type="button" className="codex-close" onClick={onClose} aria-label="Close lobby">✕</button>
        </div>

        <div className="lobby-body">
          {net?.opponent ? (
            <div className="lobby-match" data-round-id={net.roundId}>
              {readyRoom && result ? (
                <section className="last-round" aria-label="Last round result">
                  <strong data-outcome={result.outcome}>LAST ROUND // {result.outcome.toUpperCase()}</strong>
                  <span>{resultEvent}</span>
                  <small>{net.kind === "coop" ? `TEAM SCORE ${result.teamScore.toLocaleString()} · ` : ""}TIME {formatRunTime(result.durationSeconds)}</small>
                </section>
              ) : null}
              {net.phase === "countdown" ? <div className="launch-countdown" aria-live="assertive"><span>LAUNCHING IN</span><strong>{countdownLabel(net.countdownMs)}</strong></div> : <p className="lobby-status" aria-live="polite">{net?.kind === "coop" ? "ALLY FOUND — CHOOSE YOUR SHIP" : "OPPONENT FOUND — CHOOSE YOUR SHIP"}</p>}
              <div className="lobby-versus">
                <div className="ready-player own">
                  <span>YOU</span>
                  <b>{net.name}</b>
                  <MenuShip id={ownShip.id} size={88} />
                  <div className="ship-cycle" aria-label="Choose your ship">
                    <button type="button" disabled={net.phase === "countdown"} onClick={() => cycleShip(-1)} aria-label="Previous ship">◀</button>
                    <strong>{ownShip.name.toUpperCase()}</strong>
                    <button type="button" disabled={net.phase === "countdown"} onClick={() => cycleShip(1)} aria-label="Next ship">▶</button>
                  </div>
                  <small>HULL {ownShip.health} · CANNON MK{ownShip.gun} · {SHIP_SPECIALS[ownShip.id].name}</small>
                  <i className={net.you?.ready ? "ok" : ""}>{net.you?.ready ? "READY ✓" : "NOT READY"}</i>
                </div>
                <em aria-hidden="true">{net?.kind === "coop" ? "+" : "VS"}</em>
                <div className="ready-player ally">
                  <span>{net?.kind === "coop" ? "ALLY" : "OPPONENT"}</span>
                  <b>{net.opponent.name}</b>
                  <MenuShip id={allyShip.id} size={88} />
                  <strong className="ally-ship">{allyShip.name.toUpperCase()}</strong>
                  <small>HULL {allyShip.health} · CANNON MK{allyShip.gun} · {SHIP_SPECIALS[allyShip.id].name}</small>
                  <i className={net.opponent.ready ? "ok" : ""}>
                    {net.opponent.connected ? (net.opponent.ready ? "READY ✓" : "NOT READY") : "DISCONNECTED"}
                  </i>
                </div>
              </div>

              {net.kind === "pvp" ? <label className="lobby-ship">
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
              </label> : null}

              <button
                type="button"
                className={`lobby-ready ${net.you?.ready ? "on" : ""}`}
                disabled={net.phase === "countdown"}
                onClick={() => onReady(!net.you?.ready)}
              >
                {net.phase === "countdown"
                  ? "LOCKED IN"
                  : net.you?.ready
                    ? "READY ✓"
                    : "READY UP"}
              </button>
              {net.phase !== "countdown" ? <p className="lobby-waiting">
                {net.you?.ready && !net.opponent.ready ? `WAITING FOR ${net.opponent.name}` : !net.you?.ready && net.opponent.ready ? `${net.opponent.name} IS READY` : "CHOOSE SHIPS AND READY UP"}
              </p> : null}
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
            <button
              type="button"
              className="lobby-code"
              aria-label={`Copy private match code ${status.code}`}
              onClick={() => void copyPrivateCode(status.code)}
            >
              <span>{status.code}</span>
              <small aria-live="polite">{codeCopied ? "CODE COPIED" : "TAP TO COPY"}</small>
            </button>
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
                onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 4))}
                placeholder="AB7K"
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                maxLength={4}
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
 * Ship silhouette for the menu, drawn with the same routine the arena uses so
 * the art in the menu is literally the art in the game.
 */
const MenuShip = memo(function MenuShip({ id, size }: { id: ShipId; size: number }) {
  return <img src={SHIP_MODEL_ASSETS[id]} width={size} height={size} alt="" draggable={false} />;
});

export default function WormholeGame() {
  useEffect(() => preloadShipModels(), []);
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
  const [riftRun, setRiftRun] = useState<RiftRunState | null>(null);
  const riftRunRef = useRef<RiftRunState | null>(null);
  const riftWeaponRuntime = useRef<WeaponRuntime>({});
  const hullGunRewardPending = Boolean(riftRun && pendingHullGunReward(riftRun));
  const specialChoicePending = Boolean(riftRun?.pendingSpecialChoice);
  // A follow-up choice always wins over the next upgrade screen. Unlocking a
  // socket or a Special hands the pilot a second decision immediately, and
  // rolling the next card set over the top of it would lose that decision.
  const upgradeRoll = useMemo(
    () => riftRun && !riftRun.pendingHullGunReward && !riftRun.pendingSpecialChoice && riftRun.pendingLevels > 0
      ? rollUpgradeChoices(riftRun)
      : null,
    [riftRun]
  );
  const pendingHardpoint = riftRun?.pendingHullGunReward
    ? riftRun.hardpoints[riftRun.pendingHullGunReward.hardpointIndex]
    : undefined;
  const commitRiftRun = useCallback((next: RiftRunState) => { riftRunRef.current=next; setRiftRun(next); }, []);
  /**
   * Push the earned loadout into the live simulation.
   *
   * Payload capacity, the cannon mark, the engine mark and reverse thrust are
   * all things the loop reads directly off the game object every tick, so an
   * upgrade is not applied until they are written across. Derived from the run
   * state rather than incremented in place: replaying the same state twice
   * lands on the same ship.
   */
  const applyRiftRunLoadout = useCallback((next: RiftRunState) => {
    const game = gameRef.current;
    game.payloadCapacity = next.loadout.payloadSlots;
    // A floor, never a cap. CANNON UPGRADE and ENGINE UPGRADE pickups raise
    // these same marks off the arena floor, and assigning the tier's mark
    // outright would silently confiscate one the pilot had already flown
    // across the map to collect.
    game.player.gun = Math.max(game.player.gun, cannonMarkForTier(next.loadout.cannonTier));
    game.player.thrust = Math.max(game.player.thrust, thrusterMarkForTier(next.loadout.thrusterTier));
    game.player.retros = Math.max(game.player.retros, retrosForTier(next.loadout.thrusterTier));
    game.specialShip = next.loadout.special?.shipId ?? null;
    // Payload capacity can only go up, but the bin has to obey it either way.
    if (game.stock.length > game.payloadCapacity) game.stock = game.stock.slice(-game.payloadCapacity);
  }, []);
  /** True once every pending choice has been spent, so the run can resume. */
  const riftRunSettled = (state: RiftRunState) =>
    !state.pendingLevels && !pendingHullGunReward(state) && !state.pendingSpecialChoice;
  const chooseUpgrade = useCallback((choice: NonNullable<typeof upgradeRoll>["choices"][number]) => {
    const current=riftRunRef.current; if (!current || !upgradeRoll) return;
    const next=applyUpgrade({...current,rollIndex:upgradeRoll.nextRollIndex},choice);
    if (next === current) return;
    commitRiftRun(next);
    const player=gameRef.current.player;
    const hullGain=next.shipModifiers.hull-current.shipModifiers.hull;
    const shieldGain=next.shipModifiers.shield-current.shipModifiers.shield;
    if (hullGain>0) { player.maxHealth+=hullGain; player.health=Math.min(player.maxHealth,player.health+hullGain); }
    if (shieldGain>0) player.shield+=shieldGain;
    applyRiftRunLoadout(next);
    if (riftRunSettled(next)) gameRef.current.paused=false;
  }, [commitRiftRun, applyRiftRunLoadout, upgradeRoll]);
  const chooseSpecial = useCallback((shipId: ShipId) => {
    const current=riftRunRef.current; if (!current) return;
    const next=chooseRiftRunSpecial(current, shipId);
    if (next === current) return;
    commitRiftRun(next);
    applyRiftRunLoadout(next);
    // A freshly installed Special is ready at once. Waiting out a cooldown for
    // an ability that has never been used would read as a bug.
    gameRef.current.player.specialCooldown = 0;
    if (riftRunSettled(next)) gameRef.current.paused=false;
  }, [commitRiftRun, applyRiftRunLoadout]);
  const chooseHardpointWeapon = useCallback((weaponId: RiftWeaponId) => {
    const current=riftRunRef.current;
    const hardpointIndex=current?.pendingHullGunReward?.hardpointIndex;
    if (!current || hardpointIndex === undefined) return;
    const next=claimHullGunWeapon(current,hardpointIndex,weaponId);
    commitRiftRun(next); riftWeaponRuntime.current=createWeaponRuntime(next);
    if (riftRunSettled(next)) gameRef.current.paused=false;
  }, [commitRiftRun]);
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
  const [touchEditorOpen, setTouchEditorOpen] = useState(false);
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
  const progression = useSyncExternalStore(
    pilotProgressionStore.subscribe,
    pilotProgressionStore.getSnapshot,
    pilotProgressionStore.getServerSnapshot,
  );
  useEffect(() => {
    const safe = safeDifficulty(difficulty, progression);
    if (safe !== difficulty) difficultyPreference.set(safe);
  }, [difficulty, progression]);
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
  const aimGuideRef = useRef<AimGuide>("off");
  const cameraRef = useRef(true);
  const zoomRef = useRef<ZoomLevel>("standard");
  const qualityRef = useRef<QualityMode>("auto");
  const reducedMotionRef = useRef(false);
  const viewProfileRef = useRef(viewProfile);
  /**
   * How far down the canvas HUD must start on each side to clear the DOM
   * panels floating over the arena — the rules badge on the left, the PvP HUD
   * on the right. Measured from the real elements rather than hard-coded, so
   * it stays right when their contents or the type scale change.
   */
  const audioPool = useRef<Map<string, HTMLAudioElement[]>>(new Map());
  const cueAudio = useRef<AudioContext | null>(null);
  const beamAudio = useRef<BeamAudioManager | null>(null);
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
  useEffect(() => { aimGuideRef.current = settings.aimGuide; }, [settings.aimGuide]);

  /**
   * Publish the mirrored-actions preference to the document.
   *
   * Owned here rather than by a menu screen because the shell is the only
   * component guaranteed to be mounted. The left-hand touch buttons default to
   * display:none and are revealed solely by this attribute, so a screen-owned
   * effect left them hidden for anyone who launched straight into a run.
   */
  useEffect(() => {
    document.documentElement.dataset.mirrorTouchActions = settings.mirrorTouchActions ? "on" : "off";
  }, [settings.mirrorTouchActions]);
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
  const immersive = viewProfile.modernHud;

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

  // Touch/Hybrid reserves a real header lane above the 1.6:1 playfield.
  // Measuring the rendered HUD keeps wrapped rules and shield text out of the
  // playable canvas on phones, tablets, and foldables.
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;

    const measure = () => {
      if (!viewProfile.modernHud) {
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
      const healthBottom = Math.max(
        bottomOf(".difficulty-badge"),
        bottomOf(".pilot-rail"),
        bottomOf(".pilot-rail small"),
        bottomOf(".rival-rail")
      );
      // The same measurement without the shield caption.
      //
      // That caption hangs below the pilot rail at the far left, so including
      // it pushes anything anchored to "below health" down by the caption's
      // full height — across the entire width, including the centre where
      // there is nothing to clear. The payload inventory is centred, so it was
      // sitting a caption's height lower than it needed to and leaving an
      // obvious dead band under the bars.
      const healthBarsBottom = Math.max(
        bottomOf(".difficulty-badge"),
        bottomOf(".pilot-rail"),
        bottomOf(".rival-rail")
      );
      // Only permanent HUD participates in playfield geometry. Spawn notices
      // are absolutely positioned overlays and must never move or resize the
      // arena when their contents change.
      const phonePortrait = layout.form === "phone" && layout.orientation === "portrait";
      const hudBottom = phonePortrait
        ? Math.max(healthBottom, bottomOf(".touch-powerup-hud"))
        : healthBottom;
      const playfieldTop = Math.ceil(hudBottom) + 2;
      const availableHeight = Math.max(1, wrapRect.height - playfieldTop);
      // The canvas takes the running arena's shape. Reading the module default
      // here would letterbox a square world into 16:10 and waste a third of it.
      const arenaWidth = Math.max(1, gameRef.current.worldWidth);
      const arenaHeight = Math.max(1, gameRef.current.worldHeight);
      // The CSS baseline aspect follows the arena too. Left hardcoded it would
      // letterbox a square world back into 16:10 behind the measured size.
      wrap.style.setProperty("--arena-aspect", `${arenaWidth} / ${arenaHeight}`);
      const canvasWidth = Math.max(1, Math.floor(Math.min(wrapRect.width, availableHeight * arenaWidth / arenaHeight)));
      const canvasHeight = Math.max(1, Math.floor(canvasWidth * arenaHeight / arenaWidth));
      // Menu and Fullscreen are position:fixed and sit above everything on the
      // z-index scale, so the full-width rules rail ran underneath them and its
      // right-hand entries were unreadable. Reserve exactly the overlap rather
      // than a guess: the labels change width ("Fullscreen" / "Exit Fullscreen"),
      // and the controls are viewport-fixed while the rail is wrap-relative.
      const systemControls = document.querySelector<HTMLElement>(".system-controls");
      const systemRect = systemControls?.getBoundingClientRect();
      const systemOverlap = systemRect && systemRect.width > 0
        ? Math.max(0, wrapRect.right - systemRect.left)
        : 0;
      wrap.style.setProperty("--system-controls-width", `${Math.ceil(systemOverlap)}px`);
      wrap.style.setProperty("--rules-bottom", `${Math.max(0, bottomOf(".difficulty-badge"))}px`);
      wrap.style.setProperty("--health-bottom", `${Math.max(0, healthBottom)}px`);
      wrap.style.setProperty("--health-bars-bottom", `${Math.max(0, healthBarsBottom)}px`);
      wrap.style.setProperty("--arena-playfield-top", `${playfieldTop}px`);
      wrap.style.setProperty("--camera-safe-top", `${layout.form === "phone" && layout.orientation === "landscape" ? Math.ceil(Math.max(healthBottom, bottomOf(".touch-powerup-hud"))) + 2 : 0}px`);
      wrap.style.setProperty("--arena-canvas-width", `${canvasWidth}px`);
      wrap.style.setProperty("--arena-canvas-height", `${canvasHeight}px`);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    for (const selector of [".difficulty-badge", ".pilot-rail", ".pilot-rail small", ".rival-rail", ".touch-powerup-hud"]) {
      const element = wrap.querySelector(selector);
      if (element) observer.observe(element);
    }
    // Fixed, so outside the wrap — but its width changes when the Fullscreen
    // label does, and the rail has to re-inset when it happens.
    const systemControlsEl = document.querySelector(".system-controls");
    if (systemControlsEl) observer.observe(systemControlsEl);
    return () => observer.disconnect();
  }, [immersive, layout.arena, layout.form, layout.orientation, layout.preset, layout.sticks, mode, net?.phase, viewProfile.modernHud]);

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

  const getBeamAudio = useCallback(() => {
    if (!beamAudio.current) {
      beamAudio.current = new BeamAudioManager(() => cueAudio.current);
    }
    return beamAudio.current;
  }, []);

  const ensureAudioContext = useCallback(() => {
    if (!soundRef.current || typeof window === "undefined") return null;
    const AudioContextClass = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return unlockGameAudio(cueAudio, () => AudioContextClass ? new AudioContextClass() : null);
  }, []);

  // Unlock while the browser still grants transient user activation. This
  // covers Q, touch SPEC, and the interaction that starts controller play;
  // RAF/gamepad polling only consumes the already-unlocked shared context.
  useEffect(() => {
    const unlock = () => { ensureAudioContext(); };
    window.addEventListener("keydown", unlock);
    window.addEventListener("pointerdown", unlock);
    return () => {
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("pointerdown", unlock);
    };
  }, [ensureAudioContext]);

  useEffect(() => {
    const pool = audioPool.current;
    return () => {
      beamAudio.current?.stopAll(true);
      beamAudio.current = null;
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
  const playCue = useCallback((cue: string | PupPickupSoundProfile | ProceduralCue, volume = 0.16) => {
    const context = ensureAudioContext();
    if (!context) return;

    const cueName = typeof cue === "string" ? cue : cue.id;
    const hash = [...cueName].reduce((value, character) => ((value * 33) ^ character.charCodeAt(0)) >>> 0, 5381);
    // Overcharges get a longer, lower, four-note signature than any pickup
    // cue, so a special is identifiable with the screen covered by a thumb.
    const special = typeof cue !== "string"
      ? cue
      : cue === "rift-level"
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
      : cue === "sentry-overdrive"
        ? { frequencies: [150, 220, 330, 510], duration: 0.48, gap: 0.035, type: "sawtooth" as OscillatorType }
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
      // A cue may ask for its notes to bend down over their own length, which
      // is what separates a discharge from a beep. The two cues named below
      // predate the flag and keep the bend they always had.
      const sweep = (special as { sweep?: number }).sweep
        ?? (cueName === "wormhole-explosion" || cueName === "overcharge:core" ? 0.45 : 0);
      if (sweep > 0) {
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(24, frequency * sweep), noteEnd);
      }
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume), noteStart + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + 0.02);
    });
  }, [ensureAudioContext]);

  /** Local-only collection cue; mute, volume, and audio unlock stay in playCue. */
  const playPupPickupSound = useCallback((pupClass: PupClass) => {
    const profile = pupPickupSoundProfile(pupClass);
    playCue(profile, cap(profile.volume * SOUND_GAIN[soundLevelRef.current], 0, 1));
  }, [playCue]);

  /**
   * Continuous victory riser: audible from the first pull frame through the
   * singularity collapse, then faded out just before the blast cue begins.
   */
  const playVictorySuction = useCallback((frequencyHz: number, remainingSeconds: number, volume = 0.085) => {
    if (victorySuctionAudio.current) return;
    const context = ensureAudioContext();
    if (!context) return;

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
  }, [ensureAudioContext]);

  useEffect(() => {
    const beams = getBeamAudio();
    beams.setVolume(SOUND_GAIN[settings.soundLevel]);
    beams.setEnabled(sound);
    if (!sound) stopVictorySuction();
  }, [getBeamAudio, settings.soundLevel, sound, stopVictorySuction]);

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
      gameRef.current.stock = detail.filter((id): id is PowerId => id in WEAPONS).slice(0, gameRef.current.payloadCapacity);
      sync();
    };
    window.addEventListener("breach-runner:test-stock", seedStock);
    return () => window.removeEventListener("breach-runner:test-stock", seedStock);
  }, [sync]);

  /* The two-browser lifecycle test ends a real server-owned PvP round without
     depending on random arena collisions. Production builds omit this hook. */
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const damage = () => netRef.current?.reportDamage("impact", 50, "hostile_projectile");
    window.addEventListener("breach-runner:test-pvp-damage", damage);
    return () => window.removeEventListener("breach-runner:test-pvp-damage", damage);
  }, []);

  /* Spawn notices are wave-timed, so tests ask for one rather than waiting out
     the rift's own schedule. This pushes the same record `pushSpawn` does. */
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const seedNotice = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; count?: number }>).detail;
      const type = detail?.type;
      if (typeof type !== "string" || !(type in WEAPONS)) return;
      nextSpawnId += 1;
      gameRef.current.spawns.push({
        id: nextSpawnId,
        x: gameRef.current.portalX,
        y: gameRef.current.portalY,
        type: type as PickupId,
        kind: "hostile",
        age: 0,
        life: 145,
        count: Math.max(1, Math.round(detail?.count ?? 1)),
      });
      sync();
    };
    window.addEventListener("breach-runner:test-spawn-notice", seedNotice);
    return () => window.removeEventListener("breach-runner:test-spawn-notice", seedNotice);
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

  // Network modes share the proven WebSocket lobby. Offline modes never open a
  // socket — solo Classic included, which otherwise dials one it cannot use.
  useEffect(() => {
    if (isOfflineMode(mode)) {
      netRef.current?.disconnect();
      netRef.current = null;
      return;
    }
    const client = new PvpClient(mode === "coop" ? "coop" : "pvp", difficulty);
    netRef.current = client;
    const unsubscribe = client.subscribe(setNet);
    client.connect(resolveMultiplayerName(settings.playerInitials));
    return () => {
      unsubscribe();
      client.disconnect();
      netRef.current = null;
    };
  }, [difficulty, mode, settings.playerInitials]);

  const chooseMode = useCallback((next: GameMode) => {
    modePreference.set(next);
    // Picking an arcade mode leaves the challenge. Survival has no co-op or
    // PvP balance behind it, and leaving the preference set would make the
    // Modes screen show a ticked challenge next to a ticked arcade mode.
    if (difficultyPreference.get() === "survival") difficultyPreference.set("easy");
  }, []);
  const chooseDifficulty = useCallback((next: DifficultyId) => {
    if (!isDifficultyUnlocked(next, pilotProgressionStore.getSnapshot())) return;
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

    pilotProgressionStore.record({ mode: hud.mode, difficulty: hud.difficulty, outcome: hud.result });

    const settlement = settleScore(hud.score, hud.elapsedSeconds, hud.result);
    const practice = hud.difficulty === "practice";
    // Survival's score already grew with every second survived, and
    // `settleScore` only charges the time penalty on a victory — which
    // Survival, having no win condition, can never produce. So the roadmap's
    // "the normal PvE time penalty does not apply" needs no exception here.
    const survivalRun = hud.difficulty === "survival";
    const replay = replayForCompletedRun(hud.mode, hud.difficulty, riftRunRef.current);
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
        replay,
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
        replay,
        best: loadLocalBest(),
        isBest: false,
        runs: 0,
        restored: false,
        awaitingInitials: true,
        deathCause: hud.deathCause,
      });
    } else if (practice) {
      setSummary({ run: identifiedRun, replay, best: loadLocalBest(), isBest: false, runs: 0, restored: false, awaitingInitials: false, deathCause: hud.deathCause });
    } else {
      const local = saveLocalRun(identifiedRun);
      setSummary({ run: identifiedRun, replay, best: local.best, isBest: local.isBest, runs: local.runs, restored: false, awaitingInitials: false, deathCause: hud.deathCause });
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

  /**
   * Begin a run.
   *
   * `riftRun` is a flag rather than a ship id now: Rift Run has no ship to
   * name. It rides on the PvE mode, so the mode alone cannot distinguish the
   * two and the caller has to say which it wants.
   */
  const start = useCallback((riftRun?: boolean, modeOverride?: GameMode, difficultyOverride?: DifficultyId) => {
    const launchMode = modeOverride ?? mode;
    const selectedDifficulty = difficultyOverride ?? difficulty;
    stopVictorySuction();
    const confirmedShip = launchMode === "coop" ? netRef.current?.state.you?.ship : null;
    const launchDifficulty = safeDifficulty(selectedDifficulty, pilotProgressionStore.getSnapshot());
    if (launchDifficulty !== selectedDifficulty) difficultyPreference.set(launchDifficulty);
    // Rift Run issues the same stripped starter frame every time; every other
    // mode flies the hull its lobby confirmed.
    const launchSpec = riftRun ? riftRunStarterSpec() : selectedShip((confirmedShip ?? shipId) as ShipId);
    const game = createGame(launchSpec, launchMode, launchDifficulty, DEFAULT_ARENA, Boolean(riftRun));
    if (riftRun) {
      const seed = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-rift-run`;
      const run = createRunAgainRiftRun({ kind: "rift-run" }, seed);
      riftRunRef.current = run;
      riftWeaponRuntime.current = createWeaponRuntime(run);
      setRiftRun(run);
      // Depth zero is the arena Rift Run has always opened in — the rift
      // locked centre, no contact hazard, no enrage. Arming it here rather
      // than treating it as a special case means every later depth is the
      // same code path applied to a bigger number.
      game.riftEscalation = createRiftRunEscalationRuntime(game.rules);
      game.rules = game.riftEscalation.current.rules;
      game.portalThreshold = game.riftEscalation.current.escalation.powerUpCharge;
    } else {
      riftRunRef.current = null;
      riftWeaponRuntime.current = {};
      setRiftRun(null);
    }
    game.roundId = launchMode === "coop" ? (netRef.current?.state.roundId ?? 0) : 0;
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

  const launchRiftRun = useCallback(() => {
    modePreference.set("pve");
    difficultyPreference.set("easy");
    // Stated explicitly rather than left to the preferences set just above.
    // `start` closes over the mode and difficulty from the render it was
    // created in, and a store update does not reach that closure until React
    // re-renders — so a Rift Run launched under whatever was remembered from
    // the previous run instead of its own rules.
    //
    // Harmless while every remembered mode still routed payload damage the
    // same way. Once Classic could be remembered it was not: a Rift Run
    // started after a Classic run inherited CLASSIC_RULES, which orbits the
    // rift at depth zero and sends launched payloads down the network
    // transmit branch instead of the PvE damage branch, so rift integrity
    // could never fall and the run could not be won.
    start(true, "pve", "easy");
  }, [start]);

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
    if (isOfflineMode(game.mode) || serverHull === null) return;
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
    if (isOfflineMode(game.mode)) return;
    // Multiplayer results leave the arena immediately. The persistent room
    // is the sole post-round surface and therefore owns touch/controller input.
    game.running = false;
    game.paused = false;
    game.result = null;
    setSummary(null);
    setMenu(resetRoute("lobby"));
    sync();
  }, [netResult, sync]);

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
    // An unspent choice holds the pause. Resuming with a hull gun or a Special
    // still to pick would leave the reward stranded behind live gameplay.
    if (!paused && riftRunRef.current && (pendingHullGunReward(riftRunRef.current) || riftRunRef.current.pendingSpecialChoice)) return;
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
    if (isOfflineMode(mode)) { start(); return; }
    setMenu(resetRoute("lobby"));
  }, [mode, start]);

  /**
   * Play opens the mode question, not the ship question.
   *
   * Menu -> Mode -> Lobby -> Ship/Ready. Ship choice belongs to the round's
   * lobby now, so the only thing Play has to establish is what is being
   * played; Rift Run's lobby then asks nothing about ships at all.
   */
  const beginPlayFlow = useCallback(() => setMenu(resetRoute("modes")), []);
  /**
   * Confirm on the Ships screen returns where it was opened from.
   *
   * Ships is a browsing surface reached from Home (and from "end run and
   * change ship"), never the first screen of a launch. Popping keeps it that
   * way; the fallback to Home covers the case where it is the whole stack,
   * because popping the last route would drop the pilot into an inert cockpit
   * with no run in it.
   */
  const confirmShip = useCallback(
    () => setMenu((stack) => (stack.length > 1 ? popRoute(stack) : resetRoute("home"))),
    []
  );

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
    // Portrait uses a taller presentation viewport than the fixed simulation
    // viewport. Pointer coordinates must follow that same visible viewport.
    const viewHeight = VIEW_WIDTH * rect.height / Math.max(1, rect.width);
    const screenY = ((event.clientY - rect.top) / rect.height) * viewHeight;
    const game = gameRef.current;
    const player = game.player;
    const locked = cameraRef.current;
    const camScale = locked ? ZOOM_SCALE[zoomRef.current] : Math.min(VIEW_WIDTH / game.worldWidth, viewHeight / game.worldHeight);
    const camX = locked ? cap(VIEW_WIDTH / 2 - player.x * camScale, VIEW_WIDTH - game.worldWidth * camScale, 0) : (VIEW_WIDTH - game.worldWidth * camScale) / 2;
    const camY = locked ? cap(viewHeight / 2 - player.y * camScale, viewHeight - game.worldHeight * camScale, 0) : (viewHeight - game.worldHeight * camScale) / 2;
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
    const gameKeys = [...MOVEMENT_CODES, "Space", "KeyE", "KeyQ", "KeyP", "KeyK"] as string[];
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
      // Self-destruct. The reference binds this to Q, which is already the ship
      // special here and not worth breaking muscle memory over, so Classic takes
      // K. Classic only: no other mode has a way to be stuck that scuttling
      // would solve, and an instant-death key is not something to leave lying
      // around in a scored run.
      if (code === "KeyK" && !event.repeat) {
        const live = gameRef.current;
        // A flag, not a hull write: the key handler is outside the simulation,
        // and hull is the loop's to spend. This also means a scuttle lands on a
        // tick boundary like every other source of damage.
        if (live.mode === "classic" && live.running && !live.result) live.selfDestruct = true;
        return;
      }
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
    const leaveControllerMode = () => clearControllerFocus();
    window.addEventListener("pointerdown", leaveControllerMode, { passive: true });
    window.addEventListener("pointermove", leaveControllerMode, { passive: true });
    window.addEventListener("keydown", leaveControllerMode, { passive: true });
    const poll = (now: number) => {
      const action = controllerStateForPads(Array.from(navigator.getGamepads?.() ?? []));
      controllerInput.current = action;
      const controls = visibleControllerControls();
      if (controls.length > 0) {
        const activeControl = document.activeElement as HTMLElement | null;
        const tabShoulder = activeControl?.getAttribute("role") === "tab"
          ? pressedOnce(action.nextPup, previous.nextPup) ? 1 : pressedOnce(action.previousPup, previous.previousPup) ? -1 : 0
          : 0;
        if (tabShoulder) moveControllerFocus(controls, tabShoulder, 0);
        const menuX = action.menuX || action.moveX;
        const menuY = action.menuY || action.moveY;
        const previousX = previous.menuX || previous.moveX;
        const previousY = previous.menuY || previous.moveY;
        const horizontal = Math.abs(menuX) > Math.abs(menuY) ? menuX : 0;
        const vertical = horizontal ? 0 : menuY;
        const direction = vertical || horizontal;
        if (!tabShoulder && direction && (!previousX && !previousY || now - lastMenuMove > 220)) {
          lastMenuMove = now;
          moveControllerFocus(controls, horizontal, vertical);
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
    return () => {
      cancelAnimationFrame(frame);
      controllerInput.current = EMPTY_GAMEPAD;
      window.removeEventListener("pointerdown", leaveControllerMode);
      window.removeEventListener("pointermove", leaveControllerMode);
      window.removeEventListener("keydown", leaveControllerMode);
      clearControllerFocus();
    };
  }, [controllerCancel, toggleMenu]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasWrap = canvasWrapRef.current;
    if (!canvasWrap) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let raf = 0;
    let previous = performance.now();
    let accumulator = 0;
    let hudDelay = 0;
    let lastGunFeedbackTick = -999;

    const vibrateCombat = (event: "gun" | "hull", damage?: number) => {
      if (reducedMotionRef.current) return;
      playCombatHaptics(combatHapticsRef.current, event, {
        pads: Array.from(navigator.getGamepads?.() ?? []),
        vibratePhone: "vibrate" in navigator ? navigator.vibrate.bind(navigator) : undefined,
        damage,
      });
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
    let renderViewHeight = VIEW_HEIGHT;
    let cssScale = 1;
    let needsResize = true;

    const touchDevice = navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;
    const densePanel = (window.devicePixelRatio || 1) > 2;
    let autoQ = touchDevice || densePanel ? 0.55 : 1;
    let appliedQ = -1;
    let profile = profileFor(autoQ);
    let frameAverage = 16.7;
    let samples = 0;
    let cameraSafeTop = 0;

    const applyProfile = () => {
      const mode = qualityRef.current;
      const q = mode === "high" ? 1 : mode === "performance" ? 0.25 : autoQ;
      if (q === appliedQ) return;
      appliedQ = q;
      profile = profileFor(q);
      needsResize = true;
    };
    applyProfile();

    /**
     * HUD panels painted over the arena, in presentation units.
     *
     * These are DOM overlays with a z-index above the canvas, so anything the
     * renderer draws beneath one is simply swallowed. Measuring them turns
     * "invisible" into "somewhere a marker must not be left", which is the only
     * thing the marker code needs to know about the HUD.
     *
     * The rectangles are read from layout on a slow throttle and cached in
     * VIEW_WIDTH units, which depend on the page layout rather than on the
     * camera. That keeps the per-frame cost to a little arithmetic instead of a
     * forced layout however many markers are on screen, and it is why phone,
     * tablet and desktop all work from each panel's real rendered size rather
     * than an assumed desktop rectangle.
     *
     * Each rectangle is clipped to the canvas, so a panel that sits beside or
     * above the arena on a given layout contributes nothing at all — which is
     * the honest answer to "does this overlap the playfield here". The rules
     * badge does on desktop and landscape phones but not on tablets or portrait
     * phones, where it sits above the arena; the fixed-position system controls
     * reach into the arena's top-right corner on landscape phones only.
     */
    const HUD_BLOCK_SELECTORS = [".difficulty-badge", ".system-controls"];
    const HUD_BLOCK_REFRESH_MS = 250;
    let hudBlocks: BlockedRegion[] = [];
    let hudBlocksMeasuredAt = -Infinity;

    /**
     * The part of the canvas the pilot can actually see, in presentation units.
     *
     * Not the same rectangle as the canvas. In the immersive layouts the canvas
     * is deliberately sized past its wrapper — `min-width: 100%` on an element
     * that keeps the world's aspect ratio — and the wrapper's `overflow: hidden`
     * throws the overhang away, so the arena fills the screen without being
     * stretched. The overhang is always horizontal, because the canvas is given
     * the wrapper's exact height and only its width is free to grow: that is
     * precisely why an edge marker on the top or the bottom has always been
     * visible while the same marker on the left or the right was painted into
     * the clipped strip and never reached the glass.
     *
     * Measured rather than derived, so it stays honest whatever the layout does
     * next: every box between the canvas and the document that clips, plus the
     * window itself. Defaults to the whole canvas, which is the answer on every
     * layout that does not clip — desktop included — so nothing moves there.
     */
    let playfieldBox = { left: 0, top: 0, right: VIEW_WIDTH, bottom: VIEW_HEIGHT };

    const measurePlayfield = () => {
      const canvasRect = canvas.getBoundingClientRect();
      const scale = canvasRect.width > 0 ? VIEW_WIDTH / canvasRect.width : 0;
      const full = { left: 0, top: 0, right: VIEW_WIDTH, bottom: renderViewHeight };
      if (!scale) {
        playfieldBox = full;
        return;
      }
      let visible = {
        left: canvasRect.left,
        top: canvasRect.top,
        right: canvasRect.right,
        bottom: canvasRect.bottom,
      };
      // The window is the last clip, and every scroll container between here
      // and it is one too. `overflow: visible` is the only value that does not
      // clip, so anything else contributes its box.
      const viewport = {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
      };
      let clipped: CameraBounds | null = intersectBounds(visible, viewport);
      for (let node = canvas.parentElement; node && clipped; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowX === "visible" && style.overflowY === "visible") continue;
        const rect = node.getBoundingClientRect();
        clipped = intersectBounds(clipped, {
          left: style.overflowX === "visible" ? clipped.left : rect.left,
          top: style.overflowY === "visible" ? clipped.top : rect.top,
          right: style.overflowX === "visible" ? clipped.right : rect.right,
          bottom: style.overflowY === "visible" ? clipped.bottom : rect.bottom,
        });
      }
      // A playfield clipped to nothing — the arena scrolled off, a collapsed
      // ancestor mid-layout — is not an answer worth clamping markers into, so
      // fall back to the full canvas rather than stacking them in a sliver.
      if (!clipped) {
        playfieldBox = full;
        return;
      }
      visible = clipped;
      playfieldBox = {
        left: Math.max(0, (visible.left - canvasRect.left) * scale),
        top: Math.max(0, (visible.top - canvasRect.top) * scale),
        right: Math.min(VIEW_WIDTH, (visible.right - canvasRect.left) * scale),
        bottom: Math.min(renderViewHeight, (visible.bottom - canvasRect.top) * scale),
      };
      if (!(playfieldBox.right > playfieldBox.left) || !(playfieldBox.bottom > playfieldBox.top)) {
        playfieldBox = full;
      }
    };

    const measureHudBlocks = () => {
      const canvasRect = canvas.getBoundingClientRect();
      const scale = canvasRect.width > 0 ? VIEW_WIDTH / canvasRect.width : 0;
      if (!scale) {
        hudBlocks = [];
        return;
      }
      const viewHeight = canvasRect.height * scale;
      hudBlocks = HUD_BLOCK_SELECTORS.flatMap((selector) => {
        // Arena-local panels first; the system controls are position: fixed and
        // live outside the wrap, but their viewport rect maps in just the same.
        const element = canvasWrap.querySelector<HTMLElement>(selector)
          ?? document.querySelector<HTMLElement>(selector);
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return [];
        const block = {
          left: Math.max(0, (rect.left - canvasRect.left) * scale),
          top: Math.max(0, (rect.top - canvasRect.top) * scale),
          right: Math.min(VIEW_WIDTH, (rect.right - canvasRect.left) * scale),
          bottom: Math.min(viewHeight, (rect.bottom - canvasRect.top) * scale),
        };
        return block.right > block.left && block.bottom > block.top ? [block] : [];
      });
    };

    const applyResize = () => {
      needsResize = false;
      const backing = canvasBackingSize(cssWidth, cssHeight, window.devicePixelRatio || 1, profile.maxBackingPx);
      // The old path always derived height from the 1.6:1 simulation aspect.
      // In portrait CSS made the canvas tall, but its backing store and camera
      // remained 1.6:1. Keep the fixed world width while extending the logical
      // presentation viewport to exactly match the measured canvas rectangle.
      const targetWidth = backing.width;
      const targetHeight = backing.height;
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }
      worldScale = targetWidth / VIEW_WIDTH;
      renderViewHeight = backing.logicalHeight;
      cssScale = targetWidth / cssWidth;
      const safeTopCss = Number.parseFloat(getComputedStyle(canvasWrap).getPropertyValue("--camera-safe-top")) || 0;
      cameraSafeTop = safeTopCss * VIEW_WIDTH / cssWidth;
      hudBlocksMeasuredAt = -Infinity;
      // The clipped strip is a function of the layout, so it is re-measured
      // whenever the layout moves rather than only when a marker is due.
      measurePlayfield();
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
      // Reduced motion opts out of the heavier cloud as well as the count: a
      // pilot who asked for less movement did not ask for bigger debris.
      const explosion = count >= EXPLOSION_MIN_COUNT && !reducedMotionRef.current;
      const total = Math.max(2, Math.round(count * scale * (explosion ? EXPLOSION_COUNT_SCALE : 1)));
      spawnParticles(
        game,
        x,
        y,
        color,
        total,
        speed * (explosion ? EXPLOSION_SPEED_SCALE : 1),
        profile.maxParticles,
        explosion ? EXPLOSION_SIZE_SCALE : 1,
      );
    };

    const exhaustBurst = (game: Game, x: number, y: number, heading: number, color: string, count: number, speed: number) => {
      const scale = reducedMotionRef.current ? 0.35 : 0.45 + profile.detail * 0.55;
      const total = Math.min(Math.max(1, Math.round(count * scale)), profile.maxParticles - game.particles.length);
      for (let i = 0; i < total; i += 1) {
        const angle = heading + Math.PI + range(-0.35, 0.35), force = range(speed * 0.45, speed);
        const life = range(18, 55);
        game.particles.push({ x, y, vx: Math.cos(angle) * force, vy: Math.sin(angle) * force, color, size: range(1, 3.4), life, maxLife: life });
      }
    };

    /** Name a collected power-up where the pilot picked it up, then fade it. */
    const pushPickupLabel = (game: Game, type: PickupId, x: number, y: number) => {
      nextSpawnId += 1;
      game.pickupLabels.push({
        id: nextSpawnId,
        x,
        y,
        text: WEAPONS[type].short,
        color: POWER_COLORS[type],
        age: 0,
        life: ticksForSeconds(1.6),
      });
    };

    const pushSpawn = (game: Game, kind: SpawnKind, type: PickupId, x: number, y: number, count: number) => {
      nextSpawnId += 1;
      game.spawns.push({ id: nextSpawnId, x, y, type, kind, age: 0, life: kind === "hostile" ? 145 : 115, count });
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
      amount = riftRunHullDamage(amount, riftRunRef.current);
      if (game.rules.unlimitedHull) {
        player.health = player.maxHealth;
        game.notice = "SIMULATION // HULL LOCKED";
        game.noticeLife = 55;
        return;
      }
      if (amount > 0) vibrateCombat("hull", amount);
      player.health -= amount;
      if (game.mode !== "pve") {
        player.health = Math.max(0, player.health);
        return;
      }
      if (player.health > 0) return;
      player.health = 0;

      // A Rift Run spends an extra life rather than ending, if it has one.
      // Lives are milestone-sourced only — nothing in this file awards one
      // outside `breachRiftRunNow` — so this is a buffer the pilot earned by
      // going deep, never one the dice handed them.
      const run = riftRunRef.current;
      if (run && run.lives > 0) {
        const spend = spendExtraLife(run.lives, player.maxHealth);
        const next = { ...run, lives: spend.lives };
        riftRunRef.current = next;
        setRiftRun(next);
        player.health = spend.health;
        player.invuln = spend.invuln;
        player.vx = 0;
        player.vy = 0;
        // The arena is not swept, but whatever the rift had in flight is:
        // respawning into a shockwave that was already halfway across the
        // room would spend the next life before the pilot could react.
        if (game.riftDanger) {
          game.riftDanger.shockwaves = [];
          game.riftDanger.sweeps = [];
          game.riftDanger.pressure.pressure = 0;
          game.riftDanger.pressure.pending = null;
        }
        game.notice = respawnNotice(spend);
        game.noticeLife = 150;
        burst(game, player.x, player.y, "#64eaff", 50, 10);
        playCue("shield-down", 0.2);
        return;
      }

      game.running = false;
      game.result = "defeat";
      if (game.riftDanger) clearRiftDanger(game.riftDanger);
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
      if (game.result || player.invuln > 0 || player.shield > 0) return false;
      player.invuln = 24;
      burst(game, player.x, player.y, "#ff5570", 18, 7);
      play("explosion", 0.24);
      game.lastDamageCause = cause;
      game.lastDamageAmount = Math.min(player.health, amount);
      report(game, "impact", amount, cause);
      applyHullDamage(game, amount);
      return true;
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
      // Everything the opponent sends arrives through this arena's rift, which
      // is the same rift the pilot is shooting. That is the mode: you never see
      // the other pilot, you only feel what they push through.
      const originX = game.portalX;
      const originY = game.portalY;
      for (let i = 0; i < count; i += 1) game.enemies.push(makeEnemy(power, originX, originY, i, count));
      game.incoming = power;
      game.notice = `INCOMING // ${WEAPONS[power].short}`;
      game.noticeLife = 140;
      // The arrival flare belongs at the same mouth the wave came out of.
      pushSpawn(game, "hostile", power, originX, originY, count);
      burst(game, originX, originY, POWER_COLORS[power], 26, 9);
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
      game.kills += 1;
      game.score += enemy.kind === "nuke" ? 600 : enemy.kind === "gunship" ? 300 : 100;
      const run=riftRunRef.current;
      if (run) {
        const next=awardRiftEnergy(run,enemyKillEnergy(enemy.kind));
        riftRunRef.current=next; setRiftRun(next);
        if (next.pendingLevels>0) game.paused=true;
      }
      burst(game, enemy.x, enemy.y, POWER_COLORS[enemy.kind], 18, 8);
      play("explosion", 0.16);
      if (enemy.kind !== "ghost" && enemy.kind !== "beam" && enemy.kind !== "emp" && enemy.kind !== "mines" && (guaranteedDrop || Math.random() < 0.48)) {
        game.pickups.push({ x: enemy.x, y: enemy.y, ...pupLaunchVelocity(1.1, 2.6), type: dropForGame(game), life: 900, phase: range(0, 6) });
      }
    };

    const enemyIdentity = (game: Game, enemy: Enemy) => {
      if (!enemy.enemyId) enemy.enemyId = ++game.nextEnemyId;
      return enemy.enemyId;
    };

    const damageEnemy = (game: Game, enemy: Enemy, amount: number, guaranteedDrop = false) => {
      if (enemy.hp <= 0 || amount <= 0) return;
      enemy.hp -= scrambledDamage(amount, (enemy.scrambled ?? 0) > 0);
      if (enemy.hp <= 0) destroyEnemy(game, enemy, guaranteedDrop);
    };

    /**
     * Pays a Survival run for damage the rift has *already* absorbed.
     *
     * The one place rift damage becomes score. Callers hand it the amount the
     * rift actually took — never a projectile's nominal damage, never a
     * predicted hit — so a round that was refunded, absorbed by an enrage
     * shield or clamped at zero integrity cannot be paid for, and a single
     * impact cannot be paid for twice by two different call sites.
     *
     * A no-op outside Survival: the other modes settle their scores their own
     * way and nothing here changes them.
     */
    const awardRiftDamage = (game: Game, damage: number) => {
      const survival = game.survival;
      if (!survival || game.result) return;
      game.score += scoreRiftDamage(survival, damage);
    };

    /** Shared nominal-damage path for cannon and additive Rift Run hull guns. */
    const chargeRiftPup = (game: Game, nominalDamage: number) => {
      // Banked through the portal model: it owns the threshold rule, including
      // resetting to zero rather than carrying the remainder, so one enormous
      // hit sheds one power-up instead of a shower of them.
      const banked = chargePortal(
        { charge: game.portalCharge, threshold: game.portalThreshold } as Parameters<typeof chargePortal>[0],
        nominalDamage
      );
      game.portalCharge = banked.portal.charge;
      if (!banked.bloomed) return;
      const type = dropForGame(game);
      game.pickups.push({ x: game.portalX + range(-28, 28), y: game.portalY + range(-28, 28), ...pupLaunchVelocity(2.0, 4.2), type, life: 900, phase: range(0, 6) });
      game.notice = `${WEAPONS[type].short} READY TO COLLECT`;
      game.noticeLife = 100;
      pushSpawn(game, "friendly", type, game.portalX, game.portalY, 1);
      playCue(`spawn:${type}`, 0.17);
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

    /**
     * One Rift Run breach: rewards, the reform timer, and the next depth's rules.
     *
     * Rift Run is endless the way Survival is endless — the rift reforms
     * rather than dying — so a breach is where the mode's difficulty clock
     * ticks. Every rift the pilot destroys hands the run a deeper ruleset:
     * the rift starts to orbit, then burns on contact, then enrages, and by
     * the fourth breach the arena is running Survival's Rift Collapse stage.
     * It keeps climbing after that with no ceiling.
     *
     * Shared by both breach call sites — hull-mounted Rift Run weapons and
     * ordinary power-up damage — so a rift can only ever be collapsed, paid
     * for, and escalated by one path.
     */
    const breachRiftRunNow = (game: Game) => {
      const run = riftRunRef.current;
      if (!run || game.rivalHealth > 0 || game.riftReformTicks > 0 || game.result) return;

      const breached = breachRiftRun(run, {
        integrity: game.rivalHealth,
        maximumIntegrity: game.rivalMaxHealth,
        reformRemainingMs: 0,
        breached: false,
      });
      // The only place in the game that awards an extra life. Milestone
      // depths only, capped, and never reachable from a loot table.
      const award = awardLifeForDepth(breached.state.lives, breached.state.riftBreaches);
      const banked = award.awarded ? { ...breached.state, lives: award.lives } : breached.state;
      const scoreDelta = banked.score - run.score;
      riftRunRef.current = banked;
      setRiftRun(banked);

      // A new rift is a new budget, a clean pressure meter and no retaliation
      // in flight. Environmental hazards deliberately survive the breach: they
      // belong to the run, not to the rift.
      if (game.riftDanger) resetRiftDangerForNewRift(game.riftDanger);
      game.score += scoreDelta;
      game.rivalHealth = breached.runtime.integrity;
      game.rivalMaxHealth = breached.runtime.maximumIntegrity;
      game.riftReformTicks = Math.ceil(breached.runtime.reformRemainingMs / TICK_MS);

      // What the new depth means is decided in `escalateRiftRunToDepth`, as
      // data. All that happens here is applying it — the loop was already
      // reading every one of these rules every tick.
      const escalation = game.riftEscalation ?? createRiftRunEscalationRuntime(game.rules);
      game.riftEscalation = escalation;
      const next = escalateRiftRunToDepth(escalation, breached.state.riftBreaches);
      game.rules = next.rules;
      game.portalThreshold = next.escalation.powerUpCharge;

      // Enrage arrives at a depth here rather than at an integrity threshold,
      // and every deeper breach refreshes the rift's regeneration and its
      // temporary shield.
      if (game.rules.wormholeEnrage.enabled) {
        game.enrageActive = true;
        game.enrageTimer = game.rules.wormholeEnrage.waveIntervalTicks;
        game.enrageMineTimer = game.rules.wormholeEnrage.minePulseIntervalTicks;
        activateEnrageRecovery(game.enrageRecovery, game.rules, game.rivalMaxHealth);
      }

      game.notice = award.awarded || award.cappedOut ? extraLifeNotice(award) : riftRunBreachNotice(next);
      game.noticeLife = Math.max(game.riftReformTicks, next.stageChanged ? 170 : 120);
      if (breached.state.pendingLevels > 0 || pendingHullGunReward(breached.state)) game.paused = true;
      game.portalPulse = 1;
      burst(game, game.portalX, game.portalY, "#ffffff", next.stageChanged ? 60 : 40, next.stageChanged ? 12 : 10);
      if (next.stageChanged) burst(game, game.portalX, game.portalY, "#ff4fd8", 40, 11);
      playCue("wormhole-explosion", next.stageChanged ? 0.22 : 0.18);
      if (next.stageChanged) playCue("rift-level", 0.24);
    };

    /**
     * One tick of Rift Run escalation.
     *
     * Pure scheduling, and deliberately the same scheduling Survival does:
     * waves, mine storms and sweep beams on the cadences the current depth
     * armed. Nothing here scores — Rift Run pays for kills and rift damage in
     * Rift Energy, not survived seconds — and nothing here spawns a hostile
     * the game did not already have.
     */
    const tickRiftRunEscalation = (game: Game) => {
      const runtime = game.riftEscalation;
      if (!runtime || game.result || !riftRunRef.current) return;
      const { escalation, ownsWaveSchedule } = runtime.current;

      // A full arena skips the wave it was about to spawn instead of queuing
      // another one behind it. A mode with no wave count has no other brake.
      const crowded = game.enemies.length >= RIFT_RUN_HOSTILE_CAP;

      // Before the first breach the ordinary PvE scheduler still owns waves,
      // so the rift's own clock stays parked at zero.
      if (ownsWaveSchedule) {
        runtime.waveIn -= 1;
        if (runtime.waveIn <= 0) {
          runtime.waveIn = escalation.waveIntervalTicks;
          if (!crowded) {
            const pool = escalation.wavePool;
            addIncoming(game, pool[Math.floor(Math.random() * pool.length)], escalation.waveSizeBonus);
          }
        }
      }

      if (escalation.mineStormIntervalTicks > 0) {
        runtime.mineStormIn -= 1;
        if (runtime.mineStormIn <= 0) {
          runtime.mineStormIn = escalation.mineStormIntervalTicks;
          if (!crowded) spawnSurvivalHostiles(game, "mines", escalation.mineStormCount, "MINE STORM");
        }
      }

      // Beams are exempt from the crowding skip for the same reason they are
      // in Survival: there are only ever one or two, they are anchored to the
      // rift rather than chasing the pilot, and they are the stage's signature
      // threat rather than part of the swarm the cap exists to stop.
      if (escalation.beamIntervalTicks > 0) {
        runtime.beamIn -= 1;
        if (runtime.beamIn <= 0) {
          runtime.beamIn = escalation.beamIntervalTicks;
          spawnSurvivalHostiles(
            game,
            "beam",
            escalation.beamCount,
            escalation.beamCount > 1 ? "DOUBLE SWEEP" : "SWEEP BEAM",
          );
        }
      }
    };

    /**
     * Sheds whatever the rift's budget owes at its current integrity.
     *
     * Called after every hit that moved integrity, so a single round that
     * crosses several thresholds pays all of them. Nothing here is
     * proportional to damage: the budget decides, and once a band is paid,
     * more fire into the same band produces nothing at all.
     */
    const releaseRiftBudget = (game: Game) => {
      const danger = game.riftDanger;
      if (!danger || game.rivalMaxHealth <= 0) return;
      const owed = creditRiftPupBudget(danger.budget, game.rivalHealth / game.rivalMaxHealth);
      if (owed <= 0) return;
      for (let index = 0; index < owed; index += 1) {
        const type = dropForGame(game);
        // Outward, on a spread, so collecting a power-up is a trip away from
        // the rift rather than a reason to keep sitting on it.
        const ejection = ejectRiftPup(index, owed, { x: game.portalX, y: game.portalY });
        game.pickups.push({ ...ejection, type, phase: range(0, 6) });
        pushSpawn(game, "friendly", type, ejection.x, ejection.y, 1);
        playCue(`spawn:${type}`, 0.17);
      }
      const left = riftPupBudgetRemaining(danger.budget);
      game.notice = left > 0
        ? `RIFT SHEDS ${owed > 1 ? `${owed} PAYLOADS` : "A PAYLOAD"} // ${left} LEFT IN THIS RIFT`
        : "RIFT SPENT // BREACH IT FOR MORE";
      game.noticeLife = 110;
      game.portalPulse = 1;
    };


    /**
     * One tick of every Rift Run danger system.
     *
     * Order matters, and it is the order the pilot experiences: the rift's
     * health phase is resolved first because everything else reads it, then
     * the pressure meter, then whatever a landed retaliation left in the
     * arena, then the environmental hazard scheduler. Nothing here scores and
     * nothing here touches integrity.
     *
     * Every rule consulted lives in `app/rift-run/`; this function is wiring.
     */
    const tickRiftDanger = (game: Game) => {
      const danger = game.riftDanger;
      const run = riftRunRef.current;
      if (!danger || !run || game.result || game.riftReformTicks > 0) return;
      const player = game.player;

      // 1. Phase. Announced once per transition, never per tick.
      const fraction = game.rivalMaxHealth > 0 ? game.rivalHealth / game.rivalMaxHealth : 1;
      const phase = riftPhaseForIntegrity(fraction);
      if (phase.id !== danger.phaseId) {
        danger.phaseId = phase.id;
        game.notice = riftPhaseNotice(phase);
        game.noticeLife = 120;
        game.portalPulse = 1;
        burst(game, game.portalX, game.portalY, "#ff4fd8", 26, 8);
        playCue("rift-level", 0.18);
      }

      // 2. Pressure. The rift will not begin charging while a lethal hazard
      // already owns the arena — the fairness guarantee, asked from this side.
      const pressure = tickRiftPressure(danger.pressure, {
        distance: dist(player, { x: game.portalX, y: game.portalY }),
        playerX: player.x,
        playerY: player.y,
        riftX: game.portalX,
        riftY: game.portalY,
        phase,
        hazardBusy: lethalHazardActive(danger.hazards),
      });

      if (pressure.telegraphed) {
        game.notice = riftRetaliationNotice(pressure.telegraphed.kind);
        game.noticeLife = pressure.telegraphed.telegraphTicks + 40;
        playCue("wormhole-explosion", 0.12);
      }

      const landed = pressure.landed;
      if (landed) {
        if (landed.kind === "strike") {
          burst(game, landed.x, landed.y, "#ff5570", 46, 11);
          if (dist(player, landed) <= landed.radius) damagePlayer(game, landed.damage, "rift_strike");
        } else if (landed.kind === "shockwave") {
          danger.shockwaves.push(createRiftShockwave(game.portalX, game.portalY, landed.damage));
          burst(game, game.portalX, game.portalY, "#64eaff", 34, 6);
        } else {
          danger.sweeps.push(createRiftSweep(game.portalX, game.portalY, landed.angle, landed.damage));
        }
        playCue("wormhole-explosion", 0.2);

        // A wounded rift never retaliates alone. The escort is drawn from the
        // phase's own mix, so what arrives says which phase the rift is in.
        const crowded = game.enemies.length >= RIFT_RUN_HOSTILE_CAP;
        if (!crowded && phase.spawnCount > 0) {
          const kind = riftPhaseSpawn(phase);
          if (kind) spawnSurvivalHostiles(game, kind, phase.spawnCount, `RIFT ${phase.name}`);
        }
      }

      // 3. Retaliations already in the arena.
      danger.shockwaves = danger.shockwaves.filter((wave) => {
        const alive = tickRiftShockwave(wave);
        if (riftShockwaveHits(wave, player)) {
          wave.struck = true;
          const push = riftShockwavePush(wave, player);
          // The shove lands whether or not the damage does: being moved off
          // the rift is the point, and immunity should not make a pilot immune
          // to being pushed.
          player.vx += push.vx;
          player.vy += push.vy;
          damagePlayer(game, wave.damage, "rift_shockwave");
        }
        return alive;
      });

      danger.sweeps = danger.sweeps.filter((sweep) => {
        const alive = tickRiftSweep(sweep);
        if (riftSweepHits(sweep, player)) {
          markRiftSweepHit(sweep);
          damagePlayer(game, sweep.damage, "rift_sweep");
        }
        return alive;
      });

      // 4. Environmental hazards. Depth is the primary gate, pilot level the
      // secondary floor, and the scheduler refuses to open a lethal event
      // while the rift is mid-retaliation.
      const hazards = tickRiftHazards(danger.hazards, {
        depth: run.riftBreaches,
        level: run.level,
        arena: { width: game.worldWidth, height: game.worldHeight },
        playerX: player.x,
        playerY: player.y,
        riftX: game.portalX,
        riftY: game.portalY,
        retaliationActive: danger.pressure.pending !== null || danger.shockwaves.length > 0 || danger.sweeps.length > 0,
      });

      for (const event of hazards.warned) {
        game.notice = riftHazardNotice(event);
        game.noticeLife = 140;
        playCue("rift-level", 0.16);
      }
      for (const impact of hazards.erupted) {
        burst(game, impact.x, impact.y, "#ffb346", 40, 10);
        playCue("wormhole-explosion", 0.18);
      }
      for (const { event, impact } of liveHazardImpacts(danger.hazards)) {
        if (event.damage <= 0) continue;
        if (!hazardImpactHits(impact, player)) continue;
        impact.struck = true;
        damagePlayer(game, event.damage, `hazard_${event.id.replace(/-/g, "_")}`);
      }
    };

    /**
     * Resolves a Rift Run cannon hit against the rift.
     *
     * A small trickle -- a fraction of a hull-weapon hit -- so cannon fire is a
     * fallback source of progress rather than a substitute for PUPs and hull
     * weapons. Sheds the budget the same way any other integrity damage does,
     * so crossing a threshold on cannon fire alone still bloomed a power-up.
     */
    const hitRiftWithCannonInRiftRun = (game: Game, cannonDamage: number) => {
      const integrityDamage = applyRiftRunCannonDamage(game, cannonDamage);
      if (integrityDamage <= 0) return;
      const run = riftRunRef.current;
      if (run) {
        const next = riftDamaged(run, integrityDamage, "cannon");
        riftRunRef.current = next;
        setRiftRun(next);
        if (next.pendingLevels) game.paused = true;
      }
      releaseRiftBudget(game);
      breachRiftRunNow(game);
    };

    /** Resolves every Rift Run hull-weapon hit through one integrity path. */
    const hitRiftWithRiftRunWeapon = (game: Game, weaponDamage: number, weaponInstanceId: string) => {
      // Deliberately no per-damage power-up charge here. Rift Run's supply
      // line is a per-rift budget paid at integrity thresholds rather than a
      // rate paid per point of damage — see `rift-run/pup-budget.ts` for why.
      const integrityDamage = applyRiftRunHullWeaponDamage(game, weaponDamage);
      const run = riftRunRef.current;
      if (run && integrityDamage > 0) {
        const next = riftDamaged(run, integrityDamage, weaponInstanceId);
        riftRunRef.current = next;
        setRiftRun(next);
        if (next.pendingLevels) game.paused = true;
      }

      if (integrityDamage > 0) releaseRiftBudget(game);
      breachRiftRunNow(game);
      return integrityDamage;
    };

    const enemyTarget = (game: Game, enemy: Enemy) => {
      const network = netRef.current?.state;
      const localId = network?.you?.id ?? "local";
      const pilots = [{
        id: localId, x: game.player.x, y: game.player.y,
        living: game.player.health > 0, connected: true,
      }];
      // The arena host consumes the teammate transform already delivered by
      // the ordinary co-op position stream. No targeting channel or guest
      // simulation is introduced here.
      if (game.mode === "coop" && network?.you?.id === network?.hostId && network?.teammate) {
        pilots.push({
          id: network.teammate.id,
          x: network.teammate.x,
          y: network.teammate.y,
          living: (network.opponentCombat?.hull ?? 0) > 0,
          connected: network.opponent?.connected === true
            && network.teammate.roundId === network.roundId,
        });
      }
      return nearestPilot(enemy, pilots);
    };

    const spawnEnemyBullet = (game: Game, enemy: Enemy, target: NonNullable<ReturnType<typeof nearestPilot>>, speed = 5, damage = 10) => {
      const velocity = hostileShotVelocity(enemy, target, speed);
      game.bullets.push({ x: enemy.x, y: enemy.y, ...velocity, damage, life: 170, enemy: true, color: "#ff596f" });
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

      if (spec.beam) {
        // The lance keeps no position of its own — it is re-derived from the
        // hull and the ship's aim on every tick of `tickPlayerBeam`, which is
        // what makes it track rather than fire and forget.
        player.beam = spec.beam;
        player.beamTicks = timing.beam;
      } else {
        player.beam = null;
        player.beamTicks = 0;
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
        if (game.mode === "coop" && timing.scramble > 0
          && netRef.current?.state.you?.id !== netRef.current?.state.hostId) {
          netRef.current?.reportWorldAction("emp");
        }
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

      // No Special installed at all: a Rift Run before its unlock. Say so
      // rather than firing whatever the hull would have had.
      if (!game.specialShip) {
        game.notice = "NO SPECIAL INSTALLED // EARN ONE WITH AN UPGRADE";
        game.noticeLife = 55;
        return;
      }
      const spec = SHIP_SPECIALS[game.specialShip];
      if (player.specialCooldown > 0) {
        game.notice = `${spec.name} // READY IN ${wholeSecondsForTicks(player.specialCooldown)}S`;
        game.noticeLife = 55;
        return;
      }

      const ship = game.specialShip;
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
        if (game.mode === "coop" && netRef.current?.state.you?.id !== netRef.current?.state.hostId) netRef.current?.reportWorldAction("clear");
        game.enemies.forEach((enemy) => {
          if (enemy.kind !== "ghost") destroyEnemy(game, enemy);
        });
        const reactorCost = Math.random() < 0.75 ? 20 : 0;
        player.health = Math.max(1, player.health - riftRunHullDamage(reactorCost, riftRunRef.current));
        game.notice = "REACTOR BURST";
      } else if (ship === "flash") {
        player.flashMode = player.flashMode === "tank" ? "squid" : "tank";
        game.notice = `FORM SHIFT // ${player.flashMode === "tank" ? "HEAVY" : "SCOUT"} FORM`;
      } else if (ship === "flagship") {
        player.flagshipField = ticksForSeconds(3);
        game.notice = "GRAVITY PULSE // 3S";
      } else if (ship === "kestrel") {
        player.salvageLink = ticksForSeconds(spec.activeSeconds ?? 0);
        game.notice = `SALVAGE LINK // ${spec.activeSeconds ?? 0}S`;
      } else if (ship === "warden") {
        player.suppressionBarrage = ticksForSeconds(spec.activeSeconds ?? 0);
        game.notice = `SUPPRESSION BARRAGE // ${spec.activeSeconds ?? 0}S`;
      }

      // A Rift Run's Special tier buys its cooldown down. Tier I is the
      // ability exactly as the fleet flies it.
      const specialTier = riftRunRef.current?.loadout.special?.tier ?? 1;
      const cooldownScale = RIFT_RUN_SPECIAL_COOLDOWN_SCALE[Math.min(specialTier, RIFT_RUN_SPECIAL_COOLDOWN_SCALE.length - 1)] ?? 1;
      player.specialCooldown = ticksForSeconds(spec.cooldownSeconds * cooldownScale);
      game.noticeLife = 90;
      if (!overcharge) {
        burst(game, player.x, player.y, "#68f2ff", 26, 8);
        if (ship === "kestrel") playCue("salvage-link-active", 0.22);
        else if (ship === "warden") play("fire", 0.2, 0.72);
        else play("magic", 0.22);
      }
    };

    /** The two legitimate paths into the one authoritative pickup resolver. */
    type PickupCollectionSource = "physical" | "salvage-link";

    /**
     * Authoritative local pickup path shared by hull contact and SALVAGE LINK.
     * Physical contact retains the original full-bin behavior (consume the
     * loose PUP), while a failed remote shot deliberately leaves it available.
     */
    const resolvePlayerPickup = (game: Game, pickup: Pickup, source: PickupCollectionSource) => {
      const player = game.player;
      const type = pickup.type;
      if (WEAPONS[type].sendable && game.stock.length >= game.payloadCapacity) {
        if (source === "physical") pickup.life = 0;
        game.notice = "POWERUP BIN FULL";
        game.noticeLife = 75;
        playCue("inventory-full", 0.2);
        return false;
      }

      pickup.life = 0;
      game.score += 50;
      if (type === "gun") player.gun = Math.min(3, player.gun + 1);
      else if (type === "thrust") player.thrust = Math.min(3, player.thrust + 1);
      else if (type === "retros") player.retros = Math.min(RETRO_MAX_LEVEL, player.retros + 1);
      else if (type === "shield") player.shield = Math.max(450, player.shield + 200);
      else if (type === "clear") {
        const coopGuest = game.mode === "coop" && netRef.current?.state.you?.id !== netRef.current?.state.hostId;
        if (coopGuest) netRef.current?.reportWorldAction("clear");
        else game.enemies.forEach((enemy) => destroyEnemy(game, enemy));
        // The screen clear takes loose power-ups with it. They are arena bodies
        // like anything else, and sparing them would make the clear read as
        // selective. Enemies are host-owned in co-op; loose PUPs are local, so
        // this runs on both sides.
        for (const loose of game.pickups) {
          if (loose === pickup || loose.life <= 0) continue;
          // A drop still inside its spawn shield survives the clear. Without
          // this a zap fired as the rift bloomed erased the very payload it
          // had just paid out.
          if (pupIsProtected(loose)) continue;
          loose.life = 0;
          burst(game, loose.x, loose.y, POWER_COLORS[loose.type], 8, 3.5);
        }
      }
      else if (type === "health") player.health = Math.min(player.maxHealth, player.health + 30);
      else if (type === "ricochet") player.ricochetTicks = ticksForSeconds(RICOCHET_DURATION_SECONDS);
      else {
        const wasBelowCapacity = game.stock.length === game.payloadCapacity - 1;
        game.stock.push(type);
        // This is the existing sequenced delta event. The server still owns
        // capacity and ordering; no absolute inventory count crosses the wire.
        if (game.mode !== "pve") netRef.current?.reportInventory("collect", type);
        if (wasBelowCapacity) playCue("inventory-full", 0.2);
      }
      // The name lands where the pickup was rather than on the coach strip.
      // That line is shared with ship specials and rift guidance, so a pickup
      // used to overwrite whatever the pilot was actually being told.
      pushPickupLabel(game, type, pickup.x, pickup.y);
      burst(game, pickup.x, pickup.y, POWER_COLORS[type], 16, 5);
      playPupPickupSound(WEAPONS[type].pupClass);
      return true;
    };

    /**
     * Burns Phantom's lance for one tick.
     *
     * The line is rebuilt from the hull and the current facing every tick, so
     * the pilot keeps aiming it for the whole four seconds. What it touches is
     * decided by one rule with one deliberate exclusion list:
     *
     *   - hostiles die, through `damageEnemy` at their own current health, so
     *     the ordinary death path runs and explosions, drops, score and the
     *     co-op hooks all happen exactly as they would from cannon fire;
     *   - hostile fire in the air is burned out of it;
     *   - a Phase Shade is untouched, because "cannot be shot down, only a
     *     Nova Burst removes it" is the whole of that hostile's design and a
     *     new weapon is not a reason to quietly revoke it;
     *   - loose power-ups are untouched. The rift's own SWEEP BEAM eats them;
     *     the overcharged build pointedly does not, and a special that
     *     destroyed the thing the mode is about would be unusable;
     *   - the pilot, the pilot's own rounds and every friendly object are
     *     never considered — the loop only ever inspects `game.enemies` and
     *     bullets already flagged `enemy`.
     */
    const tickPlayerBeam = (game: Game) => {
      const player = game.player;
      const beam = player.beam;
      if (!beam || player.beamTicks <= 0) return;
      player.beamTicks -= 1;
      if (player.beamTicks <= 0) {
        player.beam = null;
        player.beamTicks = 0;
      }

      const angle = player.angle * DEG;
      const muzzle = playerBeamMuzzle(game.ship.id, player);
      const coopGuest = game.mode === "coop"
        && netRef.current?.state.you?.id !== netRef.current?.state.hostId;

      for (const enemy of game.enemies) {
        if (enemy.hp <= 0 || !beamDestroysHostile(enemy.kind, beam)) continue;
        if (!pointTouchesBeam(muzzle.x, muzzle.y, angle, enemy.x, enemy.y, beam.width + enemy.radius, beam.length)) continue;
        // Enough damage to guarantee the kill, delivered through the ordinary
        // damage path so the death runs: explosion, drop, score, co-op hooks.
        const lethal = Math.max(1, enemy.hp);
        if (coopGuest) netRef.current?.reportEnemyHit(enemyIdentity(game, enemy), lethal, "overcharge");
        else damageEnemy(game, enemy, lethal);
        burst(game, enemy.x, enemy.y, "#b58bff", 6, 5);
      }

      if (beam.clearsHostileFire) {
        for (const bullet of game.bullets) {
          if (!bullet.enemy || bullet.life <= 0) continue;
          if (!pointTouchesBeam(muzzle.x, muzzle.y, angle, bullet.x, bullet.y, beam.width + 4, beam.length)) continue;
          bullet.life = 0;
          burst(game, bullet.x, bullet.y, "#b58bff", 3, 3);
        }
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
        // Measured to the hull rather than the centre, so a hostile the ring
        // visibly swallows is caught by it. A Plasma Bloom that has grown to
        // a couple of hundred units across is the case that matters.
        if (!blastSweepReached(d, enemy.radius, previous, radius)) continue;

        if (blast.knockback > 0) {
          const away = Math.max(1, d);
          enemy.vx += (dx / away) * blast.knockback;
          enemy.vy += (dy / away) * blast.knockback;
        }
        // A Phase Shade is immune to fire by design; scrambling one is still
        // fair game, because scramble steers rather than damages.
        if (scrambleTicks > 0) enemy.scrambled = Math.max(enemy.scrambled ?? 0, scrambleTicks);

        const falloff = blastDamageAt(d, blast);
        if (falloff <= 0 || enemy.kind === "ghost") continue;
        // A Plasma Bloom's health has no ceiling, so falloff damage alone
        // meant a mature bloom survived a detonation that plainly engulfed
        // it. Raising the damage to its current health kills it through
        // `damageEnemy` — explosion, drop, score and co-op hooks intact —
        // rather than reaching past the death path with a flag.
        const damage = blastAnnihilates(enemy.kind, blast)
          ? Math.max(falloff, enemy.hp)
          : falloff;
        damageEnemy(game, enemy, damage, blast.guaranteedDrops);
        burst(game, enemy.x, enemy.y, fx.spec.accent, 6, 4);
      }
    };

    const updateEnemy = (game: Game, enemy: Enemy) => {
      const player = game.player;
      const target = enemyTarget(game, enemy);
      if (!target) return;
      const network = netRef.current?.state;
      const localTarget = target.id === (network?.you?.id ?? "local");
      const attackAuthority = hasEnemyAttackAuthority(game.mode, network?.you?.id, network?.hostId);
      enemy.age += 1;
      // A scrambled hostile flies its approach backwards and its weapon timer
      // stops, so the pulse buys real space rather than only looking dramatic.
      const scrambled = (enemy.scrambled ?? 0) > 0;
      if (scrambled) enemy.scrambled = (enemy.scrambled ?? 0) - 1;
      else enemy.cooldown -= 1;
      const tracking = hostileTrackingVector(enemy.x, enemy.y, target.x, target.y, scrambled);
      const dx = tracking.dx;
      const dy = tracking.dy;
      const d = Math.max(1, Math.hypot(dx, dy));

      if (enemy.kind === "heatseeker") {
        // The whole flight model lives in app/trackers.ts: its own speed, its
        // own turn rate, and — the part that actually breaks the V — its own
        // aim point offset from the pilot, so each tracker takes its own route
        // and the swarm converges only at the end.
        const steered = steerTracker(enemy, enemy.x + dx, enemy.y + dy);
        enemy.vx = steered.vx;
        enemy.vy = steered.vy;
      } else if (enemy.kind === "ufo") {
        enemy.vx += (dx / d) * 0.2;
        enemy.vy += (dy / d) * 0.2;
        const speed = Math.hypot(enemy.vx, enemy.vy);
        if (speed > 5) { enemy.vx = (enemy.vx / speed) * 5; enemy.vy = (enemy.vy / speed) * 5; }
        if (attackAuthority && !scrambled && enemy.age % 150 === 0) {
          for (let i = 0; i < 3; i += 1) game.enemies.push(makeEnemy("heatseeker", enemy.x, enemy.y, i, 3));
        }
      } else if (enemy.kind === "inflator") {
        if (enemy.age % 2 === 0) enemy.hp += 1;
        // Size follows the peak, not the current health, so shooting a bloom
        // never shrinks it below what it had already grown to. maxHp is that
        // peak, and the health bar still reads as a fraction of it.
        enemy.maxHp = Math.max(enemy.maxHp, enemy.hp);
        enemy.radius = bloomRadiusForHp(enemy.maxHp);
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
        if (attackAuthority && !scrambled && enemy.cooldown <= 0) {
          spawnEnemyBullet(game, enemy, target, enemy.kind === "artillery" ? 7 : 5, enemy.kind === "artillery" ? 16 : 10);
          enemy.cooldown = enemy.kind === "gunship" ? 28 : 45;
        }
      } else if (enemy.kind === "minelayer") {
        enemy.vx = Math.cos(enemy.age * 0.04) * 3.5;
        enemy.vy = Math.sin(enemy.age * 0.021) * 3.5;
        if (attackAuthority && !scrambled && enemy.age % 95 === 0) game.enemies.push(makeEnemy("mines", enemy.x, enemy.y, 0, 1));
      } else if (enemy.kind === "scarab") {
        const pickup = game.pickups[0];
        if (pickup) {
          const pdx = pickup.x - enemy.x;
          const pdy = pickup.y - enemy.y;
          const pd = Math.max(1, Math.hypot(pdx, pdy));
          enemy.vx += (pdx / pd) * 0.2;
          enemy.vy += (pdy / pd) * 0.2;
          // A scavenger loitering by the rift used to take every drop the
          // instant it ejected, which is what made the spawn shield look like
          // it was doing nothing.
          if (pd < 18 && !pupIsProtected(pickup)) { pickup.life = 0; game.notice = "SCAVENGER STOLE A POWER-UP"; game.noticeLife = 70; }
        }
      } else if (enemy.kind === "wallcrawler") {
        if (enemy.x <= 12) { enemy.x = 12; enemy.vx = 0; enemy.vy = 4; }
        if (enemy.y >= game.worldHeight - 12) { enemy.y = game.worldHeight - 12; enemy.vx = 4; enemy.vy = 0; }
        if (enemy.x >= game.worldWidth - 12) { enemy.x = game.worldWidth - 12; enemy.vx = 0; enemy.vy = -4; }
        if (enemy.y <= 12) { enemy.y = 12; enemy.vx = -4; enemy.vy = 0; }
        if (attackAuthority && !scrambled && enemy.age % 35 === 0) spawnEnemyBullet(game, enemy, target, 6, 10);
      } else if (enemy.kind === "ghost") {
        if (enemy.age % 130 === 0) { enemy.vx = range(-2.5, 2.5); enemy.vy = range(-2.5, 2.5); }
      } else if (enemy.kind === "emp") {
        enemy.blastRadius = (enemy.blastRadius ?? 0) + (!scrambled && enemy.age > 65 ? 8 : 0);
        enemy.x = target.x;
        enemy.y = target.y;
        if (localTarget && (enemy.blastRadius ?? 0) > 0 && (enemy.blastRadius ?? 0) >= d) {
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
        const touchesPlayer = pointTouchesBeam(
          game.portalX, game.portalY, enemy.phase, player.x, player.y, BEAM_HIT_WIDTH
        );
        if (!touchesPlayer) enemy.playerBeamContact = false;
        if (!scrambled && enemy.age > 45 && enemy.age < 365) {
          if (enemy.age % 16 === 0 && touchesPlayer) {
            const hit = damagePlayer(game, 8, "beam");
            const contact = hostileBeamContact(Boolean(enemy.playerBeamContact), touchesPlayer, hit);
            enemy.playerBeamContact = contact.active;
            if (contact.consume) {
              const removed = consumeLoadedPup(game.stock);
              if (removed && game.mode !== "pve") netRef.current?.reportInventory("remove", removed);
            }
          }
          for (const pickup of game.pickups) {
            if (
              pupIsShootable(pickup)
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
          if (localTarget && d <= (enemy.blastRadius ?? 0) && d > previousRadius && player.shield <= 0) damagePlayer(game, Math.max(5, 40 * (1 - (enemy.blastRadius ?? 0) / 1000)), "nuke_blast");
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
      if (localTarget && collisionRadius > 0 && d < collisionRadius + 12) {
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
          // The lance is player state rather than a world object, so the
          // sweep that empties the arena has to put it out explicitly.
          player.beam = null;
          player.beamTicks = 0;
          game.spawns.length = 0;
          game.pickupLabels.length = 0;
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

      if (game.selfDestruct) {
        game.selfDestruct = false;
        game.notice = "SCUTTLED";
        game.noticeLife = 120;
        damagePlayer(game, game.player.health, "self_destruct");
      }
      game.cycles += 1;
      game.elapsedTicks += 1;
      // PvpClient owns the single 33ms (~30Hz) position cadence.
      if (game.mode === "coop") {
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
      player.salvageLink = Math.max(0, player.salvageLink - 1);
      player.suppressionBarrage = Math.max(0, player.suppressionBarrage - 1);
      player.emp = Math.max(0, player.emp - 1);
      player.ricochetTicks = Math.max(0, player.ricochetTicks - 1);
      // Wormhole motion is a rule, not a constant: EASY locks it dead centre
      // while DIFFICULT and HARD MODE keep the original orbit.
      game.portalAngle = advanceWormholeAngle(game.rules, game.portalAngle);
      const arenaSize = { width: game.worldWidth, height: game.worldHeight };
      const wormhole = wormholePosition(game.rules, arenaSize, game.portalAngle);
      game.portalX = wormhole.x;
      game.portalY = wormhole.y;
      if (game.portals.length > 0) {
        // Portal zero stays driven by the ruleset rather than by the portal
        // model, because the ruleset is what knows about a locked rift — the
        // model always orbits. Syncing rather than replacing keeps every
        // existing mode byte-identical.
        const primary = game.portals[0];
        primary.angle = game.portalAngle;
        primary.charge = game.portalCharge;
        primary.threshold = game.portalThreshold;
        primary.x = wormhole.x;
        primary.y = wormhole.y;
        // Any additional portal is the model's to move: it warps in, then orbits.
        for (let i = 1; i < game.portals.length; i += 1) {
          const portal = game.portals[i];
          game.portals[i] = isPortalWarpedIn(portal)
            ? advancePortal(portal, arenaSize)
            : stepPortalWarpIn(portal, arenaSize);
        }
      }

      // Survival re-derives `game.rules` on every Rift Level, so its clock has
      // to run before anything that reads them this tick.
      tickSurvival(game);
      // Rift Run re-derives `game.rules` on every breach, so its hazard
      // schedule runs in the same slot, before anything reads them this tick.
      tickRiftRunEscalation(game);
      tickRiftDanger(game);

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
      // ENGINE UPGRADE is applied relative to whatever this frame — or, for
      // Switchback, whichever form it is currently in — was tuned with, so the
      // marks make each hull more itself rather than converging the fleet.
      const engine = engineHandling(handling, player.thrust);
      const specialHandling = riderHandling(
        engine.acceleration,
        engine.maxSpeed,
        player.riderTicks > 0
          ? { seconds: 0, accelerationScale: player.riderAcceleration, maxSpeedScale: player.riderMaxSpeed }
          : null,
      );
      const liveHandling = riftRunHandling(specialHandling, riftRunRef.current);
      const maxSpeed = liveHandling.maxSpeed;
      const acceleration = liveHandling.acceleration;

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
      const gravity = game.survival?.escalation.gravityPull
        ?? game.riftEscalation?.current.escalation.gravityPull
        ?? 0;
      if (gravity > 0) {
        const dx = game.portalX - player.x;
        const dy = game.portalY - player.y;
        const pull = Math.max(1, Math.hypot(dx, dy));
        player.vx += (dx / pull) * gravity;
        player.vy += (dy / pull) * gravity;
      }

      // An environmental gravity well pulls toward its own centre rather than
      // toward the rift, and stacks with the depth well above: it is pressure,
      // not lethality, and its job is to make every other danger harder to
      // answer rather than to kill anyone by itself.
      const well = game.riftDanger ? riftHazardGravity(game.riftDanger.hazards) : null;
      if (well) {
        const dx = well.x - player.x;
        const dy = well.y - player.y;
        const reach = Math.max(1, Math.hypot(dx, dy));
        player.vx += (dx / reach) * well.pull;
        player.vy += (dy / reach) * well.pull;
      }

      // An upgraded engine says so out of the back of the ship: the existing
      // exhaust burst fires on every other tick instead of every third, and
      // throws a couple more sparks a little harder per mark. No new artwork,
      // and nothing here touches how the ship actually flies.
      const exhaustEvery = player.thrust > 0 ? 2 : 3;
      // The hull turns toward travel unless the player is aiming, and keeps its
      // last heading when nothing is held.
      player.angle = facingFor(
        intent,
        firingHeading === null ? null : player.emp > 0 ? firingHeading + 180 : firingHeading,
        player.angle
      );
      if (intent.active && intent.heading !== null && game.cycles % exhaustEvery === 0) {
        const points = shipThrusterWorldPoints(game.ship.id, player, player.angle * DEG, 1.15);
        const count = Math.max(1, Math.round((2 + player.thrust) / points.length));
        for (const point of points) exhaustBurst(game, point.x, point.y, player.angle * DEG, player.thrust > 1 ? "#9dfbff" : "#63efff", count, 2.5 + player.thrust * 0.5);
      }

      const playerSpeed = Math.hypot(player.vx, player.vy);
      if (playerSpeed > maxSpeed) { player.vx = (player.vx / playerSpeed) * maxSpeed; player.vy = (player.vy / playerSpeed) * maxSpeed; }
      player.x += player.vx;
      player.y += player.vy;
      if (player.x < 12 || player.x > game.worldWidth - 12) { player.x = cap(player.x, 12, game.worldWidth - 12); player.vx *= game.rules.wall.bounce; if (game.rules.wall.damage > 0) damageCollision(game, game.rules.wall.damage, "wall"); }
      if (player.y < 12 || player.y > game.worldHeight - 12) { player.y = cap(player.y, 12, game.worldHeight - 12); player.vy *= game.rules.wall.bounce; if (game.rules.wall.damage > 0) damageCollision(game, game.rules.wall.damage, "wall"); }

      const activeRiftRun = riftRunRef.current;
      if (activeRiftRun) {
        clearInactiveFlameFx(game.riftFlames, new Set(activeRiftRun.hardpoints.flatMap((point) =>
          point.status === "occupied" && point.weapon.weaponId === "flamethrower" ? [point.weapon.instanceId] : []
        )), Boolean(fire));
        if (game.riftReformTicks > 0) {
          const reformed = tickRiftReform({
            integrity: game.rivalHealth,
            maximumIntegrity: game.rivalMaxHealth,
            reformRemainingMs: game.riftReformTicks * TICK_MS,
            breached: true,
          }, TICK_MS, RIFT_RUN_BASE_INTEGRITY, activeRiftRun.riftBreaches);
          game.riftReformTicks = Math.ceil(reformed.reformRemainingMs / TICK_MS);
          game.rivalHealth = reformed.integrity;
          game.rivalMaxHealth = reformed.maximumIntegrity;
          if (!reformed.breached) {
            game.notice = `RIFT REFORMED // DEPTH ${activeRiftRun.riftBreaches}`;
            game.noticeLife = 90;
          }
        }
        tickWeaponRuntime(riftWeaponRuntime.current);
        const mountedShots = processHardpointFire(activeRiftRun.hardpoints, riftWeaponRuntime.current, Boolean(fire), shipMuzzleWorldPoint(game.ship.id, player, player.angle * DEG, 1.15), player.angle * DEG);
        for (const mounted of mountedShots) {
          if (mounted.kind === "flame") {
            refreshFlameFx(game.riftFlames, mounted, activeRiftRun.hardpoints.length, player.angle * DEG);
            const targets = game.enemies.filter((enemy) => enemy.hp > 0 && enemy.kind !== "ghost").map((enemy) => ({ id: enemyIdentity(game, enemy), x: enemy.x, y: enemy.y }));
            const hit = new Set(targetsInFlameCone(mounted.origin, mounted.angle, mounted.range, mounted.coneDegrees, targets));
            for (const enemy of game.enemies) {
              const id = enemyIdentity(game, enemy);
              if (enemy.hp <= 0 || !hit.has(id)) continue;
              damageEnemy(game, enemy, mounted.damage);
              if (mounted.evolutionId === "inferno-projector" && enemy.hp > 0) applyScorched(game.riftScorched, id);
            }
            // Rift contact is one cadence-bounded tick, just like an enemy; it
            // cannot be multiplied by render rate or overlap samples.
            if (targetsInFlameCone(mounted.origin, mounted.angle, mounted.range, mounted.coneDegrees, [{ id: "rift", x: game.portalX, y: game.portalY }]).length) {
              hitRiftWithRiftRunWeapon(game, mounted.damage, mounted.instanceId);
            }
            continue;
          }
          if (!admitsProjectile(game.riftProjectiles, mounted.instanceId, mounted.weaponId as RiftWeaponId)) continue;
          const projectile = projectileFromShot(mounted, { x: player.vx, y: player.vy });
          if (projectile) game.riftProjectiles.push(projectile);
        }
        if (mountedShots.length > 0 && game.cycles - lastGunFeedbackTick >= (mountedShots[0].weaponId === "minigun" ? 6 : mountedShots[0].weaponId === "flamethrower" ? 10 : 1)) {
          lastGunFeedbackTick = game.cycles;
          const id = mountedShots[0].weaponId;
          if (id === "railgun") {
            // A rail round is not a slowed-down pulse. It gets its own
            // procedural crack and its own violet flash at the rail that
            // fired it, so the weapon is identifiable with eyes shut.
            playCue(RAILGUN_FIRE_CUE, cap(RAILGUN_FIRE_CUE.volume * SOUND_GAIN[soundLevelRef.current], 0, 1));
            for (const shot of mountedShots) {
              if (shot.weaponId !== "railgun") continue;
              burst(game, shot.origin.x, shot.origin.y, RAILGUN_PALETTE.glow, RAILGUN_MUZZLE_PARTICLES, 4);
            }
          } else {
            play(id === "missile-pod" ? "thrust" : id === "flamethrower" ? "magic" : "fire", id === "minigun" ? 0.04 : 0.11, id === "minigun" ? 1.8 : id === "flamethrower" ? 0.7 : 1);
          }
          vibrateCombat("gun");
        }
      }
      if (fire && game.shotCycle <= 0 && game.playerShots < SHOT_LEVELS[player.gun].maxShots) {
        const shot = SHOT_LEVELS[player.gun];
        const aimAngle = player.angle * DEG;
        const cannonDamage = shot.damage * (activeRiftRun?.shipModifiers.cannonDamage ?? 1);
        const rounds = game.specialShip === "warden" && player.suppressionBarrage > 0
          ? suppressionBarrageRounds(aimAngle, cannonDamage)
          : (shot.shots === 2 ? [-0.05, 0.05] : [0]).map((offset) => ({ angle: aimAngle + offset, damage: cannonDamage, supplemental: false }));
        const muzzle = shipMuzzleWorldPoint(game.ship.id, player, aimAngle, 1.15);
        rounds.forEach((round) => {
          const velocity = shipForwardVelocity(round.angle, 10, { x: player.vx, y: player.vy });
          game.bullets.push({ x: muzzle.x, y: muzzle.y, vx: velocity.x, vy: velocity.y, damage: round.damage, life: 110, enemy: false, color: shot.color, bouncesLeft: player.ricochetTicks > 0 ? RICOCHET_BOUNCES : 0, salvageLinked: game.specialShip === "kestrel" && player.salvageLink > 0, supplemental: round.supplemental });
          if (!round.supplemental) game.playerShots += 1;
        });
        game.shotCycle = Math.max(1, Math.round(shot.delay / (activeRiftRun?.shipModifiers.cannonFireRate ?? 1)));
        play("fire", 0.12, cannonPlaybackRate(player.gun));
        vibrateCombat("gun");
      }

      activateSpecial(game, controller.special);

      if (launch && game.stock.length > 0 && !keys.current.__launchLatch) {
        keys.current.__launchLatch = true;
        const type = consumeLoadedPup(game.stock)!;
        if (game.mode !== "pve") netRef.current?.reportInventory("launch", type);
        const angle = player.angle * DEG;
        const homing = game.specialShip === "rabbit" && player.viperGuidance > 0;
        const muzzle = shipMuzzleWorldPoint(game.ship.id, player, angle, 1.15), velocity = shipForwardVelocity(angle, 10, { x: player.vx, y: player.vy });
        game.powers.push({ x: muzzle.x, y: muzzle.y, vx: velocity.x, vy: velocity.y, type, life: homing ? 320 : 160, homing });
        game.notice = homing ? `${WEAPONS[type].short} // TARGET LINK` : `${WEAPONS[type].short} ARMED`;
        game.noticeLife = 75;
        burst(game, player.x, player.y, POWER_COLORS[type], 10, 4);
        play("fire", 0.2);
      }
      if (!launch) keys.current.__launchLatch = false;
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

      // Rift projectiles retain combat identity for their whole flight. They
      // deliberately never enter `bullets`, so standard cannon accounting and
      // special-projectile behavior remain unchanged.
      for (const projectile of game.riftProjectiles) {
        const liveTargets = game.enemies.filter((enemy) => enemy.hp > 0 && enemy.kind !== "ghost").map((enemy) => ({
          id: enemyIdentity(game, enemy), x: enemy.x, y: enemy.y, hostile: true,
        }));
        steerMissile(projectile, liveTargets);
        projectile.x += projectile.vx; projectile.y += projectile.vy; projectile.state.remainingLifetime -= 1;
        if (projectile.state.remainingLifetime <= 0) continue;
        if (Math.hypot(projectile.x-game.portalX, projectile.y-game.portalY) < 43) {
          // Missiles never acquire the Rift, but a manually aimed missile can
          // still strike it. Rail rounds stop at the Rift; only normal hostile
          // contacts consume their configured penetration allowance.
          hitRiftWithRiftRunWeapon(game, projectile.state.damage, projectile.state.instanceId);
          projectile.state.remainingLifetime = 0; game.portalPulse = Math.max(game.portalPulse, .4);
          burst(game, projectile.x, projectile.y, "#ff5ac8", 5, 3);
          continue;
        }
        for (const enemy of game.enemies) {
          if (enemy.hp <= 0 || enemy.kind === "ghost" || projectile.state.remainingLifetime <= 0) continue;
          const id = enemyIdentity(game, enemy);
          if (projectile.state.hitTargetIds.has(id)) continue;
          const dx=projectile.x-enemy.x, dy=projectile.y-enemy.y, radius=enemy.radius+projectile.radius;
          if (dx*dx+dy*dy >= radius*radius) continue;
          if (projectile.state.weaponId === "missile-pod") {
            const victims = new Set(detonateMissile(projectile, game.enemies.filter((item) => item.hp > 0 && item.kind !== "ghost").map((item) => ({ id: enemyIdentity(game, item), x: item.x, y: item.y }))));
            for (const victim of game.enemies) if (victim.hp > 0 && victims.has(enemyIdentity(game, victim))) damageEnemy(game, victim, projectile.state.damage);
            burst(game, projectile.x, projectile.y, "#ffae5f", 14, 5); play("explosion", .14, 1.25);
          } else {
            damageEnemy(game, enemy, projectile.state.damage);
            projectile.state.hitTargetIds.add(id);
            if (projectile.state.evolutionId === "nova-cannon" || projectile.state.evolutionId === "seismic-rail") {
              const radialTargets=game.enemies.filter(item=>item.hp>0&&item.kind!=="ghost").map(item=>({id:enemyIdentity(game,item),x:item.x,y:item.y}));
              const victims=new Set(evolutionRadialHit(projectile,enemy,radialTargets));
              for(const victim of game.enemies) if(victim.hp>0&&victims.has(enemyIdentity(game,victim))) damageEnemy(game,victim,projectile.state.damage*.35);
              burst(game,projectile.x,projectile.y,projectile.state.evolutionId==="seismic-rail"?"#9cf6ff":"#fff1a8",12,5);
            }
            if (projectile.state.weaponId !== "railgun") projectile.state.remainingLifetime = 0;
            else {
              // Railgun penetrates exactly the configured number of unique
              // normal/major enemies, never the same entity on later ticks.
              projectile.state.hitTargetIds.delete(id);
              const persists = penetrate(projectile.state, id);
              if (!persists || projectile.state.remainingPenetrations <= 0) projectile.state.remainingLifetime = 0;
            }
            if (projectile.state.weaponId === "railgun") {
              // Violet sparks first so the hit reads as the rail's, then a
              // few flecks in the victim's colour so it still reads as a hit.
              burst(game, projectile.x, projectile.y, RAILGUN_PALETTE.spark, RAILGUN_IMPACT_PARTICLES, 5);
              burst(game, projectile.x, projectile.y, POWER_COLORS[enemy.kind], 4, 3);
              playCue(RAILGUN_IMPACT_CUE, cap(RAILGUN_IMPACT_CUE.volume * SOUND_GAIN[soundLevelRef.current], 0, 1));
            } else burst(game, projectile.x, projectile.y, POWER_COLORS[enemy.kind], 4, 3);
          }
        }
      }

      if (activeRiftRun && game.riftScorched.size > 0) {
        const liveScorched = new Map<EntityId, Enemy>();
        for (const enemy of game.enemies) {
          if (enemy.hp > 0) liveScorched.set(enemyIdentity(game, enemy), enemy);
        }
        for (const id of tickScorched(game.riftScorched)) {
          const enemy = liveScorched.get(id);
          if (enemy?.hp > 0) damageEnemy(game, enemy, SCORCHED_DAMAGE);
        }
        for (const id of game.riftScorched.keys()) {
          if (!liveScorched.has(id)) game.riftScorched.delete(id);
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
        // Additional cannon/PUP contact only: combat checks below are intact
        // for every round that did not actually touch a loose collectible.
        if (bullet.life > 0 && bullet.salvageLinked) {
          const pickup = game.pickups.find((item) => item.life > 0 && salvageLinkHitsPup(game.specialShip ?? game.ship.id, bullet, item));
          if (pickup) {
            const collected = resolvePlayerPickup(game, pickup, "salvage-link");
            // Consume on both success and a full bin so this one round cannot
            // retry every frame or collect a second PUP in the same row.
            bullet.life = 0;
            if (collected) {
              burst(game, pickup.x, pickup.y, "#75ffd0", 8, 3.5);
              playCue("salvage-link", 0.14);
            }
          }
        }
        if (bullet.life <= 0) return;
        // Every portal in the arena is shootable, by anyone. With one portal
        // this is exactly the old behaviour; with several it is the rule that
        // makes the mode work — a pilot can farm power-ups off a rival's
        // portal as readily as their own.
        const struck = game.portals.find((portal) => Math.hypot(bullet.x - portal.x, bullet.y - portal.y) < 43);
        if (struck) {
          bullet.life = 0;
          // Rift Run's rift pays a per-rift budget at integrity thresholds
          // instead of a per-damage rate, so cannon fire does not feed the
          // meter there. It still lands, at a small integrity trickle, so a
          // pilot out of PUPs and without a hull weapon still has a way to
          // make progress. Every other mode is untouched.
          if (struck.id === 0 && !game.riftDanger) chargeRiftPup(game, bullet.damage);
          else if (struck.id === 0 && game.riftDanger) hitRiftWithCannonInRiftRun(game, bullet.damage);
          else {
            // A rival's portal banks its own damage and sheds at its own
            // threshold. It is not this pilot's rift, so it does not feed the
            // rift-damage score.
            const banked = chargePortal(struck, bullet.damage);
            struck.charge = banked.portal.charge;
            if (banked.bloomed) {
              const type = dropForGame(game);
              game.pickups.push({ x: struck.x + range(-28, 28), y: struck.y + range(-28, 28), ...pupLaunchVelocity(2.0, 4.2), type, life: PUP_LIFE_TICKS, phase: range(0, 6) });
              pushSpawn(game, "friendly", type, struck.x, struck.y, 1);
              playCue(`spawn:${type}`, 0.17);
            }
          }
          // This is where cannon damage is actually applied to the rift — the
          // coach line calls it damage and the charge meter measures it — so
          // it is where Survival pays for it. Awarding at the muzzle instead
          // would pay for rounds that never arrive.
          awardRiftDamage(game, bullet.damage);
          game.portalPulse = Math.max(game.portalPulse, 0.4);
          burst(game, bullet.x, bullet.y, "#ff5ac8", 4, 2.5);
          cannonImpactFeedback(game, bullet);
        }
        // Hostile rounds are bodies, not effects: one player round trades
        // itself for one of theirs. Both die, so a wall of incoming fire can be
        // answered instead of only dodged.
        for (const hostile of game.bullets) {
          if (!hostile.enemy || hostile.life <= 0 || bullet.life <= 0) continue;
          if (dist(bullet, hostile) < 11) {
            hostile.life = 0;
            bullet.life = 0;
            burst(game, hostile.x, hostile.y, "#ff9db0", 5, 2.5);
            cannonImpactFeedback(game, bullet);
          }
        }
        // A loose power-up can be shot once its spawn grace is up. Salvage-linked
        // rounds are exempt: Kestrel's special collects PUPs by shooting them, so
        // letting those same rounds destroy one would cancel the ship's identity.
        if (bullet.life > 0 && !bullet.salvageLinked) {
          for (const loose of game.pickups) {
            if (!pupIsShootable(loose)) continue;
            if (dist(bullet, loose) < PUP_RADIUS + 4) {
              loose.life = 0;
              bullet.life = 0;
              burst(game, loose.x, loose.y, POWER_COLORS[loose.type], 12, 4);
              cannonImpactFeedback(game, bullet);
              break;
            }
          }
        }
        for (const enemy of game.enemies) {
          if (enemy.hp <= 0 || bullet.life <= 0 || enemy.kind === "ghost") continue;
          if (dist(bullet, enemy) < enemy.radius + 4) {
            bullet.life = 0;
            const coopGuest = game.mode === "coop" && netRef.current?.state.you?.id !== netRef.current?.state.hostId;
            if (coopGuest) netRef.current?.reportEnemyHit(enemyIdentity(game, enemy), bullet.damage, bullet.special ? "overcharge" : "cannon");
            else damageEnemy(game, enemy, bullet.damage);
            burst(game, bullet.x, bullet.y, POWER_COLORS[enemy.kind], 4, 2.5);
            cannonImpactFeedback(game, bullet);
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
              // A payload landing is the second — and only other — place the
              // rift takes damage. What is paid for is the integrity actually
              // removed, so the part an enrage shield swallowed scores
              // nothing and a hit on a rift already at zero scores nothing.
              awardRiftDamage(game, game.lastRivalDamage);
              // The other place integrity moves, so the other place the rift's
              // budget is booked. A no-op outside Rift Run.
              if (game.lastRivalDamage > 0) releaseRiftBudget(game);
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
            } else if (game.rivalHealth <= 0 && riftRunRef.current) {
              breachRiftRunNow(game);
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
          if (dist(power, enemy) < enemy.radius + 10) {
            power.life = 0;
            const coopGuest = game.mode === "coop" && netRef.current?.state.you?.id !== netRef.current?.state.hostId;
            if (coopGuest) netRef.current?.reportEnemyHit(enemyIdentity(game, enemy), 60, "projectile");
            else damageEnemy(game, enemy, enemy.hp);
          }
        }
      });

      game.pickups.forEach((pickup) => {
        // A loose PUP now belongs to the arena rather than drifting out of it:
        // `advancePup` carries the float it always had and bounces its whole
        // body — not its centre — off the boundary.
        if (advancePup(pickup, { width: game.worldWidth, height: game.worldHeight })) {
          burst(game, pickup.x, pickup.y, POWER_COLORS[pickup.type], 3, 2);
        }
        pickup.phase += PUP_SPIN;
        pickup.life -= 1;
        if (pupCollected(pickup, player)) {
          resolvePlayerPickup(game, pickup, "physical");
        }
      });

      const coopNetwork = netRef.current?.state;
      const coopIsHost = game.mode === "coop"
        && Boolean(coopNetwork?.you?.id)
        && coopNetwork?.you?.id === coopNetwork?.hostId;
      if (coopIsHost) {
        for (const hit of netRef.current?.drainEnemyHits() ?? []) {
          if (hit.roundId !== game.roundId) continue;
          const enemy = game.enemies.find((entry) => entry.enemyId === hit.enemyId);
          if (enemy) damageEnemy(game, enemy, hit.damage);
        }
        for (const action of netRef.current?.drainWorldActions() ?? []) {
          if (action.roundId !== game.roundId) continue;
          if (action.action === "clear") game.enemies.forEach((enemy) => destroyEnemy(game, enemy));
          else game.enemies.forEach((enemy) => { enemy.scrambled = Math.max(enemy.scrambled ?? 0, ticksForSeconds(3)); });
        }
      }
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
        // Survival — and a Rift Run that has breached at least once —
        // schedules its own waves from an escalation table, so the PvE
        // scheduler stands down rather than spawning alongside it.
        !game.survival
        && !game.riftEscalation?.current.ownsWaveSchedule
        && (game.mode !== "coop" || coopIsHost)
        && game.botTimer <= 0
        && game.running
      ) {
        const pool: PowerId[] = game.cycles < 1800 ? ["heatseeker", "mines", "ufo", "inflator"] : SENDABLE_POWERUPS;
        const attack = pool[Math.floor(Math.random() * pool.length)];
        addIncoming(game, attack);
        game.botTimer = Math.max(330, 580 - Math.floor(game.cycles / 140));
      }

      tickPlayerBeam(game);
      game.blasts.forEach((fx) => updateBlast(game, fx));
      game.enemies.forEach((enemy) => { if (enemy.hp > 0) updateEnemy(game, enemy); });
      if (coopIsHost && game.cycles % 6 === 0) {
        netRef.current?.reportWorld({
          roundId: game.roundId,
          portalX: game.portalX,
          portalY: game.portalY,
          portalAngle: game.portalAngle,
          enrageActive: game.enrageActive,
          enemies: game.enemies.slice(0, 128).map((enemy) => ({ ...enemy, enemyId: enemyIdentity(game, enemy) })),
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
      game.pickupLabels.forEach((label) => { label.age += 1; });

      // In-place compaction: no new arrays are allocated every tick.
      let liveShots = 0;
      compact(game.bullets, (item) => {
        const alive = item.life > 0 && item.x > -30 && item.x < game.worldWidth + 30 && item.y > -30 && item.y < game.worldHeight + 30;
        if (alive && countsTowardShotBudget(item)) liveShots += 1;
        return alive;
      });
      game.playerShots = liveShots;
      compact(game.riftProjectiles, (item) => item.state.remainingLifetime > 0 && item.x > -30 && item.x < game.worldWidth + 30 && item.y > -30 && item.y < game.worldHeight + 30);
      compact(game.riftFlames, (item) => { item.life -= 1; return item.life > 0; });
      compact(game.pickups, (item) => item.life > 0);
      compact(game.powers, (item) => item.life > 0 && item.x > -30 && item.x < game.worldWidth + 30 && item.y > -30 && item.y < game.worldHeight + 30);
      compact(game.enemies, (item) => item.hp > 0);
      compact(game.blasts, (item) => item.age < item.life);
      compact(game.particles, (item) => item.life > 0);
      compact(game.spawns, (item) => item.age < item.life);
      compact(game.pickupLabels, (item) => item.age < item.life);
      if (game.incoming && game.noticeLife <= 0) game.incoming = null;

      if (pendingRelease.current.length > 0) {
        for (const code of pendingRelease.current) keys.current[code] = false;
        pendingRelease.current.length = 0;
      }

      hudDelay += 1;
      if (hudDelay >= 7 || game.result) { hudDelay = 0; sync(); }
    };

    /**
     * The backdrop.
     *
     * Three parallax star layers, a nebula field and a slow dust drift, in
     * place of the flat grid and the single pinned sheet of stars that used to
     * sit here. Layout comes from app/starfield.ts; this is the canvas half.
     *
     * The far layer and the clouds are baked once into an offscreen canvas and
     * blitted, because large translucent radial gradients are the only part of
     * this design that would cost real frames at 60fps. The bake is keyed on
     * the arena palette, so it repaints itself when a run escalates a stage and
     * at no other time. The two nearer layers are plain fillRects and are drawn
     * live, which is what buys the twinkle and the faster parallax.
     */
    const BACKDROP_MARGIN = 72;
    let backdropBudget = starfieldBudget(profile.detail, reducedMotionRef.current, profile.maxParticles);
    let midStars: BackdropStar[] = [];
    let nearStars: BackdropStar[] = [];
    let dustMotes: BackdropMote[] = [];
    let bakedBackdrop: HTMLCanvasElement | null = null;
    let bakedBackdropKey = "";
    let vignetteGradient: CanvasGradient | null = null;
    let vignetteKey = "";

    const rebuildStarLayers = (budget: StarfieldBudget) => {
      midStars = createStars(budget.mid, VIEW_WIDTH, VIEW_HEIGHT, "mid", 2);
      nearStars = createStars(budget.near, VIEW_WIDTH, VIEW_HEIGHT, "near", 3);
      dustMotes = createMotes(budget.motes, VIEW_WIDTH, VIEW_HEIGHT, 4);
    };
    rebuildStarLayers(backdropBudget);

    const bakeBackdrop = (paletteKey: string, budget: StarfieldBudget, height: number) => {
      const key = backdropKey(paletteKey, budget.nebulae, budget.far + budget.band, VIEW_WIDTH, height);
      if (bakedBackdrop && bakedBackdropKey === key) return bakedBackdrop;
      const width = VIEW_WIDTH + BACKDROP_MARGIN * 2, depth = Math.round(height) + BACKDROP_MARGIN * 2;
      const canvas = bakedBackdrop ?? document.createElement("canvas");
      canvas.width = width; canvas.height = depth;
      const bake = canvas.getContext("2d");
      if (!bake) return null;
      bake.clearRect(0, 0, width, depth);
      const [primary, secondary] = nebulaTints(paletteKey);
      // Additive, so where lobes overlap the cloud brightens into a visible
      // core and where they do not it stays a wisp. That structure is the
      // difference between a nebula and a background gradient.
      bake.globalCompositeOperation = "lighter";
      for (const cloud of createNebulae(budget.nebulae, width, depth, 11)) {
        const colour = cloud.tint === 0 ? primary : secondary;
        for (const lobe of cloud.lobes) {
          const cx = cloud.x + lobe.dx, cy = cloud.y + lobe.dy;
          const cloudFill = bake.createRadialGradient(cx, cy, 0, cx, cy, lobe.radius);
          cloudFill.addColorStop(0, rgba(colour, NEBULA_ALPHA * lobe.alpha));
          cloudFill.addColorStop(0.35, rgba(colour, NEBULA_ALPHA * lobe.alpha * 0.6));
          cloudFill.addColorStop(1, rgba(colour, 0));
          bake.fillStyle = cloudFill;
          bake.beginPath(); bake.arc(cx, cy, lobe.radius, 0, Math.PI * 2); bake.fill();
        }
      }
      // The galactic band first, then the loose field over it: a scatter of
      // dots with a structure running through it reads as a place rather than
      // as noise, and both are baked, so neither costs a frame.
      for (const star of createBandStars(budget.band, width, depth, 6)) {
        bake.fillStyle = `rgba(${STAR_TINTS[star.tint]},${star.alpha.toFixed(3)})`;
        bake.fillRect(star.x, star.y, star.size, star.size);
      }
      for (const star of createStars(budget.far, width, depth, "far", 1)) {
        bake.fillStyle = `rgba(${STAR_TINTS[star.tint]},${star.alpha.toFixed(3)})`;
        bake.fillRect(star.x, star.y, star.size, star.size);
      }
      bake.globalCompositeOperation = "source-over";
      bakedBackdrop = canvas; bakedBackdropKey = key;
      return canvas;
    };

    const drawBackdrop = (paletteKey: string, time: number, detail: number, camX: number, camY: number, height: number) => {
      const budget = starfieldBudget(detail, reducedMotionRef.current, profile.maxParticles);
      if (budget.mid !== backdropBudget.mid || budget.near !== backdropBudget.near || budget.motes !== backdropBudget.motes) {
        rebuildStarLayers(budget);
      }
      backdropBudget = budget;

      const baked = bakeBackdrop(paletteKey, budget, height);
      if (baked) {
        // Clamped rather than tiled: one blit a frame, and at the extremes of
        // a follow camera the deepest layer simply stops sliding, which at a
        // parallax factor of 0.05 nobody can see.
        const slide = (value: number) => Math.max(-BACKDROP_MARGIN, Math.min(BACKDROP_MARGIN, value * PARALLAX_DEPTH.far));
        ctx.drawImage(baked, -BACKDROP_MARGIN + slide(camX), -BACKDROP_MARGIN + slide(camY));
      }

      for (const layer of [{ stars: midStars, depth: PARALLAX_DEPTH.mid }, { stars: nearStars, depth: PARALLAX_DEPTH.near }]) {
        for (const star of layer.stars) {
          const point = parallaxPoint(star.x, star.y, camX, camY, layer.depth, VIEW_WIDTH, height);
          ctx.fillStyle = `rgba(${STAR_TINTS[star.tint]},${twinkleAlpha(star, time, budget.twinkle).toFixed(3)})`;
          ctx.fillRect(point.x, point.y, star.size, star.size);
        }
      }

      for (const mote of dustMotes) {
        const drifted = moteAt(mote, time, VIEW_WIDTH, VIEW_HEIGHT, budget.drift);
        const point = parallaxPoint(drifted.x, drifted.y, camX, camY, PARALLAX_DEPTH.near, VIEW_WIDTH, height);
        ctx.fillStyle = `rgba(190,214,240,${mote.alpha.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(point.x, point.y, mote.radius, 0, Math.PI * 2); ctx.fill();
      }

      // Corners down, middle untouched. Spent entirely on the backdrop: this
      // runs before a single ship, bullet or power-up is drawn, so it buys
      // contrast for the fight without dimming any of it.
      const vignetteId = `${Math.round(height)}`;
      if (!vignetteGradient || vignetteKey !== vignetteId) {
        const cx = VIEW_WIDTH / 2, cy = height / 2, outer = Math.max(VIEW_WIDTH, height) * VIGNETTE.outerRatio;
        const shade = ctx.createRadialGradient(cx, cy, outer * VIGNETTE.innerRatio, cx, cy, outer);
        shade.addColorStop(0, "rgba(0,0,0,0)");
        shade.addColorStop(1, `rgba(0,0,0,${VIGNETTE.alpha})`);
        vignetteGradient = shade; vignetteKey = vignetteId;
      }
      ctx.fillStyle = vignetteGradient;
      ctx.fillRect(0, 0, VIEW_WIDTH, height);
    };
    // Sparse, non-colliding world landmarks. They move with the camera to make
    // flight readable, but stay faint enough to remain behind combat.
    // Scattered across whatever arena this run is actually using, so a square
    // world is not left with an empty right-hand third.
    const rockField = gameRef.current;
    const backgroundRocks = Array.from({ length: 11 }, (_, i) => ({
      x: 90 + (i * 317.3) % Math.max(1, rockField.worldWidth - 180),
      y: 80 + (i * 191.7) % Math.max(1, rockField.worldHeight - 160),
      radius: 34 + (i % 4) * 18,
      sides: 7 + (i % 3),
      rotation: (i * 0.73) % (Math.PI * 2),
      drift: 0.00001 * (i % 2 === 0 ? 1 : -1),
    }));

    /**
     * A portal this pilot owns rather than attacks.
     *
     * Drawn as its own mouth rather than by reusing drawPortal, which carries
     * rift state — charge meter, enrage tint, contact hazard ring, victory
     * collapse — that means nothing here. A shootable body has to be visible,
     * and it has to be visibly *not* the thing you are trying to destroy.
     */
    const drawOwnPortal = (portal: Portal, time: number) => {
      const pulse = 0.6 + Math.sin(time * 0.004) * 0.15;
      ctx.save();
      ctx.translate(portal.x, portal.y);
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "#8dffd0";
      for (let ring = 0; ring < 3; ring += 1) {
        ctx.globalAlpha = (0.5 - ring * 0.12) * pulse;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 30 + ring * 15, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Banked charge, so shooting your own portal for power-ups reads as
      // progress rather than as hitting a decoration.
      const banked = cap(portal.charge / Math.max(1, portal.threshold), 0, 1);
      if (banked > 0) {
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 22, -Math.PI / 2, -Math.PI / 2 + banked * Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    };

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


    /**
     * Every Rift Run danger the pilot has to see, in world space.
     *
     * The rule this obeys is that nothing lethal is ever invisible: a
     * retaliation and a hazard both spend their whole telegraph drawn as a
     * filling outline, so the pilot reads how long they have left rather than
     * being told it happened. Drawn after the rift and before ships, so the
     * pilot's own hull is never hidden under a warning.
     */
    const drawRiftDanger = (game: Game, time: number) => {
      const danger = game.riftDanger;
      if (!danger) return;

      // The anti-camp radius, shown only once pressure is actually building,
      // so the arena is not permanently ringed for a pilot who never camps.
      const pressure = danger.pressure.pressure / 100;
      if (pressure > 0.02) {
        ctx.save();
        ctx.globalAlpha = 0.1 + pressure * 0.4;
        ctx.strokeStyle = pressure > 0.75 ? "#ff5570" : "#ff9a4d";
        ctx.lineWidth = 1 + pressure * 2.5;
        ctx.setLineDash([10, 12]);
        ctx.beginPath();
        ctx.arc(game.portalX, game.portalY, RIFT_PRESSURE_RADIUS, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      const pending = danger.pressure.pending;
      if (pending) {
        const spent = 1 - pending.telegraphTicks / Math.max(1, pending.telegraphTotal);
        ctx.save();
        ctx.strokeStyle = "#ff5570";
        ctx.fillStyle = "rgba(255, 85, 112, .16)";
        ctx.lineWidth = 3;
        if (pending.kind === "strike") {
          // A filling disc under the pilot's last position: the fill is the
          // countdown, and leaving the circle is the whole answer to it.
          ctx.beginPath();
          ctx.arc(pending.x, pending.y, pending.radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(pending.x, pending.y, pending.radius * spent, 0, Math.PI * 2);
          ctx.fill();
        } else if (pending.kind === "shockwave") {
          ctx.globalAlpha = 0.35 + spent * 0.5;
          ctx.beginPath();
          ctx.arc(pending.x, pending.y, 44 + spent * 26, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.globalAlpha = 0.3 + spent * 0.55;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 10]);
          ctx.beginPath();
          ctx.moveTo(pending.x, pending.y);
          ctx.lineTo(pending.x + Math.cos(pending.angle * DEG) * 420, pending.y + Math.sin(pending.angle * DEG) * 420);
          ctx.stroke();
        }
        ctx.restore();
      }

      for (const wave of danger.shockwaves) {
        const fade = 1 - wave.radius / Math.max(1, wave.maxRadius);
        ctx.save();
        ctx.globalAlpha = 0.25 + fade * 0.6;
        ctx.strokeStyle = "#64eaff";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(wave.x, wave.y, wave.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      for (const sweep of danger.sweeps) {
        const half = 9 * DEG;
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = "rgba(255, 85, 112, .3)";
        ctx.strokeStyle = "#ff5570";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sweep.x, sweep.y);
        ctx.arc(sweep.x, sweep.y, sweep.length, sweep.angle * DEG - half, sweep.angle * DEG + half);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      for (const event of danger.hazards.active) {
        for (const impact of event.impacts) {
          const warning = impact.warningTicks > 0;
          if (!warning && impact.liveTicks <= 0) continue;
          const lethal = event.category === "lethal";
          ctx.save();
          if (warning) {
            // Still a warning: outline plus a filling core showing how much of
            // the telegraph is spent.
            const spent = 1 - impact.warningTicks / Math.max(1, impact.warningTotal);
            ctx.globalAlpha = 0.75;
            ctx.strokeStyle = lethal ? "#ffb346" : "#8f7dff";
            ctx.lineWidth = 3;
            ctx.setLineDash([12, 10]);
            ctx.lineDashOffset = -time * 0.02;
            ctx.beginPath();
            ctx.arc(impact.x, impact.y, impact.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 0.16;
            ctx.fillStyle = lethal ? "#ffb346" : "#8f7dff";
            ctx.beginPath();
            ctx.arc(impact.x, impact.y, impact.radius * Math.min(1, Math.max(0, spent)), 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.globalAlpha = lethal ? 0.42 : 0.2;
            ctx.fillStyle = lethal ? "#ff5570" : "#8f7dff";
            ctx.beginPath();
            ctx.arc(impact.x, impact.y, impact.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 0.85;
            ctx.strokeStyle = lethal ? "#ff9a4d" : "#a89bff";
            ctx.lineWidth = 3;
            ctx.stroke();
          }
          ctx.restore();
        }
      }
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
        phase: enemy.kind === "mines" ? enemy.phase : undefined,
        charge: enemy.kind === "nuke" ? cap((enemy.countdown ?? 0) / 600, 0, 1) : undefined,
      });
      ctx.restore();

      ctx.save();
      ctx.translate(enemy.x, enemy.y);
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
    /**
     * The collected power-up's name, rising and fading where it was picked up.
     *
     * Drawn in world space so it stays pinned to the spot as the camera moves,
     * and drawn last so nothing paints over it. Held fully opaque for the first
     * third of its life, then faded, so it is readable rather than a flicker.
     */
    const drawPickupLabel = (label: PickupLabel) => {
      const p = cap(label.age / label.life, 0, 1);
      const alpha = p < 0.34 ? 1 : 1 - (p - 0.34) / 0.66;
      if (alpha <= 0) return;
      ctx.save();
      ctx.translate(label.x, label.y - 22 - p * 16);
      ctx.globalAlpha = alpha;
      ctx.font = "700 13px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const width = ctx.measureText(label.text).width + 14;
      ctx.fillStyle = "rgba(2, 9, 15, .82)";
      ctx.strokeStyle = label.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(-width / 2, -9, width, 18, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = label.color;
      ctx.fillText(label.text, 0, 1);
      ctx.restore();
    };

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
          // The renderer has no game in scope, so read the live arena from the
          // ref the rest of the draw pass already uses.
          const arena = gameRef.current;
          const away = Math.atan2(spawn.y - arena.worldHeight / 2, spawn.x - arena.worldWidth / 2) + Math.PI;
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
      const shipOvercharge = game.specialShip ? overchargeFor(game.specialShip) : null;

      ctx.setTransform(worldScale, 0, 0, worldScale, 0, 0);
      // Survival repaints the arena as it escalates, so the stage a run has
      // reached is legible before a single word of HUD is read.
      // Survival repaints the arena as it escalates, and a Rift Run repaints
      // it per breach, so the stage a run has reached is legible before a
      // single word of HUD is read.
      // One key for both halves of the arena's look: the gradient underneath
      // and the nebula field over it. Survival and Rift Run key it to the
      // escalation stage, everything else to the difficulty.
      const paletteKey: string = game.survival
        ? game.survival.escalation.stage.id
        : game.riftEscalation
          ? game.riftEscalation.current.stage.id
          : game.rules.id;
      const palette = game.survival
        ? SURVIVAL_PALETTES[game.survival.escalation.stage.id]
        : game.riftEscalation
          ? SURVIVAL_PALETTES[game.riftEscalation.current.stage.id]
          : ARENA_PALETTES[game.rules.id];
      const gradient = ctx.createRadialGradient(VIEW_WIDTH / 2, renderViewHeight / 2, 10, VIEW_WIDTH / 2, renderViewHeight / 2, Math.max(VIEW_WIDTH, renderViewHeight) * .58);
      gradient.addColorStop(0, palette[0]);
      gradient.addColorStop(.58, palette[1]);
      gradient.addColorStop(1, palette[2]);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, VIEW_WIDTH, renderViewHeight);

      // The starfield needs the camera it is parallaxing against, so the
      // backdrop is drawn a few lines below, once camX/camY exist.
      const locked = cameraRef.current;
      const camScale = locked ? ZOOM_SCALE[zoomRef.current] : Math.min(VIEW_WIDTH / game.worldWidth, renderViewHeight / game.worldHeight);
      // On short landscape phones, bias critical focal objects below the DOM
      // HUD. This changes framing only; simulation bounds remain untouched.
      const focalTop = cssWidth > cssHeight ? Math.min(renderViewHeight * .42, cameraSafeTop) : 0;
      // Use the same measured playfield as markers: clipped canvas overhang is
      // not usable follow-camera space. Full Arena retains its whole-world fit.
      const followed = locked
        ? followCameraFrame(player, { width: game.worldWidth, height: game.worldHeight }, camScale,
            playfieldBox, Math.max(playfieldBox.top, focalTop))
        : null;
      const camX = followed?.camX ?? (VIEW_WIDTH - game.worldWidth * camScale) / 2;
      const camY = followed?.camY ?? (renderViewHeight - game.worldHeight * camScale) / 2;
      const viewLeft = -camX / camScale;
      const viewTop = -camY / camScale;
      const viewRight = (VIEW_WIDTH - camX) / camScale;
      const viewBottom = (renderViewHeight - camY) / camScale;
      const visible = (x: number, y: number, r: number) =>
        x + r > viewLeft && x - r < viewRight && y + r > viewTop && y - r < viewBottom;

      drawBackdrop(paletteKey, time, detail, camX, camY, renderViewHeight);

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

      // A local presentation aid only: it uses the exact player.angle consumed
      // by the cannon below and lives in the camera's world-space transform.
      // Drawing it before portals, combat effects, and ships keeps it subdued.
      const guide = player.health > 0
        ? aimGuideSegment(aimGuideRef.current, player.x, player.y, player.angle * DEG)
        : null;
      if (guide) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = "#a8b0b6";
        ctx.lineWidth = 1.25;
        ctx.lineCap = "round";
        ctx.setLineDash([2, 7]);
        ctx.beginPath();
        ctx.moveTo(guide.startX, guide.startY);
        ctx.lineTo(guide.endX, guide.endY);
        ctx.stroke();
        ctx.restore();
      }

      drawPortal(game, time, detail);
      drawRiftDanger(game, time);
      // Breadcrumbs toward every portal that is not the pilot's own. A
      // scrolling camera in a large arena leaves rival portals off-screen with
      // nothing to point at them; a trail of dots from the centre outward says
      // which way to fly. Portal zero is the one already on screen, so it is
      // skipped rather than drawn over.
      if (game.portals.length > 1) {
        for (let i = 1; i < game.portals.length; i += 1) drawOwnPortal(game.portals[i], time);
        const arenaSize = { width: game.worldWidth, height: game.worldHeight };
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = "#8dffd0";
        for (let i = 1; i < game.portals.length; i += 1) {
          for (const dot of portalBreadcrumbs(game.portals[i], arenaSize)) {
            ctx.beginPath();
            ctx.arc(dot.x, dot.y, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
      for (const spawn of game.spawns) drawSpawnFx(spawn, time, detail);
      for (const label of game.pickupLabels) drawPickupLabel(label);

      // Friendly pickups sit in a class-colored, class-shaped cradle around
      // their established glyph, whose individual visual identity stays intact.
      for (const pickup of game.pickups) {
        if (!visible(pickup.x, pickup.y, PUP_RADIUS + 7)) continue;
        const frameColor = pupFrameColor(WEAPONS[pickup.type].pupClass);
        ctx.save();
        ctx.translate(pickup.x, pickup.y);
        if (profile.shadows) ctx.shadowBlur = 12;
        drawLooseArenaPup(ctx, {
          pupClass: WEAPONS[pickup.type].pupClass,
          frameColor,
          rotation: pickup.phase * 0.35,
        }, () => {
          // The glyph is sized from the cradle, so the icon keeps its share of
          // the badge instead of rattling around inside a bigger hexagon.
          drawWeaponGlyph(ctx, pickup.type, PUP_GLYPH_RADIUS, time, { detail });
        });
        // The spawn shield. Described in pup-world beside the badge itself,
        // so this loop keeps making no raw canvas marks of its own.
        if (pupIsProtected(pickup)) drawPupSpawnShield(ctx, pupShieldProgress(pickup));
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
          if (profile.shadows) { ctx.shadowColor = bullet.salvageLinked ? "#75ffd0" : bullet.color; ctx.shadowBlur = bullet.special ? 13 : bullet.salvageLinked ? 11 : 7; }
          const bankshot = !bullet.special && (bullet.bouncesLeft ?? 0) > 0;
          ctx.strokeStyle = bullet.salvageLinked ? "#75ffd0" : bankshot ? "#73f6b0" : bullet.color;
          ctx.lineWidth = bullet.special ? 4.4 : bullet.salvageLinked ? 3.4 : bankshot ? 3.4 : 2.6;
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

      for (const projectile of game.riftProjectiles) {
        const id = projectile.state.weaponId;
        if (id === "railgun") {
          // A hypervelocity slug, not a pulse: an ionised channel hanging back
          // toward the muzzle, a violet motion streak, and a white-hot needle
          // roughly twenty times longer than it is wide.
          const speed = Math.hypot(projectile.vx, projectile.vy);
          if (!visible(projectile.x, projectile.y, RAIL_TRACE_TICKS * speed + 40)) continue;
          const slug = railgunSlugGeometry(projectile.radius);
          const trace = detail >= 0.35
            ? railTrace(projectile.x, projectile.y, projectile.vx, projectile.vy,
                projectile.state.remainingLifetime, RIFT_WEAPON_BY_ID.railgun.lifetimeTicks)
            : null;
          if (trace) {
            const channel = ctx.createLinearGradient(trace.fromX, trace.fromY, projectile.x, projectile.y);
            channel.addColorStop(0, rgba(RAILGUN_PALETTE.edge, 0));
            channel.addColorStop(1, RAILGUN_PALETTE.plasma);
            ctx.save();
            ctx.globalAlpha = trace.alpha;
            ctx.globalCompositeOperation = "lighter";
            ctx.strokeStyle = channel;
            ctx.lineWidth = Math.max(2.4, projectile.radius * 1.7);
            ctx.lineCap = "round";
            ctx.beginPath(); ctx.moveTo(trace.fromX, trace.fromY); ctx.lineTo(projectile.x, projectile.y); ctx.stroke();
            ctx.restore();
          }
          ctx.save();
          ctx.translate(projectile.x, projectile.y);
          ctx.rotate(Math.atan2(projectile.vy, projectile.vx));
          if (profile.shadows) { ctx.shadowColor = RAILGUN_PALETTE.edge; ctx.shadowBlur = 18; }
          const streak = ctx.createLinearGradient(-slug.tailLength, 0, 0, 0);
          streak.addColorStop(0, rgba(RAILGUN_PALETTE.edge, 0));
          streak.addColorStop(1, RAILGUN_PALETTE.edge);
          ctx.fillStyle = streak;
          ctx.beginPath();
          ctx.moveTo(-slug.tailLength, 0);
          ctx.lineTo(-slug.bodyLength, -slug.halfWidth);
          ctx.lineTo(-slug.bodyLength, slug.halfWidth);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = RAILGUN_PALETTE.plasma;
          ctx.beginPath();
          ctx.moveTo(slug.noseLength, 0);
          ctx.lineTo(0, -slug.halfWidth);
          ctx.lineTo(-slug.bodyLength, -slug.halfWidth * 0.5);
          ctx.lineTo(-slug.bodyLength, slug.halfWidth * 0.5);
          ctx.lineTo(0, slug.halfWidth);
          ctx.closePath(); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = RAILGUN_PALETTE.core;
          ctx.beginPath();
          ctx.moveTo(slug.noseLength * 0.8, 0);
          ctx.lineTo(0, -slug.coreHalfWidth);
          ctx.lineTo(-slug.bodyLength * 0.7, 0);
          ctx.lineTo(0, slug.coreHalfWidth);
          ctx.closePath(); ctx.fill();
          ctx.restore();
          continue;
        }
        if (!visible(projectile.x, projectile.y, 30)) continue;
        ctx.save(); ctx.translate(projectile.x, projectile.y); ctx.rotate(Math.atan2(projectile.vy, projectile.vx));
        ctx.shadowColor = id === "missile-pod" ? "#ff9b58" : id === "minigun" ? "#ffe67b" : "#69ecff";
        if (profile.shadows) ctx.shadowBlur = 8;
        ctx.fillStyle = ctx.shadowColor;
        if (id === "missile-pod") { ctx.fillRect(-8,-3,12,6); ctx.fillStyle="#ff5b39"; ctx.fillRect(-11,-2,4,4); }
        else { ctx.fillRect(-8, -projectile.radius, 12, projectile.radius*2); }
        ctx.restore();
      }
      for (const flame of game.riftFlames) {
        const display = flameDisplayTransform(flame, shipMuzzleWorldPoint(game.ship.id, player, player.angle * DEG, 1.15), player.angle * DEG);
        ctx.save(); ctx.translate(display.origin.x, display.origin.y); ctx.rotate(display.angle);
        const width = flame.range * Math.tan(flame.coneDegrees * Math.PI / 360);
        const gradient = ctx.createLinearGradient(0,0,flame.range,0); gradient.addColorStop(0,"rgba(255,245,135,.78)"); gradient.addColorStop(.45,"rgba(255,126,42,.48)"); gradient.addColorStop(1,"rgba(255,56,25,0)");
        ctx.fillStyle=gradient; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(flame.range,-width); ctx.lineTo(flame.range,width); ctx.closePath(); ctx.fill(); ctx.restore();
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

      // Phantom's lance, drawn from the hull along the current facing with the
      // same two-pass stroke the rift's own SWEEP BEAM uses: a wide coloured
      // body under a thin white core. Drawn before the hull so the ship sits
      // on top of its own emitter, and kept to eleven units wide so it reads
      // as a lance rather than washing out the arena.
      if (player.health > 0 && player.beam && player.beamTicks > 0) {
        const beam = player.beam;
        const muzzle = playerBeamMuzzle(game.ship.id, player);
        const flicker = quiet ? 1 : 0.88 + Math.sin(time * 0.05) * 0.12;
        ctx.save();
        ctx.translate(muzzle.x, muzzle.y);
        ctx.rotate(player.angle * DEG);
        if (profile.shadows) { ctx.shadowColor = "#b58bff"; ctx.shadowBlur = 16; }
        ctx.lineCap = "round";
        ctx.globalAlpha = 0.42 * flicker;
        ctx.strokeStyle = "#b58bff";
        ctx.lineWidth = beam.width * 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(beam.length, 0);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.95 * flicker;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(beam.length, 0);
        ctx.stroke();
        ctx.restore();
      }

      if (player.health > 0) {
        // Rift Energy belongs to the pilot, not the Rift. Keep the arc in
        // world space and unrotated, then paint the hull and its shield/damage
        // feedback over it so those higher-priority effects remain legible.
        drawRiftEnergyRing(ctx, player.x, player.y, riftRunRef.current, time);
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
        // Phantom phases the hull out while the lance burns, so the frame
        // reads as untouchable rather than merely lucky.
        if (shipOvercharge?.id === "lance" && player.riderTicks > 0) {
          ctx.globalAlpha = 0.42 + Math.sin(time * 0.02) * 0.12;
        }
        ctx.strokeStyle = player.invuln > 0 ? "#ffffff" : "#69ecff";
        ctx.fillStyle = "rgba(86, 226, 255, .12)";
        if (profile.shadows) { ctx.shadowColor = "#62eaff"; ctx.shadowBlur = 10; }
        ctx.lineWidth = 2;
        drawShipModel(ctx, game.ship.id, 1.15);
        if (player.salvageLink > 0) {
          ctx.strokeStyle = "#75ffd0";
          ctx.globalAlpha = 0.42 + Math.sin(time * 0.012) * 0.18;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, 23 + Math.sin(time * 0.009) * 2, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (player.shield > 0 || player.invuln > 0) {
          ctx.strokeStyle = player.invuln > 0 ? "#ffffff" : "#76a7ff";
          ctx.globalAlpha = .7;
          ctx.beginPath();
          ctx.arc(0, 0, game.ship.id === "flagship" ? 30 : 22, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();

        if (game.specialShip === "warden" && player.suppressionBarrage > 0) {
            const total = ticksForSeconds(SHIP_SPECIALS.warden.activeSeconds ?? 0);
            ctx.save();
            ctx.translate(player.x, player.y);
            ctx.strokeStyle = "#ffd166";
            ctx.globalAlpha = 0.2 + Math.sin(time * 0.025) * 0.1;
            ctx.setLineDash([2, 6]);
            ctx.beginPath(); ctx.arc(0, 0, 25 + Math.sin(time * 0.018) * 2, 0, Math.PI * 2); ctx.stroke();
            if (player.suppressionBarrage > total - 12) {
              const pulse = (total - player.suppressionBarrage) / 12;
              ctx.globalAlpha = (1 - pulse) * 0.7;
              ctx.setLineDash([]);
              ctx.beginPath(); ctx.arc(0, 0, 24 + pulse * 30, 0, Math.PI * 2); ctx.stroke();
            }
            ctx.restore();
        }

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

        const teammate = netRef.current?.renderedTeammate(time);
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
          const allyShip = netRef.current?.state.opponent?.ship as ShipId | undefined;
          drawShipModel(ctx, allyShip ?? "wing", 1.15);
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

      /**
       * Off-screen awareness. Purely local presentation: it reads world
       * positions the client already knows and sends nothing, and every target
       * goes through the one shared helper so the maths cannot drift apart.
       *
       * Bounds come from the live camera rectangle, so this follows Full Arena,
       * ship-lock and every zoom without touching camera behaviour. The inset
       * is converted out of presentation units into world units, and the marker
       * counter-scales, so markers keep a constant on-screen size and a
       * constant distance from the border at any magnification.
       */
      if (!game.result) {
        /**
         * Every marker is measured against the playfield the pilot can see,
         * not against the whole canvas.
         *
         * On layouts that clip the canvas the two differ, and the difference is
         * the entire bug this exists to prevent: the old bounds ran to the
         * canvas edge, so a left or right marker was placed correctly, drawn
         * correctly, and then discarded by the wrapper's clip, while top and
         * bottom — never clipped, because the canvas is given its wrapper's
         * exact height — worked fine. One rectangle, converted once, feeds
         * visibility, placement and rotation for the Rift, the ally, hazards,
         * PUPs and hostiles alike, so no marker type can drift from another.
         *
         * On every layout that does not clip, this is the camera rectangle to
         * the pixel and nothing about placement changes.
         */
        const playfieldBounds = {
          left: (playfieldBox.left - camX) / camScale,
          top: (playfieldBox.top - camY) / camScale,
          right: (playfieldBox.right - camX) / camScale,
          bottom: (playfieldBox.bottom - camY) / camScale,
        };
        const markerInset = OFFSCREEN_INDICATOR_INSET / camScale;
        const drawOffscreenMarker = (
          indicator: { x: number; y: number; angle: number },
          accent: string,
          ally: boolean,
        ) => {
          ctx.save();
          ctx.translate(indicator.x, indicator.y);
          // Counter-scaling out of the camera keeps the marker the same size
          // whether the pilot is in Full Arena or the closest zoom.
          ctx.scale(1 / camScale, 1 / camScale);
          ctx.rotate(indicator.angle);
          ctx.globalAlpha = 0.85;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          if (profile.shadows) { ctx.shadowColor = accent; ctx.shadowBlur = 7; }
          // An identity mark behind the chevron, on the marker's own axis: the
          // rift keeps its flattened ring, the ally gets swept hull bars, so
          // the two never read as each other.
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          if (ally) {
            ctx.moveTo(-3, -9);
            ctx.lineTo(-12, -4);
            ctx.moveTo(-3, 9);
            ctx.lineTo(-12, 4);
          } else {
            ctx.ellipse(-6, 0, 8, 4.5, 0, 0, Math.PI * 2);
          }
          ctx.stroke();
          ctx.fillStyle = `${accent}59`;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(13, 0);
          ctx.lineTo(0, -8);
          ctx.lineTo(3, 0);
          ctx.lineTo(0, 8);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        };

        /**
         * A loose PUP's marker: its class silhouette in its class colour, with
         * a small arrowhead outside it for the heading.
         *
         * The badge deliberately does not carry the individual weapon glyph or
         * the world PUP's spin. At this size the glyph is mush and a rotating
         * frame fights the arrow for meaning, so the class shape stays upright
         * and stable and only the arrowhead turns. Same footprint as the Rift
         * and ally markers, so one shared radius keeps them all apart.
         */
        const drawOffscreenPupMarker = (
          indicator: { x: number; y: number; angle: number },
          pupClass: PupClass,
        ) => {
          const accent = pupFrameColor(pupClass);
          ctx.save();
          ctx.translate(indicator.x, indicator.y);
          ctx.scale(1 / camScale, 1 / camScale);
          ctx.globalAlpha = 0.85;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          if (profile.shadows) { ctx.shadowColor = accent; ctx.shadowBlur = 7; }
          ctx.save();
          ctx.rotate(indicator.angle);
          ctx.fillStyle = `${accent}59`;
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(14, 0);
          ctx.lineTo(7, -5.5);
          ctx.lineTo(7, 5.5);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          // Upright: the class silhouette is an identity, not a heading.
          ctx.fillStyle = `${accent}3d`;
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.8;
          drawPupFrame(ctx, pupClass, 6.5, 0);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        };

        /**
         * A major hazard's marker: the same compact footprint as every other
         * marker, but wearing an alarm-red warning triangle instead of the
         * hostile threat star, with a heavier outline and a slow pulse.
         *
         * Three things separate it from the ordinary hostile badge, and all
         * three are legible at marker size: the hue is alarm red rather than
         * hazard orange, the silhouette is a warning triangle rather than a
         * four-point star, and the outline is drawn twice — once wide and
         * translucent as a halo, once tight — so the badge carries visible
         * weight without growing. The bang inside it is painted in the
         * hazard's own kind colour, read from the same table its hull is drawn
         * from, so CORE BOMB and SWEEP BEAM stay distinguishable from each
         * other the way ordinary hostiles already are.
         *
         * The chevron outside stays exactly the hostile chevron, in the new
         * colour: heading is heading, and the pilot should not have to relearn
         * which end of the marker points at the thing.
         *
         * The pulse rides the badge's alpha only — nothing grows, nothing
         * moves, and the screen is untouched — and it flattens to a steady
         * bright badge when the pilot has asked for reduced motion, so the
         * warning never depends on the animation to be readable.
         */
        const drawOffscreenHazardMarker = (
          indicator: { x: number; y: number; angle: number },
          kind: PowerId,
          urgent: boolean,
        ) => {
          const accent = OFFSCREEN_HAZARD_ACCENT;
          const pulse = reducedMotionRef.current
            ? 1
            : urgent
              ? 0.82 + 0.18 * Math.sin(time * 0.012)
              : 0.86 + 0.14 * Math.sin(time * 0.006);
          ctx.save();
          ctx.translate(indicator.x, indicator.y);
          ctx.scale(1 / camScale, 1 / camScale);
          ctx.globalAlpha = (urgent ? 0.98 : 0.86) * pulse;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          if (profile.shadows) { ctx.shadowColor = accent; ctx.shadowBlur = 9; }
          ctx.save();
          ctx.rotate(indicator.angle);
          ctx.strokeStyle = accent;
          ctx.lineWidth = 2.1;
          ctx.beginPath();
          ctx.moveTo(8, -5.5);
          ctx.lineTo(13.5, 0);
          ctx.lineTo(8, 5.5);
          ctx.stroke();
          ctx.restore();
          // Upright: the warning triangle is an identity, not a heading.
          ctx.beginPath();
          ctx.moveTo(0, -8.4);
          ctx.lineTo(7.6, 5.4);
          ctx.lineTo(-7.6, 5.4);
          ctx.closePath();
          // Wide translucent pass first, then the tight one over it: a heavier
          // outline than any other marker carries, at the same footprint.
          ctx.strokeStyle = `${accent}5c`;
          ctx.lineWidth = 4.4;
          ctx.stroke();
          ctx.fillStyle = `${accent}40`;
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.8;
          ctx.fill();
          ctx.stroke();
          // The bang, in the hazard's own kind colour.
          ctx.strokeStyle = POWER_COLORS[kind];
          ctx.fillStyle = POWER_COLORS[kind];
          ctx.lineWidth = 1.9;
          ctx.beginPath();
          ctx.moveTo(0, -4.2);
          ctx.lineTo(0, 0.6);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 3.1, 1.15, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        };

        /**
         * A hostile's marker: one consistent threat badge in hazard orange,
         * carrying that hostile's own kind colour at its core, with a small
         * open chevron outside it for the heading.
         *
         * Deliberately not the hostile's weapon glyph. Those silhouettes
         * collapse into mush at badge scale, and a glyph on the edge is
         * already how a loose PUP announces itself — a hostile wearing one
         * would read as something to fly toward and collect. So the shape says
         * THREAT and the colour says which threat, which is the pair that
         * survives being small.
         *
         * Same footprint as the Rift, ally and PUP markers, so one shared
         * radius keeps every marker apart from every other.
         */
        const drawOffscreenEnemyMarker = (
          indicator: { x: number; y: number; angle: number },
          kind: PowerId,
        ) => {
          const accent = OFFSCREEN_ENEMY_ACCENT;
          ctx.save();
          ctx.translate(indicator.x, indicator.y);
          ctx.scale(1 / camScale, 1 / camScale);
          ctx.globalAlpha = 0.85;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          if (profile.shadows) { ctx.shadowColor = accent; ctx.shadowBlur = 7; }
          ctx.save();
          ctx.rotate(indicator.angle);
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(8, -5.5);
          ctx.lineTo(13.5, 0);
          ctx.lineTo(8, 5.5);
          ctx.stroke();
          ctx.restore();
          // Upright: the threat badge is an identity, not a heading.
          ctx.fillStyle = `${accent}3d`;
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          for (let point = 0; point < OFFSCREEN_ENEMY_BADGE.length; point += 1) {
            const spike = OFFSCREEN_ENEMY_BADGE[point];
            if (point === 0) ctx.moveTo(spike.x, spike.y);
            else ctx.lineTo(spike.x, spike.y);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          // The identifying detail, read from the same table the hostile's own
          // hull is drawn from, so the two can never fall out of step.
          ctx.fillStyle = POWER_COLORS[kind];
          ctx.beginPath();
          ctx.arc(0, 0, 2.1, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        };

        const riftBody = { x: game.portalX, y: game.portalY, radius: PORTAL_VISUAL_RADIUS };
        // Co-op only. Solo PvE and Survival have no ally, and a PvP rival is
        // an opponent rather than one, so neither gets this marker.
        const allyTarget = game.mode === "coop" ? netRef.current?.renderedTeammate(time) : null;
        const allyBody = allyTarget
          ? { x: allyTarget.x, y: allyTarget.y, radius: ALLY_VISUAL_RADIUS }
          : null;

        // The HUD rectangles are only worth a layout read when there is
        // actually a marker to keep out from under one, and then only a few
        // times a second. Every target gets the same list and the same
        // footprint, so none can end up under a panel another one avoids.
        let marking = isTargetOffscreen(riftBody, playfieldBounds)
          || (allyBody ? isTargetOffscreen(allyBody, playfieldBounds) : false);
        if (!marking) {
          // Scanned in place, with an early exit: no array is built for this,
          // so the ordinary frame where everything is on screen costs a few
          // comparisons per hostile and nothing else.
          for (const enemy of game.enemies) {
            if (enemy.hp > 0 && isTargetOffscreen(enemy, playfieldBounds)) { marking = true; break; }
          }
        }
        if (marking && time - hudBlocksMeasuredAt >= HUD_BLOCK_REFRESH_MS) {
          hudBlocksMeasuredAt = time;
          measureHudBlocks();
          // Both readings are layout, both are wanted only when a marker is
          // due, and both go stale for the same reasons, so they refresh
          // together rather than on two schedules that could disagree.
          measurePlayfield();
        }
        const safePlacement = {
          blocked: marking
            ? hudBlocks.map((block) => ({
                left: (block.left - camX) / camScale,
                top: (block.top - camY) / camScale,
                right: (block.right - camX) / camScale,
                bottom: (block.bottom - camY) / camScale,
              }))
            : [],
          markerRadius: OFFSCREEN_MARKER_RADIUS / camScale,
          // Counter-scaled like everything else about the marker, so the clamp
          // reserves the same amount of real screen for its body at any zoom.
          markerExtent: OFFSCREEN_MARKER_EXTENT / camScale,
        };

        const riftMarker = offscreenIndicatorFor(riftBody, playfieldBounds, markerInset, safePlacement);
        const allyMarker = allyBody
          ? offscreenIndicatorFor(allyBody, playfieldBounds, markerInset, safePlacement)
          : null;

        /**
         * Major hazards, placed straight after the Rift and the ally and ahead
         * of everything else on the edge.
         *
         * Which hostiles those are is not decided here: the render path asks
         * the one shared classifier, so the arena's idea of "this one is worth
         * an alarm" cannot drift away from the marker's. Today that is the
         * CORE BOMB and the SWEEP BEAM emitter, both of which can reach the
         * pilot from outside the frame.
         *
         * They are placed before the PUPs and the ordinary hostiles precisely
         * so a dense wave cannot push an urgent warning somewhere unreadable:
         * a hazard takes the edge position that actually points at it, and the
         * hostiles that arrive afterwards slide around it. This is the same
         * blocked-region mechanism every other marker already uses — nothing
         * about the geometry is special-cased for hazards.
         *
         * The markers are held and painted after the ordinary hostiles rather
         * than drawn here, so that on the rare frame where a crowded edge
         * leaves nowhere clear, the hazard is the one on top. Nothing is kept
         * between frames: the list is rebuilt from whatever is alive right now,
         * and stays null on the ordinary frame where no hazard is off screen.
         */
        const hazardPlacement = {
          blocked: [
            ...safePlacement.blocked,
            ...(riftMarker ? [markerBlockFor(riftMarker, safePlacement.markerRadius)] : []),
            ...(allyMarker ? [markerBlockFor(allyMarker, safePlacement.markerRadius)] : []),
          ],
          markerRadius: safePlacement.markerRadius,
          markerExtent: safePlacement.markerExtent,
        };
        let hazardMarkers: { marker: OffscreenIndicator; kind: PowerId; urgent: boolean }[] | null = null;
        for (const enemy of game.enemies) {
          if (enemy.hp <= 0 || !isMajorOffscreenHazard(enemy.kind)) continue;
          const marker = offscreenIndicatorFor(enemy, playfieldBounds, markerInset, hazardPlacement);
          if (!marker) continue;
          const urgent = isMajorOffscreenHazardUrgent(enemy);
          (hazardMarkers ??= []).push({ marker, kind: enemy.kind, urgent });
          hazardPlacement.blocked.push(markerBlockFor(marker, hazardPlacement.markerRadius));
        }

        /**
         * Loose PUPs, drawn under the Rift and ally markers because those two
         * are the objective and the teammate and must stay the loudest things
         * on the edge.
         *
         * Nothing is remembered between frames: the list is whatever is loose
         * in the arena right now, so a collected or expired PUP stops producing
         * a marker on the very next draw. The five nearest to the ship are
         * marked, and each one placed becomes a blocked region for the next, so
         * a cluster of PUPs off the same corner spreads along the edge instead
         * of stacking into one smudge. Only the position moves; every marker
         * still points at its own PUP.
         *
         * The blocked list is the one the hazards have been filling, used as-is
         * rather than copied, so a PUP already avoids the HUD panels, the Rift,
         * the ally and every hazard marker.
         */
        const pupPlacement = hazardPlacement;
        const loosePups = nearestOffscreenTargets(
          game.pickups,
          playfieldBounds,
          MAX_OFFSCREEN_PUP_INDICATORS,
          { origin: player, radius: PUP_RADIUS },
        );
        for (const pickup of loosePups) {
          const marker = offscreenIndicatorFor(
            { x: pickup.x, y: pickup.y, radius: PUP_RADIUS },
            playfieldBounds,
            markerInset,
            pupPlacement,
          );
          if (!marker) continue;
          drawOffscreenPupMarker(marker, WEAPONS[pickup.type].pupClass);
          pupPlacement.blocked.push(markerBlockFor(marker, pupPlacement.markerRadius));
        }

        /**
         * Hostiles, placed last and painted under the Rift and ally markers,
         * because those two are the objective and the teammate and must stay
         * the loudest things on the edge.
         *
         * Every live hostile that is not a major hazard is offered a marker.
         * The two loops are exact complements of the one shared classifier, so
         * a hostile is either an alarm or a threat badge and never both: one
         * world entity, at most one marker.
         *
         * There is no cap on them. The point of the marker is that a hostile
         * outside the frame stays detectable, and a limit would silently drop
         * exactly the one about to arrive. A dense wave spreads along the edge
         * instead, because each marker placed becomes a blocked region for the
         * next, the same mechanism the PUPs already use. Only the position
         * slides; every marker still points at its own hostile.
         *
         * Nothing is remembered between frames and no marker state is written
         * back to a hostile: the list is whatever is alive in the arena right
         * now, so a hostile that dies, despawns or comes back into view stops
         * producing a marker on the very next draw.
         *
         * The blocked list is the one the PUPs have been filling, used as-is
         * rather than copied, so a hostile already avoids the HUD panels, the
         * Rift, the ally and every PUP marker without any of that being
         * re-derived per hostile.
         */
        const enemyPlacement = pupPlacement;
        for (const enemy of game.enemies) {
          if (enemy.hp <= 0 || isMajorOffscreenHazard(enemy.kind)) continue;
          // The live hostile is handed straight to the shared helper: it is
          // already { x, y, radius }, so its drawn body decides visibility
          // without a wrapper object per hostile per frame.
          const marker = offscreenIndicatorFor(enemy, playfieldBounds, markerInset, enemyPlacement);
          if (!marker) continue;
          drawOffscreenEnemyMarker(marker, enemy.kind);
          enemyPlacement.blocked.push(markerBlockFor(marker, enemyPlacement.markerRadius));
        }

        if (hazardMarkers) {
          for (const hazard of hazardMarkers) {
            drawOffscreenHazardMarker(hazard.marker, hazard.kind, hazard.urgent);
          }
        }

        if (riftMarker) drawOffscreenMarker(riftMarker, game.enrageActive ? "#ff2a3f" : "#ff4cbe", false);
        if (allyMarker) drawOffscreenMarker(allyMarker, "#b6ff57", true);
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
      const fit = (text: string, maxWidth: number) => {
        if (ctx.measureText(text).width <= maxWidth) return text;
        let clipped = text;
        while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) clipped = clipped.slice(0, -1);
        return `${clipped}…`;
      };

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
        drawRiftLabel(
          ctx,
          cap(portalX, 60, W - 60),
          cap(portalY + 82 * camera.camScale * (W / VIEW_WIDTH), 12, H - 12),
          portalX,
          portalY,
          game.victorySequence > 0 ? victoryVisualState(game.victorySequence, TICK_MS) : null,
          reducedMotionRef.current,
        );
      }

      // Player-hit feedback: a brief red rim, never a full-screen wash. The rim
      // follows the canvas box, so a portrait phone gets the pulse on every
      // edge instead of a square wash that stops partway down the arena.
      const invuln = game.player.invuln;
      if (invuln > 0 && game.player.health > 0 && profile.detail >= 0.35) {
        const strength = cap(invuln / 24, 0, 1) * 0.55;
        const rim = damageVignette(W, H);
        ctx.save();
        ctx.translate(rim.centerX, rim.centerY);
        ctx.scale(rim.scaleX, rim.scaleY);
        const vignette = ctx.createRadialGradient(0, 0, rim.innerRadius, 0, 0, rim.outerRadius);
        vignette.addColorStop(0, "rgba(255,60,90,0)");
        vignette.addColorStop(1, `rgba(255,60,90,${strength})`);
        ctx.fillStyle = vignette;
        ctx.fillRect(-rim.extent / 2, -rim.extent / 2, rim.extent, rim.extent);
        ctx.restore();
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
      const audioGame = gameRef.current;
      const liveHostileBeams = audioGame.running && !audioGame.paused && !audioGame.result
        ? audioGame.enemies.filter((enemy) => enemy.kind === "beam" && enemy.hp > 0 && enemy.age > 45)
        : [];
      getBeamAudio().sync(
        Boolean(audioGame.running && !audioGame.paused && !audioGame.result
          && audioGame.player.health > 0 && audioGame.player.beam && audioGame.player.beamTicks > 0),
        liveHostileBeams.length,
        liveHostileBeams[0]?.phase ?? 0,
      );
      const camera = drawScene(now, profile.detail);
      drawOverlay(now, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      getBeamAudio().stopAll();
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", onDprChange);
      window.removeEventListener("orientationchange", onDprChange);
    };
    // playPupPickupSound is a stable playCue wrapper used only by this loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getBeamAudio, play, playCue, playVictorySuction, stopVictorySuction, sync, viewMode]);

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
      {/* A Rift Run flies with no Special until it earns one. The button has
          to say so: reading READY and accepting the press for an ability that
          does not exist is a promise the ship cannot keep. */}
      <button className="touch-special" type="button" aria-label={hud.specialLocked ? "No special installed. Earn one with an upgrade." : `${hud.specialName}. ${hud.specialCooldown > 0 ? `Ready in ${hud.specialCooldown} seconds.` : "Ready."} Same as keyboard Q.`} disabled={!gameActive || hud.specialLocked || hud.specialCooldown > 0} {...controlProps("KeyQ")}><b>SPEC</b><small>{hud.specialLocked ? "LOCKED" : hud.specialCooldown > 0 ? `${hud.specialCooldown}S` : "READY"}</small></button>
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
      className={`app-shell modern-hud ${touchCapable ? "touch-capable" : ""} compact-menu`}
      data-view-mode={viewMode}
      data-immersive={immersive ? "true" : "false"}
      data-orientation={layout.orientation}
      data-form={layout.form}
      data-sticks={layout.sticks}
      data-preset={layout.preset}
      data-panels={layout.panels}
      data-touch-controls={layout.showTouchControls ? "on" : "off"}
      data-touch-height={settings.touchControlHeight}
      data-touch-profile={settings.touchProfile}
      /* The anchored edge rides on the shell rather than in the variables so the
         stylesheet can switch between left: and right: — a custom property
         cannot select a property name. */
      data-touch-move-edge={touchElementEdge("move", settings.customTouchLayout.handed)}
      data-touch-aim-edge={touchElementEdge("aim", settings.customTouchLayout.handed)}
      style={{
        // Every size the interface uses comes from the one measurement, so
        // CSS never has to guess and cannot disagree with the shell.
        "--arena-size": `${layout.arena}px`,
        "--stick": `${layout.stick}px`,
        // Only meaningful under the Custom profile; M-Sticks ignores them.
        ...customTouchLayoutVariables(settings.customTouchLayout),
        "--touch-base-stick": `${layout.stick}px`,
        "--touch-control-scale": layout.form === "phone"
          ? Math.max(.72, Math.min(layout.orientation === "portrait" ? 1 : .9, layout.usableWidth / (layout.orientation === "portrait" ? 390 : 844)))
          : 1,
        "--usable-h": `${layout.usableHeight}px`,
      } as React.CSSProperties}
    >
      <p className="sr-only" aria-live="polite">{guidance}</p>

      <header className="topbar">
        <div className="brand">
          <div className="brand-lockup">
            <div className="brand-row">
              <img
                className="brand-logo"
                src="/branding/breach_runner_logo.webp"
                alt="Breach Runner"
                width={800}
                height={320}
              />
              <BuildWatermark />
            </div>
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
          {/* Cards are the buttons. Standing "CHANGE SHIP" and "CHANGE MODE"
              controls used to sit next to a mode readout that already looked
              tappable; the readout is the control now, so there is no second
              thing to hunt for. */}
          <div className="mission-summary">
            <button
              type="button"
              className="mission-line-button"
              onClick={() => go("modes")}
              aria-label={`Mode: ${mode === "pvp" ? "PVP 1V1" : mode === "coop" ? "PVE Co-op" : DIFFICULTIES[difficulty].shortName}. Change mode.`}
            >
              <span>MODE</span>
              <b>{mode === "pvp" ? "PVP 1V1" : mode === "coop" ? `PVE CO-OP · ${DIFFICULTIES[difficulty].shortName}` : DIFFICULTIES[difficulty].shortName}</b>
              <em aria-hidden="true">CHANGE</em>
            </button>
          </div>
          <div className="eyebrow">CURRENT SHIP</div>
          <button
            type="button"
            className="selected-ship selected-ship-button"
            onClick={() => go("ships")}
            aria-label={`Current ship: ${currentShip.name}, ${currentShip.role}. Change ship.`}
          >
            <div className="ship-icon" aria-hidden="true"><span className={`ship-glyph ${currentShip.id}`} /></div>
            <div><h2>{currentShip.name}</h2><p>{currentShip.role}</p></div>
            <em className="selected-ship-cta" aria-hidden="true">CHANGE</em>
          </button>
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

        <section
          className="play-column"
          // The whole live play surface owns the secondary mouse button, not
          // just the canvas. Keeping this on the gameplay column covers its
          // HUD and controls while leaving menus and the rest of the page with
          // the browser's normal context menu.
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="match-bar" data-round-id={net?.roundId ?? 0}>
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
                role="img"
                aria-label={`Breach Runner combat arena. Hull ${hud.health} of ${hud.maxHealth}. Rift charge ${hud.portalCharge} percent. Rival integrity ${hud.rivalHealth} percent. ${hud.enrageActive ? "Rift enraged. " : ""}${queued ? `Next power-up ${WEAPONS[queued].name}.` : "Power-up bin empty."}`}
              />
              {viewProfile.modernHud && !settings.compactHud ? <div className="health-rails" aria-label={`Pilot hull ${hud.health} of ${hud.maxHealth}. Shield ${hud.shield ? `${hud.shield} percent${hud.shield < 100 ? ", recharging" : ", ready"}` : "disabled"}. ${mode === "pvp" ? `Opponent hull ${net?.opponentCombat ? Math.round(net.opponentCombat.hull) : "unavailable"}` : `Rival integrity ${hud.rivalCurrentHealth} of ${hud.rivalMaxHealth}`}.`}>
                <div className="health-rail pilot-rail"><span>HULL {hud.health}/{hud.maxHealth}</span><i className="rail-fill hull-fill" style={{ width: `${healthPct}%` }} /><i className="rail-fill shield-fill" style={{ width: `${hud.shield}%` }} /><small>{hud.shield ? `SHIELD ${hud.shield}% ${hud.shield < 100 ? "RECHARGING" : "READY"}` : "SHIELD DISABLED"}</small></div>
                <div className={`health-rail rival-rail ${hud.enrageActive ? "enraged" : ""}`}><span>{mode === "pvp" ? "OPPONENT" : "RIVAL"} {mode === "pvp" ? (net?.opponentCombat ? Math.round(net.opponentCombat.hull) : "—") : `${hud.rivalCurrentHealth}/${hud.rivalMaxHealth}`}</span><i className="rail-fill rival-fill" style={{ width: `${mode === "pvp" ? opponentHullPct : hud.rivalHealth}%` }} /></div>
              </div> : null}
              {/*
                Compact HUD: slim gauges flanking the ship instead of the wide
                rails above the arena. Anchored to the centre of the canvas
                because the follow camera keeps the ship there, and offset far
                enough that nothing overlaps the hull model.

                Rendered for every mode — it is a display preference, not a mode
                feature. The payload frame draws exactly the slots this run has
                earned, so a Rift Run opening on one slot shows one cell and the
                frame grows as capacity is bought. Drawing five and locking four
                showed the pilot four things they could not use.

                The Special sits below the frame and appears only once one is
                installed, because a Rift Run starts without one and there is
                nothing to report until it is earned.
              */}
              {settings.compactHud ? (() => {
                const capacity = Math.max(1, hud.payloadCapacity);
                const compact = pupInventoryLayout(hud.stock, capacity);
                const slots = [...compact.stored, compact.loaded];
                return (
                  <div className="compact-hud" style={{ "--compact-slots": capacity } as React.CSSProperties}>
                    <div
                      className="compact-gauges"
                      role="img"
                      aria-label={hud.shield > 0
                        ? `Hull ${hud.health} of ${hud.maxHealth}. Shield ${hud.shield} percent.`
                        : `Hull ${hud.health} of ${hud.maxHealth}.`}
                    >
                      <span className="compact-gauge compact-hull"><i style={{ height: `${healthPct}%` }} /></span>
                      {/* The shield gauge is drawn only when a shield actually
                          exists on this run. A permanently-empty gauge is dead
                          weight, and a ship without a shield never earns one
                          later — no need to hold space for it. */}
                      {hud.shield > 0 ? <span className="compact-gauge compact-shield"><i style={{ height: `${hud.shield}%` }} /></span> : null}
                    </div>
                    <ol className="compact-pups" aria-label={`${hud.stock.length} of ${hud.payloadCapacity} power-ups stored`}>
                      {slots.map((itemId, index) => {
                        const item = itemId as PickupId | null;
                        const meta = item ? WEAPONS[item] : null;
                        const visual = item ? inventoryPupVisual(item) : null;
                        // The loaded payload is last so it sits nearest the ship.
                        const isLoaded = index === slots.length - 1;
                        return (
                          <li
                            key={index}
                            className={`compact-pup ${meta ? "occupied" : "empty"} ${isLoaded ? "loaded" : ""}`}
                            style={{ "--pup": visual?.color ?? "var(--muted)" } as React.CSSProperties}
                            aria-label={meta ? `${meta.name}${isLoaded ? ", fires next" : ""}` : "Empty slot"}
                          >
                            {meta ? <WeaponIcon id={meta.id} size={18} inventoryFrame /> : <span aria-hidden="true" />}
                          </li>
                        );
                      })}
                    </ol>
                    {hud.specialLocked ? null : (
                      <div
                        className={"compact-special " + (hud.specialCooldown > 0 ? "cooling" : "ready")}
                        role="img"
                        aria-label={hud.specialCooldown > 0
                          ? `${hud.specialName} ready in ${hud.specialCooldown} seconds`
                          : `${hud.specialName} ready`}
                      >
                        <b>SPEC</b>
                        <small>{hud.specialCooldown > 0 ? `${hud.specialCooldown}S` : "READY"}</small>
                      </div>
                    )}
                  </div>
                );
              })() : null}
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
                data-compact={settings.compactHud ? "on" : "off"}
                /* The slot grid sizes itself from the shared ceiling rather than
                   assuming a fixed count, so retuning PUP_INVENTORY_CAPACITY
                   cannot leave the HUD laying out columns that no longer exist. */
                style={{ "--pup-stored-slots": STOCK_LIMIT - 1 } as React.CSSProperties}
                aria-label={queued
                  ? `${hud.stock.length} of ${hud.payloadCapacity} power-ups stored. ${WEAPONS[queued].name} fires next.`
                  : `0 of ${hud.payloadCapacity} power-ups stored.`}
              >
                <ol className="touch-powerup-slots" aria-label="Stored power-ups in loading order">
                  {pupInventoryLayout(hud.stock, STOCK_LIMIT).stored.map((itemId, index) => {
                    const item = itemId as PickupId | null;
                    const meta = item ? WEAPONS[item] : null;
                    const visual = item ? inventoryPupVisual(item) : null;
                    return (
                      <li
                        key={index}
                        className={`touch-powerup-slot ${meta ? "occupied" : "empty"}${index < STOCK_LIMIT - hud.payloadCapacity ? " locked" : ""}`}
                        style={{ "--pup": visual?.color ?? "var(--muted)" } as React.CSSProperties}
                        aria-label={index < STOCK_LIMIT - hud.payloadCapacity ? "Locked slot" : meta ? `${meta.name}${index === STOCK_LIMIT - 2 ? ", loads next" : ""}` : "Empty slot"}
                      >
                        {meta ? (
                          <button type="button" onClick={() => pinSlot(meta.id)} aria-label={`View ${meta.name}`}>
                            <WeaponIcon id={meta.id} size={22} inventoryFrame />
                          </button>
                        ) : <span aria-hidden="true" />}
                      </li>
                    );
                  })}
                </ol>
                {(() => {
                  const loaded = pupInventoryLayout(hud.stock, STOCK_LIMIT).loaded;
                  const meta = loaded ? WEAPONS[loaded] : null;
                  const visual = loaded ? inventoryPupVisual(loaded) : null;
                  return <div className={`touch-powerup-loaded ${meta ? "occupied" : "empty"}`} style={{ "--pup": visual?.color ?? "var(--muted)" } as React.CSSProperties}>
                    <small>LOADED PUP <b>{hud.stock.length}/{hud.payloadCapacity}</b></small>
                    {meta ? <button type="button" onClick={() => pinSlot(meta.id)} aria-label={`View loaded ${meta.name}`}>
                      <WeaponIcon id={meta.id} size={28} inventoryFrame /><strong>{meta.name}</strong>
                    </button> : <span aria-label="No PUP loaded">—</span>}
                  </div>;
                })()}
                {/*
                  Spawn notices live inside the inventory panel rather than
                  beside it, so they inherit its coordinate system: whatever
                  responsive rule moves the inventory — resize, orientation,
                  fullscreen, the touch breakpoints — moves these with it, and
                  the gap between the two stays a single margin.
                */}
                <div className="pup-notice-stack" role="status" aria-live="polite">
                  {hud.spawnNotices.map((plate) => {
                    const meta = WEAPONS[plate.type];
                    const label = plate.kind === "hostile"
                      ? `${meta.short}${plate.count > 1 ? ` ×${plate.count}` : ""}  ${threatBadge(meta)}`
                      : plate.kind === "friendly"
                        ? `${meta.short}  READY`
                        : `${meta.short}  SENT  −${plate.count}`;
                    const accent = plate.kind === "hostile" ? "#ff6a80" : plate.kind === "friendly" ? "#8dffd0" : meta.color;
                    // The plate is unmounted the tick its life runs out, so driving
                    // the fade off that same number keeps the timing the canvas
                    // version always had.
                    return (
                      <p
                        key={plate.id}
                        className={`pup-notice ${plate.kind}`}
                        style={{ "--notice-accent": accent, animationDuration: `${plate.life * TICK_MS}ms` } as React.CSSProperties}
                      >
                        <WeaponIcon id={plate.type} size={18} />
                        <span>{label}</span>
                      </p>
                    );
                  })}
                </div>
              </div>
              <div className="pilot-health">
                <span><em>PILOT HULL</em><b>{hud.health}/{hud.maxHealth}</b></span>
                <div className="meter hull"><i style={{ width: `${healthPct}%` }} /></div>
              </div>
              <DifficultyBadge hud={hud} pending={pendingRules} pendingMode={mode} live={badgeLive} riftRun={riftRun} />
              <i className="reticle tl" aria-hidden="true" /><i className="reticle tr" aria-hidden="true" />
              <i className="reticle bl" aria-hidden="true" /><i className="reticle br" aria-hidden="true" />
              {specialChoicePending ? (
                <div className="rift-upgrade-layer"><section className="rift-upgrade-dialog" data-controller-surface role="dialog" aria-modal="true" aria-label="Select special ability">
                  <header><p>SPECIAL ABILITY INSTALLED</p><h2>CHOOSE YOUR SPECIAL</h2></header>
                  <div className="rift-weapon-options rift-special-options">{RIFT_RUN_SPECIALS.map(option=><button type="button" key={option.shipId} onClick={()=>chooseSpecial(option.shipId)}><small>SPECIAL</small><b>{option.name}</b><span>{option.summary}</span></button>)}</div>
                </section></div>
              ) : hullGunRewardPending && pendingHardpoint ? (
                <div className="rift-upgrade-layer"><section className="rift-upgrade-dialog" data-controller-surface role="dialog" aria-modal="true" aria-label="Select weapon">
                  <header><p>HARDPOINT UNLOCKED · HARDPOINT {pendingHardpoint.index+1}</p><h2>SELECT HULL GUN</h2></header>
                  <div className="rift-weapon-options">{RIFT_WEAPONS.map(weapon=><button type="button" key={weapon.id} onClick={()=>chooseHardpointWeapon(weapon.id)}><small>{rewardCategoryLabel("hull-gun")}</small><b>{weapon.name}</b><span>{weapon.role}</span></button>)}</div>
                </section></div>

              ) : upgradeRoll ? (
                <div className="rift-upgrade-layer"><section className="rift-upgrade-dialog" data-controller-surface role="dialog" aria-modal="true" aria-label="Upgrade available">
                  <header><p>UPGRADE AVAILABLE</p><h2>CHOOSE ONE</h2></header>
                  {/* The eyebrow names the ship system, because the system is
                      what the three cards are competing over. */}
                  <div className="rift-upgrade-options">{upgradeRoll.choices.map(choice=><button type="button" className={choice.kind==="evolution"?"rift-evolution-card":undefined} key={choice.key} onClick={()=>chooseUpgrade(choice)}><small>{RIFT_SYSTEM_LABELS[choice.system]}</small><b>{choice.title}</b><em>{choice.target}</em><span>{choice.description}</span></button>)}</div>
                </section></div>
              ) : null}
              {summary ? (
                <div className="run-summary-layer">
                  <section className="run-summary" data-controller-surface aria-live="polite" aria-label="Run result">
                    {!summary.awaitingInitials ? <button className="run-close" type="button" onClick={() => setSummary(null)} aria-label="Dismiss run summary">✕</button> : null}
                    {/*
                      Two groups, one markup. Everywhere but phone landscape
                      they are `display: contents`, so the card reads as the
                      single column it always has; phone landscape promotes
                      them to real grid items and puts the result beside the
                      continuation controls, which is the only way the whole
                      menu fits a 390px-tall viewport without scrolling.
                    */}
                    <div className="run-report">
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

                      {/*
                        The final event belongs with the result it explains, so it
                        travels in the report group rather than the action group.
                      */}
                      <div className={`death-info ${summary.run.outcome === "victory" ? "victory" : ""}`} role="status">
                        <strong>FINAL EVENT</strong>
                        <span>{finalEventLabel(summary.run)}</span>
                      </div>
                    </div>

                    <div className="run-continue">
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

                      <div className="run-links" aria-label="End game actions">
                        {summary.awaitingInitials ? (
                          <p className="run-links-note" role="status">LOCK SCORE TO CONTINUE</p>
                        ) : null}
                        <button
                          type="button"
                          className="run-action primary"
                          disabled={summary.awaitingInitials || (mode !== "pve" && Boolean(net?.rematch?.you))}
                          onClick={() => {
                            if (summary.replay.kind === "rift-run") start(true, "pve", "easy");
                            else if (summary.replay.kind === "pve" || summary.replay.kind === "survival") start();
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
                    </div>
                  </section>
                </div>
              ) : null}
            </div>
            {!touchCapable ? (
              // Mouse-and-keyboard status row: same three indicators (payload,
              // special, pause), same cooldown text, same click behaviour, no
              // thumbsticks. Sits in the corner of the arena chrome; the CSS
              // scales it down and pins it out of the way of the HUD rails.
              <div className="desktop-utility-rail" aria-label="Payload, special ability, and pause">
                {touchUtility()}
              </div>
            ) : null}
            {touchCapable ? <div className="touch-controls" aria-label="Twin-stick touch controls">
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
            </div> : null}

            <div className="status-dock">
            <div className="vitals">
              <span>HULL <b>{hud.health}/{hud.maxHealth}</b></span>
              <div className="meter hull"><i style={{ width: `${healthPct}%` }} /></div>
              <span>SHIELD <b>{hud.shield}%</b></span>
              <div className="meter shield"><i style={{ width: `${hud.shield}%` }} /></div>
              <span>SPECIAL <b>{hud.specialLocked ? "LOCKED" : hud.specialCooldown > 0 ? `${hud.specialName} ${hud.specialCooldown}S` : `${hud.specialName} READY`}</b></span>
            </div>
            <div className="power-bin">
              <div className="bin-label">
                <span>POWER-UP BIN <b className="bin-count">{hud.stock.length}/{hud.payloadCapacity}</b></span>
                <small>FIRE WITH <b>E</b> / <b>PUP</b></small>
              </div>
              <ul className="bin-slots" aria-label="Power-up bin. The last collected power-up fires first.">
                {/* Only the slots this run has actually earned are drawn. A row of
                    locked cells advertises capacity the pilot cannot use and reads
                    as a fault rather than as progress; one slot means one slot. */}
                {Array.from({ length: Math.max(1, hud.payloadCapacity) }, (_, index) => {
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
                  const visual = inventoryPupVisual(item);
                  const isNext = index === hud.stock.length - 1;
                  const duplicates = stockCounts.get(item) ?? 1;
                  return (
                    <li key={index} className={`slot loaded ${isNext ? "next" : ""}`} style={{ "--pup": visual.color } as React.CSSProperties}>
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
                        <WeaponIcon id={item} size={24} inventoryFrame />
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
            <div><span>RETROS</span><b>{hud.retros > 0 ? `MK ${hud.retros}/${RETRO_MAX_LEVEL}` : "OFFLINE"}</b></div>
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
          renderShip={renderShip}
          running={launched && gameActive}
          onLaunch={beginPlayFlow}
          go={go}
          openSettings={openSettings}
          back={back}
          close={resumeOrClose}
        />
      ) : null}

      {route === "pause" ? (
        <PauseScreen
          // The live run's own mode, not the stored preference: the pause
          // screen must describe the simulation actually running.
          mode={hud.mode}
          pausable={isOfflineMode(hud.mode)}
          // Restart has to restart the run that is actually running. A Rift
          // Run restarted through a bare start() came back as ordinary PvE,
          // because the mode alone cannot tell the two apart.
          onRestart={() => (riftRunRef.current ? start(true, "pve", "easy") : start(false, hud.mode))}
          onQuit={quitRun}
          onEndRunAndChangeShip={() => endRun("ships")}
          onEndRunAndChangeMode={() => endRun("modes")}
          go={go}
          openSettings={openSettings}
          back={back}
          close={resumeOrClose}
        />
      ) : null}

      {route === "modes" ? (
        <GameTypeScreen go={go} openSettings={openSettings} back={back} close={resumeOrClose} />
      ) : null}

      {route === "pvp-modes" ? (
        <PvpModesScreen onSelect={() => { chooseMode("pvp"); setMenu(["modes", "pvp-modes", "lobby"]); }} go={go} openSettings={openSettings} back={back} close={resumeOrClose} />
      ) : null}

      {route === "pve-modes" ? (
        <PveModesScreen onMode={(next) => {
          chooseMode(next);
          if (next === "classic") start(undefined, "classic");
          else setMenu(["modes", "pve-modes", "difficulty"]);
        }} onSurvival={() => { chooseSurvival(); start(undefined, "pve", "survival"); }} onRiftRun={() => go("rift-run")} go={go} openSettings={openSettings} back={back} close={resumeOrClose} />
      ) : null}

      {route === "difficulty" ? (
        <DifficultyScreen ship={shipId} mode={mode === "coop" ? "coop" : "pve"} difficulty={difficulty} progression={progression} onDifficulty={chooseDifficulty} onSelectShip={(id) => { setShipId(id); netRef.current?.chooseShip(id); }} onLaunch={launchFromMenu} renderShip={renderShip} go={go} openSettings={openSettings} back={back} close={resumeOrClose} />
      ) : null}

      {route === "rift-run" ? (
        <RiftRunSetupScreen
          onLaunch={launchRiftRun}
          renderShip={renderShip}
          go={go}
          openSettings={openSettings}
          back={back}
          close={resumeOrClose}
        />
      ) : null}

      {route === "ships" ? (
        <ShipsScreen
          ship={shipId}
          onSelect={(id) => { setShipId(id); netRef.current?.chooseShip(id); }}
          onLaunch={confirmShip}
          renderShip={renderShip}
          go={go}
          openSettings={openSettings}
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
          aimGuide={settings.aimGuide}
          onAimGuide={(next) => setSetting("aimGuide", next)}
          compactHud={settings.compactHud}
          onCompactHud={(next) => setSetting("compactHud", next)}
          touchProfile={settings.touchProfile}
          onTouchProfile={(next) => setSetting("touchProfile", next)}
          onEditTouchLayout={() => setTouchEditorOpen(true)}
          cameraLock={cameraLocked}
          onCameraLock={(next) => setSetting("cameraLock", next)}
          zoom={settings.zoom}
          onZoom={(next) => setSetting("zoom", next)}
          initials={settings.playerInitials}
          onInitials={(next) => setSetting("playerInitials", normalizeInitials(next))}
          go={go}
          openSettings={openSettings}
          back={back}
          close={resumeOrClose}
        />
      ) : null}

      {route === "info" ? (
        <InfoScreen
          viewMode={viewMode}
          onCodex={() => setCodexOpen(true)}
          go={go}
          openSettings={openSettings}
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
      {/* Above the menu: the layout is adjusted over the live arena, and Save
          is the only thing that commits — Close discards the working copy. */}
      {touchEditorOpen ? (
        <TouchLayoutEditor
          layout={settings.customTouchLayout}
          onClose={() => setTouchEditorOpen(false)}
          onSave={(next) => {
            setSetting("customTouchLayout", next);
            setTouchEditorOpen(false);
          }}
        />
      ) : null}
      {codexOpen ? <WeaponCodex onClose={() => setCodexOpen(false)} onOpenSettings={openSettings} reducedMotion={reducedMotion} /> : null}
    </main>
  );
}
