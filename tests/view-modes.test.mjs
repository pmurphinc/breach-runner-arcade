import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const game = await readFile(new URL('../app/game.tsx', import.meta.url), 'utf8');
const settings = await readFile(new URL('../app/view-settings.ts', import.meta.url), 'utf8');
const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');

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


test('touch health rails reserve the complete overlay control stack', () => {
  const controlsOn = css.match(/\.touch-capable\[data-sticks="overlay"\]\[data-touch-controls="on"\] \.health-rails \{[^}]+\}/s)?.[0] ?? '';
  const controlsOff = css.match(/\.touch-capable\[data-sticks="overlay"\]\[data-touch-controls="off"\] \.health-rails \{[^}]+\}/s)?.[0] ?? '';
  assert.match(controlsOn, /var\(--stick\).*var\(--touch-target\)/s,
    'rails must stop above both the stick and utility-button row');
  assert.doesNotMatch(controlsOff, /var\(--stick\)/,
    'hidden sticks must not reserve their old height');
  assert.match(controlsOff, /var\(--touch-target\)/,
    'rails must still clear the compact HUD and utility buttons');
});


test('touch score shares the rules rail and utilities orbit the fire stick', () => {
  assert.match(game, /className="rule-score">SCORE/);
  assert.match(css, /\.touch-capable \.match-bar\s*\{\s*display:\s*none/);
  assert.match(css, /\.touch-capable \.difficulty-badge \.rule-score/);
  const satellites = css.slice(css.indexOf('Three independent circular utility buttons'));
  assert.match(satellites, /\.touch-pup[\s\S]*right:\s*calc\(100% \+ 8px\)/);
  assert.match(satellites, /\.touch-special[\s\S]*right:\s*85%/);
  assert.match(satellites, /\.touch-pause[\s\S]*left:\s*38%/);
  assert.match(satellites, /border-radius:\s*50%/);
});


test('touch frame reaches the viewport and health bars use fighting-game geometry', () => {
  assert.match(game, /bottomOf\("\.pilot-rail small"\)/,
    'the playfield must clear the visible shield-status label');
  assert.match(game, /bottomOf\("\.rival-rail"\)/,
    'the playfield must clear Rival or Opponent health');
  assert.match(game, /className="rail-fill hull-fill" style=\{\{ width:/);
  assert.match(game, /className="rail-fill rival-fill" style=\{\{ width:/);
  const frame = css.slice(css.indexOf('complete remaining viewport as one framed'));
  assert.match(frame, /\.arena-stage[\s\S]*height:\s*calc\(100dvh/);
  assert.match(frame, /\.canvas-wrap[\s\S]*height:\s*100%/);
  const fighterBars = css.slice(css.indexOf('Fighting-game bars attach'));
  assert.match(fighterBars, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(fighterBars, /top:\s*var\(--rules-bottom/);
});

test('special remains radially between PUP and Pause', () => {
  const radial = css.slice(css.indexOf('A true 9\/10\/11 o’clock arc'));
  assert.match(radial, /touch-pup[\s\S]*left:\s*0[\s\S]*top:\s*50%/);
  assert.match(radial, /touch-special[\s\S]*left:\s*-8%[\s\S]*top:\s*17%/);
  assert.match(radial, /touch-pause[\s\S]*left:\s*17%[\s\S]*top:\s*-8%/);
});




test('touch playfield starts below the complete HUD and removes canvas text panels', () => {
  assert.match(game, /const playfieldTop = Math\.ceil\(hudBottom\) \+ 2/);
  assert.match(game, /--arena-canvas-size/);
  const overlay = game.slice(game.indexOf('const drawOverlay'), game.indexOf('// Next weapon in the bin'));
  assert.doesNotMatch(overlay, /WORMHOLE CHARGE|Mission notice|coachLine\(game\)/);
  const reserved = css.slice(css.indexOf('The Touch\/Hybrid HUD occupies a real header lane'));
  assert.match(reserved, /margin:\s*var\(--arena-playfield-top/);
  assert.match(reserved, /border-top:\s*2px/);
});


test('landscape tablets reuse the full arena shell and corner controls', () => {
  const tablet = css.slice(css.indexOf('Landscape tablets use the full existing arena shell'));
  assert.match(tablet, /data-form="tablet"\]\[data-orientation="landscape"/);
  assert.match(tablet, /\.arena-stage\s*\{[\s\S]*?width:\s*100%/);
  assert.match(tablet, /\.touch-flight\s*\{[\s\S]*?bottom:\s*max\(12px,[\s\S]*?left:\s*max\(12px/);
  assert.match(tablet, /\.touch-action\s*\{[\s\S]*?right:\s*max\(12px,[\s\S]*?bottom:\s*max\(12px/);
  assert.doesNotMatch(tablet, /scale|dead.?zone|accel|inertia/i,
    'tablet layout must not alter touch response or gameplay');
});
