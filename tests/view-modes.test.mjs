import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const game = await readFile(new URL('../app/game.tsx', import.meta.url), 'utf8');
const settings = await readFile(new URL('../app/view-settings.ts', import.meta.url), 'utf8');

test('view modes are explicit, typed, and versioned', () => {
  assert.match(settings, /type ViewMode = "touch" \| "pc" \| "hybrid"/);
  assert.match(settings, /wormhole-arcade:settings:v1/);
  assert.match(settings, /viewMode: null/);
  assert.doesNotMatch(game.slice(game.indexOf('label="VIEW MODE"'), game.indexOf('label="CAMERA LOCK"')), /AUTO/);
});

test('first launch requires an explicit choice', () => {
  assert.match(game, /if \(!viewMode\)/);
  assert.match(game, /Choose Your View/);
  assert.match(game, /settingsStore\.update\(\{ viewMode: mode \}\)/);
});

test('menus expose only requested setting groups', () => {
  const display = game.slice(game.indexOf('id="menu-panel-display"'), game.indexOf('id="menu-panel-controls"'));
  assert.match(display, /VIEW MODE/);
  assert.match(display, /CAMERA LOCK/);
  assert.doesNotMatch(display, /SCREEN FIT|RENDER QUALITY|FULLSCREEN|SHELL/);
  const controls = game.slice(game.indexOf('id="menu-panel-controls"'), game.indexOf('id="menu-panel-info"'));
  for (const label of ['SOUND', 'THUMBSTICKS', 'TOUCH CONTROL SIZE']) assert.match(controls, new RegExp(label));
  assert.match(game, /role="switch" aria-checked=\{value\}/);
  assert.match(game, /Available in Touch or Hybrid view/);
});

test('view profile owns HUD and canvas queue behavior', () => {
  assert.match(settings, /canvasQueue: false/);
  assert.match(settings, /pc: .*fullInventory: true.*canvasQueue: true/);
  assert.match(game, /viewProfileRef\.current\.canvasQueue/);
  assert.match(game, /viewProfile\.verticalRails/);
  assert.match(game, /data-view-mode=\{viewMode\}/);
});


test('canvas renderer starts after first-launch view selection', () => {
  const renderer = game.slice(
    game.indexOf('const canvas = canvasRef.current'),
    game.indexOf('const currentShip = selectedShip')
  );
  assert.match(renderer, /\[play, sync, viewMode\]/,
    'the render effect must rerun after the chooser mounts the canvas');
});
