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
  const result = server.updatePosition(a.player, { x: 120, y: 300, angle: 45 }, 5000);
  assert.equal(result.ok, true);
  const message = b.messages.at(-1);
  assert.equal(message.type, "teammate");
  assert.deepEqual({ x: message.x, y: message.y, angle: message.angle }, { x: 120, y: 300, angle: 45 });
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
    portalX: 752,
    portalY: 470,
    portalAngle: 1.2,
    enrageActive: false,
    enemies: [{ kind: "mines", x: 700, y: 400, vx: 0, vy: 0, hp: 20, maxHp: 20, radius: 12, age: 40, cooldown: 0, phase: 0, armed: true }],
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
  const world = { seq: 4, portalX: 752, portalY: 470, portalAngle: 0, enrageActive: false, enemies: [] };
  server.updateWorld(a.player, world, 5000);
  server.updateWorld(a.player, { ...world, seq: 3 }, 5200);
  assert.equal(b.messages.filter((message) => message.type === "world").length, 1);
});


test("co-op defeat identifies the eliminated pilot and final damage source", () => {
  const { server, a, b } = activeCoop();
  server.reportDamage(a.player, { seq: 1, source: "impact", amount: 60, cause: "nuke_blast" }, 6000);
  server.reportDamage(a.player, { seq: 2, source: "impact", amount: 60, cause: "nuke_blast" }, 7100);
  server.reportDamage(a.player, { seq: 3, source: "impact", amount: 60, cause: "nuke_blast" }, 8200);
  server.reportDamage(a.player, { seq: 4, source: "impact", amount: 60, cause: "nuke_blast" }, 9300);
  const ownResult = a.messages.findLast((message) => message.type === "result");
  const allyResult = b.messages.findLast((message) => message.type === "result");
  assert.equal(ownResult.youEliminated, true);
  assert.equal(allyResult.youEliminated, false);
  assert.equal(ownResult.eliminatedName, a.player.name);
  assert.equal(allyResult.eliminatedName, a.player.name);
  assert.equal(ownResult.cause, "nuke_blast");
  assert.equal(allyResult.cause, "nuke_blast");
});

test("a co-op retry can store a new ship before both pilots accept", () => {
  const { server, a, b, room } = activeCoop();
  server.finishCoop(room, "defeat", "pilot_hull", 5000, a.player, "mines_collision");
  const first = server.requestRematch(a.player, 5100, "tank");
  assert.equal(first.starting, false);
  assert.equal(a.player.ship, "tank");
  const second = server.requestRematch(b.player, 5200);
  assert.equal(second.starting, true);
  assert.equal(room.phase, "select");
  assert.equal(a.player.ship, "tank");
});
