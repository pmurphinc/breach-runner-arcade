"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import {
  CATEGORY_LABELS,
  ENEMY_COUNTS,
  ENEMY_STATS,
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
  DIFFICULTY_ORDER,
  TICK_MS,
  absorbCollisionDamage,
  advanceWormholeAngle,
  createCollisionShield,
  createContactHazard,
  pilotSpawn,
  rulesFor,
  secondsForTicks,
  tickCollisionShield,
  tickContactHazard,
  wormholePosition,
  type CollisionShieldState,
  type ContactHazardState,
  type DifficultyId,
  type DifficultyRules,
  type GameMode,
} from "./difficulty";
import ShipSelect from "./ship-select";
import { SHIP_PROFILES } from "./ship-data";
import { PvpClient, type PvpSnapshot } from "./pvp-client";
import {
  DEFAULT_PRESET,
  PRESET_BLURBS,
  PRESET_LABELS,
  SCREEN_PRESETS,
  budgetFor,
  budgetsEqual,
  readViewport,
  type LayoutBudget,
  type ScreenPreset,
  type TouchControlMode,
} from "./layout-budget";
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
  discordSignInUrl,
  fetchArcadeSession,
  fetchLeaderboard,
  hasSeenDiscordSavePrompt,
  loadLocalBest,
  markDiscordSavePromptSeen,
  saveLocalRun,
  saveScoreToMurph,
  stashPendingRun,
  takePendingRun,
  type ArcadePlayer,
  type LeaderboardEntry,
  type LocalBest,
  type RunResult,
} from "./arcade-scores";

const BOARD = 655;
const WORLD_SIZE = 940;
const PORTAL_THRESHOLD = 150;
const DEG = Math.PI / 180;
const THRUST_ACCEL_BONUS = 0.035;
const THRUST_SPEED_BONUS = 0.25;
const STOCK_LIMIT = 5;
const ticksForSeconds = (seconds: number) => Math.round(seconds * 1000 / TICK_MS);
const wholeSecondsForTicks = (ticks: number) => Math.max(0, Math.ceil(ticks * TICK_MS / 1000));
/** More than two nameplates at once is noise, not information. */
const MAX_NAMEPLATES = 2;

type Bullet = { x: number; y: number; vx: number; vy: number; damage: number; life: number; enemy: boolean; color: string };
type Pickup = { x: number; y: number; vx: number; vy: number; type: PickupId; life: number; phase: number };
type PowerShot = { x: number; y: number; vx: number; vy: number; type: PowerId; life: number };
type Particle = { x: number; y: number; vx: number; vy: number; color: string; size: number; life: number; maxLife: number };
type StickPosition = { active: boolean; x: number; y: number };
type StickKind = "move" | "aim";
type SpawnKind = "hostile" | "friendly" | "transmit";
/** Short, non-blocking portal animation announcing what just came through. */
type SpawnFx = { x: number; y: number; type: PickupId; kind: SpawnKind; age: number; life: number; count: number };

type QualityMode = "auto" | "high" | "performance";
type LayoutPref = "auto" | "game" | "desktop";

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
  armed?: boolean;
  countdown?: number;
  blastRadius?: number;
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
  /** Ticks remaining on the Flagship's continuous attraction/repulsion field. */
  flagshipField: number;
  flashMode: "tank" | "squid";
};

type Game = {
  worldSize: number;
  ship: ShipSpec;
  /** Rules in force for this run. Read by the loop; never re-derived from an id. */
  rules: DifficultyRules;
  mode: GameMode;
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
  /** Hard Mode wormhole enrage, activated once at the configured integrity threshold. */
  enrageActive: boolean;
  /** Ticks until the next automatic mixed enrage wave. */
  enrageTimer: number;
  bullets: Bullet[];
  pickups: Pickup[];
  enemies: Enemy[];
  powers: PowerShot[];
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
  /** Normalized rival integrity percentage for UI and saved-run compatibility. */
  rivalHealth: number;
  rivalCurrentHealth: number;
  rivalMaxHealth: number;
  portalCharge: number;
  stock: PowerId[];
  running: boolean;
  paused: boolean;
  result: Game["result"];
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
  if (game.stock.length > 0) return `AIM AT THE WORMHOLE // PRESS E OR PUP TO SEND ${WEAPONS[game.stock[game.stock.length - 1]].short}`;
  if (game.pickups.length > 0) return "POWER-UP LOOSE // FLY OVER IT TO COLLECT";
  const remaining = Math.max(0, PORTAL_THRESHOLD - game.portalCharge);
  return `SHOOT THE WORMHOLE // ${Math.ceil(remaining)} MORE DAMAGE GENERATES A POWER-UP`;
}

function createGame(ship: ShipSpec, mode: GameMode = "pve", difficulty: DifficultyId = "difficult"): Game {
  const rules = rulesFor(mode, difficulty);
  const spawn = pilotSpawn(rules, WORLD_SIZE);
  const wormhole = wormholePosition(rules, WORLD_SIZE, 0);
  return {
    worldSize: WORLD_SIZE,
    ship,
    rules,
    mode,
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
      flagshipField: 0,
      flashMode: "tank",
    },
    portalAngle: 0,
    portalCharge: 0,
    portalX: wormhole.x,
    portalY: wormhole.y,
    portalPulse: 0,
    enrageActive: false,
    enrageTimer: 0,
    bullets: [],
    pickups: [],
    enemies: [],
    powers: [],
    particles: [],
    spawns: [],
    stock: [],
    score: 0,
    rivalHealth: rules.rivalIntegrity,
    rivalMaxHealth: rules.rivalIntegrity,
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
    rivalHealth: Math.max(0, Math.round((game.rivalHealth / game.rivalMaxHealth) * 100)),
    rivalCurrentHealth: Math.max(0, Math.round(game.rivalHealth)),
    rivalMaxHealth: game.rivalMaxHealth,
    portalCharge: Math.round((game.portalCharge / PORTAL_THRESHOLD) * 100),
    stock: [...game.stock],
    running: game.running,
    paused: game.paused,
    result: game.result,
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
    const defensive: PickupId[] = ["gun", "thrust", "retros", "shield", "clear", "health"];
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
          ? "ACTIVATE — KEYBOARD E · TOUCH PUP. Aim at the rival wormhole before firing."
          : "ACTIVATE — no key needed. Fly over the pickup and it applies at once."}
      </p>
    </div>
  );
}

const CODEX_ORDER: PickupId[] = [...SENDABLE_POWERUPS, "gun", "thrust", "retros", "shield", "clear", "health"];

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
    <div className="codex-backdrop" role="presentation" onClick={onClose}>
      <div
        className="codex"
        role="dialog"
        aria-modal="true"
        aria-labelledby="codex-heading"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="codex-head">
          <h2 id="codex-heading">WEAPON CODEX</h2>
          <p>Every power-up the wormhole can produce. Select one to read what it does.</p>
          <button ref={closeRef} type="button" className="codex-close" onClick={onClose} aria-label="Close weapon codex">✕</button>
        </div>
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
    </div>
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
};

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; rank: number | null; bestScore: number }
  | { status: "error"; message: string };

/**
 * Global board, read on open so it is never fetched for players who never
 * ask for it. A failed read is reported in place — the leaderboard is a bonus,
 * never a dependency of the game.
 */
function Leaderboard({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [best, setBest] = useState<LocalBest | null>(null);
  const [failed, setFailed] = useState(false);
  const [boardLimit, setBoardLimit] = useState(10);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const localBest = loadLocalBest();
    setEntries(null);
    setFailed(false);
    void fetchLeaderboard(boardLimit).then((rows) => {
      if (cancelled) return;
      setBest(localBest);
      if (rows) setEntries(rows); else setFailed(true);
    });
    return () => { cancelled = true; };
  }, [boardLimit]);

  return (
    <div className="codex-backdrop" role="presentation" onClick={onClose}>
      <div
        className="codex board"
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-heading"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="codex-head">
          <h2 id="board-heading">GLOBAL BOARD</h2>
          <p>Best run per signed-in pilot. Guest scores stay on your own device.</p>
          <button ref={closeRef} type="button" className="codex-close" onClick={onClose} aria-label="Close leaderboard">✕</button>
        </div>
        <div className="board-body">
          {failed ? <p className="board-note">Murph Tournaments could not be reached. Your scores are safe on this device.</p> : null}
          {!failed && entries === null ? <p className="board-note">Loading the board…</p> : null}
          {entries !== null && entries.length === 0 ? <p className="board-note">No saved runs yet. Sign in after a run to put the first score up.</p> : null}
          {entries !== null && entries.length > 0 ? (
            <ol className="board-list">
              {entries.map((entry) => (
                <li key={`${entry.rank}-${entry.displayName}`}>
                  <span className="board-rank">{entry.rank}</span>
                  <span className="board-name">{entry.displayName}</span>
                  <span className="board-runs">{entry.runs} {entry.runs === 1 ? "RUN" : "RUNS"}</span>
                  <b>{entry.bestScore.toLocaleString()}</b>
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
          {entries !== null && boardLimit === 10 && entries.length >= 10 ? (
            <button className="board-link" type="button" onClick={() => setBoardLimit(100)}>
              LOAD FULL BOARD →
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * A remembered choice, backed by localStorage and read through
 * `useSyncExternalStore`.
 *
 * The store shape matters here: the page is server-rendered, so reading
 * localStorage during render would hydrate with a different value than the
 * server sent. `getServerSnapshot` hands React the default for the server pass
 * and `getSnapshot` supplies the stored value on the client, which is exactly
 * the mismatch this hook exists to resolve. A blocked or empty store is not an
 * error — the default simply stands.
 */
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
const touchControlPreference = createPreference<TouchControlMode>(
  "wormhole-arcade:touch-controls",
  ["auto", "show", "hide"],
  "auto"
);
const stickSizePreference = createPreference<StickSizeName>(
  "wormhole-arcade:stick-size",
  ["small", "medium", "large"],
  "medium"
);
/** The ship the player last confirmed, pre-highlighted on the next visit. */
const shipPreference = createPreference<ShipId>(
  "wormhole-arcade:ship",
  SHIPS.map((ship) => ship.id),
  "wing"
);

const modePreference = createPreference<GameMode>(
  "wormhole-arcade:mode",
  ["pve", "pvp"],
  "pve"
);
/** Only the PvE difficulty is remembered; PvP is always Easy rules. */
const difficultyPreference = createPreference<DifficultyId>(
  "wormhole-arcade:difficulty",
  DIFFICULTY_ORDER,
  "difficult"
);

/**
 * A segmented control that is genuinely operable by keyboard, mouse and touch.
 *
 * Implemented as an ARIA radiogroup with roving tabindex: one stop in the tab
 * order, arrow keys move between options, Home/End jump to the ends. Buttons
 * carry a real touch target so the same markup serves a phone.
 */
function SegmentedChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className = "",
}: {
  label: string;
  value: T;
  options: readonly { id: T; label: string; hint?: string }[];
  onChange: (next: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  const move = (delta: number) => {
    const index = options.findIndex((option) => option.id === value);
    const next = options[(index + delta + options.length) % options.length];
    if (next) onChange(next.id);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); move(1); }
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); move(-1); }
    else if (event.key === "Home") { event.preventDefault(); onChange(options[0].id); }
    else if (event.key === "End") { event.preventDefault(); onChange(options[options.length - 1].id); }
  };

  return (
    <div className={`segmented ${className}`}>
      <span className="segmented-label" id={`seg-${label.replace(/\W+/g, "-").toLowerCase()}`}>{label}</span>
      <div
        className="segmented-options"
        role="radiogroup"
        aria-labelledby={`seg-${label.replace(/\W+/g, "-").toLowerCase()}`}
        onKeyDown={onKeyDown}
      >
        {options.map((option) => {
          const active = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              disabled={disabled}
              className={active ? "active" : ""}
              onClick={() => onChange(option.id)}
            >
              <b>{option.label}</b>
              {option.hint ? <small>{option.hint}</small> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}


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
  const pendingShield = pending.collisionShield.enabled;
  const wormhole = live
    ? hud.wormholeState
    : pending.wormhole.kind === "locked"
      ? "LOCKED"
      : "MOVING";
  const hazardArmed = live ? hud.contactHazard : pending.contactHazard.enabled;
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

  return (
    <div className={`difficulty-badge ${contactActive ? "hazard" : ""}`}>
      <b className="badge-mode">
        {(live ? hud.mode : pendingMode) === "pvp" ? "PVP // EASY RULES" : pending.shortName}
      </b>
      <span><em>WORMHOLE</em><i>{wormhole}</i></span>
      <span className={charge !== null && charge <= 0 ? "warn" : ""}>
        <em>SHIELD</em><i>{shield}</i>
      </span>
      <span className={contactActive ? "warn" : ""}>
        <em>CONTACT</em><i>{hazardArmed ? (contactActive ? "ACTIVE" : "ARMED") : "OFF"}</i>
      </span>
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="lobby-heading"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="codex-head">
          <h2 id="lobby-heading">MULTIPLAYER LOBBY</h2>
          <p>Real-time 1v1 under Easy rules. No sign-in — guests get a callsign.</p>
          <button ref={closeRef} type="button" className="codex-close" onClick={onClose} aria-label="Close lobby">✕</button>
        </div>

        <div className="lobby-body">
          {net?.opponent ? (
            <div className="lobby-match">
              <p className="lobby-status" aria-live="polite">
                {net.phase === "countdown"
                  ? `LAUNCHING IN ${Math.ceil(net.countdownMs / 1000)}…`
                  : "OPPONENT FOUND — CHOOSE YOUR SHIP"}
              </p>
              <div className="lobby-versus">
                <div>
                  <span>YOU</span>
                  <b>{net.name}</b>
                  <small>{net.you?.ship?.toUpperCase() ?? "—"}</small>
                  <i className={net.you?.ready ? "ok" : ""}>{net.you?.ready ? "READY" : "NOT READY"}</i>
                </div>
                <em aria-hidden="true">VS</em>
                <div>
                  <span>OPPONENT</span>
                  <b>{net.opponent.name}</b>
                  <small>{net.opponent.ship.toUpperCase()}</small>
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
          INCOMING {fresh.weapon.toUpperCase()} FROM {fresh.from}
        </p>
      ) : null}
    </div>
  );
}

/** One line describing a difficulty, derived from its rules rather than typed. */
function difficultyHint(id: DifficultyId) {
  const rules = DIFFICULTIES[id];
  if (rules.wormhole.kind === "locked") return "WORMHOLE LOCKED";
  const parts = ["MOVING"];
  if (rules.contactHazard.enabled) parts.push("CONTACT");
  if (rules.wormholeEnrage.enabled) {
    parts.push(`ENRAGE ${Math.round(rules.wormholeEnrage.thresholdFraction * 100)}%`);
  }
  return parts.join(" · ");
}

/**
 * Mission Setup: the one place PvE/PvP and difficulty are chosen before a
 * launch. The menu only ever summarises these and offers a way back here, so
 * the same setting never appears as two independently interactive copies.
 */
function MissionSetup({
  ship,
  mode,
  difficulty,
  onMode,
  onDifficulty,
  onChangeShip,
  onLaunch,
  onOpenLobby,
  net,
}: {
  ship: ShipId;
  mode: GameMode;
  difficulty: DifficultyId;
  onMode: (next: GameMode) => void;
  onDifficulty: (next: DifficultyId) => void;
  onChangeShip: () => void;
  onLaunch: () => void;
  onOpenLobby: () => void;
  net: PvpSnapshot | null;
}) {
  const profile = SHIP_PROFILES[ship];
  const rules = rulesFor(mode, difficulty);
  const [moreInfo, setMoreInfo] = useState(false);

  return (
    <section className="mission-setup">
      <div className="setup-head">
        <p className="select-pilot">MISSION SETUP</p>
        <h2>CHOOSE YOUR MISSION</h2>
      </div>

      <div className="setup-ship">
        <div>
          <span>YOUR SHIP</span>
          <b>{profile.name}</b>
          <small>{profile.role} · {profile.experience}</small>
        </div>
        <button type="button" onClick={onChangeShip}>CHANGE SHIP</button>
      </div>

      <SegmentedChoice
        label="GAME MODE"
        value={mode}
        options={[
          { id: "pve", label: "PVE" },
          { id: "pvp", label: "PVP 1V1" },
        ] as const}
        onChange={onMode}
      />

      {mode === "pve" ? (
        <>
          <SegmentedChoice
            label="DIFFICULTY"
            className="stacked"
            value={difficulty}
            options={DIFFICULTY_ORDER.map((id) => ({
              id,
              label: DIFFICULTIES[id].shortName,
              hint: difficultyHint(id),
            }))}
            onChange={onDifficulty}
          />
          <p className="setup-summary">
            {rules.wormhole.kind === "locked" ? "Wormhole locked centre" : "Wormhole moves"}
            {" · "}
            {rules.collisionShield.enabled ? "collision shield" : "no collision shield"}
            {" · "}
            {rules.contactHazard.enabled ? "contact hazard" : "contact harmless"}
            <button type="button" className="more-info" onClick={() => setMoreInfo((v) => !v)} aria-expanded={moreInfo}>
              {moreInfo ? "LESS" : "MORE INFO"}
            </button>
          </p>
          {moreInfo ? <p className="setup-blurb">{rules.blurb}</p> : null}
          <button type="button" className="setup-launch" onClick={onLaunch}>LAUNCH MISSION</button>
        </>
      ) : (
        <>
          <p className="setup-summary">
            Real-time 1v1 under Easy rules. No sign-in — guests get a callsign.
            {net?.name ? ` You are ${net.name}.` : ""}
          </p>
          <button type="button" className="setup-launch" onClick={onOpenLobby}>
            OPEN MULTIPLAYER LOBBY
          </button>
        </>
      )}
    </section>
  );
}

/**
 * Settings drawer.
 *
 * Replaces the tall flat dropdown. A right-side sheet with a sticky header
 * and a sticky primary action, an independently scrolling body, a focus trap,
 * Escape to close and focus restored to whatever opened it — so it never
 * depends on the page scrolling and never loses the keyboard.
 *
 * It deliberately does not contain the ship grid or a second copy of the
 * mode and difficulty controls: it summarises what is chosen and offers a way
 * back to the surface that owns the choice.
 */
function SettingsDrawer({
  open, onClose, ship, mode, difficulty, gameActive, stage,
  preset, onPreset, cameraLocked, onCamera, quality, autoLabel, onQuality,
  layoutPref, onLayoutPref, fullscreen, onFullscreen, sound, onSound,
  touchControls, onTouchControls, stickSize, onStickSize,
  onChangeShip, onChangeMode, onRunAgain, onCodex, onBoard, onLobby,
}: {
  open: boolean;
  onClose: () => void;
  ship: ShipId;
  mode: GameMode;
  difficulty: DifficultyId;
  gameActive: boolean;
  stage: "select" | "setup" | "arena";
  preset: ScreenPreset;
  onPreset: (next: ScreenPreset) => void;
  cameraLocked: boolean;
  onCamera: (next: boolean) => void;
  quality: QualityMode;
  autoLabel: string;
  onQuality: (next: QualityMode) => void;
  layoutPref: LayoutPref;
  onLayoutPref: (next: LayoutPref) => void;
  fullscreen: boolean;
  onFullscreen: () => void;
  sound: boolean;
  onSound: (next: boolean) => void;
  touchControls: TouchControlMode;
  onTouchControls: (next: TouchControlMode) => void;
  stickSize: StickSizeName;
  onStickSize: (next: StickSizeName) => void;
  onChangeShip: () => void;
  onChangeMode: () => void;
  onRunAgain: () => void;
  onCodex: () => void;
  onBoard: () => void;
  onLobby: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const profile = SHIP_PROFILES[ship];
  const rules = rulesFor(mode, difficulty);

  useEffect(() => {
    if (!open) return;
    // Remember what opened the drawer so focus can go back there on close.
    restoreRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const restore = restoreRef.current;
    return () => { restore?.focus?.(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); return; }
      if (event.key !== "Tab") return;
      // Focus trap: Tab cycles inside the drawer rather than escaping to the
      // page behind it.
      const candidates = panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]"
      );
      // The segmented controls use a roving tabindex, so many of their buttons
      // carry tabindex="-1" and are not actually tabbable. Including them made
      // the guarded "last" element the wrong one, and Tab escaped the drawer.
      const focusable = [...(candidates ?? [])].filter(
        (element) => element.tabIndex >= 0 && element.offsetParent !== null
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, open]);

  if (!open) return null;

  const modeSummary = mode === "pvp" ? "PVP 1V1" : DIFFICULTIES[difficulty].shortName;

  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <div
        className="settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-head">
          <h2 id="drawer-title">MENU</h2>
          <button ref={closeRef} type="button" className="drawer-close" onClick={onClose} aria-label="Close menu">✕</button>
        </header>

        <div className="drawer-body">
          <section>
            <h3>Play</h3>
            <div className="drawer-summary">
              <p><span>Ship</span><b>{profile.name}</b></p>
              <p><span>Mode</span><b>{modeSummary}</b></p>
              {mode === "pve" ? (
                <p className="drawer-note">
                  {rules.wormhole.kind === "locked" ? "Wormhole locked centre" : "Wormhole moves"}
                  {rules.collisionShield.enabled ? " · collision shield" : ""}
                  {rules.contactHazard.enabled ? " · contact hazard" : ""}
                </p>
              ) : null}
            </div>
            <div className="drawer-actions">
              <button type="button" onClick={onChangeShip}>CHANGE SHIP</button>
              <button type="button" onClick={onChangeMode}>CHANGE MODE</button>
              {stage === "arena" ? <button type="button" onClick={onRunAgain}>{gameActive ? "RESTART" : "RUN AGAIN"}</button> : null}
              {mode === "pvp" ? <button type="button" onClick={onLobby}>MULTIPLAYER LOBBY</button> : null}
            </div>
          </section>

          <section>
            <h3>Display</h3>
            <SegmentedChoice
              label="SCREEN FIT"
              className="stacked"
              value={preset}
              options={SCREEN_PRESETS.map((id) => ({ id, label: PRESET_LABELS[id].toUpperCase(), hint: PRESET_BLURBS[id] }))}
              onChange={onPreset}
            />
            <SegmentedChoice
              label="CAMERA"
              value={cameraLocked ? "ship" : "arena"}
              options={[{ id: "ship", label: "SHIP LOCK" }, { id: "arena", label: "ARENA" }] as const}
              onChange={(next) => onCamera(next === "ship")}
            />
            <SegmentedChoice
              label="RENDER QUALITY"
              value={quality}
              options={[
                { id: "auto", label: "AUTO", hint: autoLabel },
                { id: "high", label: "HIGH" },
                { id: "performance", label: "PERF" },
              ] as const}
              onChange={onQuality}
            />
            <SegmentedChoice
              label="SHELL"
              value={layoutPref}
              options={[
                { id: "auto", label: "AUTO" },
                { id: "game", label: "GAME" },
                { id: "desktop", label: "DESKTOP" },
              ] as const}
              onChange={onLayoutPref}
            />
            <button type="button" className="drawer-wide" aria-pressed={fullscreen} onClick={onFullscreen}>
              {fullscreen ? "EXIT FULLSCREEN" : "FULLSCREEN"}
            </button>
          </section>

          <section>
            <h3>Controls &amp; Audio</h3>
            <SegmentedChoice
              label="SOUND"
              value={sound ? "on" : "off"}
              options={[{ id: "on", label: "ON" }, { id: "off", label: "OFF" }] as const}
              onChange={(next) => onSound(next === "on")}
            />
            <SegmentedChoice
              label="TOUCH CONTROLS"
              value={touchControls}
              options={[
                { id: "auto", label: "AUTO" },
                { id: "show", label: "SHOW" },
                { id: "hide", label: "HIDE" },
              ] as const}
              onChange={onTouchControls}
            />
            <SegmentedChoice
              label="TOUCH CONTROL SIZE"
              value={stickSize}
              options={[
                { id: "small", label: "SMALL" },
                { id: "medium", label: "MEDIUM" },
                { id: "large", label: "LARGE" },
              ] as const}
              onChange={onStickSize}
            />
            <dl className="drawer-keys">
              <div><dt>Move</dt><dd>W A S D or arrows</dd></div>
              <div><dt>Pulse cannon</dt><dd>Space</dd></div>
              <div><dt>Power-up</dt><dd>E · touch PUP</dd></div>
              <div><dt>Ship special</dt><dd>Q · touch SPEC</dd></div>
              <div><dt>Menu / pause</dt><dd>P</dd></div>
            </dl>
          </section>

          <section>
            <h3>Game Information</h3>
            <div className="drawer-actions">
              <button type="button" onClick={onCodex} aria-haspopup="dialog">WEAPON CODEX</button>
              <button type="button" onClick={onBoard} aria-haspopup="dialog">LEADERBOARD</button>
              <button type="button" onClick={onChangeShip}>VIEW ALL SHIPS</button>
              <a className="drawer-link" href={MURPH_SITE_URL} target="_blank" rel="noopener noreferrer">
                MURPH TOURNAMENTS ↗
              </a>
            </div>
          </section>
        </div>

        <footer className="drawer-foot">
          <button type="button" className="drawer-primary" onClick={onClose}>
            {stage === "arena" ? "BACK TO THE ARENA" : "BACK"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default function WormholeGame() {
  const shellRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const topActionsRef = useRef<HTMLDivElement>(null);
  const moveStickRef = useRef<HTMLDivElement>(null);
  const aimStickRef = useRef<HTMLDivElement>(null);
  const moveStickPointer = useRef<number | null>(null);
  const aimStickPointer = useRef<number | null>(null);
  const moveHeading = useRef<number | null>(null);
  const aimHeading = useRef<number | null>(null);
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
  const [sound, setSound] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [layoutPref, setLayoutPref] = useState<LayoutPref>("auto");
  const [menuOpen, setMenuOpen] = useState(false);
  const [cameraLocked, setCameraLocked] = useState(true);
  const screenPreset = useSyncExternalStore(
    presetPreference.subscribe,
    presetPreference.get,
    presetPreference.getServer
  );
  const touchControlMode = useSyncExternalStore(
    touchControlPreference.subscribe,
    touchControlPreference.get,
    touchControlPreference.getServer
  );
  const stickSizeName = useSyncExternalStore(
    stickSizePreference.subscribe,
    stickSizePreference.get,
    stickSizePreference.getServer
  );
  const [budget, setBudget] = useState<LayoutBudget | null>(null);
  const [quality, setQuality] = useState<QualityMode>("auto");
  const [autoLabel, setAutoLabel] = useState("HIGH");
  const [moveStickPosition, setMoveStickPosition] = useState<StickPosition>({ active: false, x: 0, y: 0 });
  const [aimStickPosition, setAimStickPosition] = useState<StickPosition>({ active: false, x: 0, y: 0 });
  const [inspect, setInspect] = useState<{ id: PickupId; pinned: boolean } | null>(null);
  const [codexOpen, setCodexOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
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
  /**
   * Where the player is before the arena.
   *
   * "select" is the dedicated ship scene and is always where a new browser
   * session starts — the remembered ship pre-highlights, but nothing launches
   * on its own. "setup" is Mission Setup: mode and difficulty. "arena" means
   * the shell is showing the game.
   */
  const [stage, setStage] = useState<"select" | "setup" | "arena">("select");
  const [lobbyOpen, setLobbyOpen] = useState(false);
  const [net, setNet] = useState<PvpSnapshot | null>(null);
  /** Who Murph Tournaments says is playing. Null means guest or unavailable. */
  const [player, setPlayer] = useState<ArcadePlayer | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  /** The one specific result screen allowed to show the Discord invitation. */
  const [discordPromptRun, setDiscordPromptRun] = useState<RunResult | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const reducedMotion = useReducedMotion();

  const soundRef = useRef(true);
  const cameraRef = useRef(true);
  const qualityRef = useRef<QualityMode>("auto");
  const reducedMotionRef = useRef(false);
  /** CSS pixels of arena covered by the HTML HUD strip, for the canvas to skip. */
  const hudInsetRef = useRef(0);
  /**
   * How far down the canvas HUD must start on each side to clear the DOM
   * panels floating over the arena — the rules badge on the left, the PvP HUD
   * on the right. Measured from the real elements rather than hard-coded, so
   * it stays right when their contents or the type scale change.
   */
  const overlayInsetRef = useRef({ left: 0, right: 0 });
  const audioPool = useRef<Map<string, HTMLAudioElement[]>>(new Map());
  /** Epoch ms the current run began, so a finished run can report its length. */
  const runStartedAt = useRef(0);
  /** The outcome already turned into a summary, so each run is recorded once. */
  const recordedResult = useRef<Game["result"]>(null);
  /** The summary object already submitted automatically for the signed-in player. */
  const autoSavedRun = useRef<RunResult | null>(null);
  /** Ship the current run is being flown in, fixed at launch. */
  const runShipName = useRef("");
  /**
   * The live match connection. Held in a ref so the fixed-step loop can read
   * and report without re-subscribing every render.
   */
  const netRef = useRef<PvpClient | null>(null);

  useEffect(() => { soundRef.current = sound; }, [sound]);
  useEffect(() => { cameraRef.current = cameraLocked; }, [cameraLocked]);
  useEffect(() => { qualityRef.current = quality; }, [quality]);
  useEffect(() => { reducedMotionRef.current = reducedMotion; }, [reducedMotion]);

  const gameActive = hud.running && !hud.result;
  // Until the first measurement lands, assume the safest shape rather than a
  // desktop one, so a handheld never flashes a layout it cannot use.
  const layout: LayoutBudget = budget ?? FALLBACK_BUDGET;
  const touchCapable = layout.showTouchControls;
  // Immersive is a property of the hardware, not of the match in progress.
  const immersive = layoutPref === "game" || (layoutPref === "auto" && layout.handheld);

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
      const next = budgetFor(readViewport(touchControlMode, STICK_SIZES[stickSizeName]), screenPreset);
      setBudget((previous) => (previous && budgetsEqual(previous, next) ? previous : next));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();

    coarsePointer.addEventListener?.("change", schedule);
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("orientationchange", schedule, { passive: true });
    window.addEventListener("touchstart", schedule, { passive: true, once: true });
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
      window.removeEventListener("touchstart", schedule);
      document.removeEventListener("fullscreenchange", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [screenPreset, stickSizeName, touchControlMode]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!topActionsRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [menuOpen]);

  useEffect(() => {
    const updateFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  // Page-level gesture suppression is scoped to active touch gameplay so normal
  // scrolling, zooming, and selection stay available everywhere else.
  useEffect(() => {
    hudInsetRef.current = immersive && layout.sticks === "overlay" ? 44 : 0;
  }, [immersive, layout.sticks]);

  // Keep the canvas HUD clear of the panels floating over the arena. Without
  // this the mission notice is drawn underneath the rules badge and only its
  // right-hand end is readable.
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;

    const measure = () => {
      const wrapTop = wrap.getBoundingClientRect().top;
      const clearanceBelow = (selector: string) => {
        const element = wrap.querySelector<HTMLElement>(selector);
        if (!element) return 0;
        const rect = element.getBoundingClientRect();
        if (rect.height === 0) return 0;
        // Eight pixels of breathing room below the panel.
        return Math.max(0, Math.round(rect.bottom - wrapTop) + 8);
      };
      const next = {
        left: clearanceBelow(".difficulty-badge"),
        right: clearanceBelow(".pvp-hud"),
      };
      const current = overlayInsetRef.current;
      if (current.left !== next.left || current.right !== next.right) {
        overlayInsetRef.current = next;
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    for (const selector of [".difficulty-badge", ".pvp-hud"]) {
      const element = wrap.querySelector(selector);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
    // The ResizeObserver covers shape changes; these deps cover a panel
    // appearing or disappearing entirely.
  }, [layout.arena, layout.preset, mode, net?.phase]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("wh-playing", immersive);
    return () => root.classList.remove("wh-playing");
  }, [immersive]);

  useEffect(() => {
    const pool = audioPool.current;
    return () => {
      pool.forEach((clips) => clips.forEach((clip) => { clip.pause(); clip.removeAttribute("src"); clip.load(); }));
      pool.clear();
    };
  }, []);

  /** Pooled playback: three reusable elements per clip instead of one per shot. */
  const play = useCallback((name: "fire" | "explosion" | "magic" | "thrust", volume = 0.22) => {
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
    clip.volume = volume;
    try { clip.currentTime = 0; } catch { /* Safari throws before metadata loads. */ }
    void clip.play().catch(() => undefined);
  }, []);

  const sync = useCallback(() => {
    const next = hudFrom(gameRef.current);
    setHud((previous) => (hudEqual(previous, next) ? previous : next));
  }, []);

  /**
   * Sends a finished run to Murph Tournaments. Only ever called for a player
   * who is already signed in, or who has just signed in for this purpose.
   */
  const saveRun = useCallback(async (run: RunResult) => {
    setSaveState({ status: "saving" });
    const result = await saveScoreToMurph(run);

    if (result.status === "saved") {
      setSaveState({ status: "saved", rank: result.rank, bestScore: result.bestScore });
      setPlayer((current) =>
        current ? { ...current, bestScore: result.bestScore, runs: result.runs, rank: result.rank } : current
      );
      return;
    }

    if (result.status === "signed-out") {
      // The session lapsed between the run and the save. Fall back to the
      // guest path rather than pretending the score went anywhere.
      setPlayer(null);
      setSaveState({ status: "idle" });
      return;
    }

    setSaveState({ status: "error", message: result.message });
  }, []);

  /**
   * Parks the run, sends the player to Discord, and returns them to this exact
   * page. Nothing is lost if they abandon the sign-in — the run is already in
   * this device's local best.
   */
  const signInToSave = useCallback((run: RunResult) => {
    stashPendingRun(run);
    window.location.href = discordSignInUrl(window.location.href);
  }, []);

  // The socket exists only while PvP is the chosen mode. A PvE player never
  // opens one, so single-player is untouched by the match service entirely.
  useEffect(() => {
    if (mode !== "pvp") {
      netRef.current?.disconnect();
      netRef.current = null;
      return;
    }
    const client = new PvpClient();
    netRef.current = client;
    const unsubscribe = client.subscribe(setNet);
    client.connect();
    return () => {
      unsubscribe();
      client.disconnect();
      netRef.current = null;
    };
  }, [mode]);

  const chooseMode = useCallback((next: GameMode) => { modePreference.set(next); }, []);
  const chooseDifficulty = useCallback((next: DifficultyId) => {
    difficultyPreference.set(next);
  }, []);

  // Ask once, on load, who is playing — and finish saving a run that was
  // waiting on a sign-in redirect. Never blocks or delays the game.
  useEffect(() => {
    let cancelled = false;
    const pending = takePendingRun();

    const best = loadLocalBest();

    void fetchArcadeSession().then((session) => {
      if (cancelled) return;
      setPlayer(session?.signedIn ? session.player : null);
      setSessionChecked(true);
      if (!pending || !session?.signedIn) return;
      setSummary({ run: pending, best, isBest: false, runs: 0, restored: true });
    });

    return () => { cancelled = true; };
  }, [saveRun]);

  // A run just ended: record it on this device, then offer or perform the save.
  useEffect(() => {
    if (!hud.result) {
      recordedResult.current = null;
      return;
    }
    if (recordedResult.current === hud.result) return;
    recordedResult.current = hud.result;

    const run: RunResult = {
      score: hud.score,
      outcome: hud.result,
      ship: runShipName.current,
      rivalHealth: hud.rivalHealth,
      durationSeconds: runStartedAt.current
        ? Math.max(0, Math.round((Date.now() - runStartedAt.current) / 1000))
        : 0,
    };

    const local = saveLocalRun(run);
    setSummary({ run, best: local.best, isBest: local.isBest, runs: local.runs, restored: false });
    setSaveState({ status: "idle" });
  }, [hud.result, hud.score, hud.rivalHealth]);

  // Signed-in players always save automatically, including when a run finishes
  // before the initial Murph Tournaments session request returns.
  useEffect(() => {
    if (!player || !summary || autoSavedRun.current === summary.run) return;
    autoSavedRun.current = summary.run;
    void saveRun(summary.run);
  }, [player, saveRun, summary]);

  // Offer Discord sign-in on one completed-run screen per device, never while
  // the session request is still pending (which avoids flashing it to members).
  useEffect(() => {
    if (!sessionChecked || player || !summary || discordPromptRun) return;
    if (hasSeenDiscordSavePrompt()) return;
    markDiscordSavePromptSeen();
    setDiscordPromptRun(summary.run);
  }, [discordPromptRun, player, sessionChecked, summary]);

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
    setBoardOpen(false);
    setSummary(null);
    setSaveState({ status: "idle" });
    runStartedAt.current = Date.now();
    runShipName.current = game.ship.name;
    sync();
    canvasWrapRef.current?.focus({ preventScroll: true });
    setStage("arena");
    play("magic", 0.28);
  }, [difficulty, mode, play, shipId, sync]);

  // The server decides when the match is live. When it says so, launch the
  // local arena; the client never starts a PvP run on its own timing.
  const netPhase = net?.phase ?? null;
  useEffect(() => {
    if (netPhase !== "active") return;
    const game = gameRef.current;
    if (game.mode === "pvp" && game.running && !game.result) return;
    start();
    setLobbyOpen(false);
  }, [netPhase, start]);

  // Hull is reconciled from the server, never trusted from local arithmetic,
  // and only the server's result ends a PvP match.
  const serverHull = net?.yourCombat?.hull ?? null;
  const netResult = net?.result ?? null;
  useEffect(() => {
    const game = gameRef.current;
    if (game.mode !== "pvp" || serverHull === null) return;
    game.player.health = serverHull;
  }, [serverHull]);

  useEffect(() => {
    if (!netResult) return;
    const game = gameRef.current;
    if (game.mode !== "pvp") return;
    game.running = false;
    game.result = netResult.outcome === "victory" ? "victory" : "defeat";
    game.notice =
      netResult.reason === "forfeit"
        ? `${netResult.opponent} DID NOT RETURN`
        : netResult.outcome === "victory"
          ? `${netResult.opponent} DESTROYED`
          : "SHIP DESTROYED";
    game.noticeLife = 180;
  }, [netResult]);

  const togglePause = useCallback(() => {
    const game = gameRef.current;
    if (!game.running || game.result) return;
    if (game.mode === "pvp") {
      // A live match cannot be paused: the opponent keeps playing. P opens the
      // menu instead, and the match visibly continues behind it.
      game.notice = "PVP // MATCH CONTINUES, NO PAUSE";
      game.noticeLife = 90;
      setMenuOpen((value) => !value);
      sync();
      return;
    }
    game.paused = !game.paused;
    game.notice = game.paused ? "SIMULATION PAUSED" : "SYSTEMS ONLINE";
    game.noticeLife = 90;
    sync();
  }, [sync]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await shellRef.current?.requestFullscreen({ navigationUI: "hide" });
    } catch {
      // Fullscreen is a progressive enhancement and may be blocked by the browser.
    }
  }, []);

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
    const screenX = ((event.clientX - rect.left) / rect.width) * BOARD;
    const screenY = ((event.clientY - rect.top) / rect.height) * BOARD;
    const game = gameRef.current;
    const player = game.player;
    const locked = cameraRef.current;
    const camScale = locked ? 1 : BOARD / game.worldSize;
    const camX = locked ? cap(BOARD / 2 - player.x, BOARD - game.worldSize, 0) : 0;
    const camY = locked ? cap(BOARD / 2 - player.y, BOARD - game.worldSize, 0) : 0;
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
      if (code === "Escape") { setInspect(null); setCodexOpen(false); setMenuOpen(false); }
      if (editing || activating) return;
      if (gameKeys.includes(code)) event.preventDefault();
      if (code === "Enter" && (!gameRef.current.running || gameRef.current.result)) start();
      if (code === "KeyP" && !event.repeat) togglePause();
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
  }, [start, togglePause]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let raf = 0;
    let previous = performance.now();
    let accumulator = 0;
    let hudDelay = 0;

    // Rendering geometry. `worldScale` maps the 655-unit arena viewport onto the
    // backing store; `cssScale` maps CSS pixels onto it so HUD text keeps a
    // constant on-screen size no matter how large the arena is drawn.
    let cssWidth = Math.max(1, canvas.getBoundingClientRect().width || BOARD);
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
      setAutoLabel(q >= 0.85 ? "HIGH" : q >= 0.5 ? "BALANCED" : "PERF");
    };
    applyProfile();

    const applyResize = () => {
      needsResize = false;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const target = Math.max(420, Math.min(profile.maxBackingPx, Math.round(cssWidth * dpr)));
      if (canvas.width !== target || canvas.height !== target) {
        canvas.width = target;
        canvas.height = target;
      }
      worldScale = target / BOARD;
      cssScale = target / cssWidth;
    };

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0 && Math.abs(width - cssWidth) > 0.5) {
        cssWidth = width;
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
      player.health -= amount;
      if (game.mode === "pvp") {
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
    const report = (game: Game, source: "collision" | "impact", amount: number) => {
      if (game.mode === "pvp") netRef.current?.reportDamage(source, amount);
    };

    /**
     * Non-collision damage: projectiles, beams and blasts.
     *
     * Deliberately does NOT consult the Easy collision shield — that shield
     * covers impacts only, and routing weapon fire through it would quietly
     * turn it into blanket immunity.
     */
    const damagePlayer = (game: Game, amount: number) => {
      const player = game.player;
      if (player.invuln > 0 || player.shield > 0) return;
      player.invuln = 24;
      burst(game, player.x, player.y, "#ff5570", 18, 7);
      play("explosion", 0.24);
      report(game, "impact", amount);
      applyHullDamage(game, amount);
    };

    /**
     * Collision damage: walls and hostile bodies.
     *
     * Existing immunity wins first (post-hit i-frames, collectible shield), so
     * the collision shield is never spent while the pilot is already immune.
     * Whatever the collision shield cannot absorb overflows to hull.
     */
    const damageCollision = (game: Game, amount: number) => {
      const player = game.player;
      if (player.invuln > 0 || player.shield > 0) return;

      const shield = game.collisionShield;
      if (!shield) {
        damagePlayer(game, amount);
        return;
      }

      // Report the raw collision, not the post-shield remainder: the server
      // keeps its own shield and must be the one to decide how much of this
      // reaches hull.
      report(game, "collision", amount);
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
        play("explosion", 0.2);
      }
      if (hit.toHull <= 0) return;

      player.invuln = 24;
      burst(game, player.x, player.y, "#ff5570", 18, 7);
      play("explosion", 0.24);
      applyHullDamage(game, hit.toHull);
    };

    /**
     * HARD MODE wormhole contact. Not a collision, so the collision shield
     * never applies; collectible defensive power-ups still do.
     */
    const damageContact = (game: Game, amount: number) => {
      if (game.player.shield > 0) return;
      burst(game, game.player.x, game.player.y, "#ff5ac8", 10, 6);
      play("explosion", 0.18);
      applyHullDamage(game, amount);
    };

    const addIncoming = (game: Game, power: PowerId) => {
      const count = ENEMY_COUNTS[power];
      for (let i = 0; i < count; i += 1) game.enemies.push(makeEnemy(power, game.portalX, game.portalY, i, count));
      game.incoming = power;
      game.notice = `INCOMING // ${WEAPONS[power].short}`;
      game.noticeLife = 140;
      pushSpawn(game, "hostile", power, game.portalX, game.portalY, count);
      burst(game, game.portalX, game.portalY, POWER_COLORS[power], 26, 9);
      play(power === "nuke" ? "explosion" : "magic", 0.28);
    };

    const spawnEnrageWave = (game: Game) => {
      const enrage = game.rules.wormholeEnrage;
      if (!enrage.enabled || game.mode !== "pve" || game.result) return;

      for (const { enemy, count } of enrage.wave) {
        for (let i = 0; i < count; i += 1) {
          game.enemies.push(makeEnemy(enemy, game.portalX, game.portalY, i, count));
        }
        pushSpawn(game, "hostile", enemy, game.portalX, game.portalY, count);
      }

      game.incoming = "ufo";
      game.notice = "WORMHOLE ENRAGED // MINES · UFO · SCARABS";
      game.noticeLife = 180;
      game.portalPulse = 1;
      burst(game, game.portalX, game.portalY, "#ff263f", 52, 12);
      play("explosion", 0.36);
    };

    const destroyEnemy = (game: Game, enemy: Enemy) => {
      enemy.hp = 0;
      game.score += enemy.kind === "nuke" ? 600 : enemy.kind === "gunship" ? 300 : 100;
      burst(game, enemy.x, enemy.y, POWER_COLORS[enemy.kind], 18, 8);
      play("explosion", 0.16);
      if (enemy.kind !== "ghost" && enemy.kind !== "beam" && enemy.kind !== "emp" && enemy.kind !== "mines" && Math.random() < 0.48) {
        game.pickups.push({ x: enemy.x, y: enemy.y, vx: range(-0.7, 0.7), vy: range(-0.7, 0.7), type: randomPower(), life: 900, phase: range(0, 6) });
      }
    };

    const spawnEnemyBullet = (game: Game, enemy: Enemy, speed = 5, damage = 10) => {
      const dx = game.player.x - enemy.x;
      const dy = game.player.y - enemy.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      game.bullets.push({ x: enemy.x, y: enemy.y, vx: (dx / d) * speed, vy: (dy / d) * speed, damage, life: 170, enemy: true, color: "#ff596f" });
    };

    const activateSpecial = (game: Game) => {
      const player = game.player;
      const pressed = Boolean(keys.current.KeyQ);
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
      if (ship === "tank") {
        player.invuln = Math.max(player.invuln, ticksForSeconds(3));
        game.notice = "BULWARK // 3S IMMUNITY";
      } else if (ship === "wing") {
        const angle = player.angle * DEG;
        player.vx = Math.cos(angle) * 11;
        player.vy = Math.sin(angle) * 11;
        player.invuln = Math.max(player.invuln, ticksForSeconds(0.45));
        game.notice = "PULSE DASH";
      } else if (ship === "squid") {
        const angle = player.angle * DEG;
        player.x = cap(player.x + Math.cos(angle) * 150, 24, game.worldSize - 24);
        player.y = cap(player.y + Math.sin(angle) * 150, 24, game.worldSize - 24);
        player.invuln = Math.max(player.invuln, ticksForSeconds(0.7));
        game.notice = "PHASE SKIP";
      } else if (ship === "rabbit") {
        let target: Enemy | null = null;
        let targetDistance = Infinity;
        for (const enemy of game.enemies) {
          const distance = dist(player, enemy);
          if (enemy.hp > 0 && distance < targetDistance) {
            target = enemy;
            targetDistance = distance;
          }
        }
        const heading = target
          ? Math.atan2(target.y - player.y, target.x - player.x)
          : player.angle * DEG;
        for (let i = -3; i <= 3; i += 1) {
          const angle = heading + i * 6 * DEG;
          game.bullets.push({ x: player.x, y: player.y, vx: Math.cos(angle) * 9, vy: Math.sin(angle) * 9, damage: 18, life: 120, enemy: false, color: "#b6ff57" });
          game.playerShots += 1;
        }
        game.notice = target ? "TRACKER SALVO // LOCKED" : "TRACKER SALVO // FORWARD";
        play("fire", 0.3);
      } else if (ship === "turtle") {
        game.enemies.forEach((enemy) => {
          if (enemy.kind !== "ghost") destroyEnemy(game, enemy);
        });
        player.health = Math.max(1, player.health - (Math.random() < 0.75 ? 20 : 0));
        game.notice = "TURTLE CANNON";
      } else if (ship === "flash") {
        player.flashMode = player.flashMode === "tank" ? "squid" : "tank";
        game.notice = `FLASH // ${player.flashMode.toUpperCase()} FORM`;
      } else if (ship === "hunter") {
        for (let i = 0; i < 17; i += 1) {
          const angle = (player.angle + (i - 8) * 12) * DEG;
          game.bullets.push({ x: player.x, y: player.y, vx: Math.cos(angle) * 8, vy: Math.sin(angle) * 8, damage: 15, life: 105, enemy: false, color: "#ff5f70" });
          game.playerShots += 1;
        }
        game.notice = "PIRANHA ARRAY";
        play("fire", 0.3);
      } else if (ship === "flagship") {
        player.flagshipField = ticksForSeconds(3);
        game.notice = "A/R FIELD ACTIVE // 3S";
      }

      player.specialCooldown = ticksForSeconds(spec.cooldownSeconds);
      game.noticeLife = 90;
      burst(game, player.x, player.y, "#68f2ff", 26, 8);
      play("magic", 0.22);
    };

    const updateEnemy = (game: Game, enemy: Enemy) => {
      const player = game.player;
      enemy.age += 1;
      enemy.cooldown -= 1;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
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
        if (enemy.age % 150 === 0) {
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
        if (enemy.cooldown <= 0) {
          spawnEnemyBullet(game, enemy, enemy.kind === "artillery" ? 7 : 5, enemy.kind === "artillery" ? 16 : 10);
          enemy.cooldown = enemy.kind === "gunship" ? 28 : 45;
        }
      } else if (enemy.kind === "minelayer") {
        enemy.vx = Math.cos(enemy.age * 0.04) * 3.5;
        enemy.vy = Math.sin(enemy.age * 0.021) * 3.5;
        if (enemy.age % 95 === 0) game.enemies.push(makeEnemy("mines", enemy.x, enemy.y, 0, 1));
      } else if (enemy.kind === "scarab") {
        const pickup = game.pickups[0];
        if (pickup) {
          const pdx = pickup.x - enemy.x;
          const pdy = pickup.y - enemy.y;
          const pd = Math.max(1, Math.hypot(pdx, pdy));
          enemy.vx += (pdx / pd) * 0.2;
          enemy.vy += (pdy / pd) * 0.2;
          if (pd < 18) { pickup.life = 0; game.notice = "SCARAB STOLE A POWERUP"; game.noticeLife = 70; }
        }
      } else if (enemy.kind === "wallcrawler") {
        if (enemy.x <= 12) { enemy.x = 12; enemy.vx = 0; enemy.vy = 4; }
        if (enemy.y >= game.worldSize - 12) { enemy.y = game.worldSize - 12; enemy.vx = 4; enemy.vy = 0; }
        if (enemy.x >= game.worldSize - 12) { enemy.x = game.worldSize - 12; enemy.vx = 0; enemy.vy = -4; }
        if (enemy.y <= 12) { enemy.y = 12; enemy.vx = -4; enemy.vy = 0; }
        if (enemy.age % 35 === 0) spawnEnemyBullet(game, enemy, 6, 10);
      } else if (enemy.kind === "ghost") {
        if (enemy.age % 130 === 0) { enemy.vx = range(-2.5, 2.5); enemy.vy = range(-2.5, 2.5); }
      } else if (enemy.kind === "emp") {
        enemy.blastRadius = (enemy.blastRadius ?? 0) + (enemy.age > 65 ? 8 : 0);
        enemy.x = player.x;
        enemy.y = player.y;
        if ((enemy.blastRadius ?? 0) > 0 && (enemy.blastRadius ?? 0) >= d) player.emp = 150;
        if ((enemy.blastRadius ?? 0) > 320) enemy.hp = 0;
      } else if (enemy.kind === "beam") {
        enemy.phase += 0.006;
        enemy.x = game.portalX;
        enemy.y = game.portalY;
        if (enemy.age > 45 && enemy.age < 365) {
          const angle = Math.atan2(player.y - game.portalY, player.x - game.portalX) + Math.sin(enemy.phase) * 0.3;
          const lineDist = Math.abs(Math.sin(angle) * (player.x - game.portalX) - Math.cos(angle) * (player.y - game.portalY));
          if (lineDist < 14 && enemy.age % 16 === 0) damagePlayer(game, 8);
        }
        if (enemy.age >= 365) enemy.hp = 0;
      } else if (enemy.kind === "nuke") {
        enemy.countdown = (enemy.countdown ?? 0) - 1;
        if ((enemy.countdown ?? 0) <= 0) {
          const previousRadius = enemy.blastRadius ?? 10;
          enemy.blastRadius = previousRadius + 30;
          if (d <= (enemy.blastRadius ?? 0) && d > previousRadius && player.shield <= 0) damagePlayer(game, Math.max(5, 40 * (1 - (enemy.blastRadius ?? 0) / 1000)));
          if ((enemy.blastRadius ?? 0) > 1000) enemy.hp = 0;
        }
      }

      const anchored = enemy.kind === "turret" || enemy.kind === "beam" || enemy.kind === "emp" || enemy.kind === "nuke";
      if (!anchored) {
        enemy.x += enemy.vx;
        enemy.y += enemy.vy;
      }
      if (enemy.x < 4 || enemy.x > game.worldSize - 4) enemy.vx *= -1;
      if (enemy.y < 4 || enemy.y > game.worldSize - 4) enemy.vy *= -1;
      enemy.x = cap(enemy.x, 4, game.worldSize - 4);
      enemy.y = cap(enemy.y, 4, game.worldSize - 4);

      const collisionRadius = enemy.kind === "nuke" && (enemy.countdown ?? 0) <= 0 ? 0 : enemy.radius;
      if (collisionRadius > 0 && d < collisionRadius + 12) {
        damageCollision(game, enemy.kind === "mines" ? 20 : enemy.kind === "inflator" ? 18 : enemy.kind === "heatseeker" ? 10 : 8);
        if (enemy.kind !== "ufo" && enemy.kind !== "ghost" && enemy.kind !== "wallcrawler" && enemy.kind !== "gunship") enemy.hp = 0;
        enemy.vx *= -1;
        enemy.vy *= -1;
      }
    };

    const tick = () => {
      const game = gameRef.current;
      if (!game.running || game.paused || game.result) return;
      const player = game.player;
      game.cycles += 1;
      game.shotCycle -= 1;
      game.botTimer -= 1;
      game.noticeLife = Math.max(0, game.noticeLife - 1);
      game.portalPulse = Math.max(0, game.portalPulse - 0.012);
      player.invuln = Math.max(0, player.invuln - 1);
      player.shield = Math.max(0, player.shield - 1);
      player.specialCooldown = Math.max(0, player.specialCooldown - 1);
      player.emp = Math.max(0, player.emp - 1);
      // Wormhole motion is a rule, not a constant: EASY locks it dead centre
      // while DIFFICULT and HARD MODE keep the original orbit.
      game.portalAngle = advanceWormholeAngle(game.rules, game.portalAngle);
      const wormhole = wormholePosition(game.rules, game.worldSize, game.portalAngle);
      game.portalX = wormhole.x;
      game.portalY = wormhole.y;

      if (game.enrageActive && game.rules.wormholeEnrage.enabled) {
        game.enrageTimer -= 1;
        if (game.enrageTimer <= 0) {
          game.enrageTimer = game.rules.wormholeEnrage.waveIntervalTicks;
          spawnEnrageWave(game);
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
        game.notice = "WORMHOLE CONTACT";
        game.noticeLife = 110;
      }
      if (contact.damage > 0) damageContact(game, contact.damage);

      const firingHeading = aimHeading.current;
      let fire = keys.current.Space || keys.current.MousePrimary;
      const launch = keys.current.KeyE || keys.current.MouseSecondary;

      // Resolve the input source before combining it. The left thumbstick keeps
      // the exact immediate response it shipped with, while only WASD/arrows
      // opt into the newer momentum-preserving flight model.
      const stickIntent = intentFromStick(moveHeading.current);
      const keyboardIntent = intentFromKeys(keysFrom(keys.current));
      const usingTouchThrust = stickIntent.active;
      let intent = resolveIntent(stickIntent, keyboardIntent);
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

      let handling = game.ship;
      if (game.ship.id === "flash") handling = player.flashMode === "tank" ? SHIPS[0] : SHIPS[2];
      const maxSpeed = handling.maxSpeed + player.thrust * THRUST_SPEED_BONUS;
      const acceleration = handling.acceleration + player.thrust * THRUST_ACCEL_BONUS;

      const moved = applyIntent(
        { vx: player.vx, vy: player.vy },
        intent,
        { acceleration, maxSpeed },
        { retros: player.retros, inertial: !usingTouchThrust }
      );
      player.vx = moved.vx;
      player.vy = moved.vy;

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
      if (player.x < 12 || player.x > game.worldSize - 12) { player.x = cap(player.x, 12, game.worldSize - 12); player.vx *= -0.55; damageCollision(game, 2); }
      if (player.y < 12 || player.y > game.worldSize - 12) { player.y = cap(player.y, 12, game.worldSize - 12); player.vy *= -0.55; damageCollision(game, 2); }

      if (fire && game.shotCycle <= 0 && game.playerShots < SHOT_LEVELS[player.gun].maxShots) {
        const shot = SHOT_LEVELS[player.gun];
        const offsets = shot.shots === 2 ? [-0.05, 0.05] : [0];
        offsets.forEach((offset) => {
          const angle = player.angle * DEG + offset;
          game.bullets.push({ x: player.x + Math.cos(angle) * 12, y: player.y + Math.sin(angle) * 12, vx: Math.cos(angle) * 10 + player.vx, vy: Math.sin(angle) * 10 + player.vy, damage: shot.damage, life: 110, enemy: false, color: shot.color });
          game.playerShots += 1;
        });
        game.shotCycle = shot.delay;
        play("fire", 0.12);
      }

      if (launch && game.stock.length > 0 && !keys.current.__launchLatch) {
        keys.current.__launchLatch = true;
        const type = game.stock.pop()!;
        const angle = player.angle * DEG;
        game.powers.push({ x: player.x + Math.cos(angle) * 12, y: player.y + Math.sin(angle) * 12, vx: Math.cos(angle) * 10 + player.vx, vy: Math.sin(angle) * 10 + player.vy, type, life: 160 });
        game.notice = `${WEAPONS[type].short} ARMED`;
        game.noticeLife = 75;
        burst(game, player.x, player.y, POWER_COLORS[type], 10, 4);
        play("fire", 0.2);
      }
      if (!launch) keys.current.__launchLatch = false;
      activateSpecial(game);

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
        bullet.x += bullet.vx;
        bullet.y += bullet.vy;
        bullet.life -= 1;
        if (bullet.enemy) {
          if (dist(bullet, player) < 13) { bullet.life = 0; damagePlayer(game, bullet.damage); }
          return;
        }
        if (dist(bullet, { x: game.portalX, y: game.portalY }) < 43) {
          bullet.life = 0;
          game.portalCharge += bullet.damage;
          game.portalPulse = Math.max(game.portalPulse, 0.4);
          burst(game, bullet.x, bullet.y, "#ff5ac8", 4, 2.5);
          if (game.portalCharge > PORTAL_THRESHOLD) {
            game.portalCharge = 0;
            const type = randomPower();
            game.pickups.push({ x: game.portalX + range(-28, 28), y: game.portalY + range(-28, 28), vx: range(-1.2, 1.2), vy: range(-1.2, 1.2), type, life: 900, phase: range(0, 6) });
            game.notice = `${WEAPONS[type].short} READY TO COLLECT`;
            game.noticeLife = 100;
            pushSpawn(game, "friendly", type, game.portalX, game.portalY, 1);
            play("magic", 0.22);
          }
        }
        for (const enemy of game.enemies) {
          if (enemy.hp <= 0 || bullet.life <= 0 || enemy.kind === "ghost") continue;
          if (dist(bullet, enemy) < enemy.radius + 4) {
            bullet.life = 0;
            enemy.hp -= bullet.damage;
            burst(game, bullet.x, bullet.y, POWER_COLORS[enemy.kind], 4, 2.5);
            if (enemy.hp <= 0) destroyEnemy(game, enemy);
          }
        }
      });

      game.powers.forEach((power) => {
        power.x += power.vx;
        power.y += power.vy;
        power.life -= 1;
        if (dist(power, { x: game.portalX, y: game.portalY }) < 48) {
          power.life = 0;
          pushSpawn(game, "transmit", power.type, game.portalX, game.portalY, 0);
          burst(game, game.portalX, game.portalY, POWER_COLORS[power.type], 38, 11);
          play("magic", 0.32);

          if (game.mode === "pvp") {
            // The wormhole is the delivery route to the other arena. Rival
            // integrity is a PvE objective and plays no part here: PvP is
            // decided by the opponent's pilot hull, which only the server sets.
            netRef.current?.transmit(power.type);
            game.notice = `${WEAPONS[power.type].short} SENT TO OPPONENT`;
            game.noticeLife = 115;
          } else {
            const damage = rivalDamageFor(power.type);
            game.rivalHealth -= damage;
            game.score += 750 + damage * 10;
            game.notice = `${WEAPONS[power.type].short} SENT // RIVAL −${damage}`;
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
              spawnEnrageWave(game);
            }

            if (game.rivalHealth <= 0) {
              game.rivalHealth = 0;
              game.running = false;
              game.result = "victory";
              game.notice = "RIVAL ELIMINATED";
              burst(game, game.portalX, game.portalY, "#ff5ac8", 90, 16);
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
          else if (game.stock.length < STOCK_LIMIT) game.stock.push(type);
          else { game.notice = "POWERUP BIN FULL"; game.noticeLife = 75; return; }
          game.notice = `${WEAPONS[type].short} COLLECTED`;
          game.noticeLife = 100;
          burst(game, pickup.x, pickup.y, POWER_COLORS[type], 16, 5);
          play("magic", 0.25);
        }
      });

      if (game.mode === "pvp") {
        // No bot in PvP: every hostile wave is something the opponent chose to
        // send. The server tags deliveries, so a resend never spawns twice.
        for (const attack of netRef.current?.drainIncoming() ?? []) {
          addIncoming(game, attack.weapon as PowerId);
          game.notice = `${WEAPONS[attack.weapon as PowerId].short} FROM ${attack.from}`;
          game.noticeLife = 140;
        }
      } else if (game.botTimer <= 0 && game.running) {
        const pool: PowerId[] = game.cycles < 1800 ? ["heatseeker", "mines", "ufo", "inflator"] : SENDABLE_POWERUPS;
        const attack = pool[Math.floor(Math.random() * pool.length)];
        addIncoming(game, attack);
        game.botTimer = Math.max(330, 580 - Math.floor(game.cycles / 140));
      }

      game.enemies.forEach((enemy) => { if (enemy.hp > 0) updateEnemy(game, enemy); });
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
        const alive = item.life > 0 && item.x > -30 && item.x < game.worldSize + 30 && item.y > -30 && item.y < game.worldSize + 30;
        if (alive && !item.enemy) liveShots += 1;
        return alive;
      });
      game.playerShots = liveShots;
      compact(game.pickups, (item) => item.life > 0);
      compact(game.powers, (item) => item.life > 0 && item.x > -30 && item.x < game.worldSize + 30 && item.y > -30 && item.y < game.worldSize + 30);
      compact(game.enemies, (item) => item.hp > 0);
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
      x: (i * 83.17) % BOARD,
      y: (i * 47.31) % BOARD,
      size: i % 11 === 0 ? 2 : 1,
      cyan: i % 8 === 0,
    }));

    const drawPortal = (game: Game, time: number, detail: number) => {
      const charge = cap(game.portalCharge / PORTAL_THRESHOLD, 0, 1);
      const swell = 1 + game.portalPulse * 0.18;
      ctx.save();
      ctx.translate(game.portalX, game.portalY);
      ctx.scale(swell, swell);
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
        const angle = Math.atan2(game.player.y - game.portalY, game.player.x - game.portalX) + Math.sin(enemy.phase) * 0.3;
        ctx.save();
        ctx.translate(enemy.x, enemy.y);
        ctx.rotate(angle);
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = color;
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(900, 0);
        ctx.stroke();
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(900, 0);
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
          ? Math.atan2(game.player.y - game.portalY, game.player.x - game.portalX)
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
          const away = Math.atan2(spawn.y - WORLD_SIZE / 2, spawn.x - WORLD_SIZE / 2) + Math.PI;
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

    const drawScene = (time: number, detail: number) => {
      const game = gameRef.current;
      const player = game.player;
      const quiet = reducedMotionRef.current;

      ctx.setTransform(worldScale, 0, 0, worldScale, 0, 0);
      const gradient = ctx.createRadialGradient(BOARD / 2, BOARD / 2, 10, BOARD / 2, BOARD / 2, BOARD * .72);
      gradient.addColorStop(0, "#0b1520");
      gradient.addColorStop(.58, "#050b12");
      gradient.addColorStop(1, "#020409");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, BOARD, BOARD);

      for (const star of stars) {
        const alpha = quiet || detail < 0.5 ? 0.3 : .22 + Math.sin(time * .001 + star.x) * .18;
        ctx.fillStyle = star.cyan ? `rgba(103,232,255,${alpha})` : `rgba(255,255,255,${alpha})`;
        ctx.fillRect(star.x, star.y, star.size, star.size);
      }

      // One batched path for the whole grid instead of 42 stroke calls.
      ctx.strokeStyle = "rgba(86, 176, 200, .055)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let p = 30; p < BOARD; p += 30) {
        ctx.moveTo(p, 0);
        ctx.lineTo(p, BOARD);
        ctx.moveTo(0, p);
        ctx.lineTo(BOARD, p);
      }
      ctx.stroke();

      const locked = cameraRef.current;
      const camScale = locked ? 1 : BOARD / game.worldSize;
      const camX = locked ? cap(BOARD / 2 - player.x, BOARD - game.worldSize, 0) : 0;
      const camY = locked ? cap(BOARD / 2 - player.y, BOARD - game.worldSize, 0) : 0;
      const viewLeft = -camX / camScale;
      const viewTop = -camY / camScale;
      const viewRight = (BOARD - camX) / camScale;
      const viewBottom = (BOARD - camY) / camScale;
      const visible = (x: number, y: number, r: number) =>
        x + r > viewLeft && x - r < viewRight && y + r > viewTop && y - r < viewBottom;

      ctx.save();
      ctx.translate(camX, camY);
      ctx.scale(camScale, camScale);

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
          if (profile.shadows) { ctx.shadowColor = bullet.color; ctx.shadowBlur = 7; }
          ctx.strokeStyle = bullet.color;
          ctx.lineWidth = 2.6;
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
        ctx.translate(player.x, player.y);
        ctx.rotate(player.angle * DEG);
        ctx.strokeStyle = player.invuln > 0 ? "#ffffff" : "#69ecff";
        ctx.fillStyle = "rgba(86, 226, 255, .12)";
        if (profile.shadows) { ctx.shadowColor = "#62eaff"; ctx.shadowBlur = 10; }
        ctx.lineWidth = 2;
        drawShipShape(ctx, game.ship.id, game.ship.id === "flagship" ? .82 : 1);
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
      ctx.setTransform(cssScale, 0, 0, cssScale, 0, 0);
      ctx.textBaseline = "middle";

      const base = cap(W / 655, 0.96, 1.3);
      const fs = (size: number) => Math.max(11.5, Math.round(size * base * 10) / 10);
      const mono = (weight: number, size: number) => `${weight} ${fs(size)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      const pad = Math.round(fs(12));
      const top = pad + hudInsetRef.current;
      const compactUi = W < 540;

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

      const chargeW = cap(W * 0.34, 158, 216);
      const chargeH = Math.round(fs(12) * (compactUi ? 2.6 : 3.9));
      const noticeH = Math.round(fs(12) * 2.5);
      const noticeRoom = compactUi ? W - pad * 2 : W - pad * 2 - chargeW - 8;
      // Each column starts below whatever DOM panel covers that corner.
      const noticeTop = top + overlayInsetRef.current.left;
      const chargeTop = top + overlayInsetRef.current.right;
      const chargeY = compactUi ? noticeTop + noticeH + 6 : chargeTop;

      // Mission notice, falling back to the next thing the player has to do.
      const live = game.noticeLife > 0;
      const noticeText = live ? game.notice : coachLine(game);
      ctx.font = mono(live ? 800 : 700, live ? 12.5 : 12);
      const noticeW = Math.min(noticeRoom, ctx.measureText(noticeText).width + pad * 1.8);
      panel(pad, noticeTop, noticeW, noticeH, "rgba(102,225,255,.24)");
      ctx.fillStyle = live ? "#eafcff" : "#a7c8d1";
      ctx.textAlign = "left";
      ctx.fillText(fit(noticeText, noticeW - pad * 1.6), pad + pad * 0.8, noticeTop + noticeH / 2);

      // Wormhole charge.
      const chargeX = W - pad - chargeW;
      const chargePct = Math.round((game.portalCharge / PORTAL_THRESHOLD) * 100);
      panel(chargeX, chargeY, chargeW, chargeH, "rgba(255,86,194,.32)");
      ctx.textAlign = "center";
      ctx.fillStyle = "#ff8ad6";
      ctx.font = mono(800, 12.5);
      ctx.fillText(`WORMHOLE CHARGE ${chargePct}%`, chargeX + chargeW / 2, chargeY + fs(12) * 1.05);
      const barY = chargeY + fs(12) * 1.75;
      const barW = chargeW - pad * 1.6;
      ctx.fillStyle = "rgba(255,255,255,.12)";
      ctx.fillRect(chargeX + pad * 0.8, barY, barW, 5);
      ctx.fillStyle = chargePct > 75 ? "#b2ff62" : "#ff70cc";
      ctx.fillRect(chargeX + pad * 0.8, barY, barW * cap(chargePct / 100, 0, 1), 5);
      if (!compactUi) {
        ctx.fillStyle = "#a4c2ca";
        ctx.font = mono(700, 11.5);
        ctx.fillText(fit("150 DAMAGE → POWER-UP", chargeW - pad), chargeX + chargeW / 2, chargeY + chargeH - fs(12) * 0.75);
      }

      // Next weapon in the bin, mirrored by the HTML inventory below the arena.
      const queued = nextWeapon(game.stock);
      if (queued && game.running && !game.result) {
        const meta = WEAPONS[queued];
        const chipH = Math.round(fs(12) * 3);
        const chipW = cap(W * 0.4, 176, 250);
        const chipX = W - pad - chipW;
        const chipY = W - pad - chipH;
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
        const plateY = Math.round(chargeY + chargeH + 10 + (i - firstPlate) * (plateH + 6));
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
      const portalX = (game.portalX * camera.camScale + camera.camX) * (W / BOARD);
      const portalY = (game.portalY * camera.camScale + camera.camY) * (W / BOARD);
      if (game.spawns.length === 0 && portalX > -60 && portalX < W + 60 && portalY > -60 && portalY < W + 60) {
        ctx.font = mono(700, 11.5);
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(244,226,255,.9)";
        ctx.fillText("RIVAL WORMHOLE", cap(portalX, 60, W - 60), cap(portalY + 82 * camera.camScale * (W / BOARD), 12, W - 12));
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
            : game.result === "defeat" ? "SHIP DESTROYED"
              : "WORMHOLE ARCADE";
        ctx.fillStyle = game.result === "victory" ? "#b8ff72" : game.result === "defeat" ? "#ff7285" : "#eafcff";
        const titleSize = cap(W * 0.072, 24, 46);
        ctx.font = `900 ${titleSize}px Arial, Helvetica, sans-serif`;
        ctx.fillText(fit(title, W - 32), W / 2, W / 2 - titleSize * 0.6);
        ctx.fillStyle = "#c6e3ea";
        ctx.font = mono(700, 13.5);
        const line = game.paused ? "PRESS P TO RESUME"
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

      ctx.strokeStyle = "rgba(101,232,255,.32)";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, W - 2, W - 2);
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
  }, [play, sync]);

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

  const pinSlot = useCallback((id: PickupId) => {
    setInspect((current) => (current && current.id === id && current.pinned ? null : { id, pinned: true }));
  }, []);
  const hoverSlot = useCallback((id: PickupId) => {
    setInspect((current) => (current?.pinned ? current : { id, pinned: false }));
  }, []);
  const unhoverSlot = useCallback(() => {
    setInspect((current) => (current && !current.pinned ? null : current));
  }, []);



  return (
    <main
      ref={shellRef}
      className={`app-shell ${touchCapable ? "touch-capable" : ""} compact-menu`}
      data-immersive={immersive ? "true" : "false"}
      data-orientation={layout.orientation}
      data-form={layout.form}
      data-sticks={layout.sticks}
      data-preset={layout.preset}
      data-panels={layout.panels}
      data-touch-controls={layout.showTouchControls ? "on" : "off"}
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
          <span className="brand-mark" aria-hidden="true">W/02</span>
          <div>
            <h1>WORMHOLE <em>ARCADE</em></h1>
            <a className="brand-home" href={MURPH_SITE_URL} target="_blank" rel="noopener noreferrer">
              ← MURPH TOURNAMENTS
            </a>
          </div>
        </div>
        <div className="top-actions" ref={topActionsRef}>
          <span className="link-status"><i aria-hidden="true" /> SOLO LINK</span>
          {/* Secondary controls lay out inline on wide screens and collapse into
              the MENU panel on handhelds, so the row never needs scrolling. */}
          <SettingsDrawer
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            ship={shipId}
            mode={mode}
            difficulty={difficulty}
            gameActive={gameActive}
            stage={stage}
            preset={layout.preset}
            onPreset={(next) => presetPreference.set(next)}
            cameraLocked={cameraLocked}
            onCamera={setCameraLocked}
            quality={quality}
            autoLabel={autoLabel}
            onQuality={setQuality}
            layoutPref={layoutPref}
            onLayoutPref={setLayoutPref}
            fullscreen={fullscreen}
            onFullscreen={toggleFullscreen}
            sound={sound}
            onSound={setSound}
            touchControls={touchControlMode}
            onTouchControls={(next) => touchControlPreference.set(next)}
            stickSize={stickSizeName}
            onStickSize={(next) => stickSizePreference.set(next)}
            onChangeShip={() => { setMenuOpen(false); setStage("select"); }}
            onChangeMode={() => { setMenuOpen(false); setStage("setup"); }}
            onRunAgain={() => { setMenuOpen(false); start(); }}
            onCodex={() => { setMenuOpen(false); setCodexOpen(true); }}
            onBoard={() => { setMenuOpen(false); setBoardOpen(true); }}
            onLobby={() => { setMenuOpen(false); setLobbyOpen(true); }}
          />
          <button
            className="top-menu-toggle"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="top-secondary"
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? "CLOSE" : "MENU"}
          </button>
          <button className="top-start" type="button" onClick={start}>
            {gameActive ? "RESTART" : hud.result ? "RUN AGAIN" : "START"}
          </button>
          <button className="top-pause" type="button" onClick={togglePause} aria-pressed={hud.paused} aria-label="Pause or resume, keyboard P">P / PAUSE</button>
        </div>
      </header>

      <section className="cockpit">
        <aside className="panel ship-panel">
          <div className="eyebrow">MISSION</div>
          <div className="mission-summary">
            <p>
              <span>MODE</span>
              <b>{mode === "pvp" ? "PVP 1V1" : DIFFICULTIES[difficulty].shortName}</b>
            </p>
            <div>
              <button type="button" onClick={() => setStage("select")}>CHANGE SHIP</button>
              <button type="button" onClick={() => setStage("setup")}>CHANGE MODE</button>
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
          <div className="pilot-transmission"><span>PILOT TRANSMISSION</span><strong>this is really cool!</strong></div>
          <div className="mobile-preflight">
            <label>
              <span>SHIP FRAME</span>
              <select aria-label="Select ship frame" value={shipId} disabled={hud.running && !hud.result} onChange={(event) => setShipId(event.target.value as ShipId)}>
                {SHIPS.map((ship) => <option value={ship.id} key={ship.id}>{ship.name} — {ship.role}</option>)}
              </select>
            </label>
            <div className="mobile-ship-stats"><span>HULL <b>{currentShip.health}</b></span><span>THRUST <b>MK {currentShip.thrust}</b></span></div>
            <button type="button" aria-pressed={fullscreen} onClick={toggleFullscreen}>{fullscreen ? "EXIT FULL" : "FULLSCREEN"}</button>
          </div>
          <div className="match-bar">
            <div><span>MISSION</span><b>FIRST CONTACT</b></div>
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
                width={BOARD}
                height={BOARD}
                onPointerMove={handleArenaPointerMove}
                onPointerDown={handleArenaPointerDown}
                onPointerUp={handleArenaPointerUp}
                onPointerCancel={handleArenaPointerUp}
                onContextMenu={(event) => event.preventDefault()}
                role="img"
                aria-label={`Wormhole combat arena. Hull ${hud.health} of ${hud.maxHealth}. Wormhole charge ${hud.portalCharge} percent. Rival integrity ${hud.rivalHealth} percent. ${hud.enrageActive ? "Wormhole enraged. " : ""}${queued ? `Next power-up ${WEAPONS[queued].name}.` : "Power-up bin empty."}`}
              />
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
                  <section className="run-summary" aria-live="polite" aria-label="Run result">
                    <button className="run-close" type="button" onClick={() => setSummary(null)} aria-label="Dismiss run summary">✕</button>
                    <p className="run-outcome" data-outcome={summary.run.outcome}>
                      {summary.restored ? "LAST RUN" : summary.run.outcome === "victory" ? "RIVAL ELIMINATED" : "SHIP DESTROYED"}
                    </p>
                    <p className="run-score"><span>SCORE</span><b>{summary.run.score.toLocaleString()}</b></p>
                    <p className="run-meta">
                      {summary.isBest ? "NEW DEVICE BEST" : summary.best ? `DEVICE BEST ${summary.best.score.toLocaleString()}` : "FIRST RUN ON THIS DEVICE"}
                    </p>

                    {!sessionChecked ? (
                      <div className="run-save">
                        <p className="run-status">CHECKING MURPH TOURNAMENTS SESSION…</p>
                      </div>
                    ) : player ? (
                      <div className="run-save">
                        {saveState.status === "saving" ? <p className="run-status">SAVING TO MURPH TOURNAMENTS…</p> : null}
                        {saveState.status === "saved" ? (
                          <p className="run-status ok">
                            SAVED AS {player.displayName.toUpperCase()}
                            {saveState.rank ? ` · GLOBAL #${saveState.rank}` : ""}
                          </p>
                        ) : null}
                        {saveState.status === "error" ? (
                          <>
                            <p className="run-status warn">{saveState.message}</p>
                            <button type="button" className="run-action" onClick={() => void saveRun(summary.run)}>TRY SAVING AGAIN</button>
                          </>
                        ) : null}
                      </div>
                    ) : (
                      <div className="run-save">
                        <p className="run-status">Saved on this device only.{discordPromptRun === summary.run ? " Sign in to put it on the global board." : ""}</p>
                        {discordPromptRun === summary.run ? (
                          <button type="button" className="run-action primary" onClick={() => signInToSave(summary.run)}>
                            SAVE WITH DISCORD
                          </button>
                        ) : null}
                      </div>
                    )}

                    <div className="run-links">
                      <button type="button" onClick={start}>RUN AGAIN</button>
                      <button type="button" onClick={() => { setSummary(null); setStage("select"); }}>
                        CHANGE SHIP
                      </button>
                      <button type="button" onClick={() => { setSummary(null); setStage("setup"); }}>
                        CHANGE MODE
                      </button>
                      <button type="button" onClick={() => setBoardOpen(true)}>GLOBAL BOARD</button>
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
                <div className="touch-utility">
                  <button
                    className="touch-pup"
                    type="button"
                    aria-label={queued ? `Fire power-up ${WEAPONS[queued].name}. Same as keyboard E.` : "Fire power-up. Bin is empty. Same as keyboard E."}
                    {...controlProps("KeyE")}
                  >
                    <b>PUP</b><small>E</small>
                  </button>
                  <button className="touch-special" type="button" aria-label={`${hud.specialName}. ${hud.specialCooldown > 0 ? `Ready in ${hud.specialCooldown} seconds.` : "Ready."} Same as keyboard Q.`} disabled={!gameActive || hud.specialCooldown > 0} {...controlProps("KeyQ")}>
                    <b>SPEC</b><small>{hud.specialCooldown > 0 ? `${hud.specialCooldown}S` : "READY"}</small>
                  </button>
                  <button className="touch-pause" type="button" aria-label="Pause or resume" onClick={togglePause}><b aria-hidden="true">Ⅱ</b><small>P</small></button>
                </div>
              </div>
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
                <span>POWER-UP BIN</span>
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
            <button className={`start-button ${gameActive ? "restart" : ""}`} type="button" onClick={start}>
              {gameActive ? "RESTART" : hud.result ? "RUN AGAIN" : "START MISSION"}
            </button>
            {inspect ? (
              <div className="weapon-card-layer">
                <WeaponCard id={inspect.id} reducedMotion={reducedMotion} onClose={() => setInspect(null)} />
              </div>
            ) : null}
          </div>
        </section>

        <aside className="panel intel-panel">
          <div className="eyebrow">MISSION INTEL</div>
          <h2>SURVIVE<br />THE VOID</h2>
          <p>Every rival has a wormhole orbiting your arena. Shoot it with pulse cannons to generate power-ups, collect them, then send attack power-ups back through it.</p>
          <ol>
            <li><span>01</span><div><b>CHARGE</b><small>Deal 150 cannon damage to the wormhole</small></div></li>
            <li><span>02</span><div><b>COLLECT</b><small>Fly over the generated power-up</small></div></li>
            <li><span>03</span><div><b>TRANSMIT</b><small>Aim at the wormhole and press E (touch: PUP)</small></div></li>
          </ol>
          <button type="button" className="codex-trigger" onClick={() => setCodexOpen(true)} aria-haspopup="dialog">OPEN WEAPON CODEX</button>
          <div className="intel-card">
            <div><span>GUN</span><b>MK {hud.gun + 1}/4</b></div>
            <div><span>THRUST</span><b>MK {hud.thrust}/3</b></div>
            <div><span>RETROS</span><b>{hud.retros ? "ONLINE" : "OFFLINE"}</b></div>
            <div><span>WORMHOLE</span><b>{hud.portalCharge}%</b></div>
          </div>
          <div className={`incoming-card ${hud.incoming ? "hot" : ""}`}>
            <span>THREAT MONITOR</span>
            <b>{hud.incoming ? POWER_LABELS[hud.incoming] : "SECTOR CLEAR"}</b>
            <small>{hud.incoming ? `${CATEGORY_LABELS[WEAPONS[hud.incoming].category]} · THREAT ${threatBadge(WEAPONS[hud.incoming])}` : "SCANNING RIVAL WORMHOLE"}</small>
          </div>
          <div className="source-note">
            <span>CLIENT-VERIFIED PROTOTYPE</span>
            <p>Flight values, game tick, cannon levels, portal charge, power-up capacity, enemy counts, and sound effects were recovered from the supplied Redux client.</p>
          </div>
        </aside>
      </section>

      <footer>
        <span>WORMHOLE ARCADE // PLAYABLE PROTOTYPE 0.4</span>
        <span>940×940 FIELD // SHIP-LOCK + ARENA CAMERAS</span>
      </footer>

      {codexOpen ? <WeaponCodex onClose={() => setCodexOpen(false)} reducedMotion={reducedMotion} /> : null}
      {stage !== "arena" ? (
        <div className="launch-scene" data-stage={stage}>
          {stage === "select" ? (
            <ShipSelect
              selected={shipId}
              reducedMotion={reducedMotion}
              locked={mode === "pvp" && net?.phase === "countdown"}
              onConfirm={(id) => { setShipId(id); netRef.current?.chooseShip(id); setStage("setup"); }}
            />
          ) : (
            <MissionSetup
              ship={shipId}
              mode={mode}
              difficulty={difficulty}
              onMode={chooseMode}
              onDifficulty={chooseDifficulty}
              onChangeShip={() => setStage("select")}
              onLaunch={start}
              onOpenLobby={() => setLobbyOpen(true)}
              net={net}
            />
          )}
        </div>
      ) : null}
      {boardOpen ? <Leaderboard onClose={() => setBoardOpen(false)} /> : null}
      {lobbyOpen ? (
        <MultiplayerLobby
          status={lobbyStatus}
          net={net}
          onQuickMatch={() => netRef.current?.quickMatch()}
          onCreatePrivate={() => netRef.current?.createPrivate()}
          onJoinCode={(code) => netRef.current?.join(code)}
          onCancel={() => netRef.current?.cancel()}
          onShip={(ship) => { setShipId(ship as ShipId); netRef.current?.chooseShip(ship); }}
          onReady={(ready) => netRef.current?.setReady(ready)}
          onClose={() => setLobbyOpen(false)}
        />
      ) : null}
    </main>
  );
}
