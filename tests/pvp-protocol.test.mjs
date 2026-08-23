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
