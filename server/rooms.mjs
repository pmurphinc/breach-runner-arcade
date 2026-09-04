/**
 * Authoritative room and match state.
 *
 * Deliberately free of any WebSocket knowledge: rooms take player handles with
 * a `send` function, so the whole state machine can be driven from tests
 * without opening a socket. `server/pvp.mjs` supplies the transport.
 *
 * A room holds **teams**, not two players. `app/team-rooms.js` owns the shapes:
 * 1v1 is two teams of one, co-op is one team of two, 2v2 is two teams of two.
 * Read that way the three modes are one room, and the two things the old
 * two-player code confused — "the pilot sharing my arena" and "the pilot I am
 * fighting" — become `teammatesOf` and `rivalsOf`, which is what let 2v2 be
 * added without changing 1v1 or co-op behaviour.
 *
 * Each *team* runs one shared arena: its first player is that arena's host, and
 * its validated, rate-limited world snapshots are relayed to its teammates so
 * both devices render one world. A 2v2 room therefore runs two independent
 * arenas with a host each, and one team's power-up race is never visible to the
 * other. The server still owns match membership, shared rival integrity and
 * results.
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
import {
  claimPup,
  createPupLedger,
  isSharedArenaKind,
  resetPupLedger,
  trackPupPositions,
} from "../app/shared-arena.js";
import {
  arenaHostOf,
  isArenaHost,
  isTeamDown,
  isTeamKind,
  membersOfTeam,
  nextTeamFor,
  othersOf,
  rivalsOf,
  roomCapacity,
  seatPlayers,
  teamCount,
  teamIndexOf,
  teammatesOf,
} from "../app/team-rooms.js";

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

/** The sole logical public PvP queue. Client properties never contribute to it. */
export const PVP_QUICK_MATCH_QUEUE = "PVP_1V1_QUICK_MATCH";
/** The sole logical public 2v2 queue. Four pilots, one key, no properties. */
export const TEAM_QUICK_MATCH_QUEUE = "TEAM_2V2_QUICK_MATCH";
export const PRIVATE_CODE_ATTEMPTS = 50;

/** Kinds whose rules the server owns outright; a client never picks them. */
const SERVER_RULED_KINDS = new Set(["pvp", "team"]);

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
    // Which side of the room this pilot flies for. Every kind has teams; in
    // 1v1 and co-op they are degenerate, so this is 0 until a room seats them.
    team: 0,
    ship: "wing",
    ready: false,
    connected: true,
    // Out of the current round. A team is beaten when all of its pilots are.
    eliminated: false,
    lastSeen: now,
    disconnectedAt: 0,
    combat: null,
    lastDamageSeq: -1,
    lastInventorySeq: -1,
    pupInventory: [],
    launchedPups: [],
    lastTransmitSeq: -1,
    lastEnemyHitSeq: -1,
    lastWorldActionSeq: -1,
    lastPupClaimSeq: -1,
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
   * A socket dropped. Before a match this frees the rest of the room; during
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
      // Everyone still in the room hears it, teammates and rivals alike: in a
      // four-pilot match "the opponent" is no longer a single person.
      for (const other of othersOf(room, player)) {
        this.sendTo(other, {
          type: "opponent",
          state: "disconnected",
          id: player.id,
          name: player.name,
          team: teamIndexOf(player),
          graceMs: RECONNECT_GRACE_MS,
        });
      }
      return;
    }

    // Still in the lobby or ship select. A four-pilot room has to survive one
    // pilot leaving — otherwise a 2v2 lobby could never be assembled — so the
    // seat is simply vacated and the rest are told. Two-player rooms keep their
    // existing behaviour of returning the other pilot to the lobby.
    if (isTeamKind(room.kind) && room.players.length > 1) {
      this.detachPlayer(room, player, now);
      this.byResume.delete(player.resume);
      return;
    }

    const others = othersOf(room, player);
    this.removeRoom(room);
    for (const other of others) {
      other.room = null;
      other.ready = false;
      this.sendTo(other, { type: "lobby", state: "idle", reason: "opponent_left" });
    }
    this.byResume.delete(player.resume);
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
      for (const other of othersOf(room, player)) {
        this.sendTo(other, { type: "opponent", state: "reconnected", id: player.id, name: player.name });
      }
      this.sendMatch(room);
      if (room.phase === PHASES.ACTIVE) this.broadcastState(room, now);
    }
    return player;
  }

  // ----------------------------------------------------------- matchmaking --

  /**
   * Public matchmaking. Waits until a whole roster is present, then seats it.
   *
   * 1v1 and co-op need two and 2v2 needs four, so the group size is the room's
   * capacity rather than a hardcoded pair. With a capacity of two this reduces
   * exactly to the old "find one waiting player and start" behaviour.
   */
  enqueue(player, options = {}, now = Date.now()) {
    if (typeof options === "number") { now = options; options = {}; }
    const { kind = "pvp" } = options;
    // PvP and 2v2 difficulty is both server-owned and deliberately absent from
    // matchmaking. Co-op retains its difficulty-specific public queues.
    const difficulty = SERVER_RULED_KINDS.has(kind) ? "easy" : (options.difficulty ?? "easy");
    const queueKey = kind === "pvp"
      ? PVP_QUICK_MATCH_QUEUE
      : kind === "team"
        ? TEAM_QUICK_MATCH_QUEUE
        : `coop:${difficulty}`;
    if (player.room) return;
    this.leaveQueue(player);

    const capacity = roomCapacity(kind);
    const waiting = this.queue.filter((entry) => entry.player.connected && entry.queueKey === queueKey);

    if (waiting.length + 1 < capacity) {
      this.queue.push({ player, at: now, queueKey, kind, difficulty });
      // The count travels with the message so a 2v2 lobby can honestly say
      // "2 of 4" instead of spinning with no idea how close it is.
      this.notifyQueue(queueKey, capacity);
      return;
    }

    const group = waiting.slice(0, capacity - 1);
    this.queue = this.queue.filter((entry) => !group.includes(entry));
    this.startRoom([...group.map((entry) => entry.player), player], { now, isPrivate: false, kind, difficulty });
  }

  /** Tell everyone waiting on one key how full their queue is. */
  notifyQueue(queueKey, capacity) {
    const waiting = this.queue.filter((entry) => entry.queueKey === queueKey && entry.player.connected);
    for (const entry of waiting) {
      this.sendTo(entry.player, {
        type: "lobby",
        state: "searching",
        players: waiting.length,
        needed: capacity,
      });
    }
  }

  leaveQueue(player) {
    const leaving = this.queue.find((entry) => entry.player === player);
    if (!leaving) return;
    this.queue = this.queue.filter((entry) => entry.player !== player);
    this.notifyQueue(leaving.queueKey, roomCapacity(leaving.kind));
  }

  /** Shared room shape, so the private and public paths cannot drift apart. */
  createRoom({ code, isPrivate, kind, difficulty, now }) {
    const teams = teamCount(kind);
    return {
      code,
      isPrivate,
      kind,
      difficulty,
      rivalHealth: kind === "coop" ? COOP_RIVAL_HEALTH[difficulty] : null,
      rivalMaxHealth: kind === "coop" ? COOP_RIVAL_HEALTH[difficulty] : null,
      teamScore: 0,
      phase: PHASES.LOBBY,
      players: [],
      createdAt: now,
      touchedAt: now,
      countdownEndsAt: 0,
      transmitSeq: 0,
      // One shared arena per team, so the host-authority bookkeeping is per
      // team too. A 2v2 room has two hosts publishing two independent worlds.
      worldSeqs: Array.from({ length: teams }, () => -1),
      lastWorldAts: Array.from({ length: teams }, () => 0),
      // Who took which loose PUP, per team. Shared-arena kinds only; a 1v1 room
      // keeps its own arena and never consults it. One team's race is settled
      // without the other team ever hearing about it.
      pupLedgers: Array.from({ length: teams }, () => createPupLedger()),
      rematchVotes: new Set(),
      rematchExpiresAt: 0,
      lastResult: null,
      lastResults: new Map(),
      roundStartedAt: 0,
      roundId: 0,
    };
  }

  createPrivate(player, options = {}, now = Date.now()) {
    if (typeof options === "number") { now = options; options = {}; }
    const { kind = "pvp" } = options;
    const difficulty = SERVER_RULED_KINDS.has(kind) ? "easy" : (options.difficulty ?? "easy");
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

    const room = this.createRoom({ code, isPrivate: true, kind, difficulty, now });
    this.rooms.set(code, room);
    this.seatPlayer(room, player);
    this.sendWaiting(room, code);
    return room;
  }

  /** Put one pilot in the emptiest team. Returns false when the room is full. */
  seatPlayer(room, player) {
    const team = nextTeamFor(room);
    if (team === null) return false;
    player.team = team;
    player.ready = false;
    player.eliminated = false;
    room.players.push(player);
    player.room = room;
    return true;
  }

  /** Vacate a seat without tearing the room down. Used by four-pilot lobbies. */
  detachPlayer(room, player, now = Date.now()) {
    room.players = room.players.filter((entry) => entry !== player);
    if (player.room === room) player.room = null;
    player.ready = false;
    player.combat = null;
    player.eliminated = false;
    room.touchedAt = now;
    if (room.players.length === 0) {
      this.removeRoom(room);
      return 0;
    }
    // The room is no longer full, so nobody can be ready any more.
    for (const entry of room.players) entry.ready = false;
    room.phase = PHASES.LOBBY;
    this.sendWaiting(room, room.isPrivate ? room.code : null, "opponent_left");
    return room.players.length;
  }

  /** A room that is not yet full: tell everyone in it how many seats remain. */
  sendWaiting(room, code, reason) {
    for (const player of room.players) {
      this.sendTo(player, {
        type: "lobby",
        state: "waiting",
        code: code ?? null,
        kind: room.kind,
        players: room.players.length,
        needed: roomCapacity(room.kind),
        team: teamIndexOf(player),
        ...(reason ? { reason } : {}),
      });
    }
  }

  join(player, code, now = Date.now()) {
    if (player.room) return { ok: false, code: ERRORS.WRONG_PHASE };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, code: ERRORS.UNKNOWN_ROOM };
    if (room.players.length >= roomCapacity(room.kind)) return { ok: false, code: ERRORS.ROOM_FULL };
    // A room already in flight is not a lobby to walk into.
    if (room.phase !== PHASES.LOBBY && room.phase !== PHASES.SELECT) {
      return { ok: false, code: ERRORS.ROOM_FULL };
    }

    this.leaveQueue(player);
    if (!this.seatPlayer(room, player)) return { ok: false, code: ERRORS.ROOM_FULL };
    room.touchedAt = now;

    // Ship select only opens once the whole roster is present; until then the
    // room reports how many seats are still empty.
    if (room.players.length < roomCapacity(room.kind)) {
      this.sendWaiting(room, room.isPrivate ? room.code : null);
      return { ok: true, room, waiting: true };
    }
    this.beginSelect(room, now);
    return { ok: true, room };
  }

  /**
   * Seat a whole roster at once.
   *
   * Accepts either an array of players or the historical `(a, b, options)`
   * pair, so existing two-player callers keep working unchanged.
   */
  startRoom(a, b, options) {
    const players = Array.isArray(a) ? a : [a, b];
    const settings = (Array.isArray(a) ? b : options) ?? {};
    const { now = Date.now(), isPrivate = false, kind = "pvp" } = settings;
    // Defense in depth: no caller can create PvP or 2v2 with PvE rules.
    const difficulty = SERVER_RULED_KINDS.has(kind) ? "easy" : (settings.difficulty ?? "easy");
    let code = randomCode(this.random);
    let guard = 0;
    while (this.rooms.has(code) && guard++ < 50) code = randomCode(this.random);

    const room = this.createRoom({ code, isPrivate, kind, difficulty, now });
    room.players = seatPlayers(kind, players);
    for (const player of room.players) player.room = room;
    this.rooms.set(code, room);
    this.beginSelect(room, now);
    return room;
  }

  beginSelect(room, now = Date.now()) {
    room.phase = PHASES.SELECT;
    room.rematchVotes?.clear();
    room.rematchExpiresAt = 0;
    room.touchedAt = now;
    for (const player of room.players) {
      player.ready = false;
      player.eliminated = false;
    }
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
      states: room.players.map((entry) => ({ id: entry.id, ready: entry.ready, team: teamIndexOf(entry) })),
    });

    // Four pilots for 2v2, two for everything else: a room launches only with
    // every seat filled and every pilot ready.
    if (room.players.length === roomCapacity(room.kind) && room.players.every((entry) => entry.ready)) {
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
    room.worldSeqs = room.worldSeqs.map(() => -1);
    room.lastWorldAts = room.lastWorldAts.map(() => 0);
    if (room.kind === "coop") {
      room.rivalHealth = room.rivalMaxHealth;
      room.teamScore = 0;
    }
    for (const player of room.players) {
      player.combat = createCombatState(SHIP_HULL[player.ship] ?? 240);
      player.eliminated = false;
      player.lastDamageSeq = -1;
      player.lastInventorySeq = -1;
      player.pupInventory = [];
      player.launchedPups = [];
      player.lastTransmitSeq = -1;
      player.lastEnemyHitSeq = -1;
      player.lastWorldActionSeq = -1;
      player.lastPupClaimSeq = -1;
      player.position.seq = -1;
    }
    // Last round's race results must not decide this round's PUPs. Ids restart
    // from one on a fresh host, so a stale ledger would refuse every claim.
    for (const ledger of room.pupLedgers) resetPupLedger(ledger);
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
  reportDamage(player, { seq, source, amount, cause = "unknown" }, now = Date.now()) {
    const room = player.room;
    if (!room || room.phase !== PHASES.ACTIVE || !player.combat) {
      return { ok: false, code: ERRORS.NOT_IN_MATCH };
    }
    if (seq <= player.lastDamageSeq) return { ok: true, duplicate: true };

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

    const hullBefore = player.combat.hull;
    const outcome = applyDamage(player.combat, source, amount, now);
    const finalDamage = Math.min(hullBefore, outcome.toHull);
    room.touchedAt = now;
    this.broadcastState(room, now);

    if (outcome.destroyed) {
      if (room.kind === "coop") this.finishCoop(room, "defeat", "pilot_hull", now, player, cause, finalDamage);
      else this.eliminate(room, player, "hull", now, cause, finalDamage);
    }
    return { ok: true, ...outcome };
  }

  /**
   * One pilot is out. The match ends only when their whole team is.
   *
   * In 1v1 the team is one pilot, so this is the old "hull reaches zero, the
   * opponent wins" rule with nothing changed. In 2v2 the round plays on
   * two-against-one until the second hull goes.
   */
  eliminate(room, player, reason, now = Date.now(), cause = "unknown", finalDamage = 0) {
    if (room.phase !== PHASES.ACTIVE || player.eliminated) return;
    player.eliminated = true;
    const team = teamIndexOf(player);
    if (!isTeamDown(room, team)) {
      // The round continues. Everyone is told who went down so a 2v2 client can
      // show it rather than silently losing a ship.
      this.broadcast(room, {
        type: "state",
        serverNow: now,
        down: room.players.filter((entry) => entry.eliminated).map((entry) => entry.id),
        lastDown: player.id,
      });
      this.broadcastState(room, now);
      return;
    }
    this.finish(room, rivalsOf(room, player)[0] ?? null, reason, now, player, cause, finalDamage);
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

  /** A collected attack power-up sent through the wormhole to the other side. */
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

    const rivals = rivalsOf(room, player);
    // Server-issued id so the receiver can discard a duplicate delivery.
    const eventId = `${room.code}:${(room.transmitSeq += 1)}`;

    if (isTeamKind(room.kind)) {
      // The rival team shares one arena, so exactly one of them may spawn the
      // attack: their arena host. The other rival is told for the warning
      // banner only and will see the hostile arrive in the host's snapshot.
      // Two spawns would mean two hostiles for one payload.
      const rivalHost = rivals.length ? arenaHostOf(room, rivals[0]) : null;
      for (const rival of rivals) {
        this.sendTo(rival, { type: "incoming", eventId, weapon, from: player.name, spawn: rival === rivalHost });
      }
      // The sender's own team sees the payload leave, so a teammate is not left
      // wondering where a shared arena's power-up went.
      for (const ally of membersOfTeam(room, teamIndexOf(player))) {
        this.sendTo(ally, { type: "state", sent: weapon, eventId, by: player.id });
      }
      return { ok: true, eventId };
    }

    this.sendTo(rivals[0] ?? null, { type: "incoming", eventId, weapon, from: player.name });
    this.sendTo(player, { type: "state", sent: weapon, eventId });
    return { ok: true, eventId };
  }

  updatePosition(player, position, now = Date.now()) {
    const room = player.room;
    if (!room || !isSharedArenaKind(room.kind) || room.phase !== PHASES.ACTIVE) return { ok: false, code: ERRORS.NOT_IN_MATCH };
    if (position.seq <= player.position.seq) return { ok: true, ignored: true };
    player.position = { seq: position.seq, sentAt: position.sentAt, x: position.x, y: position.y, angle: position.angle };
    room.touchedAt = now;
    // This pilot's own arena only, never the other team's: the two teams fly in
    // separate arenas and must not see each other's ships.
    for (const teammate of teammatesOf(room, player)) {
      this.sendTo(teammate, {
        type: "teammate", id: player.id, name: player.name, roundId: room.roundId, ...player.position,
      });
    }
    return { ok: true };
  }

  /** The PUP referee's record for the arena this pilot flies in. */
  pupLedgerFor(room, player) {
    return room.pupLedgers[teamIndexOf(player)] ?? room.pupLedgers[0];
  }

  updateWorld(player, world, now = Date.now()) {
    const room = player.room;
    if (!room || !isSharedArenaKind(room.kind) || room.phase !== PHASES.ACTIVE) {
      return { ok: false, code: ERRORS.NOT_IN_MATCH };
    }
    // One host per team, so a 2v2 room accepts two independent world streams.
    if (!isArenaHost(room, player)) return { ok: false, code: ERRORS.WRONG_PHASE };
    const team = teamIndexOf(player);
    if (world.roundId !== room.roundId) return { ok: true, ignored: true };
    if (world.seq <= room.worldSeqs[team]) return { ok: true, ignored: true };
    if (now - room.lastWorldAts[team] < 70) return { ok: true, ignored: true };
    room.worldSeqs[team] = world.seq;
    room.lastWorldAts[team] = now;
    room.touchedAt = now;
    // The host's snapshot is the only thing that brings a PUP into existence,
    // so it is also the only thing that tells the referee where they are.
    trackPupPositions(this.pupLedgerFor(room, player), world.pups ?? []);
    for (const teammate of teammatesOf(room, player)) {
      this.sendTo(teammate, { type: "world", ...world, hostId: player.id });
    }
    return { ok: true };
  }

  reportEnemyHit(player, hit, now = Date.now()) {
    const room = player.room;
    if (!room || !isSharedArenaKind(room.kind) || room.phase !== PHASES.ACTIVE) return { ok: false, code: ERRORS.NOT_IN_MATCH };
    if (hit.roundId !== room.roundId || hit.seq <= player.lastEnemyHitSeq) return { ok: true, ignored: true };
    rollWindow(player.window, now);
    if (player.window.enemyHits >= MAX_ENEMY_HITS_PER_WINDOW) return { ok: false, code: ERRORS.RATE_LIMITED };
    player.window.enemyHits += 1;
    player.lastEnemyHitSeq = hit.seq;
    const host = arenaHostOf(room, player);
    if (player === host) return { ok: true, ignored: true };
    this.sendTo(host, { type: "enemy_hit", ...hit, from: player.id });
    return { ok: true };
  }

  reportWorldAction(player, action) {
    const room = player.room;
    if (!room || !isSharedArenaKind(room.kind) || room.phase !== PHASES.ACTIVE) return { ok: false, code: ERRORS.NOT_IN_MATCH };
    if (action.roundId !== room.roundId || action.seq <= player.lastWorldActionSeq) return { ok: true, ignored: true };
    player.lastWorldActionSeq = action.seq;
    const host = arenaHostOf(room, player);
    if (player !== host) this.sendTo(host, { type: "coop_world_action", ...action, from: player.id });
    return { ok: true };
  }

  /**
   * The race for a loose PUP, settled in one place for both pilots.
   *
   * Either pilot in an arena may claim any PUP that arena's host has published
   * — this is the part the owner asked for, where both pilots see the same
   * power-up and fight to collect it. First claim to reach the server wins and
   * both are told the outcome, so the loser's arena removes it rather than
   * quietly keeping a PUP that no longer exists on the other screen.
   *
   * In 2v2 the verdict goes to the claimant's *team* only. The other team is
   * flying its own arena around its own rift and has never heard of that PUP.
   *
   * Worth saying plainly: the host still has a real edge here, because it reads
   * PUP positions with no delay while the teammate sees them on an
   * interpolation delay. Refereeing centrally removes the *disagreement*, not
   * that advantage.
   */
  claimSharedPup(player, { seq, roundId, pupId }, now = Date.now()) {
    const room = player.room;
    if (!room || !isSharedArenaKind(room.kind) || room.phase !== PHASES.ACTIVE) {
      return { ok: false, code: ERRORS.NOT_IN_MATCH };
    }
    if (roundId !== room.roundId || seq <= player.lastPupClaimSeq) return { ok: true, ignored: true };
    player.lastPupClaimSeq = seq;

    const outcome = claimPup(this.pupLedgerFor(room, player), pupId, player.id, player.position, now);
    if (!outcome.winner) {
      // Refused — most often a PUP the host has shed but not yet published.
      // Tell the claimant so their arena hands it straight back instead of
      // hiding it for the full claim timeout.
      this.sendTo(player, { type: "pup_taken", pupId, by: null, roundId: room.roundId });
      return { ok: false, reason: outcome.reason };
    }

    room.touchedAt = now;
    // Both pilots hear every decision, including the one who lost. A claim that
    // only reached its winner would leave the loser's arena holding a ghost.
    this.broadcastTeam(room, teamIndexOf(player), {
      type: "pup_taken", pupId, by: outcome.winner, roundId: room.roundId,
    });
    return { ok: true, winner: outcome.winner };
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

  /**
   * End the round. `winner` is any pilot on the winning side.
   *
   * Outcomes are decided by team, not by identity, so in 2v2 both pilots of the
   * winning team get a victory — including one who was shot down earlier. A
   * one-pilot team makes this identical to the old 1v1 rule, which is why the
   * existing callers can still pass a player.
   */
  finish(room, winner, reason, now = Date.now(), eliminated = null, cause = "unknown", finalDamage = 0) {
    if (room.phase !== PHASES.ACTIVE) return;
    room.touchedAt = now;
    room.lastResults.clear();
    const winningTeam = winner ? teamIndexOf(winner) : null;
    for (const player of room.players) {
      const won = winningTeam !== null && teamIndexOf(player) === winningTeam;
      const rivals = rivalsOf(room, player);
      const result = {
        outcome: won ? "victory" : "defeat",
        reason,
        opponent: rivals[0]?.name ?? "OPPONENT",
        opponentTeam: rivals.map((entry) => entry.name),
        team: teamIndexOf(player),
        teammates: teammatesOf(room, player).map((entry) => entry.name),
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
    // personalized above, then every pilot must explicitly ready for another round.
    this.beginSelect(room, now);
  }

  /** A rematch starts only after every pilot explicitly accepts. */
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
      const others = othersOf(room, entry);
      this.sendTo(entry, {
        type: "rematch",
        you: room.rematchVotes.has(entry.id),
        // "opponent" here means "everyone else has accepted"; with exactly one
        // other pilot that is what it always meant.
        opponent: others.length > 0 && others.every((other) => room.rematchVotes.has(other.id)),
        status: "waiting",
        expiresAt: room.rematchExpiresAt,
      });
    }
    return { ok: true, starting: false };
  }

  /** Leave a room and return the pilots to a clean lobby state. */
  leaveMatch(player) {
    const room = player.room;
    if (!room || room.phase === PHASES.ACTIVE) return { ok: false, code: ERRORS.WRONG_PHASE };
    // A four-pilot lobby survives one pilot walking out; the seat just reopens.
    if (isTeamKind(room.kind) && room.players.length > 1) {
      this.detachPlayer(room, player);
      return { ok: true };
    }
    const others = othersOf(room, player);
    this.removeRoom(room);
    player.ready = false;
    player.combat = null;
    for (const other of others) {
      other.ready = false;
      other.combat = null;
      this.sendTo(other, { type: "lobby", state: "idle", reason: "opponent_left" });
    }
    return { ok: true };
  }

  /** Back out of a queue or an unstarted room. Used by the transport's `cancel`. */
  cancelLobby(player) {
    this.leaveQueue(player);
    const room = player.room;
    if (!room || room.phase === PHASES.ACTIVE) return { ok: true };
    if (isTeamKind(room.kind) && room.players.length > 1) {
      this.detachPlayer(room, player);
      return { ok: true };
    }
    const others = othersOf(room, player);
    this.removeRoom(room);
    for (const other of others) {
      other.ready = false;
      this.sendTo(other, { type: "lobby", state: "idle", reason: "opponent_left" });
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
          if (player.connected || player.eliminated) continue;
          if (now - player.disconnectedAt < RECONNECT_GRACE_MS) continue;
          if (room.kind === "coop") {
            this.finishCoop(room, "defeat", "forfeit", now);
            break;
          }
          // A pilot who never came back is out of the round. Their team only
          // forfeits once nobody is left flying for it, so in 2v2 a lone
          // teammate may still win rather than losing for a dropped connection
          // that was never theirs.
          this.eliminate(room, player, "forfeit", now, "forfeit", 0);
          if (room.phase !== PHASES.ACTIVE) break;
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

  /**
   * "The other one", kept for the two-player modes that genuinely have one.
   *
   * In co-op that pilot is your teammate and in 1v1 your enemy — the ambiguity
   * that made this unusable for 2v2. New code asks for `teammatesOf` or
   * `rivalsOf` by name instead.
   */
  opponentOf(room, player) {
    return room.players.find((entry) => entry !== player) ?? null;
  }

  /** What `opponent` has always meant on the wire, per kind. */
  peerOf(room, player) {
    if (room.kind === "coop") return teammatesOf(room, player)[0] ?? null;
    return rivalsOf(room, player)[0] ?? null;
  }

  sendTo(player, message) {
    if (player && player.connected) player.send(message);
  }

  broadcast(room, message) {
    for (const player of room.players) this.sendTo(player, message);
  }

  /** One arena's worth of pilots. Never reaches the other team. */
  broadcastTeam(room, team, message) {
    for (const player of membersOfTeam(room, team)) this.sendTo(player, message);
  }

  describe(player) {
    return {
      id: player.id,
      name: player.name,
      ship: player.ship,
      ready: player.ready,
      connected: player.connected,
      team: teamIndexOf(player),
    };
  }

  sendMatch(room) {
    for (const player of room.players) {
      const peer = this.peerOf(room, player);
      this.sendTo(player, {
        type: "match",
        code: room.isPrivate ? room.code : null,
        kind: room.kind,
        difficulty: room.difficulty,
        phase: room.phase,
        // The host of *your* arena. In 1v1 nothing is shared, so this stays the
        // room's first player exactly as it always was.
        hostId: isSharedArenaKind(room.kind)
          ? (arenaHostOf(room, player)?.id ?? null)
          : (room.players[0]?.id ?? null),
        roundId: room.roundId,
        team: teamIndexOf(player),
        capacity: roomCapacity(room.kind),
        you: { id: player.id, name: player.name, ship: player.ship, ready: player.ready },
        // Named by relationship, so a four-pilot client never has to guess which
        // of the other three it is looking at.
        teammates: teammatesOf(room, player).map((entry) => this.describe(entry)),
        rivals: rivalsOf(room, player).map((entry) => this.describe(entry)),
        opponent: peer ? this.describe(peer) : null,
        lastResult: room.lastResults?.get(player.id) ?? room.lastResult,
      });
    }
  }

  broadcastState(room, now = Date.now()) {
    const teamRoom = isTeamKind(room.kind);
    const combatOf = (entry) => ({
      id: entry.id,
      eliminated: Boolean(entry.eliminated),
      ...(entry.combat ? snapshot(entry.combat, now) : {}),
    });
    for (const player of room.players) {
      const peer = this.peerOf(room, player);
      this.sendTo(player, {
        type: "state",
        serverNow: now,
        you: player.combat ? snapshot(player.combat, now) : null,
        opponent: peer?.combat ? snapshot(peer.combat, now) : null,
        rival: room.kind === "coop" ? { hull: room.rivalHealth, maxHull: room.rivalMaxHealth, score: room.teamScore } : null,
        // Only 2v2 needs the whole roster; leaving these out keeps every
        // existing mode's state frame exactly what it was.
        teammates: teamRoom ? teammatesOf(room, player).map(combatOf) : undefined,
        rivals: teamRoom ? rivalsOf(room, player).map(combatOf) : undefined,
      });
    }
  }
}

export { PHASES };
