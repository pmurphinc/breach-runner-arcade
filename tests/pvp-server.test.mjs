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
import { MatchServer, SHIP_HULL, createPlayer } from "../server/rooms.mjs";

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
  const huge = JSON.stringify({ type: "hello", name: "x".repeat(9000) });
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

function readiedMatch(now = 1000) {
  const server = new MatchServer();
  const a = fakePlayer(server, "ALPHA");
  const b = fakePlayer(server, "BRAVO");
  server.enqueue(a.player, now);
  server.enqueue(b.player, now);
  server.setShip(a.player, "wing");
  server.setShip(b.player, "tank");
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
  const { server, a } = readiedMatch();
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
  const lost = SHIP_HULL.wing - a.player.combat.hull;
  assert.ok(
    lost <= MAX_DAMAGE_TOTAL_PER_WINDOW,
    `applied ${lost} damage in one window, over the ${MAX_DAMAGE_TOTAL_PER_WINDOW} cap`
  );
});

test("victory is decided by opponent hull reaching zero", () => {
  const { server, a, b } = readiedMatch();
  let seq = 1;
  let now = 6000;
  while (a.player.combat.hull > 0 && seq < 400) {
    server.reportDamage(a.player, { seq: seq++, source: "impact", amount: 50 }, now);
    now += 1000; // step past the rate window each time
  }
  assert.equal(a.player.combat.hull, 0);
  assert.equal(a.last("result").outcome, "defeat");
  assert.equal(b.last("result").outcome, "victory");
  assert.equal(b.last("result").reason, "hull");
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

test("finished and abandoned rooms are swept away", () => {
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

  assert.equal(isOriginAllowed("https://wormhole.murphtournaments.com", origins, prod), true);
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


test("a rematch waits for both players and returns them to ship select", () => {
  const { server, a, b } = readiedMatch();
  server.finish(a.player.room, a.player, "hull", 7000);

  const first = server.requestRematch(a.player, 7100);
  assert.equal(first.ok, true);
  assert.equal(first.starting, false);
  assert.equal(a.last("rematch").you, true);
  assert.equal(b.last("rematch").opponent, true);
  assert.equal(a.player.room.phase, "finished");

  const second = server.requestRematch(b.player, 7200);
  assert.equal(second.starting, true);
  assert.equal(a.last("rematch").status, "starting");
  assert.equal(b.last("rematch").status, "starting");
  assert.equal(a.player.room.phase, "select");
  assert.equal(a.player.ready, false);
  assert.equal(b.player.ready, false);
});

test("leaving a finished match returns both pilots to the lobby", () => {
  const { server, a, b } = readiedMatch();
  server.finish(a.player.room, a.player, "hull", 7000);
  const result = server.leaveMatch(a.player);
  assert.equal(result.ok, true);
  assert.equal(a.player.room, null);
  assert.equal(b.player.room, null);
  assert.equal(b.last("lobby").reason, "opponent_left");
});
