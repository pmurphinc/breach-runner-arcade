/**
 * Anti-drift guard between the client and server halves of the protocol.
 *
 * `app/pvp-client.ts` and `server/protocol.mjs` are a matched pair kept in two
 * languages on purpose — the server must not depend on Node's experimental
 * TypeScript stripping in production. These assertions are what stops them
 * drifting apart silently.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CODE_LENGTH as CLIENT_CODE_LENGTH,
  COUNTDOWN_SECONDS as CLIENT_COUNTDOWN,
  PROTOCOL_VERSION as CLIENT_VERSION,
  PVP_PATH as CLIENT_PATH,
  RECONNECT_GRACE_MS as CLIENT_GRACE,
  matchServiceUrl,
} from "../app/pvp-client.ts";
import {
  CODE_LENGTH,
  COUNTDOWN_SECONDS,
  PROTOCOL_VERSION,
  PVP_PATH,
  RECONNECT_GRACE_MS,
  parseClientMessage,
} from "../server/protocol.mjs";

test("client and server agree on the protocol contract", () => {
  assert.equal(CLIENT_VERSION, PROTOCOL_VERSION, "protocol version drift");
  assert.equal(CLIENT_PATH, PVP_PATH, "endpoint path drift");
  assert.equal(CLIENT_CODE_LENGTH, CODE_LENGTH, "invite code length drift");
  assert.equal(CLIENT_COUNTDOWN, COUNTDOWN_SECONDS, "countdown drift");
  assert.equal(CLIENT_GRACE, RECONNECT_GRACE_MS, "reconnect grace drift");
});

test("the match service resolves to the game's own origin", () => {
  // Same origin means the single Railway service and its custom domain cover
  // the socket too, with no second host to configure.
  assert.equal(matchServiceUrl(), "", "no window means no URL, rather than a guess");
});


test("co-op world snapshots preserve rotating beam direction", () => {
  const parsed = parseClientMessage(JSON.stringify({
    type: "world",
    seq: 1,
    portalX: 752,
    portalY: 470,
    portalAngle: 0,
    enemies: [{
      kind: "beam",
      x: 752,
      y: 470,
      vx: 0,
      vy: 0,
      hp: 20,
      maxHp: 20,
      radius: 18,
      age: 1,
      cooldown: 0,
      phase: 90,
      rotationDir: -1,
    }],
    enemyBullets: [],
  }));

  assert.equal(parsed.ok, true);
  assert.equal(parsed.message.enemies[0].rotationDir, -1);
});

test("co-op world snapshots carry scramble, so a host's pulse reaches the guest", () => {
  const enemy = {
    kind: "gunship", x: 700, y: 400, vx: 1, vy: 1,
    hp: 80, maxHp: 80, radius: 25, age: 5, cooldown: 10, phase: 0,
  };
  const world = (scrambled) => JSON.parse(JSON.stringify({
    type: "world", seq: 1, portalX: 752, portalY: 470, portalAngle: 0,
    enemies: [{ ...enemy, scrambled }], enemyBullets: [],
  }));

  const scrambled = parseClientMessage(JSON.stringify(world(240)));
  assert.equal(scrambled.ok, true);
  assert.equal(scrambled.message.enemies[0].scrambled, 240);

  // Absent stays absent rather than becoming a zero the client has to guard.
  const plain = parseClientMessage(JSON.stringify(world(undefined)));
  assert.equal(plain.ok, true);
  assert.equal(plain.message.enemies[0].scrambled, undefined);

  // A client cannot claim a scramble that outlives any real pulse.
  const absurd = parseClientMessage(JSON.stringify(world(99_999)));
  assert.equal(absurd.ok, true);
  assert.equal(absurd.message.enemies[0].scrambled, 1000);
});
