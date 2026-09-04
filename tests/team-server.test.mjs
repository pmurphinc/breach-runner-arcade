/**
 * The four-pilot room, driven directly.
 *
 * `rooms.mjs` knows nothing about WebSockets, so the whole 2v2 state machine
 * runs here through fake players that record what they were sent — matchmaking,
 * seating, per-team arenas, elimination, forfeits and results. The socket layer
 * on top of it is proven separately in `team-socket.test.mjs`.
 *
 * Several of these assertions exist to pin what 2v2 must *not* do: leak one
 * team's arena to the other, end the round on the first hull to reach zero, or
 * change anything about 1v1 and co-op on the way past.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { RECONNECT_GRACE_MS } from "../server/protocol.mjs";
import {
  MatchServer,
  PVP_QUICK_MATCH_QUEUE,
  TEAM_QUICK_MATCH_QUEUE,
  createPlayer,
} from "../server/rooms.mjs";

function pilot(server, name) {
  const messages = [];
  const player = createPlayer((message) => messages.push(message));
  player.name = name;
  server.register(player);
  return {
    player,
    messages,
    last: (type) => [...messages].reverse().find((m) => m.type === type),
    all: (type) => messages.filter((m) => m.type === type),
  };
}

/** Four pilots quick-matched into one 2v2 room, still in ship select. */
function teamRoom(now = 1000) {
  const server = new MatchServer();
  const pilots = ["ALPHA", "BRAVO", "CHARLIE", "DELTA"].map((name) => pilot(server, name));
  for (const entry of pilots) server.enqueue(entry.player, { kind: "team" }, now);
  const [alpha, bravo, charlie, delta] = pilots;
  return { server, pilots, alpha, bravo, charlie, delta, room: alpha.player.room };
}

/** The same room, readied and live. */
function activeTeamRoom(now = 1000) {
  const context = teamRoom(now);
  for (const entry of context.pilots) context.server.setReady(entry.player, true, now);
  context.server.sweep(now + 4000);
  return context;
}

// ---------------------------------------------------------------- matchmaking --

test("2v2 waits for four pilots before it starts anything", () => {
  const server = new MatchServer();
  const pilots = ["A", "B", "C"].map((name) => pilot(server, name));
  for (const entry of pilots) server.enqueue(entry.player, { kind: "team" }, 100);

  assert.equal(server.rooms.size, 0, "three pilots is not a 2v2");
  assert.equal(server.queue.length, 3);
  for (const entry of pilots) {
    assert.equal(entry.last("lobby").state, "searching");
  }
  // The count travels with the message, so the lobby can say how close it is.
  assert.deepEqual(
    { players: pilots[0].last("lobby").players, needed: pilots[0].last("lobby").needed },
    { players: 3, needed: 4 },
  );

  const fourth = pilot(server, "D");
  server.enqueue(fourth.player, { kind: "team" }, 110);
  assert.equal(server.rooms.size, 1, "the fourth pilot starts the match");
  assert.equal(server.queue.length, 0);
});

test("the 2v2 queue never matches 1v1 or co-op pilots", () => {
  const server = new MatchServer();
  const team = ["A", "B", "C"].map((name) => pilot(server, name));
  for (const entry of team) server.enqueue(entry.player, { kind: "team" }, 1);
  const duel = pilot(server, "DUEL");
  const ally = pilot(server, "ALLY");
  server.enqueue(duel.player, { kind: "pvp" }, 2);
  server.enqueue(ally.player, { kind: "coop", difficulty: "easy" }, 3);

  assert.equal(server.rooms.size, 0, "a 1v1 pilot must not complete a 2v2 roster");
  assert.deepEqual(
    [...new Set(server.queue.map((entry) => entry.queueKey))].sort(),
    [PVP_QUICK_MATCH_QUEUE, TEAM_QUICK_MATCH_QUEUE, "coop:easy"].sort(),
  );
});

test("2v2 rules are server-owned: a client cannot pick a difficulty", () => {
  const server = new MatchServer();
  const pilots = ["A", "B", "C", "D"].map((name) => pilot(server, name));
  for (const entry of pilots) server.enqueue(entry.player, { kind: "team", difficulty: "hard" }, 1);
  assert.equal(pilots[0].player.room.difficulty, "easy", "2v2 is PvP-shaped, not PvE-shaped");
  assert.equal(pilots[0].player.room.rivalMaxHealth, null, "and has no server-owned rival rift");
});

test("a quick-matched roster is split two and two", () => {
  const { room, alpha, bravo, charlie, delta } = teamRoom();
  assert.equal(room.players.length, 4);
  assert.deepEqual(room.players.map((entry) => entry.team), [0, 1, 0, 1]);
  assert.equal(alpha.last("match").team, 0);
  assert.equal(bravo.last("match").team, 1);
  assert.deepEqual(alpha.last("match").teammates.map((m) => m.name), ["CHARLIE"]);
  assert.deepEqual(alpha.last("match").rivals.map((m) => m.name), ["BRAVO", "DELTA"]);
  assert.deepEqual(delta.last("match").teammates.map((m) => m.name), ["BRAVO"]);
  assert.equal(charlie.last("match").capacity, 4);
});

test("each team is told the host of its own arena, and only its own", () => {
  const { room, alpha, bravo, charlie, delta } = teamRoom();
  const [one, two] = room.players;
  assert.equal(alpha.last("match").hostId, one.id);
  assert.equal(charlie.last("match").hostId, one.id, "teammates share a host");
  assert.equal(bravo.last("match").hostId, two.id);
  assert.equal(delta.last("match").hostId, two.id);
  assert.notEqual(alpha.last("match").hostId, bravo.last("match").hostId,
    "two teams means two arenas and two hosts");
});

// -------------------------------------------------------------- private rooms --

test("a private 2v2 room fills one seat at a time and opens select at four", () => {
  const server = new MatchServer();
  const host = pilot(server, "HOST");
  const room = server.createPrivate(host.player, { kind: "team" }, 100);
  assert.equal(host.last("lobby").state, "waiting");
  assert.equal(host.last("lobby").needed, 4);

  const joiners = ["TWO", "THREE"].map((name) => pilot(server, name));
  for (const entry of joiners) {
    const result = server.join(entry.player, room.code, 110);
    assert.equal(result.ok, true);
    assert.equal(result.waiting, true, "ship select must wait for a full roster");
  }
  assert.equal(room.phase, "lobby");
  assert.equal(host.last("lobby").players, 3);

  const fourth = pilot(server, "FOUR");
  assert.equal(server.join(fourth.player, room.code, 120).ok, true);
  assert.equal(room.phase, "select");
  assert.equal(fourth.last("match").kind, "team");

  const fifth = pilot(server, "FIVE");
  assert.deepEqual(server.join(fifth.player, room.code, 130), { ok: false, code: "room_full" });
});

test("a 1v1 private room still fills at two", () => {
  const server = new MatchServer();
  const host = pilot(server, "HOST");
  const room = server.createPrivate(host.player, { kind: "pvp" }, 100);
  const guest = pilot(server, "GUEST");
  assert.equal(server.join(guest.player, room.code, 110).ok, true);
  assert.equal(room.phase, "select", "two pilots is a full 1v1 room");
  const third = pilot(server, "THIRD");
  assert.equal(server.join(third.player, room.code, 120).code, "room_full");
});

test("a 2v2 lobby survives one pilot leaving; the seat simply reopens", () => {
  const { server, room, alpha, charlie } = teamRoom();
  server.leaveMatch(alpha.player);
  assert.equal(server.rooms.size, 1, "a four-pilot lobby must not collapse on one exit");
  assert.equal(room.players.length, 3);
  assert.equal(alpha.player.room, null);
  assert.equal(charlie.last("lobby").state, "waiting");
  assert.equal(charlie.last("lobby").players, 3);
  assert.equal(room.phase, "lobby", "and nobody stays ready in a room that is no longer full");
  assert.equal(charlie.player.ready, false);
});

test("a 2v2 room only launches with four seats filled and four pilots ready", () => {
  const { server, room, pilots } = teamRoom();
  for (const entry of pilots.slice(0, 3)) server.setReady(entry.player, true, 1100);
  assert.equal(room.phase, "select", "three ready pilots must keep waiting");
  server.setReady(pilots[3].player, true, 1200);
  assert.equal(room.phase, "countdown");
});

// ------------------------------------------------------------- shared arenas --

test("a teammate's position reaches the teammate and never the other team", () => {
  const { server, room, alpha, bravo, charlie, delta } = activeTeamRoom();
  server.updatePosition(alpha.player, { seq: 1, sentAt: 10, x: 120, y: 300, angle: 45 }, 5000);

  const seen = charlie.last("teammate");
  assert.equal(seen.id, alpha.player.id);
  assert.deepEqual({ x: seen.x, y: seen.y, angle: seen.angle }, { x: 120, y: 300, angle: 45 });
  assert.equal(seen.roundId, room.roundId);
  assert.equal(bravo.last("teammate"), undefined, "the other team flies its own arena");
  assert.equal(delta.last("teammate"), undefined);
});

const world = (roundId, seq, pups = []) => ({
  seq, roundId, portalX: 700, portalY: 400, portalAngle: 0,
  enemies: [], enemyBullets: [], pups,
});

test("each team's host publishes its own world, and only to its own teammate", () => {
  const { server, room, alpha, bravo, charlie, delta } = activeTeamRoom();
  const [hostA, hostB] = [room.players[0], room.players[1]];
  assert.equal(hostA, alpha.player);
  assert.equal(hostB, bravo.player);

  assert.equal(server.updateWorld(hostA, world(room.roundId, 1), 5000).ok, true);
  assert.equal(charlie.last("world").hostId, hostA.id);
  assert.equal(bravo.last("world"), undefined, "one team must never see the other's arena");
  assert.equal(delta.last("world"), undefined);

  // The other team's host publishes independently, on its own sequence.
  assert.equal(server.updateWorld(hostB, world(room.roundId, 1), 5000).ok, true);
  assert.equal(delta.last("world").hostId, hostB.id);
  assert.equal(alpha.all("world").length, 0);
});

test("a non-host cannot publish a world for its team", () => {
  const { server, room, charlie } = activeTeamRoom();
  assert.deepEqual(
    server.updateWorld(charlie.player, world(room.roundId, 1), 5000),
    { ok: false, code: "wrong_phase" },
  );
});

test("the two arenas keep independent world sequences", () => {
  const { server, room, charlie, delta } = activeTeamRoom();
  const [hostA, hostB] = room.players;
  assert.equal(server.updateWorld(hostA, world(room.roundId, 9), 5000).ok, true);
  // A seq of 1 is stale for team zero but perfectly fresh for team one; a
  // single shared counter would have silently swallowed it.
  assert.equal(server.updateWorld(hostB, world(room.roundId, 1), 5000).ok, true);
  assert.equal(charlie.last("world").seq, 9);
  assert.equal(delta.last("world").seq, 1);
});

test("a PUP race is settled inside one team and never told to the other", () => {
  const { server, room, alpha, bravo, charlie, delta } = activeTeamRoom();
  const [hostA] = room.players;
  server.updateWorld(hostA, world(room.roundId, 1, [
    { pupId: 7, type: "beam", x: 700, y: 400, vx: 0, vy: 0, life: 800, phase: 0 },
  ]), 5000);

  server.updatePosition(alpha.player, { seq: 1, sentAt: 1, x: 700, y: 400, angle: 0 }, 5001);
  server.updatePosition(charlie.player, { seq: 1, sentAt: 1, x: 700, y: 400, angle: 0 }, 5001);
  const first = server.claimSharedPup(charlie.player, { seq: 1, roundId: room.roundId, pupId: 7 }, 5002);
  const second = server.claimSharedPup(alpha.player, { seq: 1, roundId: room.roundId, pupId: 7 }, 5003);

  assert.equal(first.winner, charlie.player.id, "first claim to reach the server wins");
  assert.equal(second.winner, charlie.player.id, "the loser asks a fair question and is told the truth");
  assert.equal(alpha.last("pup_taken").by, charlie.player.id, "rather than being left holding a ghost");
  assert.equal(charlie.last("pup_taken").by, charlie.player.id);
  assert.equal(bravo.last("pup_taken"), undefined, "the other team never saw that power-up");
  assert.equal(delta.last("pup_taken"), undefined);
});

test("the same PUP id in both arenas is two different power-ups", () => {
  const { server, room, alpha, bravo, charlie, delta } = activeTeamRoom();
  const [hostA, hostB] = room.players;
  const pup = { pupId: 3, type: "nuke", x: 700, y: 400, vx: 0, vy: 0, life: 800, phase: 0 };
  server.updateWorld(hostA, world(room.roundId, 1, [pup]), 5000);
  server.updateWorld(hostB, world(room.roundId, 1, [pup]), 5000);
  for (const entry of [alpha, bravo, charlie, delta]) {
    server.updatePosition(entry.player, { seq: 1, sentAt: 1, x: 700, y: 400, angle: 0 }, 5001);
  }

  // Ids restart from one on every host, so a single shared ledger would have
  // let one team's claim decide the other team's race.
  assert.equal(server.claimSharedPup(charlie.player, { seq: 1, roundId: room.roundId, pupId: 3 }, 5002).winner, charlie.player.id);
  assert.equal(server.claimSharedPup(delta.player, { seq: 1, roundId: room.roundId, pupId: 3 }, 5003).winner, delta.player.id);
});

test("an enemy hit is reported to the reporting pilot's own host", () => {
  const { server, room, alpha, bravo, charlie, delta } = activeTeamRoom();
  const hit = { seq: 1, roundId: room.roundId, enemyId: 4, source: "cannon", damage: 12 };
  assert.equal(server.reportEnemyHit(charlie.player, hit, 5000).ok, true);
  assert.equal(alpha.last("enemy_hit").from, charlie.player.id);
  assert.equal(bravo.last("enemy_hit"), undefined);

  assert.equal(server.reportEnemyHit(delta.player, hit, 5000).ok, true);
  assert.equal(bravo.last("enemy_hit").from, delta.player.id);
});

// ------------------------------------------------------------------ payloads --

test("a payload reaches the rival team, and only its host may spawn it", () => {
  const { server, alpha, bravo, charlie, delta } = activeTeamRoom();
  server.updateInventory(alpha.player, { seq: 1, action: "collect", weapon: "nuke" }, 5000);
  server.updateInventory(alpha.player, { seq: 2, action: "launch", weapon: "nuke" }, 5010);
  const sent = server.transmit(alpha.player, { seq: 1, weapon: "nuke" }, 5020);
  assert.equal(sent.ok, true);

  const hostIncoming = bravo.last("incoming");
  const otherIncoming = delta.last("incoming");
  assert.equal(hostIncoming.weapon, "nuke");
  assert.equal(hostIncoming.from, "ALPHA");
  assert.equal(hostIncoming.spawn, true, "the rival arena's host spawns the hostile");
  assert.equal(otherIncoming.spawn, false, "its teammate gets the warning, not a second hostile");
  assert.equal(otherIncoming.eventId, hostIncoming.eventId);

  // Nothing lands on the sender's own team.
  assert.equal(alpha.last("incoming"), undefined);
  assert.equal(charlie.last("incoming"), undefined);
  // But both of them see it leave, since they share the arena that shed it.
  assert.equal(charlie.last("state").sent, "nuke");
  assert.equal(charlie.last("state").by, alpha.player.id);
});

test("1v1 transmission is untouched: one recipient and no spawn flag needed", () => {
  const server = new MatchServer();
  const a = pilot(server, "ALPHA");
  const b = pilot(server, "BRAVO");
  server.enqueue(a.player, { kind: "pvp" }, 1000);
  server.enqueue(b.player, { kind: "pvp" }, 1000);
  server.setReady(a.player, true, 1000);
  server.setReady(b.player, true, 1000);
  server.sweep(5000);
  server.updateInventory(a.player, { seq: 1, action: "collect", weapon: "mines" }, 5100);
  server.updateInventory(a.player, { seq: 2, action: "launch", weapon: "mines" }, 5110);
  server.transmit(a.player, { seq: 1, weapon: "mines" }, 5120);
  assert.equal(b.last("incoming").weapon, "mines");
  assert.equal(b.last("incoming").spawn, undefined, "a lone pilot is their own arena's host");
  assert.equal(a.last("incoming"), undefined);
});

// -------------------------------------------------------------- elimination --

test("one hull at zero does not end a 2v2 round", () => {
  const { server, room, alpha, bravo, charlie } = activeTeamRoom();
  alpha.player.combat.shield = 0;
  server.reportDamage(alpha.player, { seq: 1, source: "impact", amount: 60 }, 5000);
  let seq = 2;
  while (alpha.player.combat && alpha.player.combat.hull > 0 && seq < 40) {
    server.reportDamage(alpha.player, { seq: seq++, source: "impact", amount: 60 }, 5000 + seq * 1200);
  }

  assert.equal(alpha.player.eliminated, true);
  assert.equal(room.phase, "active", "the teammate is still flying");
  assert.equal(charlie.last("result"), undefined);
  assert.equal(bravo.last("result"), undefined);
  // Everyone is told who went down rather than a ship silently vanishing.
  const announced = (entry) => entry.all("state").findLast((message) => message.down)?.down;
  assert.deepEqual(announced(charlie), [alpha.player.id]);
  assert.deepEqual(announced(bravo), [alpha.player.id], "the rival team hears it too");
});

test("a team loses when both of its pilots are down, and both rivals win", () => {
  const { server, room, alpha, bravo, charlie, delta } = activeTeamRoom();
  const grind = (entry) => {
    let seq = 1;
    let at = 5000;
    while (entry.player.combat && entry.player.combat.hull > 0 && seq < 60) {
      server.reportDamage(entry.player, { seq: seq++, source: "impact", amount: 60 }, at);
      at += 1200;
    }
  };
  grind(alpha);
  grind(charlie);

  assert.equal(bravo.last("result").outcome, "victory");
  assert.equal(delta.last("result").outcome, "victory", "the whole winning team wins");
  assert.equal(alpha.last("result").outcome, "defeat");
  assert.equal(charlie.last("result").outcome, "defeat");
  assert.equal(bravo.last("result").reason, "hull");
  assert.deepEqual(delta.last("result").teammates, ["BRAVO"]);
  assert.deepEqual(delta.last("result").opponentTeam, ["ALPHA", "CHARLIE"]);
  assert.equal(room.phase, "select", "and the room returns to select for another round");
});

test("a pilot shot down early still shares their team's victory", () => {
  const { server, room, bravo, delta } = activeTeamRoom();
  server.eliminate(room, bravo.player, "hull", 6000, "beam", 20);
  assert.equal(room.phase, "active");
  server.eliminate(room, room.players[0], "hull", 7000, "beam", 20);
  server.eliminate(room, room.players[2], "hull", 7100, "beam", 20);
  assert.equal(bravo.last("result").outcome, "victory", "being down is not being beaten");
  assert.equal(delta.last("result").outcome, "victory");
});

test("a new round clears everyone's elimination", () => {
  const { server, room, pilots } = activeTeamRoom();
  // Take team zero out, which ends the round and returns the room to select.
  server.eliminate(room, room.players[0], "hull", 6000);
  server.eliminate(room, room.players[2], "hull", 6100);
  assert.equal(room.phase, "select");
  assert.deepEqual(room.players.map((entry) => entry.eliminated), [false, false, false, false],
    "a fresh lobby has nobody marked down");

  for (const entry of pilots) server.setReady(entry.player, true, 8000);
  server.sweep(12_000);
  assert.equal(room.phase, "active");
  assert.equal(room.roundId, 2);
  assert.deepEqual(room.players.map((entry) => entry.eliminated), [false, false, false, false]);
});

// ---------------------------------------------------------------- disconnects --

test("a dropped 2v2 pilot is announced to all three others by name", () => {
  const { server, alpha, bravo, charlie, delta } = activeTeamRoom();
  server.disconnect(alpha.player, 6000);
  for (const entry of [bravo, charlie, delta]) {
    const notice = entry.last("opponent");
    assert.equal(notice.state, "disconnected");
    assert.equal(notice.id, alpha.player.id, "in a four-pilot room, who left has to be said");
    assert.equal(notice.name, "ALPHA");
    assert.equal(notice.team, 0);
  }
});

test("a pilot who never returns is out, but their teammate plays on", () => {
  const { server, room, alpha, bravo, charlie } = activeTeamRoom();
  server.disconnect(alpha.player, 6000);
  server.sweep(6000 + RECONNECT_GRACE_MS + 1);

  assert.equal(alpha.player.eliminated, true);
  assert.equal(room.phase, "active", "a dropped connection must not forfeit for the teammate");
  assert.equal(charlie.last("result"), undefined);
  assert.equal(bravo.last("result"), undefined);
});

test("a team forfeits once neither of its pilots is left flying", () => {
  const { server, room, alpha, bravo, charlie, delta } = activeTeamRoom();
  server.disconnect(alpha.player, 6000);
  server.disconnect(charlie.player, 6000);
  server.sweep(6000 + RECONNECT_GRACE_MS + 1);

  assert.equal(bravo.last("result").outcome, "victory");
  assert.equal(bravo.last("result").reason, "forfeit");
  assert.equal(delta.last("result").outcome, "victory");
  assert.equal(room.phase, "select");
});

// ------------------------------------------------------------------ no drift --

test("1v1 and co-op keep the room shapes they always had", () => {
  const server = new MatchServer();
  const a = pilot(server, "A");
  const b = pilot(server, "B");
  server.enqueue(a.player, { kind: "pvp" }, 1);
  server.enqueue(b.player, { kind: "pvp" }, 1);
  assert.equal(a.player.room.players.length, 2);
  assert.deepEqual(a.player.room.players.map((p) => p.team), [0, 1]);
  assert.equal(a.last("match").opponent.name, "B", "`opponent` still means the enemy in 1v1");
  assert.deepEqual(a.last("match").teammates, [], "and a 1v1 pilot has no teammate");

  const server2 = new MatchServer();
  const c = pilot(server2, "C");
  const d = pilot(server2, "D");
  server2.enqueue(c.player, { kind: "coop", difficulty: "hard" }, 1);
  server2.enqueue(d.player, { kind: "coop", difficulty: "hard" }, 1);
  assert.deepEqual(c.player.room.players.map((p) => p.team), [0, 0], "co-op is one team");
  assert.equal(c.last("match").opponent.name, "D", "`opponent` still means the ally in co-op");
  assert.deepEqual(c.last("match").rivals, [], "and there is no rival pilot to fight");
  assert.equal(c.player.room.rivalMaxHealth, 700, "co-op difficulty rules are untouched");
});
