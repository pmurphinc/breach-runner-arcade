/**
 * 2v2 over the real transport.
 *
 * `team-server.test.mjs` drives the four-pilot state machine directly; this
 * proves the socket layer carries it — four real WebSocket clients on one HTTP
 * server, exactly as the single Railway service will serve them.
 *
 * The claims worth proving here are the ones that cannot be read off the
 * source: that four separate connections actually assemble into two teams, that
 * a team's arena reaches its own teammate, and — the one that would ruin the
 * mode if it were wrong — that nothing from one team's arena ever arrives on
 * the other team's socket.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { attachPvpServer } from "../server/pvp.mjs";
import { PVP_PATH } from "../server/protocol.mjs";

/** A bare HTTP server stands in for the vinext prod server. */
function startHarness(env = {}) {
  const http = createServer((_req, res) => res.end("game"));
  const pvp = attachPvpServer(http, { log: () => {}, env: { NODE_ENV: "test", ...env } });
  return new Promise((resolve) => {
    http.listen(0, "127.0.0.1", () => {
      const { port } = http.address();
      resolve({
        port,
        url: `ws://127.0.0.1:${port}${PVP_PATH}`,
        async close() {
          pvp.close();
          await new Promise((done) => http.close(done));
        },
      });
    });
  });
}

/** A client that records every message and can await a given type. */
function connect(url, options = {}) {
  const ws = new WebSocket(url, options);
  const inbox = [];
  const waiters = [];
  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());
    inbox.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.type === message.type && waiter.match(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
  });
  return {
    ws,
    inbox,
    open: () => new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    }),
    send: (message) => ws.send(JSON.stringify(message)),
    all: (type) => inbox.filter((m) => m.type === type),
    waitFor(type, match = () => true, timeoutMs = 5000) {
      const existing = inbox.find((m) => m.type === type && match(m));
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
        waiters.push({ type, match, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      });
    },
    close: () => ws.close(),
  };
}

/**
 * Four guests quick-matched into one live 2v2.
 *
 * Returns the clients grouped the way the server grouped them, rather than the
 * way they connected: the server decides who is whose teammate, and a test that
 * assumed the order would be testing its own guess.
 */
async function startTeamMatch(harness) {
  const names = ["ALPHA", "BRAVO", "CHARLIE", "DELTA"];
  const clients = names.map(() => connect(harness.url));
  await Promise.all(clients.map((client) => client.open()));
  await Promise.all(clients.map((client) => client.waitFor("welcome")));

  clients.forEach((client, index) => client.send({ type: "hello", name: names[index] }));
  for (const client of clients) client.send({ type: "queue", kind: "team" });

  const matches = await Promise.all(clients.map((client) => client.waitFor("match", (m) => m.rivals?.length === 2)));
  for (const client of clients) client.send({ type: "ready", ready: true });
  const active = await Promise.all(
    clients.map((client) => client.waitFor("state", (m) => m.phase === "active", 25_000)),
  );

  const seat = clients.map((client, index) => ({ client, match: matches[index] }));
  const teamOf = (index) => seat.filter((entry) => entry.match.team === index);
  const side = (index) => {
    const members = teamOf(index);
    const host = members.find((entry) => entry.match.hostId === entry.match.you.id);
    const guest = members.find((entry) => entry !== host);
    return { host: host.client, guest: guest.client, hostId: host.match.you.id };
  };
  return { clients, matches, roundId: active[0].roundId, alpha: side(0), bravo: side(1) };
}

const world = (roundId, seq, pups = []) => ({
  type: "world",
  seq,
  roundId,
  portalX: 700,
  portalY: 400,
  portalAngle: 0,
  enemies: [],
  enemyBullets: [],
  pups,
});

test("four guests quick-match into two teams of two", async () => {
  const harness = await startHarness();
  try {
    const { clients, matches } = await startTeamMatch(harness);
    assert.deepEqual(matches.map((m) => m.kind), ["team", "team", "team", "team"]);
    assert.deepEqual(matches.map((m) => m.capacity), [4, 4, 4, 4]);
    assert.deepEqual([...new Set(matches.map((m) => m.team))].sort(), [0, 1]);
    for (const match of matches) {
      assert.equal(match.teammates.length, 1, "one pilot shares your arena");
      assert.equal(match.rivals.length, 2, "and two are on the other side of the rift");
      assert.equal(match.difficulty, "easy", "2v2 rules are server-owned");
    }
    for (const client of clients) client.close();
  } finally {
    await harness.close();
  }
});

test("three pilots are not a 2v2 — the queue keeps waiting and says so", async () => {
  const harness = await startHarness();
  try {
    const clients = [connect(harness.url), connect(harness.url), connect(harness.url)];
    await Promise.all(clients.map((client) => client.open()));
    await Promise.all(clients.map((client) => client.waitFor("welcome")));
    for (const client of clients) client.send({ type: "queue", kind: "team" });

    const searching = await clients[0].waitFor("lobby", (m) => m.state === "searching" && m.players === 3);
    assert.equal(searching.needed, 4, "the lobby can honestly say how close it is");
    for (const client of clients) {
      assert.equal(client.all("match").length, 0, "nothing starts with an incomplete roster");
    }
    for (const client of clients) client.close();
  } finally {
    await harness.close();
  }
});

test("each team gets its own arena host", async () => {
  const harness = await startHarness();
  try {
    const { clients, matches } = await startTeamMatch(harness);
    const hosts = new Set(matches.map((m) => m.hostId));
    assert.equal(hosts.size, 2, "two teams, two arenas, two hosts");
    // Both members of a team quote the same host, and it is one of their own.
    for (const team of [0, 1]) {
      const members = matches.filter((m) => m.team === team);
      assert.equal(members[0].hostId, members[1].hostId);
      const ids = members.map((m) => m.you.id);
      assert.ok(ids.includes(members[0].hostId), "a team is hosted from inside itself");
    }
    for (const client of clients) client.close();
  } finally {
    await harness.close();
  }
});

test("a team's loose PUP reaches its teammate and nobody on the other team", async () => {
  const harness = await startHarness();
  try {
    const { clients, roundId, alpha, bravo } = await startTeamMatch(harness);

    alpha.host.send(world(roundId, 1, [
      { pupId: 11, type: "nuke", x: 700, y: 400, vx: 1, vy: 0, life: 800, phase: 0 },
    ]));
    const mine = await alpha.guest.waitFor("world");
    assert.equal(mine.pups.length, 1, "the arena is only shared if the PUPs are");
    assert.equal(mine.pups[0].pupId, 11);
    assert.equal(mine.hostId, alpha.hostId);

    // Drive a full round trip on the other team as well. Once its own snapshot
    // has landed, anything leaking across teams would already have arrived.
    bravo.host.send(world(roundId, 1, [
      { pupId: 11, type: "beam", x: 100, y: 100, vx: 0, vy: 0, life: 800, phase: 0 },
    ]));
    const theirs = await bravo.guest.waitFor("world");
    assert.equal(theirs.hostId, bravo.hostId);
    assert.equal(theirs.pups[0].type, "beam", "the two arenas are genuinely separate worlds");

    assert.equal(bravo.guest.all("world").filter((m) => m.hostId === alpha.hostId).length, 0);
    assert.equal(bravo.host.all("world").length, 0, "a host renders its own arena, not a relay");
    assert.equal(alpha.guest.all("world").filter((m) => m.hostId === bravo.hostId).length, 0);
    for (const client of clients) client.close();
  } finally {
    await harness.close();
  }
});

test("teammates race for one PUP, exactly one wins, and the other team never hears", async () => {
  const harness = await startHarness();
  try {
    const { clients, roundId, alpha, bravo } = await startTeamMatch(harness);
    alpha.host.send(world(roundId, 1, [
      { pupId: 21, type: "beam", x: 700, y: 400, vx: 0, vy: 0, life: 800, phase: 0 },
    ]));
    await alpha.guest.waitFor("world");

    // Both pilots fly onto it and both report touching it.
    alpha.host.send({ type: "position", seq: 1, sentAt: 1, x: 700, y: 400, angle: 0 });
    alpha.guest.send({ type: "position", seq: 1, sentAt: 1, x: 700, y: 400, angle: 0 });
    alpha.host.send({ type: "pup_claim", seq: 1, roundId, pupId: 21 });
    alpha.guest.send({ type: "pup_claim", seq: 1, roundId, pupId: 21 });

    const hostVerdict = await alpha.host.waitFor("pup_taken", (m) => m.pupId === 21 && m.by !== null);
    const guestVerdict = await alpha.guest.waitFor("pup_taken", (m) => m.pupId === 21 && m.by !== null);
    assert.equal(hostVerdict.by, guestVerdict.by, "both pilots must agree who won");
    assert.ok(hostVerdict.by, "somebody has to win the race");

    // The other team is flying its own arena around its own rift, and PUP ids
    // restart from one per host — a verdict crossing over would settle a race
    // nobody there was running.
    assert.equal(bravo.host.all("pup_taken").length, 0);
    assert.equal(bravo.guest.all("pup_taken").length, 0);
    for (const client of clients) client.close();
  } finally {
    await harness.close();
  }
});

test("a payload lands on the rival team, and only their host is told to spawn it", async () => {
  const harness = await startHarness();
  try {
    const { clients, alpha, bravo } = await startTeamMatch(harness);

    alpha.host.send({ type: "inventory", seq: 1, action: "collect", weapon: "nuke" });
    alpha.host.send({ type: "inventory", seq: 2, action: "launch", weapon: "nuke" });
    alpha.host.send({ type: "transmit", seq: 1, weapon: "nuke" });

    const [atHost, atGuest] = await Promise.all([
      bravo.host.waitFor("incoming"),
      bravo.guest.waitFor("incoming"),
    ]);
    assert.equal(atHost.weapon, "nuke");
    assert.equal(atHost.spawn, true, "the rival arena's host spawns the hostile");
    assert.equal(atGuest.spawn, false, "its teammate gets the warning, not a second hostile");
    assert.equal(atGuest.eventId, atHost.eventId, "one payload, one event");

    // The sender's own team sees it leave, and takes no hit for it.
    await alpha.guest.waitFor("state", (m) => m.sent === "nuke");
    assert.equal(alpha.host.all("incoming").length, 0);
    assert.equal(alpha.guest.all("incoming").length, 0);
    for (const client of clients) client.close();
  } finally {
    await harness.close();
  }
});

test("a private 2v2 code seats exactly the four pilots who share it", async () => {
  const harness = await startHarness();
  try {
    const host = connect(harness.url);
    const others = [connect(harness.url), connect(harness.url), connect(harness.url)];
    const stranger = connect(harness.url);
    await Promise.all([host, ...others, stranger].map((client) => client.open()));
    await Promise.all([host, ...others, stranger].map((client) => client.waitFor("welcome")));

    host.send({ type: "create", kind: "team" });
    const waiting = await host.waitFor("lobby", (m) => m.state === "waiting");
    assert.match(waiting.code, /^[A-Z2-9]{4}$/);
    assert.equal(waiting.needed, 4);

    others[0].send({ type: "join", code: waiting.code });
    others[1].send({ type: "join", code: waiting.code });
    await host.waitFor("lobby", (m) => m.state === "waiting" && m.players === 3);
    assert.equal(host.all("match").length, 0, "select must wait for the fourth seat");

    others[2].send({ type: "join", code: waiting.code });
    const seated = await host.waitFor("match");
    assert.equal(seated.kind, "team");
    assert.equal(seated.rivals.length + seated.teammates.length, 3);

    stranger.send({ type: "join", code: waiting.code });
    const refused = await stranger.waitFor("error");
    assert.equal(refused.code, "room_full", "a fifth pilot is not a 2v2");

    for (const client of [host, ...others, stranger]) client.close();
  } finally {
    await harness.close();
  }
});

test("a 1v1 socket is untouched: two pilots, one arena each, no sharing", async () => {
  const harness = await startHarness();
  try {
    const alpha = connect(harness.url);
    const bravo = connect(harness.url);
    await Promise.all([alpha.open(), bravo.open()]);
    await Promise.all([alpha.waitFor("welcome"), bravo.waitFor("welcome")]);
    alpha.send({ type: "queue" });
    bravo.send({ type: "queue" });

    const match = await alpha.waitFor("match", (m) => m.opponent);
    assert.equal(match.kind, "pvp");
    assert.equal(match.capacity, 2);
    assert.deepEqual(match.teammates, [], "a 1v1 pilot is alone in their arena");
    assert.equal(match.rivals.length, 1);

    alpha.send({ type: "ready", ready: true });
    bravo.send({ type: "ready", ready: true });
    await alpha.waitFor("state", (m) => m.phase === "active", 25_000);

    alpha.send({ type: "pup_claim", seq: 1, roundId: 1, pupId: 1 });
    const error = await alpha.waitFor("error");
    assert.equal(error.code, "not_in_match", "1v1 arenas are never shared");
    alpha.close();
    bravo.close();
  } finally {
    await harness.close();
  }
});
