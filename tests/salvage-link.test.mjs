import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isSalvageLinkCannon, salvageLinkHitsPup } from "../app/salvage-link.ts";

const linked = { x: 100, y: 100, enemy: false, salvageLinked: true };

test("only a linked Kestrel normal cannon round can touch a loose PUP", () => {
  assert.equal(salvageLinkHitsPup("kestrel", linked, { x: 110, y: 100 }), true);
  assert.equal(salvageLinkHitsPup("kestrel", { ...linked, salvageLinked: false }, { x: 110, y: 100 }), false);
  assert.equal(salvageLinkHitsPup("wing", linked, { x: 110, y: 100 }), false);
  assert.equal(isSalvageLinkCannon("kestrel", { ...linked, enemy: true }), false);
  assert.equal(isSalvageLinkCannon("kestrel", { ...linked, special: true }), false);
  assert.equal(salvageLinkHitsPup("kestrel", linked, { x: 140, y: 100 }), false, "link is contact, not a magnet");
});

test("gameplay uses one pickup resolver and consumes a linked round after its first hit", () => {
  const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
  assert.match(game, /type PickupCollectionSource = "physical" \| "salvage-link"/);
  assert.match(game, /const collected = resolvePlayerPickup\(game, pickup, "salvage-link"\);[\s\S]{0,220}bullet\.life = 0/);
  assert.match(game, /if \(pupCollected\(pickup, player\)\) \{\s*resolvePlayerPickup\(game, pickup, "physical"\);/);
  assert.match(game, /reportInventory\("collect", type\)/);
  assert.doesNotMatch(game, /reportInventory\("collect", type,\s*game\.stock\.length/);
});

test("full-bin handling consumes physical PUPs but preserves remotely hit PUPs", () => {
  const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
  const resolver = game.slice(game.indexOf("const resolvePlayerPickup ="), game.indexOf("Burns Phantom's lance"));
  assert.match(resolver, /game\.stock\.length >= STOCK_LIMIT/);
  assert.match(resolver, /if \(source === "physical"\) pickup\.life = 0/);
  assert.doesNotMatch(resolver, /source === "salvage-link"[^\n]*pickup\.life = 0/);
  assert.match(resolver, /playCue\("inventory-full", 0\.2\);\s*return false/);
});

test("successful payloads and instant upgrades share identical resolution after the source check", () => {
  const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
  const resolver = game.slice(game.indexOf("const resolvePlayerPickup ="), game.indexOf("Burns Phantom's lance"));
  assert.match(resolver, /pickup\.life = 0;\s*game\.score \+= 50/);
  for (const effect of ["gun", "thrust", "retros", "shield", "clear", "health", "ricochet"]) {
    assert.match(resolver, new RegExp(`type === "${effect}"`), `${effect} still uses the shared resolver`);
  }
  assert.match(resolver, /game\.stock\.push\(type\)/, "successful payload collection still enters normal inventory");
});

test("linked cannon handling preserves the existing enemy and Rift damage values", () => {
  const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
  assert.match(game, /game\.portalCharge \+= bullet\.damage/);
  assert.match(game, /damageEnemy\(game, enemy, bullet\.damage\)/);
  assert.match(game, /bullet\.special \? "overcharge" : "cannon"/);
  assert.match(game, /game\.pickups\.find\([^\n]+salvageLinkHitsPup/);
});
