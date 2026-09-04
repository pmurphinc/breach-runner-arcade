import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PvpClient } from "../app/pvp-client.ts";
import { migrateSettings, resolveMultiplayerName } from "../app/view-settings.ts";
import { parseClientMessage } from "../server/protocol.mjs";

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances = [];

  constructor() {
    this.readyState = FakeWebSocket.CONNECTING;
    this.frames = [];
    FakeWebSocket.instances.push(this);
  }

  send(frame) { this.frames.push(JSON.parse(frame)); }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
}

function installBrowser() {
  FakeWebSocket.instances = [];
  globalThis.window = { location: { protocol: "https:", host: "example.test" } };
  globalThis.WebSocket = FakeWebSocket;
}

function helloFrom(kind, storedInitials) {
  installBrowser();
  const client = new PvpClient(kind);
  client.connect(resolveMultiplayerName(migrateSettings({ playerInitials: storedInitials }).playerInitials));
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  return { client, socket, hello: socket.frames.at(-1) };
}

test("saved Arcade Identity initials are sent as the preferred PvP name", () => {
  const { hello } = helloFrom("pvp", "mur");
  assert.deepEqual(hello, { type: "hello", name: "MUR" });
});

test("every network mode shares the same persisted identity resolution", () => {
  const pvp = helloFrom("pvp", "abc").hello;
  const coop = helloFrom("coop", "abc").hello;
  const team = helloFrom("team", "abc").hello;
  assert.equal(pvp.name, "ABC");
  assert.equal(coop.name, pvp.name);
  assert.equal(team.name, pvp.name, "a 2v2 pilot is the same pilot");

  // The room kind is the mode: the server already knows "coop" and "team", so
  // only genuinely-unknown modes fall back to a duel.
  const game = fs.readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
  assert.ok(game.includes('new PvpClient(mode === "coop" || mode === "team" ? mode : "pvp", difficulty)'));
  const client = game.indexOf("new PvpClient(");
  const connect = game.indexOf("client.connect(resolveMultiplayerName(settings.playerInitials))", client);
  assert.ok(client > 0 && connect > client, "and one name resolution feeds all of them");
});

test("missing or invalid initials omit the name so the server keeps its guest fallback", () => {
  for (const initials of ["", "A", "!!"]) {
    const { hello } = helloFrom("pvp", initials);
    assert.equal("name" in hello, false);
  }
});

test("client-provided names still pass through server sanitization and limits", () => {
  const parsed = parseClientMessage(JSON.stringify({ type: "hello", name: "<script>MUR</script>123456789" }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.message.name, "scriptMURscript1");
  assert.equal(parsed.message.name.length, 16);

  const rejected = parseClientMessage(JSON.stringify({ type: "hello", name: "!" }));
  assert.equal(rejected.ok, true);
  assert.equal(rejected.message.name, null);
});

test("automatic reconnect retains the preferred name and resume token", () => {
  const { client, socket } = helloFrom("pvp", "MUR");
  socket.onmessage({ data: JSON.stringify({ type: "welcome", name: "GUEST-4821", resume: "resume-token" }) });

  // Exercise the same no-argument connect used by the retry callback.
  socket.readyState = 3;
  client.socket = null;
  client.connect();
  const retry = FakeWebSocket.instances.at(-1);
  retry.open();
  assert.deepEqual(retry.frames.at(-1), { type: "hello", name: "MUR", resume: "resume-token" });
});
