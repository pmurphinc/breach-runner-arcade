/**
 * Authoritative room and match state.
 *
 * Deliberately free of any WebSocket knowledge: rooms take player handles with
 * a `send` function, so the whole state machine can be driven from tests
 * without opening a socket. `server/pvp.mjs` supplies the transport.
 *
 * In both co-op and PvP the first player is the arena host. Its validated,
 * rate-limited world snapshots are relayed to the other pilot so both devices
 * render one world. The server still owns match membership, shared rival
 * integrity, hull, shield and results -- the host is an authority on geometry
 * only, and reports every hit it resolves rather than asserting a hull.
 */
import {
  COUNTDOWN_SECONDS,
  ERRORS,
  MAX_DAMAGE_EVENTS_PER_WINDOW,
  MAX_DAMAGE_TOTAL_PER_WINDOW,
  MAX_MESSAGES_PER_WINDOW,
  MAX_ENEMY_HITS_PER_WINDOW,
  MAX_TRANSMITS_PER_WINDOW,
  QUEUE_TIMEOUT_MS,
  RECONNECT_GRACE_MS,
  REMATCH_TIMEOUT_MS,
  ROOM_IDLE_TIMEOUT_MS,
  SENDABLE_WEAPONS,
  createRateWindow,
  guestName,
  randomCode,
  rollWindow,
} from "./protocol.mjs";
import { applyDamage, createCombatState, snapshot } from "./rules.mjs";
import { PUP_INVENTORY_CAPACITY } from "../app/pup-inventory.js";

/** Hull by ship, mirroring app/game-data.ts. Asserted by the protocol test. */
export const SHIP_HULL = {
  tank: 280,
  wing: 175,
  squid: 170,
  rabbit: 150,
  turtle: 250,
  flash: 190,
  hunter: 220,
  flagship: 300,
  kestrel: 120,
  warden: 200,
};

const COOP_RIVAL_HEALTH = { practice: 200, easy: 200, difficult: 400, hard: 700 };
export { PUP_INVENTORY_CAPACITY };
const COOP_POWER_DAMAGE = { nuke: 24, beam: 18, artillery: 18, gunship: 18 };
const coopPowerDamage = (weapon) => COOP_POWER_DAMAGE[weapon] ?? 12;

/**
 * Modes that run one relayed world rather than two private mirrors.
 *
 * Co-op has always been one of them. PvP joined it when a duel stopped being a
 * correspondence game: without this, `updateWorld` rejects every PvP room and
 * the two pilots never share an arena.
 */
export const SHARED_ARENA_KINDS = ["coop", "pvp"];
const isSharedArena = (room) => SHARED_ARENA_KINDS.includes(room.kind);

/** The sole logical public PvP queue. Client properties never contribute to it. */
export const PVP_QUICK_MATCH_QUEUE = "PVP_1V1_QUICK_MATCH";
export const PRIVATE_CODE_ATTEMPTS = 50;

const PHASES = {
  LOBBY: "lobby",
  SELECT: "select",
  COUNTDOWN: "countdown",
  ACTIVE: "active",
  FINISHED: "finished",
};

let nextPlayerId = 1;

export function createPlayer(send, { now = Date.now(), random = Math.random } = {}) {
  return {
    id: `p${nextPlayerId++}`,
    resume: `${Math.floor(random() * 1e9).toString(36)}${Date.now().toString(36)}`,
    name: guestName(random),
    send,
    room: null,
    ship: "wing",
    ready: false,
    connected: true,
    lastSeen: now,
    disconnectedAt: 0,
    combat: null,
    lastDamageSeq: -1,
    lastInventorySeq: -1,
    pupInventory: [],
    launchedPups: [],
    lastTransmitSeq: -1,
    lastEnemyHitSeq: -1,
    lastShotSeq: -1,
    lastWorldActionSeq: -1,
    position: { seq: -1, sentAt: 0, x: 752, y: 470, angle: 270 },
    window: createRateWindow(),
  };
}

export class MatchServer {
  /**
   * `schedule` fires the countdown at exactly the right moment. Tests leave it
   * out and drive time through `sweep`, which remains the backstop in
   * production too, so a dropped timer cannot strand a room.
   */
  constructor({ random = Math.random, log = () => {}, schedule = null } = {}) {
    this.random = random;
    this.log = log;
    this.schedule = schedule;
    this.rooms = new Map();
    this.queue = [];
    this.byResume = new Map();
  }

  // ------------------------------------------------------------- lifecycle --

  register(player) {
    this.byResume.set(player.resume, player);
  }

  /**
   * A socket dropped. Before a match this simply frees the opponent; during
   * one it starts the reconnection grace period rather than ending the match.
   */
  disconnect(player, now = Date.now()) {
    player.connected = false;
    player.disconnectedAt = now;
    this.leaveQueue(player);

    const room = player.room;
    if (!room) {
      this.byResume.delete(player.resume);
      return;
    }

    if (room.phase === PHASES.ACTIVE || room.phase === PHASES.COUNTDOWN) {
      const survivor = this.opponentOf(room, player);
      // The arena host just dropped. Hand simulation to the pilot who is still
      // here rather than leave their world frozen for the whole grace period.
      // The grace itself is untouched: if the host never comes back the sweep
      // still forfeits them, and if they do they return as the guest.
      if (room.players[0] === player && survivor?.connected) {
        this.promoteHost(room, survivor, now);
      }
      this.sendTo(survivor, {
        type: "opponent",
        state: "disconnected",
        graceMs: RECONNECT_GRACE_MS,
      });
      return;
    }

    // Still in the lobby or ship select: return the opponent to the lobby.
    const opponent = this.opponentOf(room, player);
    this.removeRoom(room);
    if (opponent) {
      opponent.room = null;
      opponent.ready = false;
      this.sendTo(opponent, { type: "lobby", state: "idle", reason: "opponent_left" });
    }
    this.byResume.delete(player.resume);
  }

  /**
   * Moves the arena host to another pilot.
   *
   * Host identity is simply position zero in the room, so a migration is a
   * reorder plus a `match` broadcast. Everything that asks who hosts --
   * `sendMatch`, `updateWorld`, `reportEnemyHit` -- reads that same slot, so
   * there is no second source of truth to keep in step.
   */
  promoteHost(room, next, now = Date.now()) {
    const index = room.players.indexOf(next);
    if (index <= 0) return false;
    room.players.splice(index, 1);
    room.players.unshift(next);
    // The new host counts its own snapshots from its own counter, which has no
    // relation to the number the old host had reached. Without this reset every
    // snapshot the new host sends would look stale and be dropped.
    room.worldSeq = -1;
    room.lastWorldAt = 0;
    room.touchedAt = now;
    this.sendMatch(room);
    return true;
  }

  /** Re-attaches a returning player to their match, if the grace has not expired. */
  reconnect(resume, send, now = Date.now()) {
    const player = this.byResume.get(resume);
    if (!player || player.connected) return null;
    if (now - player.disconnectedAt > RECONNECT_GRACE_MS) return null;

    player.connected = true;
    player.send = send;
    player.lastSeen = now;
    player.disconnectedAt = 0;
    // A reloaded client starts its position sequence at one. No frames from
    // the closed socket can follow this point, so begin a fresh ordering era.
    player.position.seq = -1;

    const room = player.room;
    if (room) {
      this.sendTo(this.opponentOf(room, player), { type: "opponent", state: "reconnected" });
      this.sendMatch(room);
      if (room.phase === PHASES.ACTIVE) this.broadcastState(room, now);
    }
    return player;
  }

  // ----------------------------------------------------------- matchmaking --

  enqueue(player, options = {}, now = Date.now()) {
    if (typeof options === "number") { now = options; options = {}; }
    const { kind = "pvp" } = options;
    // PvP difficulty is both server-owned and deliberately absent from its
    // matchmaking key. Co-op retains its difficulty-specific public queues.
    const difficulty = kind === "pvp" ? "easy" : (options.difficulty ?? "easy");
    const queueKey = kind === "pvp" ? PVP_QUICK_MATCH_QUEUE : `coop:${difficulty}`;
    if (player.room) return;
    this.leaveQueue(player);
    const waiting = this.queue.find((entry) => entry.player.connected && entry.queueKey === queueKey);

    if (!waiting) {
      this.queue.push({ player, at: now, queueKey, kind, difficulty });
      this.sendTo(player, { type: "lobby", state: "searching" });
      return;
    }

    this.queue = this.queue.filter((entry) => entry !== waiting);
    this.startRoom(waiting.player, player, { now, isPrivate: false, kind, difficulty });
  }

  leaveQueue(player) {
    this.queue = this.queue.filter((entry) => entry.player !== player);
  }

  createPrivate(player, options = {}, now = Date.now()) {
    if (typeof options === "number") { now = options; options = {}; }
    const { kind = "pvp" } = options;
    const difficulty = kind === "pvp" ? "easy" : (options.difficulty ?? "easy");
    if (player.room) return null;
    this.leaveQueue(player);

    let code = null;
    for (let attempt = 0; attempt < PRIVATE_CODE_ATTEMPTS; attempt += 1) {
      const candidate = randomCode(this.random);
      if (!this.rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    // Never overwrite an active room if an extremely unlucky run exhausts
    // the bounded retry budget. The caller can safely ask the player to retry.
    if (!code) return null;

    const room = {
      code,
      isPrivate: true,
      kind,
      difficulty,
      rivalHealth: kind === "coop" ? COOP_RIVAL_HEALTH[difficulty] : null,
      rivalMaxHealth: kind === "coop" ? COOP_RIVAL_HEALTH[difficulty] : null,
      teamScore: 0,
      phase: PHASES.LOBBY,
      players: [player],
      createdAt: now,
      touchedAt: now,
      countdownEndsAt: 0,
      transmitSeq: 0,
      worldSeq: -1,
      lastWorldAt: 0,
      rematchVotes: new Set(),
      rematchExpiresAt: 0,
      lastResult: null,
      lastResults: new Map(),
      roundStartedAt: 0,
      roundId: 0,
    };
    this.rooms.set(code, room);
    player.room = room;
    this.sendTo(player, { type: "lobby", state: "waiting", code });
    return room;
  }

  join(player, code, now = Date.now()) {
    if (player.room) return { ok: false, code: ERRORS.WRONG_PHASE };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, code: ERRORS.UNKNOWN_ROOM };
    if (room.players.length >= 2) return { ok: false, code: ERRORS.ROOM_FULL };

    this.leaveQueue(player);
    room.players.push(player);
    player.room = room;
    room.touchedAt = now;
    this.beginSelect(room, now);
    return { ok: true, room };
  }

  startRoom(a, b, { now, isPrivate, kind = "pvp", difficulty = "easy" }) {
    // Defense in depth: no caller can create PvP with PvE rules.
    if (kind === "pvp") difficulty = "easy";
    let code = randomCode(this.random);
    let guard = 0;
    while (this.rooms.has(code) && guard++ < 50) code = randomCode(this.random);

    const room = {
      code,
      isPrivate,
      kind,
      difficulty,
      rivalHealth: kind === "coop" ? COOP_RIVAL_HEALTH[difficulty] : null,
      rivalMaxHealth: kind === "coop" ? COOP_RIVAL_HEALTH[difficulty] : null,
      teamScore: 0,
      phase: PHASES.LOBBY,
      players: [a, b],
      createdAt: now,
      touchedAt: now,
      countdownEndsAt: 0,
      transmitSeq: 0,
      worldSeq: -1,
      lastWorldAt: 0,
      rematchVotes: new Set(),
      rematchExpiresAt: 0,
      lastResult: null,
      lastResults: new Map(),
      roundStartedAt: 0,
      roundId: 0,
    };
    this.rooms.set(code, room);
    a.room = room;
    b.room = room;
    this.beginSelect(room, now);
    return room;
  }

  beginSelect(room, now = Date.now()) {
    room.phase = PHASES.SELECT;
    room.rematchVotes?.clear();
    room.rematchExpiresAt = 0;
    room.touchedAt = now;
    for (const player of room.players) player.ready = false;
    this.sendMatch(room);
  }

  // ----------------------------------------------------------- ship + ready --

  setShip(player, ship) {
    const room = player.room;
    // Locked once the countdown starts, so nobody swaps frames mid-launch.
    if (!room || (room.phase !== PHASES.SELECT && room.phase !== PHASES.LOBBY)) {
      return { ok: false, code: ERRORS.WRONG_PHASE };
    }
    player.ship = ship;
    player.ready = false;
    this.sendMatch(room);
    return { ok: true };
  }

  setReady(player, ready, now = Date.now()) {
    const room = player.room;
    if (!room || room.phase !== PHASES.SELECT) return { ok: false, code: ERRORS.WRONG_PHASE };

    player.ready = ready;
    room.touchedAt = now;
    this.broadcast(room, {
      type: "ready",
      states: room.players.map((entry) => ({ id: entry.id, ready: entry.ready })),
    });

    if (room.players.length === 2 && room.players.every((entry) => entry.ready)) {
      this.startCountdown(room, now);
    }
    return { ok: true };
  }

  startCountdown(room, now = Date.now()) {
    room.phase = PHASES.COUNTDOWN;
    room.countdownEndsAt = now + COUNTDOWN_SECONDS * 1000;
    room.touchedAt = now;
    if (this.schedule) {
      this.schedule(() => {
        if (room.phase === PHASES.COUNTDOWN) this.activate(room, Date.now());
      }, COUNTDOWN_SECONDS * 1000);
    }
    this.broadcast(room, {
      type: "countdown",
      seconds: COUNTDOWN_SECONDS,
      // Server timestamps: clients count down against their own clock offset
      // rather than each starting whenever their message happens to land.
      serverNow: now,
      startsAt: room.countdownEndsAt,
    });
  }

  /** Called by the sweep once a countdown has elapsed. */
  activate(room, now = Date.now()) {
    room.phase = PHASES.ACTIVE;
    room.touchedAt = now;
    room.roundStartedAt = now;
    room.roundId += 1;
    room.worldSeq = -1;
    room.lastWorldAt = 0;
    if (room.kind === "coop") {
      room.rivalHealth = room.rivalMaxHealth;
      room.teamScore = 0;
    }
    for (const player of room.players) {
      player.combat = createCombatState(SHIP_HULL[player.ship] ?? 240);
      player.lastDamageSeq = -1;
      player.lastInventorySeq = -1;
      player.pupInventory = [];
      player.launchedPups = [];
      player.lastTransmitSeq = -1;
      player.lastEnemyHitSeq = -1;
      player.lastShotSeq = -1;
      player.lastWorldActionSeq = -1;
      player.position.seq = -1;
    }
    this.broadcast(room, { type: "state", phase: "active", serverNow: now, roundId: room.roundId });
    this.broadcastState(room, now);
  }

  // ----------------------------------------------------------------- combat --

  /**
   * A client reporting damage taken in its own arena.
   *
   * The client says what hit it; the server decides what that costs. Sequence
   * numbers make a replayed frame a no-op, and the sliding window caps both
   * how often and how much a client can claim.
   */
  reportDamage(player, { seq, source, amount, cause = "unknown", target = "self" }, now = Date.now()) {
    const room = player.room;
    if (!room || room.phase !== PHASES.ACTIVE || !player.combat) {
      return { ok: false, code: ERRORS.NOT_IN_MATCH };
    }
    if (seq <= player.lastDamageSeq) return { ok: true, duplicate: true };

    // Ship-vs-ship fire is resolved once, by the arena host, in the world both
    // pilots actually share. It is still reported rather than asserted: the
    // host names who it hit and how hard, and everything below -- shield, hull,
    // destruction, result -- is decided here exactly as it was before.
    //
    // Collisions stay self-reported whoever is hosting, because only the pilot
    // who hit something knows they did.
    let victim = player;
    if (target === "opponent") {
      if (room.kind !== "pvp" || room.players[0] !== player || source !== "impact") {
        return { ok: false, code: ERRORS.WRONG_PHASE };
      }
      victim = this.opponentOf(room, player);
      if (!victim || !victim.combat) return { ok: false, code: ERRORS.NOT_IN_MATCH };
    }

    // The window is charged to the reporter either way, so a host cannot buy
    // itself a larger damage budget by aiming its claims at the other pilot.
    rollWindow(player.window, now);
    if (
      player.window.damageEvents >= MAX_DAMAGE_EVENTS_PER_WINDOW ||
      player.window.damageTotal + amount > MAX_DAMAGE_TOTAL_PER_WINDOW
    ) {
      return { ok: false, code: ERRORS.RATE_LIMITED };
    }
    player.window.damageEvents += 1;
    player.window.damageTotal += amount;
    player.lastDamageSeq = seq;

    const hullBefore = victim.combat.hull;
    const outcome = applyDamage(victim.combat, source, amount, now);
    const finalDamage = Math.min(hullBefore, outcome.toHull);
    room.touchedAt = now;
    this.broadcastState(room, now);

    if (outcome.destroyed) {
      if (room.kind === "coop") this.finishCoop(room, "defeat", "pilot_hull", now, victim, cause, finalDamage);
      else this.finish(room, this.opponentOf(room, victim), "hull", now, victim, cause, finalDamage);
    }
    return { ok: true, ...outcome };
  }

  updateInventory(player, { seq, action, weapon }, now = Date.now()) {
    const room = player.room;
    if (!room || room.phase !== PHASES.ACTIVE || !player.combat) return { ok: false, code: ERRORS.NOT_IN_MATCH };
    if (seq <= player.lastInventorySeq) return { ok: true, duplicate: true };
    if (!Number.isInteger(seq) || !["collect", "launch", "remove"].includes(action) || !SENDABLE_WEAPONS.includes(weapon)) {
      return { ok: false, code: ERRORS.BAD_MESSAGE };
    }
    player.lastInventorySeq = seq;
    // The arena still reports the concrete collision event (as it reports
    // incoming damage), but it never supplies the resulting count. This
    // server-owned typed LIFO ledger makes count jumps, replay, overflow,
    // fabricated removal, and transmission without a launch impossible.
    if (action === "collect") {
      if (player.pupInventory.length >= PUP_INVENTORY_CAPACITY) return { ok: false, code: ERRORS.BAD_MESSAGE };
      player.pupInventory.push(weapon);
    } else {
      const loaded = player.pupInventory[player.pupInventory.length - 1];
      if (loaded !== weapon) return { ok: false, code: ERRORS.INVALID_WEAPON };
      player.pupInventory.pop();
      if (action === "launch") player.launchedPups.push(weapon);
    }
    room.touchedAt = now;
    this.broadcastState(room, now);
    return { ok: true };
  }

  /** A collected attack power-up sent through the wormhole to the opponent. */
  transmit(player, { seq, weapon }, now = Date.now()) {
    const room = player.room;
    if (!room || room.phase !== PHASES.ACTIVE) return { ok: false, code: ERRORS.NOT_IN_MATCH };
    if (seq <= player.lastTransmitSeq) return { ok: true, duplicate: true };
    const launchedIndex = player.launchedPups.indexOf(weapon);
    if (launchedIndex < 0) return { ok: false, code: ERRORS.INVALID_WEAPON };

    rollWindow(player.window, now);
    if (player.window.transmits >= MAX_TRANSMITS_PER_WINDOW) {
      return { ok: false, code: ERRORS.RATE_LIMITED };
    }
    player.window.transmits += 1;
    player.lastTransmitSeq = seq;
    player.launchedPups.splice(launchedIndex, 1);
    room.touchedAt = now;

    // Co-op power-ups damage one server-owned shared wormhole instead of
    // attacking the teammate. Both clients receive the same authoritative
    // integrity and score snapshot.
    if (room.kind === "coop") {
      const damage = coopPowerDamage(weapon);
      const finalDamage = Math.min(room.rivalHealth, damage);
      room.rivalHealth = Math.max(0, room.rivalHealth - damage);
      room.teamScore += 750 + damage * 10;
      const eventId = `${room.code}:${(room.transmitSeq += 1)}`;
      this.broadcast(room, { type: "state", sent: weapon, eventId, by: player.id });
      this.broadcastState(room, now);
      if (room.rivalHealth <= 0) this.finishCoop(room, "victory", "rival", now, null, weapon, finalDamage, player);
      return { ok: true, eventId, damage };
    }

    const opponent = this.opponentOf(room, player);
    // Server-issued id so the receiver can discard a duplicate delivery.
    const eventId = `${room.code}:${(room.transmitSeq += 1)}`;
    // Both pilots hear about the delivery, and `targetId` says whose portal it
    // comes out of. The pilot being attacked raises the warning; the arena host
    // is the one that spawns the wave, so it exists in the world the two of
    // them share instead of only in the arena of whoever was attacked.
    this.broadcast(room, {
      type: "incoming",
      eventId,
      weapon,
      from: player.name,
      targetId: opponent?.id ?? null,
    });
    this.sendTo(player, { type: "state", sent: weapon, eventId });
    return { ok: true, eventId };
  }

  updatePosition(player, position, now = Date.now()) {
    const room = player.room;
    if (!room || !isSharedArena(room) || room.phase !== PHASES.ACTIVE) return { ok: false, code: ERRORS.NOT_IN_MATCH };
    if (position.seq <= player.position.seq) return { ok: true, ignored: true };
    player.position = { seq: position.seq, sentAt: position.sentAt, x: position.x, y: position.y, angle: position.angle };
    room.touchedAt = now;
    this.sendTo(this.opponentOf(room, player), {
      type: "teammate", id: player.id, name: player.name, roundId: room.roundId, ...player.position,
    });
    return { ok: true };
  }

  updateWorld(player, world, now = Date.now()) {
    const room = player.room;
    if (!room || !isSharedArena(room) || room.phase !== PHASES.ACTIVE) {
      return { ok: false, code: ERRORS.NOT_IN_MATCH };
    }
    if (room.players[0]?.id !== player.id) return { ok: false, code: ERRORS.WRONG_PHASE };
    if (world.roundId !== room.roundId) return { ok: true, ignored: true };
    if (world.seq <= room.worldSeq) return { ok: true, ignored: true };
    if (now - room.lastWorldAt < 70) return { ok: true, ignored: true };
    room.worldSeq = world.seq;
    room.lastWorldAt = now;
    room.touchedAt = now;
    this.sendTo(this.opponentOf(room, player), { type: "world", ...world, hostId: player.id });
    return { ok: true };
  }

  reportEnemyHit(player, hit, now = Date.now()) {
    const room = player.room;
    if (!room || !isSharedArena(room) || room.phase !== PHASES.ACTIVE) return { ok: false, code: ERRORS.NOT_IN_MATCH };
    if (hit.roundId !== room.roundId || hit.seq <= player.lastEnemyHitSeq) return { ok: true, ignored: true };
    rollWindow(player.window, now);
    if (player.window.enemyHits >= MAX_ENEMY_HITS_PER_WINDOW) return { ok: false, code: ERRORS.RATE_LIMITED };
    player.window.enemyHits += 1;
    player.lastEnemyHitSeq = hit.seq;
    const host = room.players[0];
    if (player === host) return { ok: true, ignored: true };
    this.sendTo(host, { type: "enemy_hit", ...hit, from: player.id });
    return { ok: true };
  }

  reportWorldAction(player, action) {
    const room = player.room;
    if (!room || !isSharedArena(room) || room.phase !== PHASES.ACTIVE) return { ok: false, code: ERRORS.NOT_IN_MATCH };
    if (action.roundId !== room.roundId || action.seq <= player.lastWorldActionSeq) return { ok: true, ignored: true };
    player.lastWorldActionSeq = action.seq;
    const host = room.players[0];
    if (player !== host) this.sendTo(host, { type: "coop_world_action", ...action, from: player.id });
    return { ok: true };
  }

  /**
   * One relayed cannon volley.
   *
   * Rounds cross as spawn events, not as positions: a cannon round has no
   * steering, so the receiver integrates it identically and gets a smooth line
   * of fire instead of one that teleports once per snapshot. It is also what
   * gives the host per-tick precision when it resolves the other pilot fire
   * against its own hull, which a six-tick position sample could never do.
   */
  reportPilotShots(player, volley, now = Date.now()) {
    const room = player.room;
    if (!room || room.kind !== "pvp" || room.phase !== PHASES.ACTIVE) {
      return { ok: false, code: ERRORS.NOT_IN_MATCH };
    }
    if (volley.roundId !== room.roundId || volley.seq <= player.lastShotSeq) {
      return { ok: true, ignored: true };
    }
    player.lastShotSeq = volley.seq;
    room.touchedAt = now;
    this.sendTo(this.opponentOf(room, player), {
      type: "pvp_shot",
      roundId: volley.roundId,
      shots: volley.shots,
      from: player.id,
    });
    return { ok: true };
  }

  finishCoop(room, outcome, reason, now = Date.now(), eliminated = null, cause = "unknown", finalDamage = 0, finisher = null) {
    if (room.phase !== PHASES.ACTIVE) return;
    room.touchedAt = now;
    room.lastResult = {
      outcome,
      reason,
      opponent: outcome === "victory" ? "RIVAL WORMHOLE" : "CO-OP TEAM",
      eliminatedId: eliminated?.id ?? null,
      eliminatedName: eliminated?.name ?? null,
      cause,
      finalDamage,
      finisherId: finisher?.id ?? null,
      finisherName: finisher?.name ?? null,
      teamScore: room.teamScore,
      durationSeconds: room.roundStartedAt ? Math.max(0, Math.round((now - room.roundStartedAt) / 1000)) : 0,
    };
    for (const player of room.players) {
      this.sendTo(player, {
        type: "result",
        ...room.lastResult,
        youEliminated: Boolean(eliminated && player.id === eliminated.id),
      });
      player.combat = null;
    }
    // Co-op results are a transition, not a terminal room phase. Reuse the
    // original selection state so the socket, invite code and ship choices live on.
    this.beginSelect(room, now);
  }

  finish(room, winner, reason, now = Date.now(), eliminated = null, cause = "unknown", finalDamage = 0) {
    if (room.phase !== PHASES.ACTIVE) return;
    room.touchedAt = now;
    room.lastResults.clear();
    for (const player of room.players) {
      const result = {
        outcome: player === winner ? "victory" : "defeat",
        reason,
        opponent: this.opponentOf(room, player)?.name ?? "OPPONENT",
        eliminatedId: eliminated?.id ?? null,
        eliminatedName: eliminated?.name ?? null,
        youEliminated: Boolean(eliminated && player.id === eliminated.id),
        cause,
        finalDamage,
        finisherId: winner?.id ?? null,
        finisherName: winner?.name ?? null,
        teamScore: 0,
        durationSeconds: room.roundStartedAt ? Math.max(0, Math.round((now - room.roundStartedAt) / 1000)) : 0,
      };
      room.lastResults.set(player.id, result);
      this.sendTo(player, { type: "result", ...result });
      player.combat = null;
    }
    // PvP uses the same persistent selection lobby as co-op. Results are
    // personalized above, then both pilots must explicitly ready for another round.
    this.beginSelect(room, now);
  }

  /** A rematch starts only after both players explicitly accept. */
  requestRematch(player, now = Date.now(), ship) {
    const room = player.room;
    if (!room || room.phase !== PHASES.FINISHED) return { ok: false, code: ERRORS.WRONG_PHASE };
    if (ship && SHIP_HULL[ship]) player.ship = ship;
    if (room.rematchExpiresAt && now > room.rematchExpiresAt) room.rematchVotes.clear();
    if (room.rematchVotes.size === 0) room.rematchExpiresAt = now + REMATCH_TIMEOUT_MS;
    room.rematchVotes.add(player.id);
    room.touchedAt = now;

    const accepted = room.players.map((entry) => room.rematchVotes.has(entry.id));
    if (accepted.every(Boolean)) {
      for (const entry of room.players) {
        this.sendTo(entry, { type: "rematch", you: true, opponent: true, status: "starting", expiresAt: room.rematchExpiresAt });
      }
      this.beginSelect(room, now);
      return { ok: true, starting: true };
    }

    for (const entry of room.players) {
      const opponent = this.opponentOf(room, entry);
      this.sendTo(entry, {
        type: "rematch",
        you: room.rematchVotes.has(entry.id),
        opponent: opponent ? room.rematchVotes.has(opponent.id) : false,
        status: "waiting",
        expiresAt: room.rematchExpiresAt,
      });
    }
    return { ok: true, starting: false };
  }

  /** Leave a room and return both pilots to a clean lobby state. */
  leaveMatch(player) {
    const room = player.room;
    if (!room || room.phase === PHASES.ACTIVE) return { ok: false, code: ERRORS.WRONG_PHASE };
    const opponent = this.opponentOf(room, player);
    this.removeRoom(room);
    player.ready = false;
    player.combat = null;
    if (opponent) {
      opponent.ready = false;
      opponent.combat = null;
      this.sendTo(opponent, { type: "lobby", state: "idle", reason: "opponent_left" });
    }
    return { ok: true };
  }

  /** Message rate guard applied to every inbound frame. */
  allowMessage(player, now = Date.now()) {
    rollWindow(player.window, now);
    player.window.messages += 1;
    player.lastSeen = now;
    return player.window.messages <= MAX_MESSAGES_PER_WINDOW;
  }

  // ------------------------------------------------------------------ upkeep --

  /**
   * Periodic housekeeping: fires elapsed countdowns, forfeits players who did
   * not come back, and clears out abandoned rooms and queue entries.
   */
  sweep(now = Date.now()) {
    for (const room of [...this.rooms.values()]) {
      if (room.phase === PHASES.COUNTDOWN && now >= room.countdownEndsAt) {
        this.activate(room, now);
        continue;
      }

      if (room.phase === PHASES.FINISHED && room.rematchExpiresAt && now > room.rematchExpiresAt) {
        room.rematchVotes.clear();
        room.rematchExpiresAt = 0;
        this.broadcast(room, { type: "rematch", you: false, opponent: false, status: "waiting", expiresAt: 0 });
      }

      if (room.phase === PHASES.ACTIVE) {
        for (const player of room.players) {
          if (player.connected) continue;
          if (now - player.disconnectedAt < RECONNECT_GRACE_MS) continue;
          if (room.kind === "coop") this.finishCoop(room, "defeat", "forfeit", now);
          else this.finish(room, this.opponentOf(room, player), "forfeit", now);
          break;
        }
      }

      const idle = now - room.touchedAt > ROOM_IDLE_TIMEOUT_MS;
      const empty = room.players.every((player) => !player.connected);
      if (room.phase === PHASES.FINISHED || idle || empty) {
        if (room.phase === PHASES.FINISHED && !idle && !empty) continue;
        this.removeRoom(room);
      }
    }

    this.queue = this.queue.filter(
      (entry) => entry.player.connected && now - entry.at < QUEUE_TIMEOUT_MS
    );

    for (const [resume, player] of [...this.byResume.entries()]) {
      if (!player.connected && now - player.disconnectedAt > RECONNECT_GRACE_MS && !player.room) {
        this.byResume.delete(resume);
      }
    }
  }

  removeRoom(room) {
    this.rooms.delete(room.code);
    for (const player of room.players) {
      if (player.room === room) player.room = null;
    }
  }

  // ------------------------------------------------------------------ output --

  opponentOf(room, player) {
    return room.players.find((entry) => entry !== player) ?? null;
  }

  sendTo(player, message) {
    if (player && player.connected) player.send(message);
  }

  broadcast(room, message) {
    for (const player of room.players) this.sendTo(player, message);
  }

  sendMatch(room) {
    for (const player of room.players) {
      const opponent = this.opponentOf(room, player);
      this.sendTo(player, {
        type: "match",
        code: room.isPrivate ? room.code : null,
        kind: room.kind,
        difficulty: room.difficulty,
        phase: room.phase,
        hostId: room.players[0]?.id ?? null,
        roundId: room.roundId,
        you: { id: player.id, name: player.name, ship: player.ship, ready: player.ready },
        opponent: opponent
          ? {
              id: opponent.id,
              name: opponent.name,
              ship: opponent.ship,
              ready: opponent.ready,
              connected: opponent.connected,
            }
          : null,
        lastResult: room.lastResults?.get(player.id) ?? room.lastResult,
      });
    }
  }

  broadcastState(room, now = Date.now()) {
    for (const player of room.players) {
      const opponent = this.opponentOf(room, player);
      this.sendTo(player, {
        type: "state",
        serverNow: now,
        you: player.combat ? snapshot(player.combat, now) : null,
        opponent: opponent?.combat ? snapshot(opponent.combat, now) : null,
        rival: room.kind === "coop" ? { hull: room.rivalHealth, maxHull: room.rivalMaxHealth, score: room.teamScore } : null,
      });
    }
  }
}

export { PHASES };
