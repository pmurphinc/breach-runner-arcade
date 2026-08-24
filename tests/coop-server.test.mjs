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
  server.reportDamage(a.player, { seq: 2, source: "impact", amount: 60 }, 6100);
  server.reportDamage(a.player, { seq: 3, source: "impact", amount: 60 }, 6200);
  server.reportDamage(a.player, { seq: 4, source: "impact", amount: 60 }, 6300);
  const aResult = a.messages.findLast((message) => message.type === "result");
  const bResult = b.messages.findLast((message) => message.type === "result");
  assert.equal(aResult.outcome, "defeat");
  assert.equal(bResult.outcome, "defeat");
});
