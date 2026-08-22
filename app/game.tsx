"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  POWER_COLORS,
  POWER_LABELS,
  SENDABLE_POWERUPS,
  SHIPS,
  SHOT_LEVELS,
  type PickupId,
  type PowerId,
  type ShipId,
  type ShipSpec,
} from "./game-data";

const BOARD = 655;
const WORLD_SIZE = 940;
const TICK_MS = 15;
const PORTAL_THRESHOLD = 150;
const DEG = Math.PI / 180;
const THRUST_ACCEL_BONUS = 0.035;
const THRUST_SPEED_BONUS = 0.25;

type Bullet = { x: number; y: number; vx: number; vy: number; damage: number; life: number; enemy: boolean; color: string };
type Pickup = { x: number; y: number; vx: number; vy: number; type: PickupId; life: number; phase: number };
type PowerShot = { x: number; y: number; vx: number; vy: number; type: PowerId; life: number };
type Particle = { x: number; y: number; vx: number; vy: number; color: string; size: number; life: number };
type StickPosition = { active: boolean; x: number; y: number };
type StickKind = "move" | "aim";
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
  bullets: Bullet[];
  pickups: Pickup[];
  enemies: Enemy[];
  powers: PowerShot[];
  particles: Particle[];
  stock: PowerId[];
  score: number;
  rivalHealth: number;
  cycles: number;
  botTimer: number;
  shotCycle: number;
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
};

const enemyStats: Record<PowerId, { hp: number; radius: number }> = {
  heatseeker: { hp: 1, radius: 6 },
  turret: { hp: 45, radius: 13 },
  mines: { hp: 5, radius: 15 },
  ufo: { hp: 40, radius: 25 },
  inflator: { hp: 30, radius: 20 },
  minelayer: { hp: 55, radius: 18 },
  gunship: { hp: 80, radius: 25 },
  scarab: { hp: 35, radius: 15 },
  nuke: { hp: 100, radius: 20 },
  wallcrawler: { hp: 150, radius: 20 },
  beam: { hp: 10, radius: 12 },
  emp: { hp: 1, radius: 8 },
  ghost: { hp: 9999, radius: 16 },
  artillery: { hp: 60, radius: 20 },
};

const enemyCounts: Record<PowerId, number> = {
  heatseeker: 12,
  turret: 1,
  mines: 15,
  ufo: 3,
  inflator: 4,
  minelayer: 2,
  gunship: 1,
  scarab: 2,
  nuke: 1,
  wallcrawler: 1,
  beam: 1,
  emp: 1,
  ghost: 1,
  artillery: 2,
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
    bullets: [],
    pickups: [],
    enemies: [],
    powers: [],
    particles: [],
    stock: [],
    score: 0,
    rivalHealth: 100,
    cycles: 0,
    botTimer: 330,
    shotCycle: 0,
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
  };
}

function spawnParticles(game: Game, x: number, y: number, color: string, count = 12, speed = 4) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const force = Math.random() * speed;
    game.particles.push({ x, y, vx: Math.cos(angle) * force, vy: Math.sin(angle) * force, color, size: range(1, 3.4), life: range(18, 55) });
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
  const stats = enemyStats[kind];
  const angle = (index / Math.max(1, count)) * Math.PI * 2 + range(-0.18, 0.18);
  let speed = kind === "mines" ? 6 : kind === "heatseeker" ? 7 : range(0.8, 2.8);
  if (["turret", "beam", "emp", "nuke"].includes(kind)) speed = 0;
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

export default function WormholeGame() {
  const shellRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const moveStickRef = useRef<HTMLDivElement>(null);
  const aimStickRef = useRef<HTMLDivElement>(null);
  const moveStickPointer = useRef<number | null>(null);
  const aimStickPointer = useRef<number | null>(null);
  const moveHeading = useRef<number | null>(null);
  const aimHeading = useRef<number | null>(null);
  const [shipId, setShipId] = useState<ShipId>("wing");
  const gameRef = useRef<Game>(createGame(selectedShip("wing")));
  const keys = useRef<Record<string, boolean>>({});
  const [hud, setHud] = useState<Hud>(() => hudFrom(createGame(selectedShip("wing"))));
  const [sound, setSound] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [touchCapable, setTouchCapable] = useState(false);
  const [cameraLocked, setCameraLocked] = useState(true);
  const [viewSize, setViewSize] = useState<"compact" | "standard" | "wide">("standard");
  const [moveStickPosition, setMoveStickPosition] = useState<StickPosition>({ active: false, x: 0, y: 0 });
  const [aimStickPosition, setAimStickPosition] = useState<StickPosition>({ active: false, x: 0, y: 0 });
  const soundRef = useRef(true);

  useEffect(() => { soundRef.current = sound; }, [sound]);

  useEffect(() => {
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    const detectTouch = () => setTouchCapable(navigator.maxTouchPoints > 0 || coarsePointer.matches || "ontouchstart" in window);
    detectTouch();
    coarsePointer.addEventListener?.("change", detectTouch);
    window.addEventListener("touchstart", detectTouch, { passive: true, once: true });
    return () => {
      coarsePointer.removeEventListener?.("change", detectTouch);
      window.removeEventListener("touchstart", detectTouch);
    };
  }, []);

  useEffect(() => {
    const updateFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  const play = useCallback((name: "fire" | "explosion" | "magic" | "thrust", volume = 0.22) => {
    if (!soundRef.current) return;
    const audio = new Audio(`/sounds/${name}.wav`);
    audio.volume = volume;
    void audio.play().catch(() => undefined);
  }, []);

  const sync = useCallback(() => setHud(hudFrom(gameRef.current)), []);

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
    sync();
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
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(8);
    updateStick(kind, event.clientX, event.clientY);
  }, [setControl, updateStick]);

  const moveStick = useCallback((kind: StickKind, event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = kind === "move" ? moveStickPointer : aimStickPointer;
    if (pointer.current !== event.pointerId) return;
    event.preventDefault();
    updateStick(kind, event.clientX, event.clientY);
  }, [updateStick]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const code = event.code;
      if (["ArrowUp", "ArrowLeft", "ArrowRight", "Space", "KeyE", "KeyQ", "KeyP"].includes(code)) event.preventDefault();
      if (code === "Enter" && (!gameRef.current.running || gameRef.current.result)) start();
      if (code === "KeyP" && !event.repeat) togglePause();
      keys.current[code] = true;
    };
    const up = (event: KeyboardEvent) => { keys.current[event.code] = false; };
    const blur = () => {
      keys.current = {};
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
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let renderScale = 1;
    let raf = 0;
    let previous = performance.now();
    let accumulator = 0;
    let hudDelay = 0;

    const syncCanvasResolution = () => {
      renderScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      const width = Math.round(BOARD * renderScale);
      if (canvas.width !== width || canvas.height !== width) {
        canvas.width = width;
        canvas.height = width;
      }
    };
    syncCanvasResolution();
    window.addEventListener("resize", syncCanvasResolution, { passive: true });

    const damagePlayer = (game: Game, amount: number) => {
      const player = game.player;
      if (player.invuln > 0 || player.shield > 0) return;
      player.health -= amount;
      player.invuln = 24;
      spawnParticles(game, player.x, player.y, "#ff5570", 18, 7);
      play("explosion", 0.24);
      if (player.health <= 0) {
        player.health = 0;
        game.running = false;
        game.result = "defeat";
        game.notice = "SHIP DESTROYED";
        spawnParticles(game, player.x, player.y, "#ffb346", 70, 13);
      }
    };

    const addIncoming = (game: Game, power: PowerId) => {
      const count = enemyCounts[power];
      for (let i = 0; i < count; i += 1) game.enemies.push(makeEnemy(power, game.portalX, game.portalY, i, count));
      game.incoming = power;
      game.notice = `INCOMING // ${POWER_LABELS[power]}`;
      game.noticeLife = 120;
      play(power === "nuke" ? "explosion" : "magic", 0.28);
    };

    const destroyEnemy = (game: Game, enemy: Enemy) => {
      enemy.hp = 0;
      game.score += enemy.kind === "nuke" ? 600 : enemy.kind === "gunship" ? 300 : 100;
      spawnParticles(game, enemy.x, enemy.y, POWER_COLORS[enemy.kind], 18, 8);
      play("explosion", 0.16);
      if (!["ghost", "beam", "emp", "mines"].includes(enemy.kind) && Math.random() < 0.48) {
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
        spawnParticles(game, player.x, player.y, "#68f2ff", 26, 8);
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
      } else if (["gunship", "artillery", "turret"].includes(enemy.kind)) {
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

      if (!(["turret", "beam", "emp", "nuke"].includes(enemy.kind))) {
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
        if (!(["ufo", "ghost", "wallcrawler", "gunship"].includes(enemy.kind))) enemy.hp = 0;
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
        if (game.cycles % 3 === 0) spawnParticles(game, player.x - Math.cos(movementAngle) * 14, player.y - Math.sin(movementAngle) * 14, "#63efff", 2, 2.5);
      } else {
        if (left) player.angle -= handling.turn;
        if (right) player.angle += handling.turn;
      }
      if (movementHeading === null && thrust) {
        player.vx += Math.cos(player.angle * DEG) * acceleration;
        player.vy += Math.sin(player.angle * DEG) * acceleration;
        if (game.cycles % 3 === 0) spawnParticles(game, player.x - Math.cos(player.angle * DEG) * 14, player.y - Math.sin(player.angle * DEG) * 14, "#63efff", 2, 2.5);
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

      if (fire && game.shotCycle <= 0 && game.bullets.filter((bullet) => !bullet.enemy).length < SHOT_LEVELS[player.gun].maxShots) {
        const shot = SHOT_LEVELS[player.gun];
        const offsets = shot.shots === 2 ? [-0.05, 0.05] : [0];
        offsets.forEach((offset) => {
          const angle = player.angle * DEG + offset;
          game.bullets.push({ x: player.x + Math.cos(angle) * 12, y: player.y + Math.sin(angle) * 12, vx: Math.cos(angle) * 10 + player.vx, vy: Math.sin(angle) * 10 + player.vy, damage: shot.damage, life: 110, enemy: false, color: shot.color });
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
          spawnParticles(game, bullet.x, bullet.y, "#ff5ac8", 4, 2.5);
          if (game.portalCharge > PORTAL_THRESHOLD) {
            game.portalCharge = 0;
            const type = randomPower();
            game.pickups.push({ x: game.portalX + range(-28, 28), y: game.portalY + range(-28, 28), vx: range(-1.2, 1.2), vy: range(-1.2, 1.2), type, life: 900, phase: range(0, 6) });
            game.notice = `${POWER_LABELS[type]} GENERATED`;
            game.noticeLife = 90;
            play("magic", 0.22);
          }
        }
        for (const enemy of game.enemies) {
          if (enemy.hp <= 0 || bullet.life <= 0 || enemy.kind === "ghost") continue;
          if (dist(bullet, enemy) < enemy.radius + 4) {
            bullet.life = 0;
            enemy.hp -= bullet.damage;
            spawnParticles(game, bullet.x, bullet.y, POWER_COLORS[enemy.kind], 4, 2.5);
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
          const damage = power.type === "nuke" ? 24 : ["beam", "artillery", "gunship"].includes(power.type) ? 18 : 12;
          game.rivalHealth -= damage;
          game.score += 750 + damage * 10;
          game.notice = `${POWER_LABELS[power.type]} TRANSMITTED`;
          game.noticeLife = 105;
          spawnParticles(game, game.portalX, game.portalY, POWER_COLORS[power.type], 38, 11);
          play("magic", 0.32);
          if (game.rivalHealth <= 0) {
            game.rivalHealth = 0;
            game.running = false;
            game.result = "victory";
            game.notice = "RIVAL ELIMINATED";
            spawnParticles(game, game.portalX, game.portalY, "#ff5ac8", 90, 16);
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
          else if (game.stock.length < 5) game.stock.push(type);
          else { game.notice = "POWERUP BIN FULL"; game.noticeLife = 75; return; }
          game.notice = `${POWER_LABELS[type]} ACQUIRED`;
          game.noticeLife = 90;
          spawnParticles(game, pickup.x, pickup.y, POWER_COLORS[type], 16, 5);
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

      game.bullets = game.bullets.filter((item) => item.life > 0 && item.x > -30 && item.x < game.worldSize + 30 && item.y > -30 && item.y < game.worldSize + 30);
      game.pickups = game.pickups.filter((item) => item.life > 0);
      game.powers = game.powers.filter((item) => item.life > 0 && item.x > -30 && item.x < game.worldSize + 30 && item.y > -30 && item.y < game.worldSize + 30);
      game.enemies = game.enemies.filter((item) => item.hp > 0);
      game.particles = game.particles.filter((item) => item.life > 0);
      if (game.incoming && game.noticeLife <= 0) game.incoming = null;

      hudDelay += 1;
      if (hudDelay >= 7 || game.result) { hudDelay = 0; sync(); }
    };

    const drawPortal = (game: Game, time: number) => {
      ctx.save();
      ctx.translate(game.portalX, game.portalY);
      ctx.globalCompositeOperation = "lighter";
      for (let radius = 30; radius < 60; radius += 4) {
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
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(244,226,255,.82)";
      ctx.font = "700 9px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("RIVAL WORMHOLE", 0, 70);
      ctx.restore();
    };

    const drawEnemy = (game: Game, enemy: Enemy, time: number) => {
      const color = POWER_COLORS[enemy.kind];
      ctx.save();
      ctx.translate(enemy.x, enemy.y);
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.strokeStyle = color;
      ctx.fillStyle = `${color}33`;
      ctx.lineWidth = 2;
      if (enemy.kind === "mines") {
        ctx.rotate(time * 0.001);
        for (let i = 0; i < 8; i += 1) { ctx.rotate(Math.PI / 4); ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(15, 0); ctx.stroke(); }
        ctx.fillRect(-6, -6, 12, 12);
      } else if (enemy.kind === "ufo") {
        ctx.beginPath(); ctx.ellipse(0, 0, 25, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(0, -5, 12, 6, 0, Math.PI, Math.PI * 2); ctx.stroke();
      } else if (enemy.kind === "heatseeker") {
        ctx.rotate(Math.atan2(enemy.vy, enemy.vx));
        ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-7, -5); ctx.lineTo(-3, 0); ctx.lineTo(-7, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (enemy.kind === "nuke") {
        if ((enemy.countdown ?? 0) > 0) {
          for (let i = 0; i < 3; i += 1) { ctx.beginPath(); ctx.arc(0, 0, 18, i * 2.1 + time * .003, i * 2.1 + .8 + time * .003); ctx.stroke(); }
          ctx.font = "800 13px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.fillStyle = color; ctx.fillText(String(Math.max(0, Math.ceil((enemy.countdown ?? 0) * TICK_MS / 1000))), 0, 5);
        } else {
          ctx.globalAlpha = .7; ctx.beginPath(); ctx.arc(0, 0, enemy.blastRadius ?? 0, 0, Math.PI * 2); ctx.stroke();
        }
      } else if (enemy.kind === "beam") {
        const angle = Math.atan2(game.player.y - game.portalY, game.player.x - game.portalX) + Math.sin(enemy.phase) * .3;
        if (enemy.age > 45) { ctx.rotate(angle); ctx.lineWidth = 8; ctx.globalAlpha = .55; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(900, 0); ctx.stroke(); }
      } else if (enemy.kind === "emp") {
        ctx.beginPath(); ctx.arc(0, 0, enemy.blastRadius ?? enemy.age * 2, 0, Math.PI * 2); ctx.stroke();
      } else if (enemy.kind === "inflator") {
        ctx.rotate(time * .001);
        ctx.beginPath();
        for (let i = 0; i < 16; i += 1) { const r = i % 2 ? enemy.radius * .72 : enemy.radius; const a = i / 16 * Math.PI * 2; const x = Math.cos(a) * r; const y = Math.sin(a) * r; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (enemy.kind === "ghost") {
        ctx.globalAlpha = .75; ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.stroke();
      } else if (enemy.kind === "wallcrawler") {
        ctx.rotate(Math.atan2(enemy.vy, enemy.vx)); ctx.strokeRect(-18, -9, 36, 18); ctx.fillRect(-4, -12, 8, 24);
      } else {
        ctx.rotate(time * .001 + enemy.phase);
        ctx.beginPath();
        for (let i = 0; i < 8; i += 1) { const a = i / 8 * Math.PI * 2; const r = i % 2 ? enemy.radius * .6 : enemy.radius; const x = Math.cos(a) * r; const y = Math.sin(a) * r; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      if (enemy.maxHp > 5 && enemy.hp < enemy.maxHp && enemy.hp > 0 && enemy.kind !== "nuke") {
        ctx.shadowBlur = 0; ctx.fillStyle = "rgba(0,0,0,.65)"; ctx.fillRect(-16, enemy.radius + 7, 32, 3); ctx.fillStyle = color; ctx.fillRect(-16, enemy.radius + 7, 32 * cap(enemy.hp / enemy.maxHp, 0, 1), 3);
      }
      ctx.restore();
    };

    const draw = (time: number) => {
      const game = gameRef.current;
      const player = game.player;
      ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
      const gradient = ctx.createRadialGradient(BOARD / 2, BOARD / 2, 10, BOARD / 2, BOARD / 2, BOARD * .72);
      gradient.addColorStop(0, "#0b1520");
      gradient.addColorStop(.58, "#050b12");
      gradient.addColorStop(1, "#020409");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, BOARD, BOARD);
      for (let i = 0; i < 85; i += 1) {
        const x = (i * 83.17) % BOARD;
        const y = (i * 47.31) % BOARD;
        const alpha = .22 + Math.sin(time * .001 + i) * .18;
        ctx.fillStyle = i % 8 === 0 ? `rgba(103,232,255,${alpha})` : `rgba(255,255,255,${alpha})`;
        ctx.fillRect(x, y, i % 11 === 0 ? 2 : 1, i % 11 === 0 ? 2 : 1);
      }
      ctx.strokeStyle = "rgba(86, 176, 200, .055)";
      ctx.lineWidth = 1;
      for (let p = 30; p < BOARD; p += 30) { ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, BOARD); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(BOARD, p); ctx.stroke(); }

      ctx.save();
      if (cameraLocked) {
        const cameraX = cap(BOARD / 2 - player.x, BOARD - game.worldSize, 0);
        const cameraY = cap(BOARD / 2 - player.y, BOARD - game.worldSize, 0);
        ctx.translate(cameraX, cameraY);
      } else {
        const overviewScale = BOARD / game.worldSize;
        ctx.scale(overviewScale, overviewScale);
      }
      drawPortal(game, time);
      game.pickups.forEach((pickup) => {
        const color = POWER_COLORS[pickup.type];
        ctx.save(); ctx.translate(pickup.x, pickup.y); ctx.rotate(pickup.phase); ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.fillStyle = color; ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#031019"; ctx.font = "900 8px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(POWER_LABELS[pickup.type].slice(0, 2), 0, 0); ctx.restore();
      });
      game.enemies.forEach((enemy) => drawEnemy(game, enemy, time));
      game.bullets.forEach((bullet) => {
        ctx.save(); ctx.strokeStyle = bullet.color; ctx.shadowColor = bullet.color; ctx.shadowBlur = 8; ctx.lineWidth = bullet.enemy ? 2.5 : 2; ctx.beginPath(); ctx.moveTo(bullet.x, bullet.y); ctx.lineTo(bullet.x - bullet.vx * 2.2, bullet.y - bullet.vy * 2.2); ctx.stroke(); ctx.restore();
      });
      game.powers.forEach((power) => {
        const color = POWER_COLORS[power.type]; ctx.save(); ctx.translate(power.x, power.y); ctx.rotate(Math.atan2(power.vy, power.vx)); ctx.shadowColor = color; ctx.shadowBlur = 18; ctx.fillStyle = color; ctx.fillRect(-12, -6, 24, 12); ctx.fillStyle = "#061018"; ctx.font = "900 8px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(POWER_LABELS[power.type].slice(0, 1), 0, 0); ctx.restore();
      });
      game.particles.forEach((particle) => { ctx.globalAlpha = cap(particle.life / 28, 0, 1); ctx.fillStyle = particle.color; ctx.fillRect(particle.x, particle.y, particle.size, particle.size); });
      ctx.globalAlpha = 1;

      if (player.health > 0) {
        ctx.save(); ctx.translate(player.x, player.y); ctx.rotate(player.angle * DEG); ctx.strokeStyle = "#69ecff"; ctx.fillStyle = "rgba(86, 226, 255, .12)"; ctx.shadowColor = "#62eaff"; ctx.shadowBlur = 10; ctx.lineWidth = 2; drawShipShape(ctx, game.ship.id, game.ship.id === "flagship" ? .82 : 1); ctx.fill(); ctx.stroke();
        if (player.shield > 0 || player.invuln > 0) { ctx.strokeStyle = player.invuln > 0 ? "#ffffff" : "#76a7ff"; ctx.globalAlpha = .7; ctx.beginPath(); ctx.arc(0, 0, game.ship.id === "flagship" ? 30 : 22, 0, Math.PI * 2); ctx.stroke(); }
        ctx.restore();
      }
      ctx.restore();

      ctx.fillStyle = "rgba(2,7,12,.76)"; ctx.fillRect(10, 10, 248, 28); ctx.strokeStyle = "rgba(102,225,255,.18)"; ctx.strokeRect(10.5, 10.5, 247, 27);
      ctx.fillStyle = game.noticeLife > 0 ? "#e9fcff" : "#6f939e"; ctx.font = "700 11px ui-monospace, monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(game.noticeLife > 0 ? game.notice : "SHOOT WORMHOLE // COLLECT // RETURN FIRE", 20, 24);
      ctx.fillStyle = "rgba(2,7,12,.84)"; ctx.fillRect(BOARD - 170, 10, 160, 42); ctx.strokeStyle = "rgba(255,86,194,.28)"; ctx.strokeRect(BOARD - 169.5, 10.5, 159, 41); ctx.fillStyle = "#ff70cc"; ctx.textAlign = "center"; ctx.font = "800 11px ui-monospace, monospace"; ctx.fillText(`WORMHOLE CHARGE ${Math.round(game.portalCharge / PORTAL_THRESHOLD * 100)}%`, BOARD - 90, 24); ctx.fillStyle = "#8eaab2"; ctx.font = "700 8px ui-monospace, monospace"; ctx.fillText("150 DAMAGE → POWERUP", BOARD - 90, 41);

      if (!game.running || game.paused || game.result) {
        ctx.fillStyle = "rgba(1,4,8,.78)"; ctx.fillRect(0, 0, BOARD, BOARD);
        ctx.textAlign = "center"; ctx.fillStyle = game.result === "victory" ? "#b2ff62" : game.result === "defeat" ? "#ff6277" : "#e9fbff"; ctx.font = "900 31px Arial, sans-serif";
        ctx.fillText(game.paused ? "PAUSED" : game.result === "victory" ? "RIVAL ELIMINATED" : game.result === "defeat" ? "SHIP DESTROYED" : "WORMHOLE ARCADE", BOARD / 2, BOARD / 2 - 12);
        ctx.fillStyle = "#84aab5"; ctx.font = "700 10px ui-monospace, monospace";
        ctx.fillText(game.paused ? "PRESS P TO RESUME" : game.result ? `SCORE ${game.score.toLocaleString()} // PRESS ENTER TO RUN AGAIN` : "CHOOSE A SHIP, THEN START MISSION", BOARD / 2, BOARD / 2 + 20);
      }
      ctx.strokeStyle = "rgba(101,232,255,.3)"; ctx.lineWidth = 2; ctx.strokeRect(1, 1, BOARD - 2, BOARD - 2);
    };

    const loop = (now: number) => {
      accumulator += Math.min(50, now - previous);
      previous = now;
      while (accumulator >= TICK_MS) { tick(); accumulator -= TICK_MS; }
      draw(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", syncCanvasResolution);
    };
  }, [cameraLocked, play, sync]);

  const currentShip = selectedShip(shipId);
  const healthPct = hud.maxHealth ? hud.health / hud.maxHealth * 100 : 0;
  const controlProps = (code: string) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      setControl(code, true);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(8);
    },
    onPointerUp: () => setControl(code, false),
    onPointerCancel: () => setControl(code, false),
    onPointerLeave: () => setControl(code, false),
    onLostPointerCapture: () => setControl(code, false),
  });

  return (
    <main ref={shellRef} className={`app-shell view-${viewSize} ${touchCapable ? "touch-capable" : ""} ${hud.running && !hud.result ? "game-active" : ""}`}>
      <header className="topbar">
        <div className="brand"><span className="brand-mark">W/02</span><div><h1>WORMHOLE <em>ARCADE</em></h1><p>NEW GROUND // COMBAT NETWORK</p></div></div>
        <div className="top-actions"><span className="link-status"><i /> SOLO LINK</span><button type="button" onClick={() => setViewSize((value) => value === "compact" ? "standard" : value === "standard" ? "wide" : "compact")}>VIEW {viewSize.toUpperCase()}</button><button type="button" aria-pressed={cameraLocked} onClick={() => setCameraLocked((value) => !value)}>{cameraLocked ? "CAMERA SHIP" : "CAMERA ARENA"}</button><button type="button" aria-pressed={sound} onClick={() => setSound((value) => !value)}>{sound ? "SOUND ON" : "SOUND OFF"}</button><button className="fullscreen-trigger" type="button" aria-pressed={fullscreen} onClick={toggleFullscreen}>{fullscreen ? "EXIT FULL" : "FULLSCREEN"}</button><button type="button" onClick={togglePause}>P / PAUSE</button></div>
      </header>

      <section className="cockpit">
        <aside className="panel ship-panel">
          <div className="eyebrow">SHIP SELECT // 8 FRAMES</div>
          <div className="selected-ship">
            <div className="ship-icon"><span className={`ship-glyph ${currentShip.id}`} /></div>
            <div><h2>{currentShip.name}</h2><p>{currentShip.role}</p></div>
          </div>
          <div className="ship-select-grid">
            {SHIPS.map((ship) => <button type="button" key={ship.id} className={shipId === ship.id ? "active" : ""} onClick={() => { if (!hud.running) setShipId(ship.id); }} disabled={hud.running && !hud.result}><span>{ship.name.replace("The ", "")}</span><small>{ship.unlock}</small></button>)}
          </div>
          <p className="ship-description">{currentShip.special}</p>
          <div className="data-grid"><div><span>HULL</span><b>{currentShip.health}</b></div><div><span>TURN</span><b>{currentShip.turn}°</b></div><div><span>MAX V</span><b>{currentShip.maxSpeed}</b></div><div><span>ACCEL</span><b>{currentShip.acceleration}</b></div></div>
          <div className="controls"><div className="eyebrow">FLIGHT CONTROL</div><dl><div><dt>ROTATE</dt><dd>← → / A D</dd></div><div><dt>THRUST</dt><dd>↑ / W</dd></div><div><dt>PULSE CANNON</dt><dd>SPACE</dd></div><div><dt>FIRE POWERUP</dt><dd>E</dd></div><div><dt>SPECIAL</dt><dd>Q</dd></div></dl></div>
        </aside>

        <section className="play-column">
          <div className="pilot-transmission"><span>PILOT TRANSMISSION</span><strong>this is really cool!</strong></div>
          <div className="mobile-preflight">
            <label><span>SHIP FRAME</span><select aria-label="Select ship frame" value={shipId} disabled={hud.running && !hud.result} onChange={(event) => setShipId(event.target.value as ShipId)}>{SHIPS.map((ship) => <option value={ship.id} key={ship.id}>{ship.name} — {ship.role}</option>)}</select></label>
            <div className="mobile-ship-stats"><span>HULL <b>{currentShip.health}</b></span><span>THRUST <b>MK {currentShip.thrust}</b></span></div>
            <button type="button" aria-pressed={fullscreen} onClick={toggleFullscreen}>{fullscreen ? "EXIT FULL" : "FULLSCREEN"}</button>
          </div>
          <div className="match-bar">
            <div><span>MISSION</span><b>FIRST CONTACT</b></div>
            <div className="score"><span>SCORE</span><b>{hud.score.toLocaleString().padStart(6, "0")}</b></div>
            <div className="rival"><span>RIVAL INTEGRITY</span><div className="meter"><i style={{ width: `${hud.rivalHealth}%` }} /></div><b>{hud.rivalHealth}%</b></div>
          </div>
          <div className="arena-stage">
            <div className="canvas-wrap"><canvas ref={canvasRef} width={BOARD} height={BOARD} aria-label="Playable Wormhole space-combat arena" /><div className="pilot-health"><span>PILOT HULL <b>{hud.health}/{hud.maxHealth}</b></span><div className="meter hull"><i style={{ width: `${healthPct}%` }} /></div></div><i className="reticle tl" /><i className="reticle tr" /><i className="reticle bl" /><i className="reticle br" /></div>
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
                  aria-label="Weapon thumbstick. Press and aim in any direction to fire continuously."
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
                <div className="touch-utility"><button className="touch-pup" type="button" aria-label="Fire power-up" {...controlProps("KeyE")}>PUP</button><button className="touch-special" type="button" aria-label="Activate ship special" {...controlProps("KeyQ")}>SPEC</button><button className="touch-pause" type="button" aria-label="Pause game" onClick={togglePause}>Ⅱ</button></div>
              </div>
            </div>
          </div>
          <div className="status-dock">
            <div className="vitals"><span>HULL <b>{hud.health}/{hud.maxHealth}</b></span><div className="meter hull"><i style={{ width: `${healthPct}%` }} /></div><span>SHIELD <b>{hud.shield}%</b></span><div className="meter shield"><i style={{ width: `${hud.shield}%` }} /></div></div>
            <div className="power-bin"><div className="bin-label"><span>POWERUP BIN</span><small>LIFO // MAX 5</small></div>{Array.from({ length: 5 }, (_, index) => { const item = hud.stock[index]; return <div className={`slot ${item ? "loaded" : ""}`} style={item ? { "--pup": POWER_COLORS[item] } as React.CSSProperties : undefined} key={index}><b>{item ? POWER_LABELS[item].slice(0, 2) : index + 1}</b><small>{item ? POWER_LABELS[item].replace("SEND ", "") : "EMPTY"}</small></div>; })}</div>
            <button className="start-button" type="button" onClick={start}>{hud.running && !hud.result ? "RESTART" : hud.result ? "RUN AGAIN" : "START MISSION"}</button>
          </div>
        </section>

        <aside className="panel intel-panel">
          <div className="eyebrow">MISSION INTEL</div><h2>SURVIVE<br />THE VOID</h2><p>Every rival has a wormhole orbiting your arena. Shoot it with pulse cannons to generate power-ups, collect them, then send attack power-ups back through it.</p>
          <ol><li><span>01</span><div><b>CHARGE</b><small>Deal 150 cannon damage to the wormhole</small></div></li><li><span>02</span><div><b>COLLECT</b><small>Fly over the generated power-up</small></div></li><li><span>03</span><div><b>TRANSMIT</b><small>Aim at the wormhole and press E</small></div></li></ol>
          <div className="intel-card"><div><span>GUN</span><b>MK {hud.gun + 1}/4</b></div><div><span>THRUST</span><b>MK {hud.thrust}/3</b></div><div><span>RETROS</span><b>{hud.retros ? "ONLINE" : "OFFLINE"}</b></div><div><span>WORMHOLE</span><b>{hud.portalCharge}%</b></div></div>
          <div className={`incoming-card ${hud.incoming ? "hot" : ""}`}><span>THREAT MONITOR</span><b>{hud.incoming ? POWER_LABELS[hud.incoming] : "SECTOR CLEAR"}</b><small>{hud.incoming ? "HOSTILE SIGNATURE DETECTED" : "SCANNING RIVAL WORMHOLE"}</small></div>
          <div className="source-note"><span>CLIENT-VERIFIED PROTOTYPE</span><p>Flight values, game tick, cannon levels, portal charge, power-up capacity, enemy counts, and sound effects were recovered from the supplied Redux client.</p></div>
        </aside>
      </section>
      <footer><span>WORMHOLE ARCADE // PLAYABLE PROTOTYPE 0.3</span><span>940×940 FIELD // SHIP-LOCK + ARENA CAMERAS</span></footer>
    </main>
  );
}
