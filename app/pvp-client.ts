"use client";

import { RemoteMotion } from "./network-motion.ts";

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
export const PROTOCOL_VERSION = 7;
export const PVP_PATH = "/pvp";
export const CODE_LENGTH = 4;
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

export type NetworkMode = "pvp" | "coop";
export type TeammatePosition = { id: string; name: string; roundId: number; seq: number; sentAt: number; x: number; y: number; angle: number };
export const POSITION_SEND_INTERVAL_MS = 33;
export type CoopRival = { hull: number; maxHull: number; score: number };
export type RoundResult = {
  outcome: "victory" | "defeat"; reason: string; opponent: string;
  eliminatedId: string | null; eliminatedName: string | null; youEliminated: boolean;
  cause: string; finalDamage: number; finisherId: string | null; finisherName: string | null;
  teamScore: number; durationSeconds: number;
};
export type CoopWorld = {
  seq: number;
  roundId: number;
  portalX: number;
  portalY: number;
  portalAngle: number;
  enrageActive: boolean;
  enemies: Array<Record<string, number | string | boolean | undefined>>;
  enemyBullets: Array<Record<string, number | string | boolean | undefined>>;
  /** Loose PUPs, identified so both pilots can race for the same ones. */
  pups: SharedPupSnapshot[];
};

export type SharedPupSnapshot = {
  pupId: number; type: string; x: number; y: number;
  vx: number; vy: number; life: number; phase: number;
};

/** The referee's verdict on one PUP race. */
export type PupDecision = { pupId: number; by: string | null; roundId: number };

export type PvpSnapshot = {
  phase: PvpPhase;
  /** Why the lobby is offline, when it is. */
  offlineReason: string;
  connected: boolean;
  /** True while a reconnect attempt is in flight during a live match. */
  reconnecting: boolean;
  name: string;
  kind: NetworkMode;
  difficulty: string;
  code: string | null;
  you: { id: string; ready: boolean; ship: string } | null;
  hostId: string | null;
  roundId: number;
  opponent: PvpOpponent | null;
  yourCombat: PvpCombat | null;
  opponentCombat: PvpCombat | null;
  rival: CoopRival | null;
  teammate: TeammatePosition | null;
  world: CoopWorld | null;
  /** Milliseconds until the match goes live, during a countdown. */
  countdownMs: number;
  countdownStartsAt: number;
  result: RoundResult | null;
  rematch: { you: boolean; opponent: boolean; status: "waiting" | "starting"; expiresAt: number } | null;
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
  kind: "pvp",
  difficulty: "easy",
  code: null,
  you: null,
  hostId: null,
  roundId: 0,
  opponent: null,
  yourCombat: null,
  opponentCombat: null,
  rival: null,
  teammate: null,
  world: null,
  countdownMs: 0,
  countdownStartsAt: 0,
  result: null,
  rematch: null,
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
  private inventorySeq = 0;
  private resume: string | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private closedByUs = false;
  /** Retained so an automatic reconnect repeats the same preferred identity. */
  private preferredName: string | undefined;
  /** Server timestamps minus ours, so countdowns agree across machines. */
  private clockOffset = 0;
  private seenIncoming = new Set<string>();
  /** Delivered attacks the game has not yet spawned. */
  private incomingQueue: { weapon: string; from: string }[] = [];
  private warningTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionKind: NetworkMode;
  private difficulty: string;
  private lastPositionAt = 0;
  private positionSeq = 0;
  private teammateMotion = new RemoteMotion();
  private lastMotionDebugAt = 0;
  private worldSeq = 0;
  private enemyHitSeq = 0;
  private worldActionSeq = 0;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private enemyHitQueue: { roundId: number; enemyId: number; source: string; damage: number; from: string }[] = [];
  private worldActionQueue: { roundId: number; action: "clear" | "emp"; from: string }[] = [];
  private pupClaimSeq = 0;
  private pupDecisionQueue: PupDecision[] = [];

  constructor(kind: NetworkMode = "pvp", difficulty = "easy") {
    this.sessionKind = kind;
    this.difficulty = difficulty;
    this.snapshot = { ...EMPTY, kind, difficulty };
  }

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

  drainEnemyHits() { const hits = this.enemyHitQueue; this.enemyHitQueue = []; return hits; }
  drainWorldActions() { const actions = this.worldActionQueue; this.worldActionQueue = []; return actions; }
  /** Settled PUP races since the last call. Both winner and loser see every one. */
  drainPupDecisions() { const decisions = this.pupDecisionQueue; this.pupDecisionQueue = []; return decisions; }

  private stopCountdownTimer() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  }

  private refreshCountdown() {
    if (this.snapshot.phase !== "countdown") return this.stopCountdownTimer();
    this.update({ countdownMs: countdownRemaining(this.snapshot.countdownStartsAt, this.clockOffset) });
  }

  private update(patch: Partial<PvpSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  connect(preferredName?: string) {
    if (typeof window === "undefined") return;
    if (preferredName !== undefined) this.preferredName = preferredName;
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
      this.send({ type: "hello", name: this.preferredName, resume: this.resume ?? undefined });
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
        this.teammateMotion.reset();
        const state = message.state;
        this.update({
          phase: state === "searching" ? "searching" : state === "waiting" ? "waiting" : "idle",
          code: typeof message.code === "string" ? message.code : null,
          name: typeof message.name === "string" ? message.name : this.snapshot.name,
          opponent: null,
          you: null,
          rival: null,
          teammate: null,
          yourCombat: null,
          opponentCombat: null,
          result: null,
          rematch: null,
          error: message.reason === "opponent_left" ? "Your opponent left." : null,
        });
        return;
      }
      case "match": {
        const you = message.you as { id?: string; ship?: string; ready?: boolean } | undefined;
        this.update({
          phase: this.snapshot.phase === "active" ? "active" : "select",
          kind: message.kind === "coop" ? "coop" : "pvp",
          difficulty: typeof message.difficulty === "string" ? message.difficulty : this.difficulty,
          code: typeof message.code === "string" ? message.code : null,
          you: { id: you?.id ?? "", ship: you?.ship ?? "wing", ready: Boolean(you?.ready) },
          hostId: typeof message.hostId === "string" ? message.hostId : null,
          roundId: typeof message.roundId === "number" ? message.roundId : this.snapshot.roundId,
          opponent: (message.opponent as PvpOpponent | null) ?? null,
          result: message.lastResult ? this.parseResult(message.lastResult as Record<string, unknown>) : null,
          rematch: this.snapshot.rematch,
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
          countdownStartsAt: startsAt,
          countdownMs: countdownRemaining(startsAt, this.clockOffset),
          teammate: null,
          world: null,
        });
        this.teammateMotion.reset();
        this.stopCountdownTimer();
        this.countdownTimer = setInterval(() => this.refreshCountdown(), 100);
        return;
      }
      case "state": {
        const patch: Partial<PvpSnapshot> = {};
        if (message.phase === "active" || message.you) {
          if (this.snapshot.phase !== "active") { this.teammateMotion.reset(); patch.teammate = null; patch.world = null; }
          patch.phase = "active";
          patch.result = null;
          this.stopCountdownTimer();
        }
        if (typeof message.roundId === "number") patch.roundId = message.roundId;
        if (message.you) patch.yourCombat = message.you as PvpCombat;
        if (message.opponent) patch.opponentCombat = message.opponent as PvpCombat;
        if (message.rival) patch.rival = message.rival as CoopRival;
        this.update(patch);
        return;
      }
      case "teammate": {
        const teammate = message as unknown as TeammatePosition;
        if (teammate.roundId !== this.snapshot.roundId) return;
        const receivedAt = performance.now();
        if (!this.teammateMotion.push({ ...teammate, receivedAt })) return;
        this.update({ teammate });
        if (process.env.NODE_ENV !== "production" && receivedAt - this.lastMotionDebugAt >= 2000) {
          this.lastMotionDebugAt = receivedAt;
          console.debug("[coop motion]", this.teammateMotion.metrics(receivedAt));
        }
        return;
      }
      case "world": {
        const world = message as unknown as CoopWorld;
        if (world.roundId !== this.snapshot.roundId || world.seq <= (this.snapshot.world?.seq ?? -1)) return;
        this.update({ world });
        return;
      }
      case "enemy_hit": {
        if (message.roundId !== this.snapshot.roundId) return;
        this.enemyHitQueue.push(message as unknown as { roundId: number; enemyId: number; source: string; damage: number; from: string });
        return;
      }
      case "pup_taken": {
        const decision = message as unknown as PupDecision;
        if (decision.roundId !== this.snapshot.roundId) return;
        this.pupDecisionQueue.push(decision);
        return;
      }
      case "coop_world_action": {
        if (message.roundId !== this.snapshot.roundId) return;
        this.worldActionQueue.push(message as unknown as { roundId: number; action: "clear" | "emp"; from: string });
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
        if (message.state === "reconnected") this.teammateMotion.reset();
        this.update({
          ...(message.state === "reconnected" ? { teammate: null } : {}),
          opponent: opponent ? { ...opponent, connected: message.state === "reconnected" } : opponent,
        });
        return;
      }
      case "rematch": {
        this.update({
          rematch: {
            you: Boolean(message.you),
            opponent: Boolean(message.opponent),
            status: message.status === "starting" ? "starting" : "waiting",
            expiresAt: typeof message.expiresAt === "number" ? message.expiresAt : 0,
          },
        });
        return;
      }
      case "result": {
        this.update({
          phase: "finished",
          result: this.parseResult(message),
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

  private parseResult(message: Record<string, unknown>): RoundResult {
    const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
    return {
      outcome: message.outcome === "victory" ? "victory" : "defeat",
      reason: String(message.reason ?? ""), opponent: String(message.opponent ?? "OPPONENT"),
      eliminatedId: typeof message.eliminatedId === "string" ? message.eliminatedId : null,
      eliminatedName: typeof message.eliminatedName === "string" ? message.eliminatedName : null,
      youEliminated: Boolean(message.youEliminated), cause: String(message.cause ?? "unknown"),
      finalDamage: number(message.finalDamage),
      finisherId: typeof message.finisherId === "string" ? message.finisherId : null,
      finisherName: typeof message.finisherName === "string" ? message.finisherName : null,
      teamScore: number(message.teamScore), durationSeconds: number(message.durationSeconds),
    };
  }

  private send(payload: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(payload));
    return true;
  }

  quickMatch() { this.send({ type: "queue", kind: this.sessionKind, difficulty: this.difficulty }); }
  createPrivate() { this.send({ type: "create", kind: this.sessionKind, difficulty: this.difficulty }); }
  join(code: string) { this.send({ type: "join", code: code.toUpperCase() }); }
  cancel() { this.send({ type: "cancel" }); }
  chooseShip(ship: string) { this.send({ type: "ship", ship }); }
  setReady(ready: boolean) { this.send({ type: "ready", ready }); }
  requestRematch(ship?: string) { this.send({ type: "rematch", ...(ship ? { ship } : {}) }); }

  /** Reports damage taken locally. The server decides what it costs. */
  reportDamage(source: "collision" | "impact", amount: number, cause = "unknown") {
    if (amount <= 0) return;
    this.damageSeq += 1;
    this.send({ type: "damage", seq: this.damageSeq, source, amount: Math.round(amount), cause });
  }

  /** Reports the concrete simulation event; the server owns the resulting count. */
  reportInventory(action: "collect" | "launch" | "remove", weapon: string) {
    this.inventorySeq += 1;
    return this.send({ type: "inventory", seq: this.inventorySeq, action, weapon });
  }

  reportPosition(x: number, y: number, angle: number, now = performance.now()) {
    if (now - this.lastPositionAt < POSITION_SEND_INTERVAL_MS) return false;
    this.lastPositionAt = now;
    this.positionSeq += 1;
    return this.send({ type: "position", seq: this.positionSeq, sentAt: Date.now(), x, y, angle });
  }

  /** Called from the canvas render loop; it does not cause a React update. */
  renderedTeammate(now = performance.now()) {
    const teammate = this.snapshot.teammate;
    const motion = this.teammateMotion.sample(now);
    return teammate && motion ? { ...teammate, ...motion } : teammate;
  }

  reportWorld(world: Omit<CoopWorld, "seq">) {
    this.worldSeq += 1;
    this.send({ type: "world", seq: this.worldSeq, ...world });
  }

  reportEnemyHit(enemyId: number, damage: number, source: "cannon" | "overcharge" | "projectile" = "cannon") {
    if (!Number.isInteger(enemyId) || enemyId < 1 || this.snapshot.roundId < 1) return false;
    this.enemyHitSeq += 1;
    return this.send({ type: "enemy_hit", seq: this.enemyHitSeq, roundId: this.snapshot.roundId, enemyId, source, damage });
  }

  /**
   * Ask for a loose PUP. The server decides; `drainPupDecisions` carries the answer.
   *
   * The caller hides the PUP immediately for responsiveness but must not award
   * the payload until the verdict arrives — inventory is a server-owned LIFO
   * ledger, and handing out a payload that might be revoked would desync it.
   */
  claimPup(pupId: number) {
    if (!Number.isInteger(pupId) || pupId < 1 || this.snapshot.roundId < 1) return false;
    this.pupClaimSeq += 1;
    return this.send({ type: "pup_claim", seq: this.pupClaimSeq, roundId: this.snapshot.roundId, pupId });
  }

  reportWorldAction(action: "clear" | "emp") {
    if (this.snapshot.roundId < 1) return false;
    this.worldActionSeq += 1;
    return this.send({ type: "coop_world_action", seq: this.worldActionSeq, roundId: this.snapshot.roundId, action });
  }

  transmit(weapon: string) {
    this.transmitSeq += 1;
    this.send({ type: "transmit", seq: this.transmitSeq, weapon });
  }

  leave() {
    this.send({ type: "leave" });
    this.update({ phase: "idle", opponent: null, result: null, rematch: null, yourCombat: null, opponentCombat: null });
  }

  disconnect() {
    this.closedByUs = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.warningTimer) clearTimeout(this.warningTimer);
    this.stopCountdownTimer();
    this.retryTimer = null;
    this.warningTimer = null;
    this.socket?.close();
    this.socket = null;
    this.seenIncoming.clear();
    this.incomingQueue = [];
    this.teammateMotion.reset();
    this.update({ ...EMPTY });
  }
}

export function countdownRemaining(startsAt: number, clockOffset: number, clientNow = Date.now()) {
  return Math.max(0, startsAt - (clientNow + clockOffset));
}

export function countdownLabel(remainingMs: number) {
  return remainingMs > 0 ? String(Math.ceil(remainingMs / 1000)) : "LAUNCH";
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
