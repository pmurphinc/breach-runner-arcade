/**
 * Authoritative match-server tests.
 *
 * `rooms.mjs` deliberately knows nothing about WebSockets, so the whole state
 * machine is driven here through fake players that record what they were sent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DIFFICULTIES,
} from "../app/difficulty.ts";
import { SHIPS, SENDABLE_POWERUPS } from "../app/game-data.ts";
import {
  ERRORS,
  MAX_DAMAGE_EVENT,
  MAX_DAMAGE_TOTAL_PER_WINDOW,
  MAX_PAYLOAD_BYTES,
  RECONNECT_GRACE_MS,
  SENDABLE_WEAPONS,
  SHIP_IDS,
  isValidCode,
  parseClientMessage,
  randomCode,
} from "../server/protocol.mjs";
import {
  COLLISION_SHIELD_CAPACITY,
  COLLISION_SHIELD_RECHARGE_MS,
  COLLISION_SHIELD_RECHARGE_TICKS,
  TICK_MS,
  applyDamage,
  createCombatState,
  snapshot,
} from "../server/rules.mjs";
import { MatchServer, PVP_QUICK_MATCH_QUEUE, SHIP_HULL, createPlayer } from "../server/rooms.mjs";

// ------------------------------------------------------------------- drift --

test("server rule copy matches the app difficulty rules exactly", () => {
  const easy = DIFFICULTIES.easy;
  assert.equal(easy.collisionShield.enabled, true);
  assert.equal(COLLISION_SHIELD_CAPACITY, easy.collisionShield.capacity);
  // The app counts the delay in whole ticks; the server derives its
  // millisecond budget from the same tick count so the two cannot diverge.
  assert.equal(COLLISION_SHIELD_RECHARGE_TICKS, easy.collisionShield.rechargeDelayTicks);
  assert.equal(COLLISION_SHIELD_RECHARGE_MS, easy.collisionShield.rechargeDelayTicks * TICK_MS);
  assert.equal(easy.wormhole.kind, "locked", "pvp wormholes must be centred");
  assert.equal(easy.contactHazard.enabled, false, "pvp must not run the contact hazard");
});

test("server ship hulls match the shipped ship data", () => {
  for (const ship of SHIPS) {
    assert.equal(SHIP_HULL[ship.id], ship.health, `hull drift for ${ship.id}`);
  }
  assert.deepEqual(SHIP_IDS.slice().sort(), SHIPS.map((s) => s.id).sort());
});

test("transmittable weapons match the game's sendable power-ups", () => {
  assert.deepEqual(SENDABLE_WEAPONS.slice().sort(), SENDABLE_POWERUPS.slice().sort());
});

// -------------------------------------------------------------- validation --

test("damage validation rejects what a cheating client would send", () => {
  const bad = [
    { type: "damage", seq: 0, source: "collision", amount: MAX_DAMAGE_EVENT + 1 },
    { type: "damage", seq: 0, source: "collision", amount: -5 },
    { type: "damage", seq: 0, source: "collision", amount: Number.POSITIVE_INFINITY },
    { type: "damage", seq: 0, source: "wormhole", amount: 5 },
    { type: "damage", seq: 1.5, source: "impact", amount: 5 },
  ];
  for (const message of bad) {
    const result = parseClientMessage(JSON.stringify(message));
    assert.equal(result.ok, false, `should reject ${JSON.stringify(message)}`);
  }
  assert.equal(
    parseClientMessage(JSON.stringify({ type: "damage", seq: 0, source: "impact", amount: 12 })).ok,
    true
  );
});

test("only sendable weapons may be transmitted", () => {
  for (const weapon of ["shield", "health", "gun", "not-a-weapon"]) {
    const result = parseClientMessage(JSON.stringify({ type: "transmit", seq: 1, weapon }));
    assert.equal(result.ok, false);
    assert.equal(result.code, ERRORS.INVALID_WEAPON);
  }
  assert.equal(parseClientMessage(JSON.stringify({ type: "transmit", seq: 1, weapon: "nuke" })).ok, true);
});

test("oversized frames are refused without parsing", () => {
  const huge = JSON.stringify({ type: "hello", name: "x".repeat(MAX_PAYLOAD_BYTES + 1) });
  const result = parseClientMessage(huge);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERRORS.TOO_LARGE);
});

test("invite codes avoid ambiguous characters", () => {
  for (let i = 0; i < 200; i += 1) {
    const code = randomCode();
    assert.ok(isValidCode(code), code);
    assert.doesNotMatch(code, /[O0I1]/, `ambiguous character in ${code}`);
  }
  assert.equal(isValidCode("ABC"), false);
  assert.equal(isValidCode("aaaaaa"), false);
});

// ------------------------------------------------------------ shield maths --

test("server shield absorbs collisions and ignores weapon damage", () => {
  const state = createCombatState(240);
  applyDamage(state, "collision", 20, 1000);
  assert.equal(state.hull, 240, "collision must not reach hull while shielded");
  assert.equal(snapshot(state, 1000).shieldPct, 50);

  applyDamage(state, "impact", 30, 1100);
  assert.equal(state.hull, 210, "weapon damage must bypass the collision shield");
  assert.equal(snapshot(state, 1100).shieldPct, 50, "and must not spend the shield");
});

test("server shield restores four seconds after the last collision, not before", () => {
  const state = createCombatState(240);
  applyDamage(state, "collision", 40, 1000);
  assert.equal(snapshot(state, 1000).shieldPct, 0);
  assert.equal(snapshot(state, 1000 + COLLISION_SHIELD_RECHARGE_MS - 1).shieldPct, 0);
  assert.equal(snapshot(state, 1000 + COLLISION_SHIELD_RECHARGE_MS).shieldPct, 100);
});

test("a later collision restarts the server-side recharge delay", () => {
  const state = createCombatState(240);
  applyDamage(state, "collision", 20, 1000);
  applyDamage(state, "collision", 10, 3000);
  assert.equal(snapshot(state, 3000 + COLLISION_SHIELD_RECHARGE_MS - 1).shieldPct, 25);
  assert.equal(snapshot(state, 3000 + COLLISION_SHIELD_RECHARGE_MS).shieldPct, 100);
});

// ------------------------------------------------------------- match flow --

function fakePlayer(server, name) {
  const inbox = [];
  const player = createPlayer((message) => inbox.push(message));
  player.name = name;
  server.register(player);
  return { player, inbox, last: (type) => [...inbox].reverse().find((m) => m.type === type) };
}

function readiedMatch(now = 1000, shipA = "wing", shipB = "tank") {
  const server = new MatchServer();
  const a = fakePlayer(server, "ALPHA");
  const b = fakePlayer(server, "BRAVO");
  server.enqueue(a.player, now);
  server.enqueue(b.player, now);
  server.setShip(a.player, shipA);
  server.setShip(b.player, shipB);
  server.setReady(a.player, true, now);
  server.setReady(b.player, true, now);
  server.sweep(now + 4000);
  return { server, a, b };
}

test("quick match pairs two waiting players", () => {
  const server = new MatchServer();
  const a = fakePlayer(server, "ALPHA");
  const b = fakePlayer(server, "BRAVO");

  server.enqueue(a.player, 1000);
  assert.equal(a.last("lobby").state, "searching");
  assert.equal(a.player.room, null);

  server.enqueue(b.player, 1100);
  assert.ok(a.player.room, "first player should be in a room");
  assert.equal(a.player.room, b.player.room, "both players share one room");
  assert.equal(a.last("match").opponent.name, "BRAVO");
  assert.equal(b.last("match").opponent.name, "ALPHA");
});

test("all legacy PvP difficulties and client metadata share the one Easy queue", () => {
  for (const [left, right] of [
    ["easy", "difficult"],
    ["practice", "hard"],
    ["hard", "easy"],
  ]) {
    const server = new MatchServer();
    const a = fakePlayer(server, `A-${left}`);
    const b = fakePlayer(server, `B-${right}`);
    server.enqueue(a.player, {
      kind: "pvp", difficulty: left, device: "phone", controls: "touch",
      browser: "mobile", ship: "tank", hiddenState: Math.random(),
    }, 1000);
    assert.equal(server.queue[0].queueKey, PVP_QUICK_MATCH_QUEUE);
    server.enqueue(b.player, {
      kind: "pvp", difficulty: right, device: "pc", controls: "keyboard",
      browser: "desktop", ship: "wing", hiddenState: Math.random(),
    }, 1100);
    assert.equal(a.player.room, b.player.room, `${left} must match ${right}`);
    assert.equal(a.player.room.difficulty, "easy");
    assert.equal(a.player.room.kind, "pvp");
    assert.equal(server.queue.length, 0);
  }
});

test("quick match is FIFO across successive pairs", () => {
  const server = new MatchServer();
  const [a, b, c, d] = ["A", "B", "C", "D"].map((name) => fakePlayer(server, name));
  server.enqueue(a.player, { kind: "pvp", difficulty: "hard" }, 1000);
  server.enqueue(b.player, { kind: "pvp", difficulty: "easy" }, 1001);
  server.enqueue(c.player, { kind: "pvp", difficulty: "practice" }, 1002);
  server.enqueue(d.player, { kind: "pvp", difficulty: "difficult" }, 1003);
  assert.equal(a.player.room, b.player.room);
  assert.equal(c.player.room, d.player.room);
  assert.notEqual(a.player.room, c.player.room);
});

test("cancel, disconnect, and duplicate queue requests cannot leave ghost entries", () => {
  const server = new MatchServer();
  const a = fakePlayer(server, "A");
  const b = fakePlayer(server, "B");
  server.enqueue(a.player, { kind: "pvp", difficulty: "hard" }, 1000);
  server.enqueue(a.player, { kind: "pvp", difficulty: "easy" }, 1001);
  assert.equal(server.queue.length, 1, "duplicates replace rather than append");
  server.leaveQueue(a.player);
  server.enqueue(b.player, { kind: "pvp" }, 1002);
  assert.equal(b.player.room, null, "cancelled A must not match B");
  server.leaveQueue(b.player);
  // Use a fresh connected player because disconnect intentionally invalidates A.
  const disconnected = fakePlayer(server, "DISCONNECTED");
  server.enqueue(disconnected.player, { kind: "pvp" }, 1003);
  server.disconnect(disconnected.player, 1004);
  server.enqueue(b.player, { kind: "pvp" }, 1005);
  assert.equal(b.player.room, null, "disconnected player must not match B");
  assert.deepEqual(server.queue.map((entry) => entry.player), [b.player]);
});

test("co-op and private-code players are isolated from public PvP quick match", () => {
  const server = new MatchServer();
  const coop = fakePlayer(server, "COOP");
  const pvp = fakePlayer(server, "PVP");
  const privateHost = fakePlayer(server, "PRIVATE");
  server.enqueue(coop.player, { kind: "coop", difficulty: "easy" }, 1000);
  server.createPrivate(privateHost.player, { kind: "pvp", difficulty: "hard" }, 1001);
  server.enqueue(pvp.player, { kind: "pvp", difficulty: "hard" }, 1002);
  assert.equal(coop.player.room, null);
  assert.equal(pvp.player.room, null);
  assert.ok(privateHost.player.room?.isPrivate);
  assert.equal(privateHost.player.room.difficulty, "easy", "private PvP also owns Easy rules");
  assert.equal(server.queue.length, 2);
});

test("private rooms are created, joined, and reject bad codes", () => {
  const server = new MatchServer();
  const host = fakePlayer(server, "HOST");
  const guest = fakePlayer(server, "GUEST");

  const room = server.createPrivate(host.player, 1000);
  assert.ok(isValidCode(room.code));
  assert.equal(host.last("lobby").state, "waiting");
  assert.equal(host.last("lobby").code, room.code);

  assert.equal(server.join(guest.player, "ZZZZZZ", 1100).code, ERRORS.UNKNOWN_ROOM);
  assert.equal(server.join(guest.player, room.code, 1100).ok, true);
  assert.equal(guest.last("match").opponent.name, "HOST");

  const third = fakePlayer(server, "THIRD");
  assert.equal(server.join(third.player, room.code, 1200).code, ERRORS.ROOM_FULL);
});

test("the countdown starts only when both players are ready", () => {
  const server = new MatchServer();
  const a = fakePlayer(server, "ALPHA");
  const b = fakePlayer(server, "BRAVO");
  server.enqueue(a.player, 1000);
  server.enqueue(b.player, 1000);

  server.setReady(a.player, true, 1000);
  assert.equal(a.last("countdown"), undefined, "one ready player is not enough");

  server.setReady(b.player, true, 1100);
  const countdown = a.last("countdown");
  assert.ok(countdown, "countdown should start once both are ready");
  assert.equal(countdown.seconds, 3);
  assert.ok(countdown.serverNow, "countdown carries a server timestamp");
});

test("ships cannot be changed once the countdown has begun", () => {
  const { server, a } = readiedMatch();
  assert.equal(server.setShip(a.player, "squid").code, ERRORS.WRONG_PHASE);
  assert.equal(a.player.ship, "wing", "ship must stay as chosen at launch");
});

test("hull is seeded from the chosen ship when the match activates", () => {
  const { a, b } = readiedMatch();
  assert.equal(a.player.combat.maxHull, SHIP_HULL.wing);
  assert.equal(b.player.combat.maxHull, SHIP_HULL.tank);
  assert.equal(a.last("state").you.hull, SHIP_HULL.wing);
});

test("Kestrel regeneration is applied by multiplayer health authority", () => {
  const { server, a, b } = readiedMatch(1000, "kestrel", "wing");
  server.reportDamage(a.player, { seq: 1, source: "impact", amount: 20 }, 6000);
  server.reportDamage(b.player, { seq: 1, source: "impact", amount: 20 }, 6000);
  const shieldBefore = a.player.combat.shieldCharge;

  server.updateInventory(a.player, { seq: 1, count: 5 }, 6000);
  server.updateInventory(b.player, { seq: 1, count: 5 }, 6000);
  server.sweep(7000);

  assert.equal(a.player.combat.hull, 101.25, "server accrues 1.25 hull for five stored PUPs");
  assert.equal(b.player.combat.hull, SHIP_HULL.wing - 20, "other ships do not inherit the passive");
  assert.equal(a.player.combat.shieldCharge, shieldBefore, "passive never touches shield state");

  server.updateInventory(a.player, { seq: 2, count: 4 }, 7000);
  server.sweep(8000);
  assert.equal(a.player.combat.hull, 102.25, "new inventory count takes effect immediately");
  assert.equal(a.player.storedPups, 4, "healing does not consume server inventory state");
});

test("reported collision damage spends the shield, not the hull", () => {
  const { server, a } = readiedMatch();
  const now = 6000;
  server.reportDamage(a.player, { seq: 1, source: "collision", amount: 20 }, now);
  const state = a.last("state");
  assert.equal(state.you.hull, SHIP_HULL.wing);
  assert.equal(state.you.shieldPct, 50);
});

test("a replayed damage event is applied only once", () => {
  const { server, a } = readiedMatch();
  server.reportDamage(a.player, { seq: 7, source: "impact", amount: 30 }, 6000);
  const afterFirst = a.last("state").you.hull;

  const replay = server.reportDamage(a.player, { seq: 7, source: "impact", amount: 30 }, 6010);
  assert.equal(replay.duplicate, true);
  assert.equal(a.last("state").you.hull, afterFirst, "duplicate must not stack");
});

test("a client cannot claim unlimited damage in one window", () => {
  // Flown in the heaviest frame on purpose: the per-window damage cap is worth
  // more than several hulls, so a lighter ship dies before the limiter is ever
  // reached and the test would pass without testing anything.
  const { server, a } = readiedMatch(1000, "flagship");
  assert.ok(SHIP_HULL.flagship > MAX_DAMAGE_TOTAL_PER_WINDOW, "cap must be reachable alive");
  let rejected = 0;
  for (let i = 0; i < 40; i += 1) {
    const result = server.reportDamage(
      a.player,
      { seq: 100 + i, source: "impact", amount: 50 },
      6000
    );
    if (!result.ok && result.code === ERRORS.RATE_LIMITED) rejected += 1;
  }
  assert.ok(rejected > 0, "flood should be rate limited");
  const lost = SHIP_HULL.flagship - a.player.combat.hull;
  assert.ok(
    lost <= MAX_DAMAGE_TOTAL_PER_WINDOW,
    `applied ${lost} damage in one window, over the ${MAX_DAMAGE_TOTAL_PER_WINDOW} cap`
  );
});

test("victory identifies the eliminated pilot and final damage source for both players", () => {
  const { server, a, b } = readiedMatch();
  let seq = 1;
  let now = 6000;
  while (!a.last("result") && seq < 400) {
    server.reportDamage(
      a.player,
      { seq: seq++, source: "impact", amount: 50, cause: "hostile_projectile" },
      now
    );
    now += 1000; // step past the rate window each time
  }
  const defeated = a.last("result");
  const winner = b.last("result");
  assert.equal(a.player.combat, null, "finished combat state is cleared in the lobby");
  assert.equal(defeated.outcome, "defeat");
  assert.equal(winner.outcome, "victory");
  assert.equal(winner.reason, "hull");
  assert.equal(defeated.youEliminated, true);
  assert.equal(winner.youEliminated, false);
  assert.equal(defeated.eliminatedName, "ALPHA");
  assert.equal(winner.eliminatedName, "ALPHA");
  assert.equal(defeated.cause, "hostile_projectile");
  assert.equal(winner.cause, "hostile_projectile");
  assert.equal(defeated.finalDamage, winner.finalDamage);
  assert.equal(defeated.finisherName, "BRAVO");
  assert.equal(winner.finisherName, "BRAVO");
  assert.ok(defeated.durationSeconds > 0);
  assert.equal(a.player.room.phase, "select", "a result immediately returns the room to select");
  assert.equal(a.player.ready, false);
  assert.equal(b.player.ready, false);
  assert.equal(a.last("match").lastResult.outcome, "defeat", "last result stays personalized");
  assert.equal(b.last("match").lastResult.outcome, "victory", "winner gets their own perspective");
  const remainder = SHIP_HULL.wing % 50;
  assert.equal(
    defeated.finalDamage,
    remainder === 0 ? 50 : remainder,
    "only the remaining hull counts as final damage"
  );
});

test("transmissions reach the opponent, tagged so duplicates can be dropped", () => {
  const { server, a, b } = readiedMatch();
  const result = server.transmit(a.player, { seq: 1, weapon: "nuke" }, 6000);
  assert.equal(result.ok, true);

  const incoming = b.last("incoming");
  assert.equal(incoming.weapon, "nuke");
  assert.equal(incoming.from, "ALPHA");
  assert.ok(incoming.eventId, "server issues the event id");
  assert.equal(a.last("incoming"), undefined, "sender must not receive their own attack");

  const replay = server.transmit(a.player, { seq: 1, weapon: "nuke" }, 6010);
  assert.equal(replay.duplicate, true);
});

// ------------------------------------------------- disconnect and cleanup --

test("a disconnect before the match returns the opponent to the lobby", () => {
  const server = new MatchServer();
  const a = fakePlayer(server, "ALPHA");
  const b = fakePlayer(server, "BRAVO");
  server.enqueue(a.player, 1000);
  server.enqueue(b.player, 1000);

  server.disconnect(a.player, 2000);
  assert.equal(b.last("lobby").state, "idle");
  assert.equal(b.last("lobby").reason, "opponent_left");
  assert.equal(b.player.room, null);
  assert.equal(server.rooms.size, 0, "the room should be cleaned up");
});

test("a disconnect during a match starts a grace period, not an instant loss", () => {
  const { server, a, b } = readiedMatch();
  server.disconnect(a.player, 7000);

  const notice = b.last("opponent");
  assert.equal(notice.state, "disconnected");
  assert.equal(notice.graceMs, RECONNECT_GRACE_MS);
  assert.equal(b.last("result"), undefined, "no result while the grace period runs");

  server.sweep(7000 + RECONNECT_GRACE_MS - 1);
  assert.equal(b.last("result"), undefined, "still no result one millisecond early");
});

test("returning inside the grace period resumes the match", () => {
  const { server, a, b } = readiedMatch();
  server.disconnect(a.player, 7000);

  const inbox = [];
  const resumed = server.reconnect(a.player.resume, (m) => inbox.push(m), 7000 + 5000);
  assert.ok(resumed, "reconnection should succeed inside the grace period");
  assert.equal(resumed.id, a.player.id);
  assert.equal(b.last("opponent").state, "reconnected");
  assert.ok(inbox.some((m) => m.type === "match"), "returning player is resynced");
  assert.equal(b.last("result"), undefined, "nobody forfeits");
});

test("failing to return inside the grace period forfeits the match", () => {
  const { server, a, b } = readiedMatch();
  server.disconnect(a.player, 7000);
  server.sweep(7000 + RECONNECT_GRACE_MS + 1);

  assert.equal(b.last("result").outcome, "victory");
  assert.equal(b.last("result").reason, "forfeit");
  assert.equal(server.reconnect(a.player.resume, () => {}, 7000 + RECONNECT_GRACE_MS + 2), null);
});

test("post-round and abandoned rooms are swept away", () => {
  const { server, a, b } = readiedMatch();
  assert.equal(server.rooms.size, 1);

  server.finish(a.player.room, b.player, "hull", 8000);
  server.disconnect(a.player, 8000);
  server.disconnect(b.player, 8000);
  server.sweep(9000);
  assert.equal(server.rooms.size, 0, "rooms must not leak");
});

test("abandoned queue entries expire", () => {
  const server = new MatchServer();
  const a = fakePlayer(server, "ALPHA");
  server.enqueue(a.player, 1000);
  assert.equal(server.queue.length, 1);

  server.disconnect(a.player, 2000);
  server.sweep(3000);
  assert.equal(server.queue.length, 0);
});

test("guests join with a generated callsign and no sign-in", () => {
  const server = new MatchServer();
  const player = createPlayer(() => {});
  server.register(player);
  assert.match(player.name, /^GUEST-\d{4}$/);
  assert.ok(player.resume, "a resume token is issued without any account");
});

test("origin policy is strict in production and permissive only on loopback", async () => {
  const { allowedOrigins, isOriginAllowed } = await import("../server/pvp.mjs");
  const prod = { NODE_ENV: "production" };
  const dev = { NODE_ENV: "development" };
  const origins = allowedOrigins(prod);

  assert.equal(isOriginAllowed("https://breachrunner.murphtournaments.com", origins, prod), true);
  assert.equal(isOriginAllowed("https://wormhole.murphtournaments.com", origins, prod), false);
  assert.equal(isOriginAllowed("https://evil.example", origins, prod), false);
  assert.equal(isOriginAllowed("http://localhost:5199", origins, prod), false,
    "production must never accept a localhost origin");
  assert.equal(isOriginAllowed("http://127.0.0.1:8150", origins, prod), false);

  // Any loopback port is fine in development; nothing else is.
  assert.equal(isOriginAllowed("http://localhost:5199", origins, dev), true);
  assert.equal(isOriginAllowed("http://127.0.0.1:8150", origins, dev), true);
  assert.equal(isOriginAllowed("https://evil.example", origins, dev), false);
  assert.equal(isOriginAllowed("http://localhost.evil.example", origins, dev), false,
    "a hostname merely starting with localhost must not pass");

  // An explicit extra origin is honoured without loosening anything else.
  const staged = allowedOrigins({ ...prod, PVP_EXTRA_ORIGINS: "https://staging.example/" });
  assert.equal(isOriginAllowed("https://staging.example", staged, prod), true);
});


test("a completed PvP round requires both players to ready before the next countdown", () => {
  const { server, a, b } = readiedMatch();
  server.finish(a.player.room, a.player, "hull", 7000);
  assert.equal(a.player.room.phase, "select");
  assert.equal(a.player.ready, false);
  assert.equal(b.player.ready, false);

  server.setReady(a.player, true, 7100);
  assert.equal(a.player.room.phase, "select", "one ready pilot must keep waiting");
  server.setReady(b.player, true, 7200);
  assert.equal(a.player.room.phase, "countdown");

  const previousRound = a.player.room.roundId;
  server.activate(a.player.room, 10_200);
  assert.equal(a.player.room.roundId, previousRound + 1);
  assert.equal(a.player.ship, "wing", "ship selection persists between rounds");
  assert.equal(b.player.ship, "tank", "opponent ship selection persists between rounds");
});

test("leaving a post-round lobby returns both pilots to the main lobby", () => {
  const { server, a, b } = readiedMatch();
  server.finish(a.player.room, a.player, "hull", 7000);
  const result = server.leaveMatch(a.player);
  assert.equal(result.ok, true);
  assert.equal(a.player.room, null);
  assert.equal(b.player.room, null);
  assert.equal(b.last("lobby").reason, "opponent_left");
});
