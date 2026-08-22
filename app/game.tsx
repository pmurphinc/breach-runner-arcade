"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORY_LABELS,
  ENEMY_COUNTS,
  ENEMY_STATS,
  POWER_COLORS,
  POWER_LABELS,
  SENDABLE_POWERUPS,
  SHIPS,
  SHOT_LEVELS,
  WEAPONS,
  rivalDamageFor,
  type PickupId,
  type PowerId,
  type ShipId,
  type ShipSpec,
  type WeaponMeta,
} from "./game-data";
import { DIRECTIONAL, drawPowerProjectile, drawWeaponGlyph } from "./weapon-art";

const BOARD = 655;
const WORLD_SIZE = 940;
const TICK_MS = 15;
const PORTAL_THRESHOLD = 150;
const DEG = Math.PI / 180;
const THRUST_ACCEL_BONUS = 0.035;
const THRUST_SPEED_BONUS = 0.25;
const STOCK_LIMIT = 5;

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
type SticksMode = "docked" | "overlay" | "gutter";

/**
 * Layout is derived from the device alone — never from whether a match is
 * running — so the interface never rearranges itself mid-session.
 */
type DeviceLayout = {
  touch: boolean;
  /** No precise pointer: a real handheld rather than a touchscreen laptop. */
  coarse: boolean;
  handheld: boolean;
  orientation: "portrait" | "landscape";
  form: "phone" | "tablet" | "desktop";
  /** Too narrow for an inline control row; the MENU panel takes over. */
  narrow: boolean;
  /** Square arena edge in CSS pixels, measured rather than guessed. */
  arena: number;
  stick: number;
  sticks: SticksMode;
};

/** Immersive chrome heights, kept in step with the values in globals.css. */
const TOP_H = 48;
const HUD_H = 44;
const DOCK_H = 62;
const GAP = 6;

const DESKTOP_LAYOUT: DeviceLayout = {
  touch: false, coarse: false, handheld: false, orientation: "landscape",
  form: "desktop", narrow: false, arena: 0, stick: 0, sticks: "docked",
};

function readDeviceLayout(): DeviceLayout {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const touch = navigator.maxTouchPoints > 0 || coarse || "ontouchstart" in window;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const shortEdge = Math.min(w, h);
  // A touchscreen laptop reports touch points but has a fine pointer and a big
  // screen; it should keep the desktop cockpit.
  const handheld = touch && (coarse || shortEdge < 950);
  const orientation = w >= h ? "landscape" : "portrait";
  const form: DeviceLayout["form"] = !touch ? "desktop" : shortEdge < 600 ? "phone" : "tablet";
  const narrow = w < 900;

  if (orientation === "landscape") {
    const stick = Math.round(cap(Math.min(w * 0.16, h * 0.34), 96, 150));
    // Side gutters keep the arena completely clear, but on a short, wide screen
    // they cost more arena than floating the sticks over its lower corners.
    const gutterArena = Math.min(h - TOP_H - GAP * 2, w - 2 * (stick + 20) - GAP * 2);
    const overlayArena = Math.min(w - GAP * 2, h - TOP_H - DOCK_H - GAP * 4);
    const useOverlay = overlayArena > gutterArena * 1.15;
    return {
      touch, coarse, handheld, orientation, form, narrow,
      arena: Math.round(Math.max(220, useOverlay ? overlayArena : gutterArena)),
      stick,
      sticks: useOverlay ? "overlay" : "gutter",
    };
  }

  const stick = Math.round(cap(Math.min(w * 0.3, h * 0.24), 100, 150));
  const full = w - GAP * 2;
  // Prefer the layout where nothing overlaps the arena, but only while the
  // arena still gets most of the width. Otherwise let the arena fill the width
  // and float the controls over its lower corners.
  const dockedArena = Math.min(full, h - TOP_H - HUD_H - DOCK_H - stick - GAP * 4);
  if (dockedArena >= full * 0.82) {
    return { touch, coarse, handheld, orientation, form, narrow, arena: Math.round(Math.max(220, dockedArena)), stick, sticks: "docked" };
  }
  const arena = Math.round(Math.max(220, Math.min(full, h - TOP_H - DOCK_H - GAP * 4)));
  return { touch, coarse, handheld, orientation, form, narrow, arena, stick, sticks: "overlay" };
}

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
  flashMode: "tank" | "squid";
};

type Game = {
  worldSize: number;
  ship: ShipSpec;
  player: Player;
  portalAngle: number;
  portalCharge: number;
  portalX: number;
  portalY: number;
  /** Decays after the portal fires, used to swell the portal on activity. */
  portalPulse: number;
  bullets: Bullet[];
  pickups: Pickup[];
  enemies: Enemy[];
  powers: PowerShot[];
  particles: Particle[];
  spawns: SpawnFx[];
  stock: PowerId[];
  score: number;
  rivalHealth: number;
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
  rivalHealth: number;
  portalCharge: number;
  stock: PowerId[];
  running: boolean;
  paused: boolean;
  result: Game["result"];
  incoming: PowerId | null;
  notice: string;
  coach: string;
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

function createGame(ship: ShipSpec): Game {
  return {
    worldSize: WORLD_SIZE,
    ship,
    player: {
      x: WORLD_SIZE / 2,
      y: WORLD_SIZE / 2,
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
      flashMode: "tank",
    },
    portalAngle: 0,
    portalCharge: 0,
    portalX: WORLD_SIZE / 2 + 210,
    portalY: WORLD_SIZE / 2,
    portalPulse: 0,
    bullets: [],
    pickups: [],
    enemies: [],
    powers: [],
    particles: [],
    spawns: [],
    stock: [],
    score: 0,
    rivalHealth: 100,
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
    rivalHealth: Math.max(0, Math.round(game.rivalHealth)),
    portalCharge: Math.round((game.portalCharge / PORTAL_THRESHOLD) * 100),
    stock: [...game.stock],
    running: game.running,
    paused: game.paused,
    result: game.result,
    incoming: game.incoming,
    notice: game.noticeLife > 0 ? game.notice : "",
    coach: coachLine(game),
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
    && a.portalCharge === b.portalCharge
    && a.running === b.running
    && a.paused === b.paused
    && a.result === b.result
    && a.incoming === b.incoming
    && a.notice === b.notice
    && a.coach === b.coach
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

function drawShipShape(ctx: CanvasRenderingContext2D, ship: ShipId, scale = 1) {
  const shapes: Record<ShipId, number[][]> = {
    tank: [[18, 0], [9, -12], [-11, -16], [-8, -5], [-17, -6], [-13, 0], [-17, 6], [-8, 5], [-11, 16], [9, 12]],
    wing: [[20, 0], [-8, -10], [-3, -3], [-15, 0], [-3, 3], [-8, 10]],
    squid: [[18, 0], [-15, -7], [-7, 0], [-19, 12], [1, 7], [-6, 0], [-19, -12]],
    rabbit: [[17, 0], [5, -7], [-14, -9], [-7, 0], [-14, 9], [5, 7]],
    turtle: [[18, 0], [8, -13], [-8, -12], [-13, -7], [-12, 0], [-13, 7], [-8, 12], [8, 13]],
    flash: [[19, 0], [-12, -13], [-5, 0], [-12, 13]],
    hunter: [[20, 0], [-7, -13], [-5, -5], [-15, -6], [-8, 0], [-15, 6], [-5, 5], [-7, 13]],
    flagship: [[28, 0], [15, -19], [-8, -19], [-9, -10], [-18, -13], [-20, 0], [-18, 13], [-9, 10], [-8, 19], [15, 19]],
  };
  const points = shapes[ship];
  ctx.beginPath();
  ctx.moveTo(points[0][0] * scale, points[0][1] * scale);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0] * scale, points[i][1] * scale);
  ctx.closePath();
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
  const [shipId, setShipId] = useState<ShipId>("wing");
  const gameRef = useRef<Game>(createGame(selectedShip("wing")));
  const keys = useRef<Record<string, boolean>>({});
  /** Keys released since the last tick; cleared only after a tick reads them. */
  const pendingRelease = useRef<string[]>([]);
  const [hud, setHud] = useState<Hud>(() => hudFrom(createGame(selectedShip("wing"))));
  const [sound, setSound] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [device, setDevice] = useState<DeviceLayout>(DESKTOP_LAYOUT);
  const [layoutPref, setLayoutPref] = useState<LayoutPref>("auto");
  const [menuOpen, setMenuOpen] = useState(false);
  const [cameraLocked, setCameraLocked] = useState(true);
  const [viewSize, setViewSize] = useState<"compact" | "standard" | "wide">("standard");
  const [quality, setQuality] = useState<QualityMode>("auto");
  const [autoLabel, setAutoLabel] = useState("HIGH");
  const [moveStickPosition, setMoveStickPosition] = useState<StickPosition>({ active: false, x: 0, y: 0 });
  const [aimStickPosition, setAimStickPosition] = useState<StickPosition>({ active: false, x: 0, y: 0 });
  const [inspect, setInspect] = useState<{ id: PickupId; pinned: boolean } | null>(null);
  const [codexOpen, setCodexOpen] = useState(false);
  const reducedMotion = useReducedMotion();

  const soundRef = useRef(true);
  const cameraRef = useRef(true);
  const qualityRef = useRef<QualityMode>("auto");
  const reducedMotionRef = useRef(false);
  /** CSS pixels of arena covered by the HTML HUD strip, for the canvas to skip. */
  const hudInsetRef = useRef(0);
  const audioPool = useRef<Map<string, HTMLAudioElement[]>>(new Map());

  useEffect(() => { soundRef.current = sound; }, [sound]);
  useEffect(() => { cameraRef.current = cameraLocked; }, [cameraLocked]);
  useEffect(() => { qualityRef.current = quality; }, [quality]);
  useEffect(() => { reducedMotionRef.current = reducedMotion; }, [reducedMotion]);

  const gameActive = hud.running && !hud.result;
  const touchCapable = device.touch;
  // Immersive is a property of the hardware, not of the match in progress.
  const immersive = layoutPref === "game" || (layoutPref === "auto" && device.handheld);

  useEffect(() => {
    // Touch capability, never viewport width: Fire OS Silk and some Android
    // tablet browsers report a fine pointer while still being touch-only.
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    let frame = 0;
    const measure = () => {
      frame = 0;
      setDevice((previous) => {
        const next = readDeviceLayout();
        return previous.arena === next.arena
          && previous.stick === next.stick
          && previous.sticks === next.sticks
          && previous.orientation === next.orientation
          && previous.form === next.form
          && previous.narrow === next.narrow
          && previous.touch === next.touch
          && previous.coarse === next.coarse
          && previous.handheld === next.handheld
          ? previous
          : next;
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    coarsePointer.addEventListener?.("change", schedule);
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("orientationchange", schedule, { passive: true });
    window.addEventListener("touchstart", schedule, { passive: true, once: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      coarsePointer.removeEventListener?.("change", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.removeEventListener("touchstart", schedule);
    };
  }, []);

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
    hudInsetRef.current = immersive && device.sticks === "overlay" ? 44 : 0;
  }, [immersive, device.sticks]);

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

  const start = useCallback(() => {
    const game = createGame(selectedShip(shipId));
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
    sync();
    canvasWrapRef.current?.focus({ preventScroll: true });
    play("magic", 0.28);
  }, [play, shipId, sync]);

  const togglePause = useCallback(() => {
    const game = gameRef.current;
    if (!game.running || game.result) return;
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

  useEffect(() => {
    const gameKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "KeyE", "KeyQ", "KeyP"];
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
      game.spawns.push({ x, y, type, kind, age: 0, life: kind === "hostile" ? 110 : 80, count });
      game.portalPulse = 1;
    };

    const damagePlayer = (game: Game, amount: number) => {
      const player = game.player;
      if (player.invuln > 0 || player.shield > 0) return;
      player.health -= amount;
      player.invuln = 24;
      burst(game, player.x, player.y, "#ff5570", 18, 7);
      play("explosion", 0.24);
      if (player.health <= 0) {
        player.health = 0;
        game.running = false;
        game.result = "defeat";
        game.notice = "SHIP DESTROYED";
        burst(game, player.x, player.y, "#ffb346", 70, 13);
      }
    };

    const addIncoming = (game: Game, power: PowerId) => {
      const count = ENEMY_COUNTS[power];
      for (let i = 0; i < count; i += 1) game.enemies.push(makeEnemy(power, game.portalX, game.portalY, i, count));
      game.incoming = power;
      game.notice = `INCOMING // ${POWER_LABELS[power]}`;
      game.noticeLife = 140;
      pushSpawn(game, "hostile", power, game.portalX, game.portalY, count);
      burst(game, game.portalX, game.portalY, POWER_COLORS[power], 26, 9);
      play(power === "nuke" ? "explosion" : "magic", 0.28);
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
      if (player.specialCooldown > 0 || !keys.current.KeyQ) return;
      const ship = game.ship.id;
      if (ship === "turtle") {
        game.enemies.forEach((enemy) => {
          if (enemy.kind !== "ghost") destroyEnemy(game, enemy);
        });
        player.health = Math.max(1, player.health - (Math.random() < 0.75 ? 20 : 0));
        game.notice = "TURTLE CANNON";
        player.specialCooldown = 10;
      } else if (ship === "flash") {
        player.flashMode = player.flashMode === "tank" ? "squid" : "tank";
        game.notice = `FLASH // ${player.flashMode.toUpperCase()} FORM`;
        player.specialCooldown = 4;
      } else if (ship === "hunter") {
        for (let i = 0; i < 17; i += 1) {
          const angle = (player.angle + (i - 8) * 12) * DEG;
          game.bullets.push({ x: player.x, y: player.y, vx: Math.cos(angle) * 8, vy: Math.sin(angle) * 8, damage: 15, life: 105, enemy: false, color: "#ff5f70" });
          game.playerShots += 1;
        }
        game.notice = "PIRANHA ARRAY";
        player.specialCooldown = 1333;
        play("fire", 0.3);
      } else if (ship === "flagship") {
        game.pickups.forEach((pickup) => {
          const dx = player.x - pickup.x;
          const dy = player.y - pickup.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          pickup.vx += (dx / d) * 0.8;
          pickup.vy += (dy / d) * 0.8;
        });
        game.enemies.forEach((enemy) => {
          const dx = enemy.x - player.x;
          const dy = enemy.y - player.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          if (d < 300) { enemy.vx += (dx / d) * 1.2; enemy.vy += (dy / d) * 1.2; }
        });
        game.notice = "A/R FIELD PULSE";
        player.specialCooldown = 18;
      }
      if (player.specialCooldown > 0) {
        game.noticeLife = 80;
        burst(game, player.x, player.y, "#68f2ff", 26, 8);
        play("magic", 0.22);
      }
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
        damagePlayer(game, enemy.kind === "mines" ? 20 : enemy.kind === "inflator" ? 18 : enemy.kind === "heatseeker" ? 10 : 8);
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
      game.portalAngle = (game.portalAngle + 0.5) % 360;
      game.portalX = game.worldSize / 2 + Math.cos(game.portalAngle * DEG) * 210;
      game.portalY = game.worldSize / 2 + Math.sin(game.portalAngle * DEG) * 210;

      const movementHeading = moveHeading.current;
      const firingHeading = aimHeading.current;
      let left = keys.current.ArrowLeft || keys.current.KeyA;
      let right = keys.current.ArrowRight || keys.current.KeyD;
      let thrust = keys.current.ArrowUp || keys.current.KeyW;
      let fire = keys.current.Space;
      const launch = keys.current.KeyE;
      if (player.emp > 0) {
        [left, right] = [right, left];
        if (game.cycles % 3 === 0) [thrust, fire] = [fire, thrust];
      }

      let handling = game.ship;
      if (game.ship.id === "flash") handling = player.flashMode === "tank" ? SHIPS[0] : SHIPS[2];
      const maxSpeed = handling.maxSpeed + player.thrust * THRUST_SPEED_BONUS;
      const acceleration = handling.acceleration + player.thrust * THRUST_ACCEL_BONUS;
      if (movementHeading !== null) {
        const movementAngle = (player.emp > 0 ? movementHeading + 180 : movementHeading) * DEG;
        if (firingHeading === null) player.angle = movementAngle / DEG;
        const directedSpeed = Math.min(maxSpeed, Math.hypot(player.vx, player.vy) + acceleration);
        player.vx = Math.cos(movementAngle) * directedSpeed;
        player.vy = Math.sin(movementAngle) * directedSpeed;
        if (game.cycles % 3 === 0) burst(game, player.x - Math.cos(movementAngle) * 14, player.y - Math.sin(movementAngle) * 14, "#63efff", 2, 2.5);
      } else {
        if (left) player.angle -= handling.turn;
        if (right) player.angle += handling.turn;
      }
      if (movementHeading === null && thrust) {
        player.vx += Math.cos(player.angle * DEG) * acceleration;
        player.vy += Math.sin(player.angle * DEG) * acceleration;
        if (game.cycles % 3 === 0) burst(game, player.x - Math.cos(player.angle * DEG) * 14, player.y - Math.sin(player.angle * DEG) * 14, "#63efff", 2, 2.5);
      } else if (movementHeading === null && player.retros) {
        player.vx *= 0.995;
        player.vy *= 0.995;
      }
      if (firingHeading !== null) player.angle = player.emp > 0 ? firingHeading + 180 : firingHeading;
      const playerSpeed = Math.hypot(player.vx, player.vy);
      if (playerSpeed > maxSpeed) { player.vx = (player.vx / playerSpeed) * maxSpeed; player.vy = (player.vy / playerSpeed) * maxSpeed; }
      player.x += player.vx;
      player.y += player.vy;
      if (player.x < 12 || player.x > game.worldSize - 12) { player.x = cap(player.x, 12, game.worldSize - 12); player.vx *= -0.55; damagePlayer(game, 2); }
      if (player.y < 12 || player.y > game.worldSize - 12) { player.y = cap(player.y, 12, game.worldSize - 12); player.vy *= -0.55; damagePlayer(game, 2); }

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
        game.notice = `${POWER_LABELS[type]} ARMED`;
        game.noticeLife = 75;
        burst(game, player.x, player.y, POWER_COLORS[type], 10, 4);
        play("fire", 0.2);
      }
      if (!launch) keys.current.__launchLatch = false;
      activateSpecial(game);

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
            game.notice = `${POWER_LABELS[type]} GENERATED`;
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
          const damage = rivalDamageFor(power.type);
          game.rivalHealth -= damage;
          game.score += 750 + damage * 10;
          game.notice = `${POWER_LABELS[power.type]} TRANSMITTED`;
          game.noticeLife = 115;
          pushSpawn(game, "transmit", power.type, game.portalX, game.portalY, damage);
          burst(game, game.portalX, game.portalY, POWER_COLORS[power.type], 38, 11);
          play("magic", 0.32);
          if (game.rivalHealth <= 0) {
            game.rivalHealth = 0;
            game.running = false;
            game.result = "victory";
            game.notice = "RIVAL ELIMINATED";
            burst(game, game.portalX, game.portalY, "#ff5ac8", 90, 16);
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
          game.notice = `${POWER_LABELS[type]} ACQUIRED`;
          game.noticeLife = 100;
          burst(game, pickup.x, pickup.y, POWER_COLORS[type], 16, 5);
          play("magic", 0.25);
        }
      });

      if (game.botTimer <= 0 && game.running) {
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
        ctx.strokeStyle = radius % 8 === 0 ? "rgba(255,84,194,.42)" : "rgba(125,80,255,.3)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, radius, radius / 2, time * 0.0015 + radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 55);
      glow.addColorStop(0, "rgba(255,255,255,.95)");
      glow.addColorStop(.12, "rgba(255,76,190,.9)");
      glow.addColorStop(.48, "rgba(73,31,116,.45)");
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
      ctx.strokeStyle = charge > 0.75 ? "#b2ff62" : "#ff70cc";
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
      const chargeY = compactUi ? top + noticeH + 6 : top;

      // Mission notice, falling back to the next thing the player has to do.
      const live = game.noticeLife > 0;
      const noticeText = live ? game.notice : coachLine(game);
      ctx.font = mono(live ? 800 : 700, live ? 12.5 : 12);
      const noticeW = Math.min(noticeRoom, ctx.measureText(noticeText).width + pad * 1.8);
      panel(pad, top, noticeW, noticeH, "rgba(102,225,255,.24)");
      ctx.fillStyle = live ? "#eafcff" : "#a7c8d1";
      ctx.textAlign = "left";
      ctx.fillText(fit(noticeText, noticeW - pad * 1.6), pad + pad * 0.8, top + noticeH / 2);

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

      // Spawn nameplates, projected from the portal into HUD space.
      let plateRow = 0;
      for (const spawn of game.spawns) {
        const p = cap(spawn.age / spawn.life, 0, 1);
        const meta = WEAPONS[spawn.type];
        const sx = (spawn.x * camera.camScale + camera.camX) * (W / BOARD);
        const sy = (spawn.y * camera.camScale + camera.camY) * (W / BOARD);
        if (sx < -80 || sx > W + 80 || sy < -80 || sy > W + 80) continue;
        const alpha = p < 0.15 ? p / 0.15 : cap((1 - p) / 0.35, 0, 1);
        const heading = spawn.kind === "hostile"
          ? `⚠ INCOMING  ${meta.name}${spawn.count > 1 ? `  ×${spawn.count}` : ""}`
          : spawn.kind === "friendly"
            ? `+ ${meta.name}  READY TO COLLECT`
            : `${meta.name}  SENT  ·  RIVAL −${spawn.count}`;
        const sub = spawn.kind === "hostile"
          ? `THREAT ${threatBadge(meta)}  ·  ${CATEGORY_LABELS[meta.category]}`
          : spawn.kind === "friendly"
            ? "FLY OVER IT TO COLLECT"
            : "TRANSMITTED THROUGH THE WORMHOLE";
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = mono(800, 12.5);
        ctx.textAlign = "center";
        const plateW = Math.max(ctx.measureText(heading).width, ctx.measureText(sub).width) + pad * 2;
        const plateH = Math.round(fs(12) * 3.2);
        const plateX = cap(sx - plateW / 2, 4, Math.max(4, W - plateW - 4));
        // Keep nameplates clear of the fixed HUD band at the top of the arena.
        const plateTop = chargeY + chargeH + 8;
        const stacked = plateRow * (plateH + 6);
        plateRow += 1;
        const plateY = cap(sy - plateH - 74 * camera.camScale * (W / BOARD) - stacked, plateTop + stacked, Math.max(plateTop + stacked, W - plateH - 4));
        const accent = spawn.kind === "hostile" ? "#ff6a80" : spawn.kind === "friendly" ? "#8dffd0" : meta.color;
        panel(plateX, plateY, plateW, plateH, `${accent}88`);
        ctx.fillStyle = spawn.kind === "hostile" ? "#ffd7dd" : "#eafcff";
        ctx.fillText(heading, plateX + plateW / 2, plateY + fs(12) * 1.05);
        ctx.fillStyle = accent;
        ctx.font = mono(700, 11.5);
        ctx.fillText(sub, plateX + plateW / 2, plateY + fs(12) * 2.25);
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
          : "ARROWS / WASD FLY  ·  SPACE CANNON  ·  E POWER-UP  ·  Q SPECIAL  ·  P PAUSE";
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
  const healthPct = hud.maxHealth ? hud.health / hud.maxHealth * 100 : 0;
  const queued = nextWeapon(hud.stock);
  const guidance = hud.notice || hud.coach;
  const qualityName = quality === "auto" ? "AUTO" : quality === "high" ? "HIGH" : "PERF";

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

  const layoutLabel = layoutPref === "auto" ? (immersive ? "AUTO · GAME" : "AUTO · DESK") : layoutPref === "game" ? "GAME" : "DESKTOP";
  const cycleLayout = () => setLayoutPref((value) => (value === "auto" ? "game" : value === "game" ? "desktop" : "auto"));
  const cycleQuality = () => setQuality((value) => (value === "auto" ? "high" : value === "high" ? "performance" : "auto"));
  const cycleView = () => setViewSize((value) => (value === "compact" ? "standard" : value === "standard" ? "wide" : "compact"));

  return (
    <main
      ref={shellRef}
      className={`app-shell view-${viewSize} ${touchCapable ? "touch-capable" : ""} ${immersive || device.narrow ? "compact-menu" : ""}`}
      data-immersive={immersive ? "true" : "false"}
      data-orientation={device.orientation}
      data-form={device.form}
      data-sticks={device.sticks}
      style={immersive ? ({ "--arena-size": `${device.arena}px`, "--stick": `${device.stick}px` } as React.CSSProperties) : undefined}
    >
      <p className="sr-only" aria-live="polite">{guidance}</p>

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">W/02</span>
          <div><h1>WORMHOLE <em>ARCADE</em></h1><p>NEW GROUND // COMBAT NETWORK</p></div>
        </div>
        <div className="top-actions" ref={topActionsRef}>
          <span className="link-status"><i aria-hidden="true" /> SOLO LINK</span>
          {/* Secondary controls lay out inline on wide screens and collapse into
              the MENU panel on handhelds, so the row never needs scrolling. */}
          <div className="top-secondary" id="top-secondary" data-open={menuOpen ? "true" : "false"}>
            <label className="menu-ship">
              <span>SHIP FRAME</span>
              <select
                aria-label="Select ship frame"
                value={shipId}
                disabled={gameActive}
                onChange={(event) => setShipId(event.target.value as ShipId)}
              >
                {SHIPS.map((ship) => <option value={ship.id} key={ship.id}>{ship.name} — {ship.role}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => { setCodexOpen(true); setMenuOpen(false); }} aria-haspopup="dialog">WEAPONS</button>
            <button type="button" onClick={cycleView} aria-label={`Arena width: ${viewSize}. Activate to change.`}>VIEW {viewSize.toUpperCase()}</button>
            <button type="button" aria-pressed={cameraLocked} onClick={() => setCameraLocked((value) => !value)} aria-label={cameraLocked ? "Camera follows your ship. Activate for the whole arena." : "Camera shows the whole arena. Activate to follow your ship."}>
              {cameraLocked ? "CAMERA SHIP" : "CAMERA ARENA"}
            </button>
            <button type="button" onClick={cycleQuality} aria-label={`Render quality: ${quality}${quality === "auto" ? `, currently ${autoLabel}` : ""}. Activate to change.`}>
              QUALITY {qualityName}
              {quality === "auto" ? <span className="q-detail"> · {autoLabel}</span> : null}
            </button>
            <button type="button" onClick={cycleLayout} aria-label={`Layout: ${layoutLabel}. Activate to change.`}>LAYOUT {layoutLabel}</button>
            <button type="button" aria-pressed={sound} onClick={() => setSound((value) => !value)}>{sound ? "SOUND ON" : "SOUND OFF"}</button>
            <button className="fullscreen-trigger" type="button" aria-pressed={fullscreen} onClick={toggleFullscreen}>{fullscreen ? "EXIT FULL" : "FULLSCREEN"}</button>
          </div>
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
          <div className="eyebrow">SHIP SELECT // 8 FRAMES</div>
          <div className="selected-ship">
            <div className="ship-icon" aria-hidden="true"><span className={`ship-glyph ${currentShip.id}`} /></div>
            <div><h2>{currentShip.name}</h2><p>{currentShip.role}</p></div>
          </div>
          <div className="ship-select-grid" role="group" aria-label="Choose a ship frame">
            {SHIPS.map((ship) => (
              <button
                type="button"
                key={ship.id}
                className={shipId === ship.id ? "active" : ""}
                aria-pressed={shipId === ship.id}
                onClick={() => { if (!hud.running) setShipId(ship.id); }}
                disabled={hud.running && !hud.result}
              >
                <span>{ship.name.replace("The ", "")}</span>
                <small>{ship.unlock}</small>
              </button>
            ))}
          </div>
          <p className="ship-description">{currentShip.special}</p>
          <div className="data-grid">
            <div><span>HULL</span><b>{currentShip.health}</b></div>
            <div><span>TURN</span><b>{currentShip.turn}°</b></div>
            <div><span>MAX V</span><b>{currentShip.maxSpeed}</b></div>
            <div><span>ACCEL</span><b>{currentShip.acceleration}</b></div>
          </div>
          <div className="controls">
            <div className="eyebrow">FLIGHT CONTROL</div>
            <dl>
              <div><dt>ROTATE</dt><dd>← → / A D</dd></div>
              <div><dt>THRUST</dt><dd>↑ / W</dd></div>
              <div><dt>PULSE CANNON</dt><dd>SPACE</dd></div>
              <div><dt>FIRE POWER-UP</dt><dd>E</dd></div>
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
            <div className="rival"><span>RIVAL INTEGRITY</span><div className="meter"><i style={{ width: `${hud.rivalHealth}%` }} /></div><b>{hud.rivalHealth}%</b></div>
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
                role="img"
                aria-label={`Wormhole combat arena. Hull ${hud.health} of ${hud.maxHealth}. Wormhole charge ${hud.portalCharge} percent. Rival integrity ${hud.rivalHealth} percent. ${queued ? `Next power-up ${WEAPONS[queued].name}.` : "Power-up bin empty."}`}
              />
              <div className="pilot-health">
                <span><em>PILOT HULL</em><b>{hud.health}/{hud.maxHealth}</b></span>
                <div className="meter hull"><i style={{ width: `${healthPct}%` }} /></div>
              </div>
              <i className="reticle tl" aria-hidden="true" /><i className="reticle tr" aria-hidden="true" />
              <i className="reticle bl" aria-hidden="true" /><i className="reticle br" aria-hidden="true" />
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
                  <button className="touch-special" type="button" aria-label="Activate ship special. Same as keyboard Q." {...controlProps("KeyQ")}>
                    <b>SPEC</b><small>Q</small>
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
    </main>
  );
}
