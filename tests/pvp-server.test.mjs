/**
 * Authoritative match-server tests.
 *
 * `rooms.mjs` deliberately knows nothing about WebSockets, so the whole state
 * machine is driven here through fake players that record what they were sent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DIFFICULTIES } from "../app/difficulty.ts";
import { SHIPS, SENDABLE_POWERUPS } from "../app/game-data.ts";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
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
import { MatchServer, PUP_INVENTORY_CAPACITY, PVP_QUICK_MATCH_QUEUE, SHIP_HULL, createPlayer } from "../server/rooms.mjs";

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
    assert.equal(code.length, 4);
    assert.ok([...code].every((character) => CODE_ALPHABET.includes(character)));
    assert.ok(isValidCode(code), code);
    assert.doesNotMatch(code, /[O0I1]/, `ambiguous character in ${code}`);
  }
  assert.equal(CODE_LENGTH, 4);
  assert.equal(isValidCode("AB7K"), true);
  assert.equal(isValidCode("ABC"), false);
  assert.equal(isValidCode("AB7KQ"), false);
  assert.equal(isValidCode("abcd"), false);
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

  assert.equal(server.join(guest.player, "ZZZZ", 1100).code, ERRORS.UNKNOWN_ROOM);
  assert.equal(server.join(guest.player, room.code, 1100).ok, true);
  assert.equal(guest.last("match").opponent.name, "HOST");

  const third = fakePlayer(server, "THIRD");
  assert.equal(server.join(third.player, room.code, 1200).code, ERRORS.ROOM_FULL);
});

test("private room code collisions regenerate without overwriting the active room", () => {
  let calls = 0;
  const random = () => calls++ < 8 ? 0 : 0.04;
  const server = new MatchServer({ random });
  const firstHost = fakePlayer(server, "FIRST");
  const secondHost = fakePlayer(server, "SECOND");
  const firstRoom = server.createPrivate(firstHost.player, 1000);
  const secondRoom = server.createPrivate(secondHost.player, 1001);

  assert.equal(firstRoom.code, "AAAA");
  assert.equal(secondRoom.code, "BBBB");
  assert.equal(server.rooms.get("AAAA"), firstRoom);
  assert.equal(server.rooms.get("BBBB"), secondRoom);
  assert.equal(server.rooms.size, 2);
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

test("stored PUPs do not regenerate Kestrel hull", () => {
  const { server, a } = readiedMatch(1000, "kestrel", "wing");
  server.reportDamage(a.player, { seq: 1, source: "impact", amount: 20 }, 6000);
  for (let seq = 1; seq <= 5; seq += 1) {
    server.updateInventory(a.player, { seq, action: "collect", weapon: "mines" }, 6000);
  }
  server.sweep(8000);
  assert.equal(a.player.combat.hull, 100, "one or several stored PUPs never heal hull");
  assert.equal(a.player.pupInventory.length, 5, "inventory remains normal progression state");
});

test("multiplayer inventory is a bounded server ledger, not a client-provided count", () => {
  const { server, a } = readiedMatch(1000, "kestrel");
  server.reportDamage(a.player, { seq: 1, source: "impact", amount: 20 }, 5500);
  const directClaim = parseClientMessage(JSON.stringify({ type: "inventory", seq: 1, count: 10 }));
  assert.equal(directClaim.ok, false, "raw count claims are not part of the protocol");
  assert.equal(server.updateInventory(a.player, { seq: 1, count: 10 }, 6000).ok, false);
  server.sweep(7000);
  assert.equal(a.player.combat.hull, 100, "an arbitrary upward count cannot grant healing");
  for (const count of [-1, 10.5, PUP_INVENTORY_CAPACITY + 1, "5", null]) {
    assert.equal(parseClientMessage(JSON.stringify({ type: "inventory", seq: 1, count })).ok, false);
  }

  for (let seq = 2; seq <= PUP_INVENTORY_CAPACITY + 1; seq += 1) {
    assert.equal(server.updateInventory(a.player, { seq, action: "collect", weapon: "beam" }, 6000).ok, true);
  }
  const overflow = server.updateInventory(a.player, { seq: 12, action: "collect", weapon: "beam" }, 6000);
  assert.equal(overflow.ok, false);
  assert.equal(a.player.pupInventory.length, PUP_INVENTORY_CAPACITY);

  const wrongLaunch = server.updateInventory(a.player, { seq: 13, action: "launch", weapon: "nuke" }, 6000);
  assert.equal(wrongLaunch.ok, false, "client cannot remove or launch a PUP it does not own next");
  assert.equal(a.player.pupInventory.length, PUP_INVENTORY_CAPACITY);

  const unownedTransmit = server.transmit(a.player, { seq: 1, weapon: "nuke" }, 6100);
  assert.equal(unownedTransmit.ok, false, "transmission requires a server-recorded launch");
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
  server.updateInventory(a.player, { seq: 1, action: "collect", weapon: "nuke" }, 5900);
  server.updateInventory(a.player, { seq: 2, action: "launch", weapon: "nuke" }, 5950);
  const result = server.transmit(a.player, { seq: 1, weapon: "nuke" }, 6000);
  assert.equal(result.ok, true);

  const incoming = b.last("incoming");
  assert.equal(incoming.weapon, "nuke");
  assert.equal(incoming.from, "ALPHA");
  assert.ok(incoming.eventId, "server issues the event id");
  assert.equal(incoming.targetId, b.player.id, "the delivery names the pilot it is aimed at");
  // Both pilots hear about a delivery now that they share one arena: the host
  // is what spawns the wave, and the host is often the sender. The tag is what
  // keeps that from being the sender's own attack arriving back at them.
  const echo = a.last("incoming");
  assert.equal(echo.eventId, incoming.eventId, "the arena host is told, so it can spawn the wave");
  assert.notEqual(echo.targetId, a.player.id, "and told it is not the one under attack");

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

// ------------------------------------------------------------ shared arena --

/**
 * A live PvP room with the relay channels open.
 *
 * `readiedMatch` already produces one; this only names the host and the guest,
 * because in a shared arena which is which decides who may do what.
 */
function duel(now = 1000, shipA = "wing", shipB = "tank") {
  const match = readiedMatch(now, shipA, shipB);
  const room = match.a.player.room;
  return { ...match, room, host: match.a, guest: match.b };
}

const world = (room, over = {}) => ({
  seq: 1, roundId: room.roundId, portalX: 752, portalY: 470, portalAngle: 0,
  enrageActive: false, enemies: [], enemyBullets: [], ...over,
});

test("a PvP room relays one world, exactly as co-op does", () => {
  // This is the change the whole mode turns on: updateWorld used to reject
  // every room whose kind was not co-op, so two duelling pilots could never
  // share an arena however much client code was written for it.
  const { server, room, host, guest } = duel();
  assert.equal(server.updateWorld(host.player, world(room), 5000).ok, true);
  const relayed = guest.last("world");
  assert.equal(relayed.roundId, room.roundId);
  assert.equal(relayed.hostId, host.player.id);
  assert.equal(host.last("world"), undefined, "the host does not relay to itself");
});

test("only the arena host may relay a world", () => {
  const { server, room, guest } = duel();
  assert.equal(server.updateWorld(guest.player, world(room), 5000).code, ERRORS.WRONG_PHASE);
});

test("a PvP world from a stale round or a stale sequence is ignored", () => {
  const { server, room, host } = duel();
  assert.equal(server.updateWorld(host.player, world(room, { seq: 4 }), 5000).ok, true);
  assert.equal(server.updateWorld(host.player, world(room, { seq: 3 }), 5200).ignored, true);
  assert.equal(server.updateWorld(host.player, world(room, { seq: 9, roundId: room.roundId - 1 }), 5400).ignored, true);
});

test("PvP pilots stream position to each other, so both are in one arena", () => {
  const { server, host, guest } = duel();
  assert.equal(server.updatePosition(host.player, { seq: 1, sentAt: 4900, x: 392, y: 470, angle: 0 }, 5000).ok, true);
  const seen = guest.last("teammate");
  assert.deepEqual({ x: seen.x, y: seen.y, angle: seen.angle }, { x: 392, y: 470, angle: 0 });
  assert.equal(seen.id, host.player.id);
});

test("a PvP guest reports hostile hits to the host rather than applying them", () => {
  // One set of hostiles lives on the host. A guest that killed them locally
  // would be shooting at a copy the other pilot cannot see die.
  const { server, room, host, guest } = duel();
  const hit = { seq: 1, roundId: room.roundId, enemyId: 3, source: "cannon", damage: 10 };
  assert.equal(server.reportEnemyHit(guest.player, hit, 5000).ok, true);
  assert.equal(host.last("enemy_hit").enemyId, 3);
  assert.equal(host.last("enemy_hit").from, guest.player.id);
  assert.equal(server.reportEnemyHit(host.player, { ...hit, seq: 2 }, 5100).ignored, true);
});

test("a PvP guest's arena-wide power-ups reach the host", () => {
  const { server, room, host, guest } = duel();
  assert.equal(server.reportWorldAction(guest.player, { seq: 1, roundId: room.roundId, action: "emp" }).ok, true);
  assert.equal(host.last("coop_world_action").action, "emp");
});

// ------------------------------------------------------ relayed cannon fire --

const volley = (room, over = {}) => ({
  seq: 1, roundId: room.roundId,
  shots: [{ x: 400, y: 470, vx: 10, vy: 0, damage: 14, life: 110, color: "#fff" }],
  ...over,
});

test("cannon volleys relay to the other pilot as spawn events", () => {
  const { server, room, host, guest } = duel();
  assert.equal(server.reportPilotShots(guest.player, volley(room), 5000).ok, true);
  const relayed = host.last("pvp_shot");
  assert.equal(relayed.from, guest.player.id);
  assert.equal(relayed.shots[0].damage, 14);
  assert.equal(guest.last("pvp_shot"), undefined, "a pilot does not receive its own fire");
});

test("stale and replayed volleys are dropped", () => {
  const { server, room, guest } = duel();
  server.reportPilotShots(guest.player, volley(room, { seq: 5 }), 5000);
  assert.equal(server.reportPilotShots(guest.player, volley(room, { seq: 5 }), 5100).ignored, true);
  assert.equal(server.reportPilotShots(guest.player, volley(room, { seq: 9, roundId: room.roundId - 1 }), 5200).ignored, true);
});

test("volleys are a duel channel and nothing else", () => {
  const server = new MatchServer();
  const a = fakePlayer(server, "ALPHA");
  const b = fakePlayer(server, "BRAVO");
  server.enqueue(a.player, { kind: "coop", difficulty: "easy" }, 1000);
  server.enqueue(b.player, { kind: "coop", difficulty: "easy" }, 1000);
  server.setReady(a.player, true, 1000);
  server.setReady(b.player, true, 1000);
  server.sweep(5000);
  const room = a.player.room;
  assert.equal(server.reportPilotShots(a.player, volley(room), 6000).code, ERRORS.NOT_IN_MATCH);
});

// ------------------------------------------ host-resolved ship-vs-ship fire --

test("the host reports the fire it resolved, and rules.mjs still owns the hull", () => {
  // The host is an authority on geometry only. It says who it hit and how
  // hard; the shield, the hull and the result are decided by the server.
  const { server, host, guest } = duel(1000, "wing", "tank");
  const before = guest.player.combat.hull;
  const result = server.reportDamage(host.player, {
    seq: 1, source: "impact", amount: 14, cause: "pilot_cannon", target: "opponent",
  }, 6000);
  assert.equal(result.ok, true);
  assert.equal(guest.player.combat.hull, before - 14);
  assert.equal(host.player.combat.hull, SHIP_HULL.wing, "the reporter's own hull is untouched");
  // Weapon fire never touches the collision shield, on either side of the wire.
  assert.equal(guest.player.combat.shieldCharge, COLLISION_SHIELD_CAPACITY);
});

test("a guest cannot report damage against the other pilot", () => {
  const { server, guest } = duel();
  const result = server.reportDamage(guest.player, {
    seq: 1, source: "impact", amount: 14, cause: "pilot_cannon", target: "opponent",
  }, 6000);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERRORS.WRONG_PHASE);
});

test("collisions stay self-reported even for the host", () => {
  // Only the pilot who hit something knows they did, so a host claiming a
  // collision on the other pilot is refused rather than quietly absorbed.
  const { server, host, guest } = duel();
  const before = guest.player.combat.hull;
  const result = server.reportDamage(host.player, {
    seq: 1, source: "collision", amount: 20, cause: "wall", target: "opponent",
  }, 6000);
  assert.equal(result.code, ERRORS.WRONG_PHASE);
  assert.equal(guest.player.combat.hull, before);
});

test("the host's anti-cheat window is charged for the fire it claims", () => {
  // Aiming a claim at the other pilot must not buy a larger damage budget.
  const { server, host } = duel(1000, "wing", "flagship");
  let seq = 0;
  let claimed = 0;
  let refused = null;
  while (seq < 40 && !refused) {
    seq += 1;
    const result = server.reportDamage(host.player, {
      seq, source: "impact", amount: MAX_DAMAGE_EVENT, cause: "pilot_cannon", target: "opponent",
    }, 6000);
    if (result.ok) claimed += MAX_DAMAGE_EVENT; else refused = result.code;
  }
  assert.equal(refused, ERRORS.RATE_LIMITED);
  assert.ok(claimed <= MAX_DAMAGE_TOTAL_PER_WINDOW, `${claimed} claimed in one window`);
});

test("a pilot destroyed by the other's cannon loses, and the shooter wins", () => {
  const { server, host, guest } = duel(1000, "wing", "kestrel");
  let seq = 0;
  let now = 6000;
  while (guest.player.combat && guest.player.combat.hull > 0 && seq < 60) {
    seq += 1;
    // Step the clock so the sliding window rolls rather than rate-limiting.
    if (seq % 3 === 0) now += 1100;
    server.reportDamage(host.player, {
      seq, source: "impact", amount: 40, cause: "pilot_cannon", target: "opponent",
    }, now);
  }
  assert.equal(host.last("result").outcome, "victory");
  assert.equal(guest.last("result").outcome, "defeat");
  assert.equal(guest.last("result").reason, "hull");
  assert.equal(guest.last("result").youEliminated, true);
  assert.equal(host.last("result").youEliminated, false);
  assert.equal(guest.last("result").eliminatedId, guest.player.id);
  assert.equal(host.last("result").cause, "pilot_cannon");
});

// --------------------------------------------------------------- host drop --

test("a host that drops mid-match hands the arena to the pilot still flying", () => {
  // Without this the survivor's world simply stops for the whole grace period:
  // no hostiles move, because the only client simulating them is gone.
  const { server, room, host, guest } = duel();
  assert.equal(room.players[0], host.player);
  server.disconnect(host.player, 7000);
  assert.equal(room.players[0], guest.player, "the survivor now hosts");
  assert.equal(guest.last("match").hostId, guest.player.id);
  assert.equal(guest.last("opponent").state, "disconnected");
  assert.equal(guest.last("opponent").graceMs, RECONNECT_GRACE_MS);
  assert.equal(room.phase, "active", "the match is not over yet");
});

test("the promoted host's own snapshots are accepted from its own sequence", () => {
  // The new host counts from a number with no relation to the one the old host
  // reached, so the room's high-water mark has to reset with the migration.
  const { server, room, host, guest } = duel();
  server.updateWorld(host.player, world(room, { seq: 900 }), 5000);
  server.disconnect(host.player, 7000);
  assert.equal(server.updateWorld(guest.player, world(room, { seq: 1 }), 8000).ok, true);
});

test("a guest that drops leaves the host hosting", () => {
  const { server, room, host, guest } = duel();
  server.disconnect(guest.player, 7000);
  assert.equal(room.players[0], host.player, "no pointless migration");
  assert.equal(host.last("opponent").state, "disconnected");
});

test("a pilot who never comes back forfeits, and nobody is said to have been eliminated", () => {
  const { server, room, host, guest } = duel();
  server.disconnect(host.player, 7000);
  server.sweep(7000 + RECONNECT_GRACE_MS + 1);
  const result = guest.last("result");
  assert.equal(result.outcome, "victory");
  assert.equal(result.reason, "forfeit");
  assert.equal(result.eliminatedId, null, "a forfeit is not a kill");
  assert.equal(result.youEliminated, false);
  assert.equal(room.phase, "select", "the room returns to selection for another round");
});

test("a host that returns inside the grace comes back as the guest", () => {
  const { server, room, host, guest } = duel();
  server.disconnect(host.player, 7000);
  const returned = server.reconnect(host.player.resume, host.player.send, 7000 + 1000);
  assert.equal(returned, host.player);
  assert.equal(room.players[0], guest.player, "the pilot who kept flying keeps the arena");
  assert.equal(host.last("match").hostId, guest.player.id);
});
