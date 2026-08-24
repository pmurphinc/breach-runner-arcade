import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SHIPS, WEAPONS } from "../app/game-data.ts";
import { PRODUCT_TAGLINE, PRODUCT_TITLE } from "../app/product.ts";

const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
const provenance = fs.readFileSync(new URL("../ASSET_PROVENANCE.md", import.meta.url), "utf8");

const legacyShipNames = [
  "The Tank", "The Wing", "The Squid", "The Turtle", "The Flash", "The Hunter", "The Flagship",
];
const legacyWeaponNames = [
  "HEAT SEEKER", "WORMHOLE TURRET", "WORMHOLE MINES", "SEND UFO", "SEND INFLATOR",
  "SEND MINELAYER", "SEND GUNSHIP", "SEND SCARAB", "SEND NUKE", "SEND WALLCRAWLER",
  "WORMHOLE BEAM", "WORMHOLE EMP", "SEND GHOST-PUD", "SEND ARTILLERY",
];

test("commercial product identity is Breach Runner", () => {
  assert.equal(PRODUCT_TITLE, "Breach Runner");
  assert.equal(PRODUCT_TAGLINE, "Weaponize the rift.");
  assert.match(readme, /^# Breach Runner/m);
  assert.match(readme, /Weaponize the rift\./i);
});

test("commercial fleet display names do not expose the legacy fleet identity", () => {
  const display = SHIPS.map((ship) => `${ship.name} ${ship.special}`).join("\n");
  for (const name of legacyShipNames) assert.doesNotMatch(display, new RegExp(name, "i"));
});

test("commercial weapon display names do not expose the legacy weapon catalog", () => {
  const display = Object.values(WEAPONS).map((weapon) => `${weapon.name} ${weapon.short}`).join("\n");
  for (const name of legacyWeaponNames) assert.doesNotMatch(display, new RegExp(name, "i"));
});

test("public metadata and README do not market the project as a recreation", () => {
  const publicCopy = `${layout}\n${readme}`;
  assert.doesNotMatch(publicCopy, /Centerfleet/i);
  assert.doesNotMatch(publicCopy, /browser recreation/i);
  assert.doesNotMatch(publicCopy, /original downloadable client/i);
});

test("undocumented file audio has a recorded replacement provenance", () => {
  for (const file of ["fire.wav", "explosion.wav", "magic.wav", "thrust.wav"]) {
    assert.match(provenance, new RegExp(file.replace(".", "\\.")));
  }
  assert.match(provenance, /newly generated original waveform/i);
});
