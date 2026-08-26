import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SHIPS, WEAPONS } from "../app/game-data.ts";
import { PRODUCT_TAGLINE, PRODUCT_TITLE } from "../app/product.ts";

const game = fs.readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const mainMenu = fs.readFileSync(new URL("../app/main-menu.tsx", import.meta.url), "utf8");
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

const legacyVisibleGamePhrases = [
  "WORMHOLE ARCADE",
  "CLIENT-VERIFIED PROTOTYPE",
  "supplied Redux client",
  "BULWARK // 3S IMMUNITY",
  "VECTOR OVERDRIVE // 3S",
  "VIPER GUIDANCE // LAUNCH WITHIN 3S",
  "TURTLE CANNON",
  "PIRANHA ARRAY",
  "A/R FIELD ACTIVE // 3S",
  "HEAT SEEKER COLLISION",
  "INFLATOR COLLISION",
  "SCARAB COLLISION",
  "WALLCRAWLER COLLISION",
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

test("player-facing game copy no longer exposes legacy branding or old ability labels", () => {
  for (const phrase of legacyVisibleGamePhrases) {
    assert.doesNotMatch(game, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.match(game, /src="\/branding\/breach_runner_logo\.webp"/);
  assert.match(game, /alt="Breach Runner"/);
  assert.match(mainMenu, /className="launch-brand-logo"/);
  assert.match(mainMenu, /src="\/branding\/breach_runner_logo\.webp"/);
  // The original-build provenance claim is a commercial-IP record, not player
  // copy. It used to sit in the Mission Intel panel; it belongs in the
  // provenance document, which is where a reviewer would actually look.
  assert.match(provenance, /rendered procedurally by application code/i);
  assert.match(provenance, /player-facing fleet and weapon identity/i);
  assert.doesNotMatch(game, /PROJECT RIFT \/\/ ORIGINAL BUILD/);
});

test("public metadata and README do not market the project as a recreation", () => {
  const publicCopy = `${layout}\n${readme}`;
  assert.doesNotMatch(publicCopy, /Centerfleet/i);
  assert.doesNotMatch(publicCopy, /browser recreation/i);
  assert.doesNotMatch(publicCopy, /original downloadable client/i);
  assert.doesNotMatch(layout, /og\.png/i);
  assert.match(layout, /\/favicon\.ico/);
  assert.match(layout, /\/favicon\.png/);
  assert.match(layout, /\/apple-touch-icon\.png/);
  assert.doesNotMatch(layout, /favicon\.svg/i);
});

test("commercial-use provenance covers replaced audio and current visual identity assets", () => {
  for (const file of ["fire.wav", "explosion.wav", "magic.wav", "thrust.wav"]) {
    assert.match(provenance, new RegExp(file.replace(".", "\\.")));
  }
  assert.match(provenance, /newly generated original waveform/i);
  for (const file of [
    "breach_runner_logo.png",
    "breach_runner_logo.webp",
    "breach_runner_favicon.png",
    "favicon.ico",
    "favicon.png",
    "apple-touch-icon.png",
  ]) {
    assert.match(provenance, new RegExp(`${file.replace(".", "\\.")}[\\s\\S]*Cleared for current project use`, "i"));
  }
  assert.match(provenance, /og\.png[\s\S]*Dormant \/ not cleared/i);
});
