import test from "node:test";
import assert from "node:assert/strict";
import { MatchServer, createPlayer } from "../server/rooms.mjs";

function pilot(now = 0) {
  const messages = [];
  const player = createPlayer((message) => messages.push(message), { now, random: () => 0.25 });
  return { player, messages };
}

function activeCoop(difficulty = "easy") {
  const server = new MatchServer({ random: () => 0.25 });
  const a = pilot();
  const b = pilot();
  server.register(a.player);
  server.register(b.player);
  server.enqueue(a.player, { kind: "coop", difficulty }, 10);
  server.enqueue(b.player, { kind: "coop", difficulty }, 20);
  server.setReady(a.player, true, 30);
  server.setReady(b.player, true, 30);
  server.activate(a.player.room, 3030);
  return { server, a, b, room: a.player.room };
}

test("co-op queues never match 1v1 players", () => {
  const server = new MatchServer({ random: () => 0.25 });
  const coop = pilot();
  const pvp = pilot();
  server.enqueue(coop.player, { kind: "coop", difficulty: "easy" }, 1);
  server.enqueue(pvp.player, { kind: "pvp", difficulty: "easy" }, 2);
  assert.equal(coop.player.room, null);
  assert.equal(pvp.player.room, null);
  assert.equal(server.queue.length, 2);
});

test("co-op rival health is doubled by difficulty", () => {
  assert.equal(activeCoop("easy").room.rivalMaxHealth, 200);
  assert.equal(activeCoop("difficult").room.rivalMaxHealth, 400);
  assert.equal(activeCoop("hard").room.rivalMaxHealth, 700);
});

test("both pilots damage one authoritative rival", () => {
  const { server, a, b, room } = activeCoop("easy");
  server.updateInventory(a.player, { seq: 1, action: "collect", weapon: "mines" }, 3900);
  server.updateInventory(a.player, { seq: 2, action: "launch", weapon: "mines" }, 3950);
  server.updateInventory(b.player, { seq: 1, action: "collect", weapon: "nuke" }, 4000);
  server.updateInventory(b.player, { seq: 2, action: "launch", weapon: "nuke" }, 4050);
  server.transmit(a.player, { seq: 1, weapon: "mines" }, 4000);
  server.transmit(b.player, { seq: 1, weapon: "nuke" }, 4100);
  assert.equal(room.rivalHealth, 164);
  const statesA = a.messages.filter((message) => message.type === "state" && message.rival);
  const statesB = b.messages.filter((message) => message.type === "state" && message.rival);
  assert.equal(statesA.at(-1).rival.hull, 164);
  assert.equal(statesB.at(-1).rival.hull, 164);
});

test("co-op teammate positions relay without becoming server movement authority", () => {
  const { server, a, b } = activeCoop();
  const result = server.updatePosition(a.player, { seq: 1, sentAt: 4900, x: 120, y: 300, angle: 45 }, 5000);
  assert.equal(result.ok, true);
  const message = b.messages.at(-1);
  assert.equal(message.type, "teammate");
  assert.deepEqual({ x: message.x, y: message.y, angle: message.angle }, { x: 120, y: 300, angle: 45 });
  assert.deepEqual({ seq: message.seq, sentAt: message.sentAt }, { seq: 1, sentAt: 4900 });
});

test("co-op server ignores stale position sequences", () => {
  const { server, a, b } = activeCoop();
  server.updatePosition(a.player, { seq: 4, sentAt: 4900, x: 120, y: 300, angle: 45 }, 5000);
  const stale = server.updatePosition(a.player, { seq: 3, sentAt: 5100, x: 900, y: 800, angle: 180 }, 5200);
  assert.equal(stale.ignored, true);
  assert.equal(b.messages.filter((message) => message.type === "teammate").length, 1);
  assert.equal(a.player.position.x, 120);
});

test("one destroyed pilot produces a shared defeat", () => {
  const { server, a, b } = activeCoop();
  server.reportDamage(a.player, { seq: 1, source: "impact", amount: 60 }, 6000);
  server.reportDamage(a.player, { seq: 2, source: "impact", amount: 60 }, 7100);
  server.reportDamage(a.player, { seq: 3, source: "impact", amount: 60 }, 8200);
  server.reportDamage(a.player, { seq: 4, source: "impact", amount: 60 }, 9300);
  const aResult = a.messages.findLast((message) => message.type === "result");
  const bResult = b.messages.findLast((message) => message.type === "result");
  assert.equal(aResult.outcome, "defeat");
  assert.equal(bResult.outcome, "defeat");
});


test("only the co-op host can publish the shared enemy world", () => {
  const { server, a, b } = activeCoop();
  const world = {
    seq: 1,
    roundId: 1,
    portalX: 752,
    portalY: 470,
    portalAngle: 1.2,
    enrageActive: false,
    enemies: [{ enemyId: 1, kind: "mines", x: 700, y: 400, vx: 0, vy: 0, hp: 20, maxHp: 20, radius: 12, age: 40, cooldown: 0, phase: 0, armed: true }],
  };
  const rejected = server.updateWorld(b.player, world, 5000);
  assert.equal(rejected.ok, false);
  assert.equal(a.messages.some((message) => message.type === "world"), false);

  const accepted = server.updateWorld(a.player, world, 5100);
  assert.equal(accepted.ok, true);
  const relayed = b.messages.findLast((message) => message.type === "world");
  assert.equal(relayed.seq, 1);
  assert.equal(relayed.enemies[0].kind, "mines");
  assert.equal(relayed.hostId, a.player.id);
});

test("stale co-op world revisions are ignored", () => {
  const { server, a, b } = activeCoop();
  const world = { seq: 4, roundId: 1, portalX: 752, portalY: 470, portalAngle: 0, enrageActive: false, enemies: [] };
  server.updateWorld(a.player, world, 5000);
  server.updateWorld(a.player, { ...world, seq: 3 }, 5200);
  assert.equal(b.messages.filter((message) => message.type === "world").length, 1);
});

test("guest enemy hits are sequenced, round-scoped, rate-limited, and relayed only to the host", () => {
  const { server, a, b, room } = activeCoop();
  const hit = { seq: 1, roundId: room.roundId, enemyId: 42, source: "cannon", damage: 10 };
  assert.equal(server.reportEnemyHit(b.player, hit, 4000).ok, true);
  assert.deepEqual(a.messages.findLast((message) => message.type === "enemy_hit"), { type: "enemy_hit", ...hit, from: b.player.id });
  assert.equal(b.messages.some((message) => message.type === "enemy_hit"), false);
  assert.equal(server.reportEnemyHit(b.player, hit, 4001).ignored, true);
  assert.equal(server.reportEnemyHit(b.player, { ...hit, seq: 2, roundId: room.roundId - 1 }, 4002).ignored, true);
  for (let seq = 2; seq <= 46; seq += 1) server.reportEnemyHit(b.player, { ...hit, seq }, 4100);
  assert.equal(server.reportEnemyHit(b.player, { ...hit, seq: 47 }, 4100).code, "rate_limited");
});

test("new co-op rounds increment their generation and reject stale worlds", () => {
  const { server, a, room } = activeCoop();
  assert.equal(room.roundId, 1);
  server.finishCoop(room, "defeat", "pilot_hull", 5000, a.player);
  server.setReady(room.players[0], true, 5100);
  server.setReady(room.players[1], true, 5100);
  server.activate(room, 8100);
  assert.equal(room.roundId, 2);
  assert.equal(server.updateWorld(a.player, { seq: 1, roundId: 1, portalX: 1, portalY: 1, portalAngle: 0, enemies: [] }, 8200).ignored, true);
});


test("co-op defeat identifies the eliminated pilot and final damage source", () => {
  const { server, a, b, room } = activeCoop();
  // Reported until the pilot is actually gone rather than a fixed number of
  // hits, so a hull rebalance cannot silently stop this reaching elimination.
  const HIT = 60;
  const remainder = a.player.combat.maxHull % HIT;
  const finalHit = remainder === 0 ? HIT : remainder;
  let seq = 1;
  let now = 6000;
  while (room.phase === "active" && seq < 100) {
    server.reportDamage(a.player, { seq: seq++, source: "impact", amount: HIT, cause: "nuke_blast" }, now);
    now += 1100;
  }
  assert.equal(room.phase, "select");
  const ownResult = a.messages.findLast((message) => message.type === "result");
  const allyResult = b.messages.findLast((message) => message.type === "result");
  assert.equal(ownResult.youEliminated, true);
  assert.equal(allyResult.youEliminated, false);
  assert.equal(ownResult.eliminatedName, a.player.name);
  assert.equal(allyResult.eliminatedName, a.player.name);
  assert.equal(ownResult.cause, "nuke_blast");
  assert.equal(allyResult.cause, "nuke_blast");
  assert.equal(ownResult.finalDamage, finalHit);
  assert.equal(allyResult.finalDamage, finalHit);
});

test("a completed co-op round immediately becomes the same persistent ready room", () => {
  const { server, a, b, room } = activeCoop();
  const code = room.code;
  const ships = room.players.map((player) => player.ship);
  server.finishCoop(room, "defeat", "pilot_hull", 5000, a.player, "mines_collision");
  assert.equal(room.phase, "select");
  assert.equal(server.rooms.get(code), room);
  assert.deepEqual(room.players.map((player) => player.ship), ships);
  assert.deepEqual(room.players.map((player) => player.ready), [false, false]);
  assert.equal(a.player.room, room);
  assert.equal(b.player.room, room);
  const match = a.messages.findLast((message) => message.type === "match");
  assert.equal(match.lastResult.eliminatedName, a.player.name);
  assert.equal(match.lastResult.cause, "mines_collision");
});

test("post-round ship changes synchronize, clear ready, and launch without recreating the room", () => {
  const { server, a, b, room } = activeCoop();
  const code = room.code;
  server.finishCoop(room, "defeat", "pilot_hull", 5000, a.player, "beam");
  server.setReady(a.player, true, 5100);
  server.setShip(a.player, "tank");
  assert.equal(a.player.ready, false);
  assert.equal(b.messages.findLast((message) => message.type === "match").opponent.ship, "tank");
  server.setReady(a.player, true, 5200);
  server.setReady(b.player, true, 5201);
  assert.equal(room.phase, "countdown");
  server.sweep(8201);
  assert.equal(room.phase, "active");
  assert.equal(room.code, code);
  assert.equal(server.rooms.size, 1);
  assert.equal(a.player.ship, "tank");
});

test("three consecutive co-op rounds reuse state without leaking ready votes", () => {
  const { server, a, b, room } = activeCoop();
  const code = room.code;
  for (let round = 1; round <= 3; round += 1) {
    server.finishCoop(room, round === 3 ? "victory" : "defeat", round === 3 ? "rival" : "pilot_hull", round * 10_000, round === 3 ? null : a.player, round === 3 ? "nuke" : "beam");
    assert.equal(room.phase, "select");
    assert.deepEqual(room.players.map((player) => player.ready), [false, false]);
    assert.equal(room.code, code);
    if (round < 3) {
      server.setReady(a.player, true, round * 10_000 + 1);
      server.setReady(b.player, true, round * 10_000 + 2);
      server.activate(room, round * 10_000 + 3002);
    }
  }
  assert.equal(room.lastResult.outcome, "victory");
  assert.equal(server.rooms.get(code), room);
});


test("co-op victory reports the power-up and exact damage that destroyed the wormhole", () => {
  const { server, a, b, room } = activeCoop("easy");
  let seq = 1;
  let now = 4000;
  while (room.rivalHealth > 0 && seq < 20) {
    server.updateInventory(a.player, { seq: seq * 2 - 1, action: "collect", weapon: "nuke" }, now - 100);
    server.updateInventory(a.player, { seq: seq * 2, action: "launch", weapon: "nuke" }, now - 50);
    server.transmit(a.player, { seq: seq++, weapon: "nuke" }, now);
    now += 1100;
  }
  const hostResult = a.messages.findLast((message) => message.type === "result");
  const allyResult = b.messages.findLast((message) => message.type === "result");
  assert.equal(hostResult.outcome, "victory");
  assert.equal(allyResult.outcome, "victory");
  assert.equal(hostResult.cause, "nuke");
  assert.equal(allyResult.cause, "nuke");
  assert.equal(hostResult.finalDamage, 8);
  assert.equal(allyResult.finalDamage, 8);
});
