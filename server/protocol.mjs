/**
 * Wire protocol for Wormhole Arcade PvP.
 *
 * Every inbound message is validated here before any room logic sees it. The
 * server treats clients as untrusted: they may report what happened in their
 * own arena, but the server decides what that means for hull, shield and the
 * match result.
 *
 * `app/pvp-protocol.ts` carries the matching client-side types and constants;
 * `tests/pvp-protocol.test.mjs` asserts the two agree.
 */

export const PROTOCOL_VERSION = 5;

/** WebSocket path. Shares the game's HTTP server and Railway's injected PORT. */
export const PVP_PATH = "/pvp";

export const CLIENT_MESSAGES = [
  "hello",
  "queue",
  "create",
  "join",
  "cancel",
  "ship",
  "ready",
  "damage",
  "transmit",
  "position",
  "world",
  "pong",
  "leave",
  "rematch",
];

export const SERVER_MESSAGES = [
  "welcome",
  "lobby",
  "match",
  "ship",
  "ready",
  "countdown",
  "state",
  "incoming",
  "teammate",
  "world",
  "result",
  "opponent",
  "error",
  "ping",
  "rematch",
];

/** Attack power-ups that may be transmitted. Mirrors SENDABLE_POWERUPS. */
export const SENDABLE_WEAPONS = [
  "heatseeker",
  "turret",
  "mines",
  "ufo",
  "inflator",
  "minelayer",
  "gunship",
  "scarab",
  "nuke",
  "wallcrawler",
  "beam",
  "emp",
  "ghost",
  "artillery",
];

export const SESSION_KINDS = ["pvp", "coop"];
export const DIFFICULTY_IDS = ["practice", "easy", "difficult", "hard"];

export const SHIP_IDS = [
  "tank",
  "wing",
  "squid",
  "rabbit",
  "turtle",
  "flash",
  "hunter",
  "flagship",
];

// ------------------------------------------------------------------ limits --

/** Hard ceiling on a single frame. Anything larger is dropped unparsed. */
export const MAX_PAYLOAD_BYTES = 32768;

/** Largest damage a single event may claim. The heaviest in-game hit is 40. */
export const MAX_DAMAGE_EVENT = 60;

/** Sliding-window damage limits, per player. */
export const DAMAGE_WINDOW_MS = 1000;
export const MAX_DAMAGE_EVENTS_PER_WINDOW = 30;
export const MAX_DAMAGE_TOTAL_PER_WINDOW = 220;

/** Transmissions are a deliberate action; this is far above human cadence. */
export const MAX_TRANSMITS_PER_WINDOW = 6;

/** General message flood guard. */
export const MAX_MESSAGES_PER_WINDOW = 120;

export const HEARTBEAT_INTERVAL_MS = 15_000;
/** No pong within this window and the socket is considered gone. */
export const HEARTBEAT_TIMEOUT_MS = 40_000;

/** How long a disconnected player has to come back before forfeiting. */
export const RECONNECT_GRACE_MS = 20_000;

/** Both players must accept a rematch inside this window. */
export const REMATCH_TIMEOUT_MS = 20_000;

/** Countdown between both players readying and the match going live. */
export const COUNTDOWN_SECONDS = 3;

/** Idle rooms and abandoned queue entries are swept after this. */
export const ROOM_IDLE_TIMEOUT_MS = 5 * 60_000;
export const QUEUE_TIMEOUT_MS = 2 * 60_000;
export const SWEEP_INTERVAL_MS = 15_000;

/** Invite codes: unambiguous alphabet, no O/0 or I/1 confusion. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

export const ERRORS = {
  BAD_MESSAGE: "bad_message",
  TOO_LARGE: "too_large",
  RATE_LIMITED: "rate_limited",
  UNKNOWN_ROOM: "unknown_room",
  ROOM_FULL: "room_full",
  NOT_IN_MATCH: "not_in_match",
  WRONG_PHASE: "wrong_phase",
  INVALID_DAMAGE: "invalid_damage",
  INVALID_WEAPON: "invalid_weapon",
};

// -------------------------------------------------------------- validation --

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

/** Trims a player-supplied name to something safe to render. */
export function sanitizeName(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^\w \-]/g, "").trim().slice(0, 16);
  return cleaned.length >= 2 ? cleaned : null;
}

export function isValidCode(value) {
  return (
    typeof value === "string" &&
    value.length === CODE_LENGTH &&
    [...value].every((character) => CODE_ALPHABET.includes(character))
  );
}

/**
 * Parses and validates one inbound frame.
 *
 * Returns `{ ok: true, message }` or `{ ok: false, code, detail }`. Nothing
 * downstream re-checks shapes, so every field a handler reads must be proven
 * here.
 */
export function parseClientMessage(raw) {
  if (typeof raw !== "string") return { ok: false, code: ERRORS.BAD_MESSAGE, detail: "not text" };
  if (raw.length > MAX_PAYLOAD_BYTES) return { ok: false, code: ERRORS.TOO_LARGE };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: ERRORS.BAD_MESSAGE, detail: "not json" };
  }
  if (!isPlainObject(parsed)) return { ok: false, code: ERRORS.BAD_MESSAGE, detail: "not object" };

  const { type } = parsed;
  if (!CLIENT_MESSAGES.includes(type)) {
    return { ok: false, code: ERRORS.BAD_MESSAGE, detail: "unknown type" };
  }

  switch (type) {
    case "hello": {
      const name = sanitizeName(parsed.name);
      const resume = typeof parsed.resume === "string" && parsed.resume.length <= 64
        ? parsed.resume
        : null;
      return { ok: true, message: { type, name, resume } };
    }
    case "queue":
    case "create": {
      const kind = SESSION_KINDS.includes(parsed.kind) ? parsed.kind : "pvp";
      const difficulty = DIFFICULTY_IDS.includes(parsed.difficulty) ? parsed.difficulty : "easy";
      return { ok: true, message: { type, kind, difficulty } };
    }
    case "join": {
      if (!isValidCode(parsed.code)) {
        return { ok: false, code: ERRORS.BAD_MESSAGE, detail: "bad code" };
      }
      return { ok: true, message: { type, code: parsed.code } };
    }
    case "ship": {
      if (!SHIP_IDS.includes(parsed.ship)) {
        return { ok: false, code: ERRORS.BAD_MESSAGE, detail: "unknown ship" };
      }
      return { ok: true, message: { type, ship: parsed.ship } };
    }
    case "ready": {
      if (typeof parsed.ready !== "boolean") {
        return { ok: false, code: ERRORS.BAD_MESSAGE, detail: "ready must be boolean" };
      }
      return { ok: true, message: { type, ready: parsed.ready } };
    }
    case "damage": {
      if (!Number.isInteger(parsed.seq) || parsed.seq < 0) {
        return { ok: false, code: ERRORS.BAD_MESSAGE, detail: "bad seq" };
      }
      if (parsed.source !== "collision" && parsed.source !== "impact") {
        return { ok: false, code: ERRORS.INVALID_DAMAGE, detail: "bad source" };
      }
      if (!isFiniteNumber(parsed.amount) || parsed.amount <= 0) {
        return { ok: false, code: ERRORS.INVALID_DAMAGE, detail: "bad amount" };
      }
      if (parsed.amount > MAX_DAMAGE_EVENT) {
        return { ok: false, code: ERRORS.INVALID_DAMAGE, detail: "amount too large" };
      }
      return {
        ok: true,
        message: {
          type,
          seq: parsed.seq,
          source: parsed.source,
          amount: parsed.amount,
          cause: typeof parsed.cause === "string" && /^[a-z0-9_]{1,32}$/.test(parsed.cause) ? parsed.cause : "unknown",
        },
      };
    }
    case "transmit": {
      if (!Number.isInteger(parsed.seq) || parsed.seq < 0) {
        return { ok: false, code: ERRORS.BAD_MESSAGE, detail: "bad seq" };
      }
      if (!SENDABLE_WEAPONS.includes(parsed.weapon)) {
        return { ok: false, code: ERRORS.INVALID_WEAPON };
      }
      return { ok: true, message: { type, seq: parsed.seq, weapon: parsed.weapon } };
    }
    case "position": {
      if (!Number.isInteger(parsed.seq) || parsed.seq < 0 || parsed.seq > 1_000_000_000
        || !Number.isInteger(parsed.sentAt) || parsed.sentAt < 0 || parsed.sentAt > 10_000_000_000_000
        || ![parsed.x, parsed.y, parsed.angle].every(isFiniteNumber)) {
        return { ok: false, code: ERRORS.BAD_MESSAGE, detail: "bad position" };
      }
      return {
        ok: true,
        message: {
          type,
          seq: parsed.seq,
          sentAt: parsed.sentAt,
          x: Math.max(0, Math.min(1504, parsed.x)),
          y: Math.max(0, Math.min(940, parsed.y)),
          angle: ((parsed.angle % 360) + 360) % 360,
        },
      };
    }
    case "world": {
      if (!Number.isInteger(parsed.seq) || parsed.seq < 0 || parsed.seq > 1_000_000_000) {
        return { ok: false, code: ERRORS.BAD_MESSAGE, detail: "bad world seq" };
      }
      if (![parsed.portalX, parsed.portalY, parsed.portalAngle].every(isFiniteNumber)
        || !Array.isArray(parsed.enemies) || parsed.enemies.length > 128
        || !Array.isArray(parsed.enemyBullets) || parsed.enemyBullets.length > 256) {
        return { ok: false, code: ERRORS.BAD_MESSAGE, detail: "bad world snapshot" };
      }
      const enemies = [];
      for (const enemy of parsed.enemies) {
        if (!isPlainObject(enemy) || !SENDABLE_WEAPONS.includes(enemy.kind)
          || ![enemy.x, enemy.y, enemy.vx, enemy.vy, enemy.hp, enemy.maxHp, enemy.radius,
            enemy.age, enemy.cooldown, enemy.phase].every(isFiniteNumber)) {
          return { ok: false, code: ERRORS.BAD_MESSAGE, detail: "bad enemy snapshot" };
        }
        enemies.push({
          kind: enemy.kind,
          x: Math.max(-100, Math.min(1604, enemy.x)),
          y: Math.max(-100, Math.min(1040, enemy.y)),
          vx: Math.max(-25, Math.min(25, enemy.vx)),
          vy: Math.max(-25, Math.min(25, enemy.vy)),
          hp: Math.max(0, Math.min(20_000, enemy.hp)),
          maxHp: Math.max(1, Math.min(20_000, enemy.maxHp)),
          radius: Math.max(1, Math.min(200, enemy.radius)),
          age: Math.max(0, Math.min(1_000_000, enemy.age)),
          cooldown: Math.max(-10_000, Math.min(10_000, enemy.cooldown)),
          phase: enemy.phase,
          rotationDir: enemy.rotationDir === -1 ? -1 : enemy.rotationDir === 1 ? 1 : undefined,
          armed: Boolean(enemy.armed),
          countdown: isFiniteNumber(enemy.countdown) ? enemy.countdown : undefined,
          blastRadius: isFiniteNumber(enemy.blastRadius) ? enemy.blastRadius : undefined,
          // Scramble is simulated state, not decoration: without it a co-op
          // guest would watch hostiles fly backwards for no visible reason.
          scrambled: isFiniteNumber(enemy.scrambled) ? Math.max(0, Math.min(1000, enemy.scrambled)) : undefined,
        });
      }
      const enemyBullets = [];
      for (const bullet of parsed.enemyBullets) {
        if (!isPlainObject(bullet)
          || ![bullet.x, bullet.y, bullet.vx, bullet.vy, bullet.damage, bullet.life].every(isFiniteNumber)
          || typeof bullet.color !== "string") {
          return { ok: false, code: ERRORS.BAD_MESSAGE, detail: "bad enemy bullet snapshot" };
        }
        enemyBullets.push({
          x: Math.max(-100, Math.min(1604, bullet.x)),
          y: Math.max(-100, Math.min(1040, bullet.y)),
          vx: Math.max(-30, Math.min(30, bullet.vx)),
          vy: Math.max(-30, Math.min(30, bullet.vy)),
          damage: Math.max(0, Math.min(100, bullet.damage)),
          life: Math.max(0, Math.min(2000, bullet.life)),
          enemy: true,
          color: bullet.color.slice(0, 32),
        });
      }
      return { ok: true, message: {
        type, seq: parsed.seq, enemies, enemyBullets,
        portalX: Math.max(0, Math.min(1504, parsed.portalX)),
        portalY: Math.max(0, Math.min(940, parsed.portalY)),
        portalAngle: parsed.portalAngle,
        enrageActive: Boolean(parsed.enrageActive),
      } };
    }
    case "rematch": {
      if (parsed.ship !== undefined && !SHIP_IDS.includes(parsed.ship)) {
        return { ok: false, code: ERRORS.BAD_MESSAGE, detail: "unknown rematch ship" };
      }
      return { ok: true, message: { type, ship: parsed.ship } };
    }
    case "pong": {
      return { ok: true, message: { type, t: isFiniteNumber(parsed.t) ? parsed.t : 0 } };
    }
    default:
      // queue, create, cancel and leave carry no payload.
      return { ok: true, message: { type } };
  }
}

/** Fixed-window counter used for the per-player rate limits above. */
export function createRateWindow() {
  return { start: 0, messages: 0, damageEvents: 0, damageTotal: 0, transmits: 0 };
}

export function rollWindow(window, now) {
  if (now - window.start >= DAMAGE_WINDOW_MS) {
    window.start = now;
    window.messages = 0;
    window.damageEvents = 0;
    window.damageTotal = 0;
    window.transmits = 0;
  }
}

export function randomCode(random = Math.random) {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Guests get a readable throwaway callsign; no sign-in is ever required. */
export function guestName(random = Math.random) {
  return `GUEST-${String(Math.floor(random() * 9000) + 1000)}`;
}
