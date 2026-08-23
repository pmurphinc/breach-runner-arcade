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

export const PROTOCOL_VERSION = 2;

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
export const MAX_PAYLOAD_BYTES = 4096;

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
        message: { type, seq: parsed.seq, source: parsed.source, amount: parsed.amount },
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
    case "pong": {
      return { ok: true, message: { type, t: isFiniteNumber(parsed.t) ? parsed.t : 0 } };
    }
    default:
      // queue, create, cancel, leave and rematch carry no payload.
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
