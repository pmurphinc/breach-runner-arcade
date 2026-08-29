import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { RIFT_LABEL, drawRiftLabel, riftLabelCharacterTransform } from "../app/rift-label-fx.ts";
import { victoryVisualState, VICTORY_TIMING, VICTORY_TOTAL_SECONDS } from "../app/victory-sequence.ts";

const TICK_MS = 1000 / 60;
const remainingAt = (elapsedSeconds) => Math.round(VICTORY_TOTAL_SECONDS * 1000 / TICK_MS) - Math.round(elapsedSeconds * 1000 / TICK_MS);
const visualAt = (phase, progress) => {
  const starts = { freeze: 0, pull: VICTORY_TIMING.freezeSeconds, collapse: VICTORY_TIMING.freezeSeconds + VICTORY_TIMING.pullSeconds, blast: VICTORY_TIMING.freezeSeconds + VICTORY_TIMING.pullSeconds + VICTORY_TIMING.collapseSeconds };
  return victoryVisualState(remainingAt(starts[phase] + VICTORY_TIMING[`${phase}Seconds`] * progress), TICK_MS);
};
const transform = (index, visual, reduced = false) => riftLabelCharacterTransform(index, 80 + index * 7, 182, 110, 100, visual, reduced);

test("normal label state is intact and retains the canonical text", () => {
  assert.equal(RIFT_LABEL, "RIVAL RIFT");
  assert.deepEqual(transform(2, null), { x: 94, y: 182, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 });
  const calls = [];
  drawRiftLabel({ fillText: (...args) => calls.push(args) }, 110, 182, 110, 100, null, false);
  assert.deepEqual(calls, [["RIVAL RIFT", 110, 182]]);
});

test("label reactions derive directly from each existing victory phase", () => {
  for (const phase of ["freeze", "pull", "collapse", "blast"]) assert.equal(visualAt(phase, 0.5).phase, phase);
  const freeze = transform(2, visualAt("freeze", 0.8));
  assert.ok(freeze.opacity === 1 && freeze.scaleX > 0.98, "freeze stays substantially intact");
  const pull = transform(2, visualAt("pull", 0.8));
  assert.ok(pull.y < 182 && pull.scaleX < 1 && pull.opacity > 0.9, "pull remains readable while moving inward");
  const collapse = transform(2, visualAt("collapse", 0.9));
  assert.ok(collapse.y < pull.y && collapse.scaleX < 0.2 && collapse.opacity < 0.1, "collapse destroys the intact label");
});

test("blast separates characters with deterministic transforms and fading opacity", () => {
  const early = visualAt("blast", 0.2);
  const late = visualAt("blast", 0.8);
  assert.deepEqual(transform(1, late), transform(1, late));
  assert.notDeepEqual(transform(1, late), transform(2, late));
  assert.ok(transform(1, late).opacity < transform(1, early).opacity);
  assert.notEqual(transform(1, late).rotation, 0);
});

test("reduced motion collapses and fades without large flying-letter movement", () => {
  const blast = visualAt("blast", 0.6);
  const full = transform(4, blast);
  const reduced = transform(4, blast, true);
  const origin = { x: 108, y: 182 };
  assert.ok(Math.hypot(reduced.x - origin.x, reduced.y - origin.y) <= 8);
  assert.ok(Math.hypot(full.x - origin.x, full.y - origin.y) > 20);
  assert.equal(reduced.rotation, 0);
});

test("canvas integration uses camera-derived Rift coordinates and no independent timer", async () => {
  const game = await readFile(new URL("../app/game.tsx", import.meta.url), "utf8");
  assert.match(game, /const portalX = \(game\.portalX \* camera\.camScale \+ camera\.camX\)/);
  assert.match(game, /drawRiftLabel\([\s\S]*?portalX,[\s\S]*?portalY,[\s\S]*?victoryVisualState\(game\.victorySequence, TICK_MS\)/);
  const helper = await readFile(new URL("../app/rift-label-fx.ts", import.meta.url), "utf8");
  assert.doesNotMatch(helper, /setTimeout|setInterval|requestAnimationFrame|Math\.random/);
});
