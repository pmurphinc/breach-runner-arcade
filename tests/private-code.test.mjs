import test from "node:test";
import assert from "node:assert/strict";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  isValidCode,
  parseClientMessage,
  randomCode,
} from "../server/protocol.mjs";
import { MatchServer, createPlayer } from "../server/rooms.mjs";

function host(server, name) {
  const messages = [];
  const player = createPlayer((message) => messages.push(message));
  player.name = name;
  server.register(player);
  return { player, messages };
}

test("generated private codes use exactly four allowed characters", () => {
  assert.equal(CODE_LENGTH, 4);
  for (let index = 0; index < 200; index += 1) {
    const code = randomCode();
    assert.equal(code.length, 4);
    assert.ok([...code].every((character) => CODE_ALPHABET.includes(character)));
  }
});

test("join validation accepts four-character codes and rejects other lengths", () => {
  assert.equal(isValidCode("AB7K"), true);
  assert.equal(parseClientMessage(JSON.stringify({ type: "join", code: "AB7K" })).ok, true);
  for (const code of ["AB7", "AB7KQ", "A0IK"]) {
    assert.equal(parseClientMessage(JSON.stringify({ type: "join", code })).ok, false);
  }
});

test("an active-code collision regenerates instead of overwriting its room", () => {
  let calls = 0;
  const server = new MatchServer({ random: () => calls++ < 8 ? 0 : 0.04 });
  const firstRoom = server.createPrivate(host(server, "FIRST").player, 1000);
  const secondRoom = server.createPrivate(host(server, "SECOND").player, 1001);

  assert.equal(firstRoom.code, "AAAA");
  assert.equal(secondRoom.code, "BBBB");
  assert.equal(server.rooms.get("AAAA"), firstRoom);
  assert.equal(server.rooms.get("BBBB"), secondRoom);
  assert.equal(server.rooms.size, 2);
});
