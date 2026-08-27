import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { WEAPONS } from "../app/game-data.ts";
import {
  PUP_PICKUP_SOUND_PROFILES,
  pupPickupSoundProfile,
} from "../app/pup-audio.ts";

const game = await readFile(new URL("../app/game.tsx", import.meta.url), "utf8");
const PUP_CLASSES = ["payload", "upgrade", "recovery", "rare"];

test("every PupClass resolves to one short pickup sound profile", () => {
  assert.deepEqual(Object.keys(PUP_PICKUP_SOUND_PROFILES).sort(), [...PUP_CLASSES].sort());
  for (const pupClass of PUP_CLASSES) {
    const profile = pupPickupSoundProfile(pupClass);
    assert.equal(profile, PUP_PICKUP_SOUND_PROFILES[pupClass]);
    assert.equal(profile.id, `pup-pickup:${pupClass}`);
    assert.ok(profile.duration >= 0.1 && profile.duration <= 0.4);
  }
});

test("the four classes have distinct audible profiles", () => {
  const signatures = PUP_CLASSES.map((pupClass) => {
    const { frequencies, duration, gap, type } = pupPickupSoundProfile(pupClass);
    return JSON.stringify({ frequencies, duration, gap, type });
  });
  assert.equal(new Set(signatures).size, PUP_CLASSES.length);
});

test("pickup sound selection is class-driven rather than keyed by PUP ID", () => {
  assert.match(game, /playPupPickupSound\(WEAPONS\[pickup\.type\]\.pupClass\)/);
  for (const id of Object.keys(WEAPONS)) {
    assert.doesNotMatch(game, new RegExp(`playPupPickupSound\\([^\\n]*["']${id}["']`));
  }
});

test("class pickup cues use the existing muted Web Audio path", () => {
  const cueBody = game.slice(game.indexOf("const playCue ="), game.indexOf("const playPupPickupSound ="));
  assert.match(cueBody, /if \(!soundRef\.current \|\| typeof window === "undefined"\) return/);
  assert.match(cueBody, /context\.resume\(\)/);
  const pickupCueBody = game.slice(game.indexOf("const playPupPickupSound ="), game.indexOf("Continuous victory riser"));
  assert.match(pickupCueBody, /SOUND_GAIN\[soundLevelRef\.current\]/);
});

test("one loose-PUP collection plays one class cue and no old generic cue", () => {
  const collection = game.slice(game.indexOf("if (pupCollected(pickup, player))"), game.indexOf("const coopNetwork"));
  assert.equal(collection.match(/playPupPickupSound\(/g)?.length, 1);
  assert.doesNotMatch(collection, /play\("magic"/);
  assert.doesNotMatch(collection, /playCue\("shield-pickup"/);
});
