import fs from "node:fs";

function patch(pathname, replacements) {
  const path = new URL(`../${pathname}`, import.meta.url);
  let source = fs.readFileSync(path, "utf8");
  for (const [from, to] of replacements) {
    if (!source.includes(from)) throw new Error(`${pathname} no longer contains expected text: ${from}`);
    source = source.replace(from, to);
  }
  fs.writeFileSync(path, source);
}

patch("tests/pvp-server.test.mjs", [
  [
    "  MAX_DAMAGE_TOTAL_PER_WINDOW,\n  RECONNECT_GRACE_MS,",
    "  MAX_DAMAGE_TOTAL_PER_WINDOW,\n  MAX_PAYLOAD_BYTES,\n  RECONNECT_GRACE_MS,",
  ],
  [
    '  const huge = JSON.stringify({ type: "hello", name: "x".repeat(9000) });',
    '  const huge = JSON.stringify({ type: "hello", name: "x".repeat(MAX_PAYLOAD_BYTES + 1) });',
  ],
]);

patch("tests/pvp-socket.test.mjs", [
  [
    'import { PVP_PATH } from "../server/protocol.mjs";',
    'import { PROTOCOL_VERSION, PVP_PATH } from "../server/protocol.mjs";',
  ],
  [
    "    assert.equal(welcome.version, 1);",
    "    assert.equal(welcome.version, PROTOCOL_VERSION);",
  ],
]);

console.log("Updated stale PvP protocol assertions to shared constants.");
