"use client";

/**
 * Client side of the PvP protocol.
 *
 * A thin, typed wrapper over one WebSocket: it owns connection state,
 * reconnection and sequence numbers, and hands the game a plain snapshot to
 * render. It deliberately holds no game rules — the server decides hull,
 * shield and results, and this file only reports and reflects.
 *
 * Nothing here is required for single-player. If the socket never opens, the
 * game is unaffected; the lobby simply reports that it is offline.
 */

/** Must match server/protocol.mjs. `tests/pvp-protocol.test.mjs` asserts it. */
export const PROTOCOL_VERSION = 1;
export const PVP_PATH = "/pvp";
export const CODE_LENGTH = 6;
export const COUNTDOWN_SECONDS = 3;
export const RECONNECT_GRACE_MS = 20_000;

/** How long an incoming-attack warning stays on screen. */
export const INCOMING_WARNING_MS = 4000;

export type PvpPhase =
  | "offline"
  | "connecting"
  | "idle"
  | "searching"
  | "waiting"
  | "select"
  | "countdown"
  | "active"
  | "finished";

export type PvpCombat = {
  hull: number;
  maxHull: number;
  shieldPct: number;
  rechargeMs: number;
};

export type PvpOpponent = {
  id: string;
  name: string;
  ship: string;
  ready: boolean;
  connected: boolean;
};

export type PvpSnapshot = {
  phase: PvpPhase;
  /** Why the lobby is offline, when it is. */
  offlineReason: string;
  connected: boolean;
  /** True while a reconnect attempt is in flight during a live match. */
  reconnecting: boolean;
  name: string;
  code: string | null;
  you: { ready: boolean; ship: string } | null;
  opponent: PvpOpponent | null;
  yourCombat: PvpCombat | null;
  opponentCombat: PvpCombat | null;
  /** Milliseconds until the match goes live, during a countdown. */
  countdownMs: number;
  result: { outcome: "victory" | "defeat"; reason: string; opponent: string } | null;
  /** Last inbound attack, for the warning banner. */
  incoming: { weapon: string; from: string; at: number } | null;
  error: string | null;
};

const EMPTY: PvpSnapshot = {
  phase: "offline",
  offlineReason: "",
  connected: false,
  reconnecting: false,
  name: "",
  code: null,
  you: null,
  opponent: null,
  yourCombat: null,
  opponentCombat: null,
  countdownMs: 0,
  result: null,
  incoming: null,
  error: null,
};

/** Where the match service lives: same origin as the game, upgraded to ws. */
export function matchServiceUrl() {
  if (typeof window === "undefined") return "";
  const override = process.env.NEXT_PUBLIC_PVP_URL;
  if (override) return override;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${PVP_PATH}`;
}

type Listener = (snapshot: PvpSnapshot) => void;

export class PvpClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private snapshot: PvpSnapshot = EMPTY;
  private damageSeq = 0;
  private transmitSeq = 0;
  private resume: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private closedByUs = false;
  /** Server timestamps minus ours, so countdowns agree across machines. */
  private clockOffset = 0;
  private seenIncoming = new Set<string>();
  /** Delivered attacks the game has not yet spawned. */
  private incomingQueue: { weapon: string; from: string }[] = [];
  private warningTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => { this.listeners.delete(listener); };
  }

  get state() {
    return this.snapshot;
  }

  /** Attacks delivered since the last call. The game drains this each tick. */
  drainIncoming() {
    if (this.incomingQueue.length === 0) return [];
    const queued = this.incomingQueue;
    this.incomingQueue = [];
    return queued;
  }

  private update(patch: Partial<PvpSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  connect(preferredName?: string) {
    if (typeof window === "undefined") return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closedByUs = false;
    this.update({ phase: this.snapshot.phase === "active" ? "active" : "connecting", error: null });

    let socket: WebSocket;
    try {
      socket = new WebSocket(matchServiceUrl());
    } catch {
      this.goOffline("could not reach the match service");
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempts = 0;
      this.update({ connected: true, reconnecting: false });
      this.send({ type: "hello", name: preferredName, resume: this.resume ?? undefined });
    };

    socket.onmessage = (event) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      this.receive(message);
    };

    socket.onerror = () => {
      // onclose always follows; retry logic lives there.
    };

    socket.onclose = () => {
      this.socket = null;
      const midMatch = this.snapshot.phase === "active" || this.snapshot.phase === "countdown";
      this.update({ connected: false, reconnecting: midMatch });
      if (this.closedByUs) {
        this.update({ phase: "offline", offlineReason: "disconnected" });
        return;
      }
      this.scheduleRetry(midMatch);
    };
  }

  /**
   * Backs off, but stays aggressive during a live match: the server's
   * forfeit grace is 20s, so there is no value in waiting longer than that.
   */
  private scheduleRetry(midMatch: boolean) {
    this.attempts += 1;
    if (!midMatch && this.attempts > 4) {
      this.goOffline("the match service is unavailable");
      return;
    }
    const delay = midMatch
      ? Math.min(2000, 400 * this.attempts)
      : Math.min(8000, 700 * 2 ** (this.attempts - 1));
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private goOffline(reason: string) {
    this.update({ phase: "offline", offlineReason: reason, connected: false, reconnecting: false });
  }

  private receive(message: Record<string, unknown>) {
    const type = message.type;

    if (typeof message.serverNow === "number") {
      this.clockOffset = message.serverNow - Date.now();
    }

    switch (type) {
      case "welcome": {
        this.resume = typeof message.resume === "string" ? message.resume : null;
        this.update({
          phase: "idle",
          name: typeof message.name === "string" ? message.name : "",
          error: null,
        });
        return;
      }
      case "lobby": {
        const state = message.state;
        this.update({
          phase: state === "searching" ? "searching" : state === "waiting" ? "waiting" : "idle",
          code: typeof message.code === "string" ? message.code : null,
          name: typeof message.name === "string" ? message.name : this.snapshot.name,
          opponent: null,
          you: null,
          yourCombat: null,
          opponentCombat: null,
          result: null,
          error: message.reason === "opponent_left" ? "Your opponent left." : null,
        });
        return;
      }
      case "match": {
        const you = message.you as { ship?: string; ready?: boolean } | undefined;
        this.update({
          phase: this.snapshot.phase === "active" ? "active" : "select",
          code: typeof message.code === "string" ? message.code : null,
          you: { ship: you?.ship ?? "wing", ready: Boolean(you?.ready) },
          opponent: (message.opponent as PvpOpponent | null) ?? null,
          result: null,
          error: null,
        });
        return;
      }
      case "ready": {
        const states = message.states as { id: string; ready: boolean }[] | undefined;
        if (!states) return;
        const opponent = this.snapshot.opponent;
        this.update({
          you: this.snapshot.you
            ? { ...this.snapshot.you, ready: states.find((s) => s.id !== opponent?.id)?.ready ?? false }
            : this.snapshot.you,
          opponent: opponent
            ? { ...opponent, ready: states.find((s) => s.id === opponent.id)?.ready ?? false }
            : opponent,
        });
        return;
      }
      case "countdown": {
        const startsAt = typeof message.startsAt === "number" ? message.startsAt : 0;
        this.update({
          phase: "countdown",
          countdownMs: Math.max(0, startsAt - (Date.now() + this.clockOffset)),
        });
        return;
      }
      case "state": {
        const patch: Partial<PvpSnapshot> = {};
        if (message.phase === "active" || message.you) patch.phase = "active";
        if (message.you) patch.yourCombat = message.you as PvpCombat;
        if (message.opponent) patch.opponentCombat = message.opponent as PvpCombat;
        this.update(patch);
        return;
      }
      case "incoming": {
        const eventId = String(message.eventId ?? "");
        // The server tags every delivery, so a resend is dropped rather than
        // spawning the same attack twice.
        if (eventId && this.seenIncoming.has(eventId)) return;
        if (eventId) this.seenIncoming.add(eventId);
        const weapon = String(message.weapon ?? "");
        const from = String(message.from ?? "OPPONENT");
        this.incomingQueue.push({ weapon, from });
        // Expiry lives here rather than in the component: a render must not
        // read the clock to decide whether a warning is still current.
        if (this.warningTimer) clearTimeout(this.warningTimer);
        this.update({ incoming: { weapon, from, at: Date.now() } });
        this.warningTimer = setTimeout(() => {
          this.warningTimer = null;
          this.update({ incoming: null });
        }, INCOMING_WARNING_MS);
        return;
      }
      case "opponent": {
        const opponent = this.snapshot.opponent;
        this.update({
          opponent: opponent ? { ...opponent, connected: message.state === "reconnected" } : opponent,
        });
        return;
      }
      case "result": {
        this.update({
          phase: "finished",
          result: {
            outcome: message.outcome === "victory" ? "victory" : "defeat",
            reason: String(message.reason ?? ""),
            opponent: String(message.opponent ?? "OPPONENT"),
          },
        });
        return;
      }
      case "error": {
        this.update({ error: describeError(String(message.code ?? "")) });
        return;
      }
      default:
        return;
    }
  }

  private send(payload: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(payload));
    return true;
  }

  quickMatch() { this.send({ type: "queue" }); }
  createPrivate() { this.send({ type: "create" }); }
  join(code: string) { this.send({ type: "join", code: code.toUpperCase() }); }
  cancel() { this.send({ type: "cancel" }); }
  chooseShip(ship: string) { this.send({ type: "ship", ship }); }
  setReady(ready: boolean) { this.send({ type: "ready", ready }); }

  /** Reports damage taken locally. The server decides what it costs. */
  reportDamage(source: "collision" | "impact", amount: number) {
    if (amount <= 0) return;
    this.damageSeq += 1;
    this.send({ type: "damage", seq: this.damageSeq, source, amount: Math.round(amount) });
  }

  transmit(weapon: string) {
    this.transmitSeq += 1;
    this.send({ type: "transmit", seq: this.transmitSeq, weapon });
  }

  leave() {
    this.send({ type: "leave" });
    this.update({ phase: "idle", opponent: null, result: null, yourCombat: null, opponentCombat: null });
  }

  disconnect() {
    this.closedByUs = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.warningTimer) clearTimeout(this.warningTimer);
    this.retryTimer = null;
    this.warningTimer = null;
    this.socket?.close();
    this.socket = null;
    this.seenIncoming.clear();
    this.incomingQueue = [];
    this.update({ ...EMPTY });
  }
}

function describeError(code: string) {
  switch (code) {
    case "unknown_room": return "No match found with that code.";
    case "room_full": return "That match is already full.";
    case "rate_limited": return "Slow down — too many actions at once.";
    case "invalid_weapon": return "That power-up cannot be transmitted.";
    case "invalid_damage": return "The server rejected a damage report.";
    case "wrong_phase": return "That is not allowed right now.";
    default: return "The match service reported a problem.";
  }
}
