/**
 * End-to-end WebSocket test against the real transport.
 *
 * `pvp-server.test.mjs` drives the state machine directly; this proves the
 * socket layer on top of it — origin policy, framing, and two real clients
 * playing a match to a result over one shared HTTP server, exactly as the
 * single Railway service will serve it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { attachPvpServer } from "../server/pvp.mjs";
import { PROTOCOL_VERSION, PVP_PATH } from "../server/protocol.mjs";

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

test("a guest connects, is named, and is offered the lobby", async () => {
  const harness = await startHarness();
  try {
    const client = connect(harness.url);
    await client.open();
    const welcome = await client.waitFor("welcome");
    assert.match(welcome.name, /^GUEST-\d{4}$/, "guests need no sign-in");
    assert.ok(welcome.resume, "a resume token is issued up front");
    assert.equal(welcome.version, PROTOCOL_VERSION);
    client.close();
  } finally {
    await harness.close();
  }
});

test("upgrades on other paths are left alone", async () => {
  const harness = await startHarness();
  try {
    const stray = new WebSocket(`ws://127.0.0.1:${harness.port}/not-pvp`);
    const outcome = await new Promise((resolve) => {
      stray.on("error", () => resolve("refused"));
      stray.on("open", () => resolve("accepted"));
    });
    assert.equal(outcome, "refused");
  } finally {
    await harness.close();
  }
});

test("a disallowed browser origin is refused", async () => {
  const harness = await startHarness({ NODE_ENV: "production" });
  try {
    const evil = new WebSocket(harness.url, { origin: "https://evil.example" });
    const outcome = await new Promise((resolve) => {
      evil.on("error", () => resolve("refused"));
      evil.on("open", () => resolve("accepted"));
    });
    assert.equal(outcome, "refused", "production must not accept arbitrary origins");
  } finally {
    await harness.close();
  }
});

test("the Breach Runner production origin is accepted in production", async () => {
  const harness = await startHarness({ NODE_ENV: "production" });
  try {
    const client = connect(harness.url, { origin: "https://breachrunner.murphtournaments.com" });
    await client.open();
    await client.waitFor("welcome");
    client.close();
  } finally {
    await harness.close();
  }
});

test("the retired wormhole production origin is refused", async () => {
  const harness = await startHarness({ NODE_ENV: "production" });
  try {
    const legacy = new WebSocket(harness.url, { origin: "https://wormhole.murphtournaments.com" });
    const outcome = await new Promise((resolve) => {
      legacy.on("error", () => resolve("refused"));
      legacy.on("open", () => resolve("accepted"));
    });
    assert.equal(outcome, "refused", "the retired production hostname must not remain trusted");
  } finally {
    await harness.close();
  }
});

test("two guests quick-match, ready up, and fight to a hull victory", async () => {
  const harness = await startHarness();
  try {
    const alpha = connect(harness.url);
    const bravo = connect(harness.url);
    await Promise.all([alpha.open(), bravo.open()]);
    await Promise.all([alpha.waitFor("welcome"), bravo.waitFor("welcome")]);

    alpha.send({ type: "hello", name: "ALPHA" });
    bravo.send({ type: "hello", name: "BRAVO" });
    alpha.send({ type: "queue" });
    bravo.send({ type: "queue" });

    const [matchA, matchB] = await Promise.all([
      alpha.waitFor("match"),
      bravo.waitFor("match"),
    ]);
    assert.equal(matchA.opponent.name, "BRAVO");
    assert.equal(matchB.opponent.name, "ALPHA");

    alpha.send({ type: "ship", ship: "wing" });
    bravo.send({ type: "ship", ship: "squid" });
    alpha.send({ type: "ready", ready: true });
    bravo.send({ type: "ready", ready: true });

    const countdown = await alpha.waitFor("countdown");
    assert.equal(countdown.seconds, 3);

    // The sweep drives the countdown to activation.
    const active = await alpha.waitFor("state", (m) => m.you && m.you.hull > 0, 25_000);
    assert.equal(active.you.maxHull, 175, "wing hull");
    assert.equal(active.opponent.maxHull, 170, "squid hull");
    assert.equal(active.you.shieldPct, 100);

    // A transmission must reach only the opponent.
    alpha.send({ type: "inventory", seq: 1, action: "collect", weapon: "nuke" });
    alpha.send({ type: "inventory", seq: 2, action: "launch", weapon: "nuke" });
    alpha.send({ type: "transmit", seq: 1, weapon: "nuke" });
    const incoming = await bravo.waitFor("incoming");
    assert.equal(incoming.weapon, "nuke");
    assert.equal(incoming.from, "ALPHA");
    assert.equal(alpha.inbox.filter((m) => m.type === "incoming").length, 0);

    // Collisions spend BRAVO's shield without touching hull.
    bravo.send({ type: "damage", seq: 1, source: "collision", amount: 20 });
    const shielded = await bravo.waitFor("state", (m) => m.you?.shieldPct === 50);
    assert.equal(shielded.you.hull, 170, "collision must not reach hull while shielded");

    // Grind BRAVO's hull to zero with weapon damage, respecting the rate cap.
    let seq = 2;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      bravo.send({ type: "damage", seq: seq++, source: "impact", amount: 50 });
      const latest = bravo.inbox.filter((m) => m.type === "state").pop();
      if (latest?.you?.hull === 0) break;
      await new Promise((r) => setTimeout(r, 260));
    }

    const [defeat, victory] = await Promise.all([
      bravo.waitFor("result"),
      alpha.waitFor("result"),
    ]);
    assert.equal(defeat.outcome, "defeat");
    assert.equal(victory.outcome, "victory");
    assert.equal(victory.reason, "hull", "PvP is decided by pilot hull");

    alpha.close();
    bravo.close();
  } finally {
    await harness.close();
  }
});

test("a private code pairs exactly the two players who share it", async () => {
  const harness = await startHarness();
  try {
    const host = connect(harness.url);
    const guest = connect(harness.url);
    const stranger = connect(harness.url);
    await Promise.all([host.open(), guest.open(), stranger.open()]);

    host.send({ type: "create" });
    const waiting = await host.waitFor("lobby", (m) => m.state === "waiting");
    assert.match(waiting.code, /^[A-Z2-9]{6}$/);

    stranger.send({ type: "join", code: "ZZZZZZ" });
    const rejected = await stranger.waitFor("error");
    assert.equal(rejected.code, "unknown_room");

    guest.send({ type: "join", code: waiting.code });
    const matched = await guest.waitFor("match");
    assert.ok(matched.opponent, "the code holder is paired");

    host.close();
    guest.close();
    stranger.close();
  } finally {
    await harness.close();
  }
});

test("a malformed frame draws an error, not a crash", async () => {
  const harness = await startHarness();
  try {
    const client = connect(harness.url);
    await client.open();
    await client.waitFor("welcome");

    client.ws.send("this is not json");
    const error = await client.waitFor("error");
    assert.equal(error.code, "bad_message");

    // The socket must still be usable afterwards.
    client.send({ type: "hello", name: "STILLHERE" });
    const lobby = await client.waitFor("lobby");
    assert.equal(lobby.name, "STILLHERE");
    client.close();
  } finally {
    await harness.close();
  }
});
