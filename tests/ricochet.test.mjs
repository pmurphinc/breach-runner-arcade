import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const data = readFileSync(new URL("../app/game-data.ts", import.meta.url), "utf8");
const art = readFileSync(new URL("../app/weapon-art.ts", import.meta.url), "utf8");
const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const ricochet = readFileSync(new URL("../app/ricochet.ts", import.meta.url), "utf8");

test("Bankshot Matrix is a non-sendable utility pickup", () => {
  assert.match(data, /PickupId = PowerId[^;]+"ricochet"/);
  assert.doesNotMatch(data.match(/export type PowerId = ([^;]+)/)?.[1] ?? "", /ricochet/);
  const entry = data.slice(data.indexOf("ricochet: {"), data.indexOf("heatseeker: {"));
  assert.match(entry, /name: "BANKSHOT MATRIX"/);
  assert.match(entry, /sendable: false/);
  assert.match(art, /ricochet: bankshotIcon/);
});

test("Weapon Codex includes every intended pickup, including Bankshot Matrix", () => {
  assert.match(data, /CODEX_PICKUPS:[^=]*= \[[\s\S]*\.\.\.SENDABLE_POWERUPS,[\s\S]*\.\.\.INSTANT_PICKUPS,[\s\S]*"ricochet"/);
  assert.match(game, /const CODEX_ORDER:[^=]*= CODEX_PICKUPS/);
  assert.match(game, /CODEX_ORDER\.map/);
  assert.match(data, /ricochet:\s*\{[\s\S]*?name: "BANKSHOT MATRIX"/);
});

test("ricochet is temporary and capped to two wall contacts", () => {
  assert.match(ricochet, /RICOCHET_DURATION_SECONDS = 10/);
  assert.match(ricochet, /RICOCHET_BOUNCES = 2/);
  assert.match(ricochet, /bouncesLeft: bouncesLeft - 1/);
  assert.match(ricochet, /vx: hitX \? -vx : vx/);
  assert.match(ricochet, /vy: hitY \? -vy : vy/);
});

test("only normal player cannon rounds receive and spend bounce charges", () => {
  assert.match(game, /bouncesLeft: player\.ricochetTicks > 0 \? RICOCHET_BOUNCES : 0/);
  assert.match(game, /!bullet\.enemy && !bullet\.special && \(bullet\.bouncesLeft \?\? 0\) > 0/);
  assert.match(game, /reflectRicochet\(/);
});

test("pickup activates a ten-second timer and already-fired rounds keep their own charges", () => {
  assert.match(game, /type === "ricochet"\) player\.ricochetTicks = ticksForSeconds\(RICOCHET_DURATION_SECONDS\)/);
  assert.match(game, /player\.ricochetTicks = Math\.max\(0, player\.ricochetTicks - 1\)/);
  assert.doesNotMatch(ricochet, /life/);
});

test("Bankshot has distinct active and bounce feedback", () => {
  assert.match(game, /BANKSHOT \$\{\(player\.ricochetTicks \* TICK_MS \/ 1000\)\.toFixed\(1\)\}s/);
  assert.match(game, /playCue\("ricochet"/);
  assert.match(game, /const bankshot = !bullet\.special/);
});
