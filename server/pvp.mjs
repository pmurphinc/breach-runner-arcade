/**
 * WebSocket transport for PvP.
 *
 * Attaches to an existing `http.Server` via the upgrade event, so the game and
 * the match service share one Railway service, one injected PORT and one
 * custom domain. Nothing here owns game rules — see `rooms.mjs`.
 */
import { WebSocketServer } from "ws";
import {
  ERRORS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  PVP_PATH,
  SWEEP_INTERVAL_MS,
  parseClientMessage,
  sanitizeName,
} from "./protocol.mjs";
import { MatchServer, createPlayer } from "./rooms.mjs";

const PRODUCTION_ORIGIN = "https://wormhole.murphtournaments.com";

/**
 * Browser origins allowed to open a match socket.
 *
 * Production is always allowed. Local development origins are added only when
 * NODE_ENV is not "production", so a deployed service never accepts a
 * localhost origin. PVP_EXTRA_ORIGINS can add more for staging without a code
 * change; it is a comma-separated list.
 */
export function allowedOrigins(env = process.env) {
  const origins = new Set([PRODUCTION_ORIGIN]);
  for (const entry of (env.PVP_EXTRA_ORIGINS ?? "").split(",")) {
    const trimmed = entry.trim().replace(/\/+$/, "");
    if (trimmed) origins.add(trimmed);
  }
  return origins;
}

/** Loopback on any port, for local development only. */
function isLoopbackOrigin(origin) {
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "http:" && protocol !== "https:") return false;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function isOriginAllowed(origin, origins, env = process.env) {
  // Same-origin browsers and non-browser clients may omit Origin entirely;
  // a *present* origin must be allowed explicitly.
  if (!origin) return true;
  const normalized = origin.replace(/\/+$/, "");
  if (origins.has(normalized)) return true;
  // Dev servers pick arbitrary ports, so allow any loopback origin outside
  // production rather than maintaining a port list. Production never does.
  return env.NODE_ENV !== "production" && isLoopbackOrigin(normalized);
}

/**
 * Mounts the PvP endpoint on an existing HTTP server.
 * Returns a handle so the caller can shut it down cleanly.
 */
export function attachPvpServer(httpServer, { log = console.log, env = process.env } = {}) {
  const origins = allowedOrigins(env);
  // Without a scheduler the countdown would only fire on the next sweep, so a
  // 3s countdown could sit for up to 15s before the match went live.
  const matches = new MatchServer({
    log,
    schedule: (fn, delayMs) => {
      const timer = setTimeout(fn, delayMs);
      timer.unref?.();
      return timer;
    },
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const sockets = new Map();

  httpServer.on("upgrade", (request, socket, head) => {
    let pathname;
    try {
      pathname = new URL(request.url, "http://localhost").pathname;
    } catch {
      socket.destroy();
      return;
    }
    // This service owns the upgrade path, so an unknown one is closed rather
    // than left dangling. Registering any upgrade listener disables Node's
    // default socket teardown, so returning early would leak the connection.
    if (pathname !== PVP_PATH) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!isOriginAllowed(request.headers.origin, origins, env)) {
      log(`[pvp] rejected upgrade from origin ${request.headers.origin}`);
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws) => {
    const send = (message) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
    };
    const player = createPlayer(send);
    sockets.set(ws, player);
    matches.register(player);

    send({
      type: "welcome",
      version: PROTOCOL_VERSION,
      id: player.id,
      name: player.name,
      resume: player.resume,
      serverNow: Date.now(),
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        send({ type: "error", code: ERRORS.BAD_MESSAGE });
        return;
      }
      const now = Date.now();
      if (!matches.allowMessage(player, now)) {
        send({ type: "error", code: ERRORS.RATE_LIMITED });
        return;
      }

      const parsed = parseClientMessage(data.toString());
      if (!parsed.ok) {
        send({ type: "error", code: parsed.code, detail: parsed.detail });
        return;
      }

      handle(matches, player, parsed.message, now, send);
    });

    ws.on("pong", () => {
      player.lastSeen = Date.now();
    });

    ws.on("close", () => {
      sockets.delete(ws);
      matches.disconnect(player);
    });

    ws.on("error", () => {
      sockets.delete(ws);
      matches.disconnect(player);
    });
  });

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const [ws, player] of sockets) {
      if (now - player.lastSeen > HEARTBEAT_TIMEOUT_MS) {
        ws.terminate();
        continue;
      }
      if (ws.readyState === ws.OPEN) ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  const sweeper = setInterval(() => matches.sweep(Date.now()), SWEEP_INTERVAL_MS);
  heartbeat.unref?.();
  sweeper.unref?.();

  log(`[pvp] match service mounted on ${PVP_PATH}`);
  return {
    matches,
    wss,
    close() {
      clearInterval(heartbeat);
      clearInterval(sweeper);
      for (const ws of sockets.keys()) ws.terminate();
      wss.close();
    },
  };
}

/** Routes one validated message. Every branch is reachable only after validation. */
function handle(matches, player, message, now, send) {
  switch (message.type) {
    case "hello": {
      if (message.name) player.name = message.name;
      matches.sendTo(player, { type: "lobby", state: "idle", name: player.name });
      return;
    }
    case "queue":
      matches.enqueue(player, { kind: message.kind, difficulty: message.difficulty }, now);
      return;
    case "create":
      matches.createPrivate(player, { kind: message.kind, difficulty: message.difficulty }, now);
      return;
    case "join": {
      const result = matches.join(player, message.code, now);
      if (!result.ok) send({ type: "error", code: result.code });
      return;
    }
    case "cancel": {
      matches.leaveQueue(player);
      const room = player.room;
      if (room && room.phase !== "active") {
        const opponent = matches.opponentOf(room, player);
        matches.removeRoom(room);
        if (opponent) {
          opponent.ready = false;
          matches.sendTo(opponent, { type: "lobby", state: "idle", reason: "opponent_left" });
        }
      }
      send({ type: "lobby", state: "idle" });
      return;
    }
    case "ship": {
      const result = matches.setShip(player, message.ship);
      if (!result.ok) send({ type: "error", code: result.code });
      return;
    }
    case "ready": {
      const result = matches.setReady(player, message.ready, now);
      if (!result.ok) send({ type: "error", code: result.code });
      return;
    }
    case "damage": {
      const result = matches.reportDamage(player, message, now);
      if (!result.ok) send({ type: "error", code: result.code });
      return;
    }
    case "transmit": {
      const result = matches.transmit(player, message, now);
      if (!result.ok) send({ type: "error", code: result.code });
      return;
    }
    case "position": {
      const result = matches.updatePosition(player, message, now);
      if (!result.ok) send({ type: "error", code: result.code });
      return;
    }
    case "world": {
      const result = matches.updateWorld(player, message, now);
      if (!result.ok) send({ type: "error", code: result.code });
      return;
    }
    case "rematch": {
      const result = matches.requestRematch(player, now);
      if (!result.ok) send({ type: "error", code: result.code });
      return;
    }
    case "leave": {
      const result = matches.leaveMatch(player);
      if (!result.ok) {
        send({ type: "error", code: result.code });
        return;
      }
      send({ type: "lobby", state: "idle" });
      return;
    }
    default:
      return;
  }
}

export { sanitizeName };
