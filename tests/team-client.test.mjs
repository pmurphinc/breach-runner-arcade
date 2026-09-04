/**
 * The client's half of the 2v2 protocol.
 *
 * `pvp-client.ts` keeps no DOM in its message handling, so the parsing can be
 * driven here with hand-built server frames — no socket, no browser. That
 * matters because the four-pilot cases are exactly the ones a two-player client
 * got away with guessing at.
 *
 * The frames below are shaped to match what `server/rooms.mjs` actually sends;
 * `tests/team-server.test.mjs` is what proves the server sends them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PvpClient } from "../app/pvp-client.ts";

/**
 * A client whose snapshot can be read after each frame.
 *
 * `receive` is TypeScript-private, which is a compile-time claim only; at
 * runtime it is an ordinary method, and driving it directly is what lets the
 * parsing be tested without standing up a WebSocket.
 */
function client(kind = "team") {
  const net = new PvpClient(kind, "easy");
  return {
    net,
    feed: (message) => net["receive"](message),
    snap: () => net.state,
  };
}

const pilot = (id, name, team, extra = {}) => ({
  id, name, team, ship: "wing", ready: false, connected: true, ...extra,
});

/** What the server sends a team-zero pilot who is also their arena's host. */
const teamMatch = (overrides = {}) => ({
  type: "match",
  kind: "team",
  difficulty: "easy",
  phase: "select",
  code: null,
  hostId: "p1",
  roundId: 1,
  team: 0,
  capacity: 4,
  you: { id: "p1", name: "ALPHA", ship: "wing", ready: false },
  teammates: [pilot("p3", "CHARLIE", 0)],
  rivals: [pilot("p2", "BRAVO", 1), pilot("p4", "DELTA", 1)],
  opponent: pilot("p2", "BRAVO", 1),
  lastResult: null,
  ...overrides,
});

const duelMatch = (overrides = {}) => teamMatch({
  kind: "pvp",
  capacity: 2,
  teammates: [],
  rivals: [pilot("p2", "BRAVO", 1)],
  ...overrides,
});

// ------------------------------------------------------------------ rosters --

test("a 2v2 match names teammates and rivals separately", () => {
  const c = client();
  c.feed(teamMatch());
  assert.equal(c.snap().kind, "team");
  assert.equal(c.snap().team, 0);
  assert.equal(c.snap().capacity, 4);
  assert.deepEqual(c.snap().teammates.map((p) => p.name), ["CHARLIE"]);
  assert.deepEqual(c.snap().rivals.map((p) => p.name), ["BRAVO", "DELTA"]);
  assert.equal(c.snap().hostId, "p1", "the host of your own arena");
  assert.equal(c.snap().phase, "select");
});

test("an unknown kind falls back to 1v1 rather than to a shared arena", () => {
  const c = client();
  c.feed(teamMatch({ kind: "nonsense" }));
  assert.equal(c.snap().kind, "pvp", "guessing wrong here would share a 1v1 arena");
});

test("1v1 still parses with no teammates at all", () => {
  const c = client("pvp");
  c.feed(duelMatch());
  assert.equal(c.snap().kind, "pvp");
  assert.deepEqual(c.snap().teammates, [], "a 1v1 pilot is alone in their arena");
  assert.equal(c.snap().rivals.length, 1);
  assert.equal(c.snap().capacity, 2);
});

test("co-op still parses with a teammate and no rival", () => {
  const c = client("coop");
  c.feed(teamMatch({
    kind: "coop",
    capacity: 2,
    teammates: [pilot("p2", "BRAVO", 0)],
    rivals: [],
    opponent: pilot("p2", "BRAVO", 0),
  }));
  assert.equal(c.snap().kind, "coop");
  assert.deepEqual(c.snap().rivals, [], "the co-op rival is a wormhole, not a pilot");
  assert.equal(c.snap().opponent.name, "BRAVO", "`opponent` still means the ally in co-op");
});

// ------------------------------------------------------------------ readiness --

test("your own readiness is read by id, not by elimination", () => {
  const c = client();
  c.feed(teamMatch());
  // Only CHARLIE is ready. Picking "the entry that is not the opponent" would
  // have found CHARLIE first and reported you as ready when you are not.
  c.feed({
    type: "ready",
    states: [
      { id: "p1", ready: false, team: 0 },
      { id: "p3", ready: true, team: 0 },
      { id: "p2", ready: false, team: 1 },
      { id: "p4", ready: false, team: 1 },
    ],
  });
  assert.equal(c.snap().you.ready, false, "you are not ready just because somebody is");
  assert.equal(c.snap().teammates[0].ready, true);
  assert.equal(c.snap().rivals[0].ready, false);
});

test("every pilot's readiness is tracked, not only the opponent's", () => {
  const c = client();
  c.feed(teamMatch());
  c.feed({
    type: "ready",
    states: [
      { id: "p1", ready: true, team: 0 },
      { id: "p3", ready: true, team: 0 },
      { id: "p2", ready: true, team: 1 },
      { id: "p4", ready: false, team: 1 },
    ],
  });
  assert.equal(c.snap().you.ready, true);
  assert.deepEqual(c.snap().rivals.map((p) => p.ready), [true, false]);
});

// ------------------------------------------------------------------ payloads --

test("only the arena host spawns a delivered payload", () => {
  const host = client();
  host.feed(teamMatch());
  host.feed({ type: "incoming", eventId: "AAAA:1", weapon: "nuke", from: "BRAVO", spawn: true });
  assert.deepEqual(host.net.drainIncoming(), [{ weapon: "nuke", from: "BRAVO" }]);
  assert.equal(host.snap().incoming.weapon, "nuke", "and the warning still shows");
  host.net.disconnect();

  const guest = client();
  guest.feed(teamMatch({ hostId: "p3" }));
  guest.feed({ type: "incoming", eventId: "AAAA:1", weapon: "nuke", from: "BRAVO", spawn: false });
  // Two spawns would be two hostiles for one payload; the teammate will see
  // this one arrive in the host's world snapshot instead.
  assert.deepEqual(guest.net.drainIncoming(), []);
  assert.equal(guest.snap().incoming.weapon, "nuke", "but the warning is still shown");
  guest.net.disconnect();
});

test("a payload with no spawn flag is spawned, which is what 1v1 sends", () => {
  const c = client("pvp");
  c.feed({ type: "incoming", eventId: "AAAA:1", weapon: "mines", from: "BRAVO" });
  assert.deepEqual(c.net.drainIncoming(), [{ weapon: "mines", from: "BRAVO" }]);
  c.net.disconnect();
});

test("a duplicate delivery is still dropped by its event id", () => {
  const c = client();
  c.feed(teamMatch());
  const frame = { type: "incoming", eventId: "AAAA:7", weapon: "beam", from: "DELTA", spawn: true };
  c.feed(frame);
  c.feed(frame);
  assert.equal(c.net.drainIncoming().length, 1);
  c.net.disconnect();
});

// --------------------------------------------------------------- elimination --

test("the round carries who is down, and a team is not beaten by the first one", () => {
  const c = client();
  c.feed(teamMatch());
  c.feed({ type: "state", roundId: 1, phase: "active", serverNow: 1, down: ["p1"], lastDown: "p1" });
  assert.deepEqual(c.snap().down, ["p1"]);
  assert.equal(c.snap().phase, "active", "being down is not the end of the round");
  c.feed({ type: "state", serverNow: 2, down: ["p1", "p3"], lastDown: "p3" });
  assert.deepEqual(c.snap().down, ["p1", "p3"]);
});

// -------------------------------------------------------------- connections --

test("a disconnect names which of the three other pilots dropped", () => {
  const c = client();
  c.feed(teamMatch());
  c.feed({ type: "opponent", state: "disconnected", id: "p4", name: "DELTA", team: 1 });
  assert.deepEqual(c.snap().rivals.map((p) => p.connected), [true, false], "only DELTA is marked");
  assert.equal(c.snap().teammates[0].connected, true);
  assert.equal(c.snap().opponent.connected, true, "BRAVO is still flying");

  c.feed({ type: "opponent", state: "reconnected", id: "p4", name: "DELTA" });
  assert.deepEqual(c.snap().rivals.map((p) => p.connected), [true, true]);
});

test("a 1v1 disconnect still marks the opponent", () => {
  const c = client("pvp");
  c.feed(duelMatch());
  c.feed({ type: "opponent", state: "disconnected", id: "p2", name: "BRAVO" });
  assert.equal(c.snap().opponent.connected, false);
});

// -------------------------------------------------------------------- lobby --

test("a filling lobby reports how many seats are taken", () => {
  const c = client();
  c.feed({ type: "lobby", state: "searching", players: 3, needed: 4 });
  assert.equal(c.snap().phase, "searching");
  assert.deepEqual(c.snap().queue, { players: 3, needed: 4 });
  assert.equal(c.snap().capacity, 4);

  c.feed({ type: "lobby", state: "waiting", code: "AB7K", kind: "team", players: 2, needed: 4, team: 1 });
  assert.equal(c.snap().code, "AB7K");
  assert.equal(c.snap().team, 1);
  assert.deepEqual(c.snap().queue, { players: 2, needed: 4 });

  c.feed({ type: "lobby", state: "idle" });
  assert.equal(c.snap().queue, null, "an idle lobby is not a queue with zero pilots in it");
  assert.deepEqual(c.snap().teammates, []);
  assert.deepEqual(c.snap().rivals, []);
});

test("a match clears the queue counter it replaces", () => {
  const c = client();
  c.feed({ type: "lobby", state: "searching", players: 3, needed: 4 });
  c.feed(teamMatch());
  assert.equal(c.snap().queue, null);
  assert.equal(c.snap().capacity, 4);
});
