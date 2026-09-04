import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { DEFAULT_ARENA } from '../app/arena.ts';

const game = await readFile(new URL('../app/game.tsx', import.meta.url), 'utf8');
const menu = await readFile(new URL('../app/main-menu.tsx', import.meta.url), 'utf8');
const routes = await readFile(new URL('../app/menu-routes.ts', import.meta.url), 'utf8');
const systemControls = await readFile(new URL('../app/system-controls.tsx', import.meta.url), 'utf8');

/**
 * Source with comments removed.
 *
 * These assertions are about what the code does, not about what the comments
 * say. A comment explaining why the first-launch gate was removed must not be
 * read as evidence that it is still there.
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const gameCode = stripComments(game);
const settings = await readFile(new URL('../app/view-settings.ts', import.meta.url), 'utf8');
const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
const arenaHudCss = await readFile(new URL('../app/arena-hud.css', import.meta.url), 'utf8');

test('view modes are explicit, typed, and versioned', () => {
  assert.match(settings, /type ViewMode = "touch" \| "pc" \| "hybrid"/);
  assert.match(settings, /wormhole-arcade:settings:v1/);
  assert.match(settings, /viewMode: null/);
  assert.match(settings, /playerInitials: ""/);
  assert.match(settings, /soundLevel/);
});

test('first launch infers the view instead of blocking on a chooser', () => {
  // The old gate rendered a "Choose Your View" screen and nothing else until
  // the player answered, so the game never mounted on first visit — which is
  // what broke every browser test on main. Capability answers it instead.
  assert.doesNotMatch(gameCode, /Choose Your View/);
  assert.doesNotMatch(gameCode, /if \(!viewMode\)/);
  assert.doesNotMatch(gameCode, /choose-shell/);
  assert.match(game, /resolveViewMode\(settings\.viewMode, capability\)/);
  assert.match(settings, /export function resolveViewMode/);
  assert.match(settings, /export function inferViewMode/);
  // Capability is subscribed, not sniffed: no user-agent, no device lists.
  assert.match(settings, /capabilityStore/);
  assert.doesNotMatch(settings, /userAgent/);
});

test('the menu is one navigation stack rather than independent booleans', () => {
  assert.match(routes, /export type MenuStack/);
  assert.match(routes, /export function menuButtonTarget/);
  assert.match(game, /const \[menu, setMenu\] = useState<MenuStack>\(INITIAL_STACK\)/);
  // The screens these replaced must be gone, not merely unused.
  for (const dead of ['setStage', 'lobbyOpen', 'boardOpen', 'MissionSetup', 'SettingsDrawer', 'ViewChooser']) {
    assert.doesNotMatch(gameCode, new RegExp(`\\b${dead}\\b`), `${dead} should be removed`);
  }
});

test('Menu and Fullscreen are one global layer above every screen', () => {
  // Exactly one implementation, rendered once.
  assert.equal((game.match(/<GlobalSystemControls/g) ?? []).length, 1);
  assert.match(systemControls, /className="system-controls"/);
  // Fullscreen state is observed, never assumed from the request resolving.
  assert.match(systemControls, /fullscreenchange/);
  assert.match(systemControls, /webkitfullscreenchange/);
  assert.match(systemControls, /fullscreenEnabled/);
  assert.match(systemControls, /Exit Fullscreen/);
  // The layer outranks every other layer, and screens sit below it.
  assert.match(css, /--z-system:\s*400/);
  assert.match(css, /\.system-controls\s*\{[^}]*z-index:\s*var\(--z-system\)/s);
  assert.match(css, /\.menu-screen\s*\{[^}]*z-index:\s*var\(--z-screen\)/s);
  // Safe-area insets on all four sides of the layer's own box.
  assert.match(css, /\.system-controls\s*\{[^}]*var\(--safe-top\)[^}]*var\(--safe-right\)/s);
});

test('the alpha build marker is passive and belongs to the logo lockup', () => {
  assert.equal((game.match(/<BuildWatermark\s*\/>/g) ?? []).length, 1);
  const brandRow = game.slice(game.indexOf('className="brand-row"'), game.indexOf('className="brand-home"'));
  assert.match(brandRow, /className="brand-logo"/);
  assert.match(brandRow, /<BuildWatermark\s*\/>/);
  assert.doesNotMatch(game.slice(game.indexOf('</header>')), /<BuildWatermark\s*\/>/);
  assert.match(systemControls, /className="build-watermark"/);
  assert.match(systemControls, /aria-hidden="true"/);
  assert.match(systemControls, />\s*ALPHA BUILD\s*</);
  assert.match(css, /\.brand-row\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center/s);
  assert.match(css, /\.build-watermark\s*\{[^}]*pointer-events:\s*none[^}]*user-select:\s*none/s);
  assert.doesNotMatch(css, /\.build-watermark\s*\{[^}]*(?:position:\s*fixed|right:)/s);

  // The branding adjustment never replaces or modifies either global control.
  assert.match(systemControls, /className="system-button system-menu"/);
  assert.match(systemControls, /className="system-button system-fullscreen"/);
});

test('settings are consolidated into Controls, Audio, Video, HUD and Game Info tabs', () => {
  const settingsScreen = menu.slice(menu.indexOf('export function SettingsScreen'), menu.indexOf('export function InfoScreen'));
  for (const group of ['Controls', 'Audio', 'Video', 'HUD', 'Game Info']) {
    assert.match(settingsScreen, new RegExp(`title="${group}"`));
  }
  for (const label of ['Thumbsticks', 'Touch control size', 'Sound', 'Volume', 'Perspective', 'Zoom']) {
    assert.match(settingsScreen, new RegExp(label));
  }
  // Fullscreen must never live only in Settings — it is a global control.
  assert.doesNotMatch(settingsScreen, /Fullscreen/);
  const ui = readFileSync(new URL('../app/ui-system.tsx', import.meta.url), 'utf8');
  assert.match(ui, /role="switch"/);
});

test('Settings Game Info renders the shared canonical reference without focus clutter', () => {
  const shared = menu.slice(menu.indexOf('export function GameInfoContent'), menu.indexOf('export type MenuCallbacks'));
  const settingsScreen = menu.slice(menu.indexOf('export function SettingsScreen'), menu.indexOf('export function InfoScreen'));
  const infoScreen = menu.slice(menu.indexOf('export function InfoScreen'), menu.indexOf('export function PauseScreen'));

  assert.match(settingsScreen, /activeTab === "gameInfo" \? <MenuSection title="Game Info">[\s\S]*?<GameInfoContent viewMode=\{viewMode\}/);
  assert.doesNotMatch(settingsScreen, /Game information remains available/);
  for (const section of ['How to Play', 'Game Modes', 'Rift', 'PUPs', 'Ships &amp; Specials']) {
    assert.match(shared, new RegExp(`title="${section}"`));
  }

  // PUP names, classes and effects and ship roles/specials remain owned by
  // their canonical gameplay/presentation records rather than copied here.
  assert.match(menu, /import \{ WEAPONS, type PickupId, type PupClass/);
  assert.match(shared, /Object\.values\(WEAPONS\)/);
  assert.match(shared, /PUP_CLASS_LABELS\[pup\.pupClass\]/);
  assert.match(shared, /pup\.summary/);
  assert.match(shared, /pup\.role/);
  assert.match(shared, /<MenuPupPreview pup=\{pup\.id\}/);
  assert.match(shared, /<MenuShipPreview ship=\{id\} size=\{96\} animated=\{false\}/);
  assert.match(shared, /SHIP_ORDER\.map/);
  assert.match(shared, /SHIP_PROFILES\[id\]/);
  assert.match(shared, /ship\.special\.description/);
  assert.match(shared, /MODE_ORDER\.map/);
  assert.match(shared, /MODE_INFO\[id\]/);
  assert.match(shared, /DIFFICULTY_ORDER\.map/);
  assert.match(shared, /difficultyBlurb\(id\)/);

  // Main menu and Settings share the same component; only main menu adds
  // optional navigation buttons. The reference cards remain non-interactive.
  assert.match(infoScreen, /<GameInfoContent viewMode=\{viewMode\}/);
  assert.doesNotMatch(shared, /<button|tabIndex=|role="button"/);
});

test('Settings owns vertical Game Info scrolling without narrow horizontal overflow', () => {
  assert.match(css, /\.menu-screen\[data-route="settings"\] \.menu-content\s*\{[^}]*overflow:\s*hidden[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\)/s);
  assert.match(css, /\.settings-tab-panel\s*\{[^}]*min-width:\s*0[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.game-info-grid\s*\{[^}]*minmax\(min\(220px, 100%\), 1fr\)/s);
  assert.match(css, /\.game-info-card\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/s);
});

test('initials are a remembered device identity with no Discord prompt', () => {
  const settingsScreen = menu.slice(menu.indexOf('export function SettingsScreen'), menu.indexOf('export function InfoScreen'));
  // The lock/save region, bounded by the action row that follows it. Anchoring
  // on death-info tied this to where the final-event card happened to sit.
  const summary = game.slice(
    game.indexOf('{summary.awaitingInitials ? ('),
    game.indexOf('aria-label="End game actions"')
  );
  assert.match(settingsScreen, /menu-player-initials/);
  assert.match(settingsScreen, /Used automatically for future scores/);
  assert.match(settings, /playerInitials: normalizePlayerInitials/);
  assert.match(summary, /type="submit".*LOCK SCORE/);
  assert.match(summary, /SCORE LOCKED/);
  assert.doesNotMatch(game, /SAVE WITH DISCORD|discordSignInUrl|signInToSave/);
});

test('all completed games expose the same core actions after score lock', () => {
  const start = game.indexOf('aria-label="End game actions"');
  const actions = game.slice(start, game.indexOf('</section>', start));
  for (const label of ['RUN AGAIN', 'CHANGE SHIP', 'CHANGE GAME MODE']) {
    assert.match(actions, new RegExp(label));
  }
  assert.match(actions, /LOCK SCORE TO CONTINUE/);
  assert.match(actions, /disabled=\{summary\.awaitingInitials/);
  assert.doesNotMatch(css, /\.run-links\.locked\s*\{\s*display:\s*none/);
  assert.match(css, /\.run-links button:disabled/);
});

test('the initials keyboard cannot reclassify the touch layout', () => {
  const measurement = game.slice(game.indexOf('const measure = () =>'), game.indexOf('coarsePointer.addEventListener'));
  assert.match(measurement, /dataset\.initialsEditing === "true"/);
  assert.match(game, /onFocus=\{beginInitialsEditing\}/);
  assert.match(game, /onBlur=\{finishInitialsEditing\}/);
});

test('view profiles separate input capabilities from the canonical modern HUD', () => {
  assert.match(settings, /pc: \{ mouseKeyboardPrimary: true, touch: false, thumbsticks: false, modernHud: true \}/);
  assert.match(settings, /touch: \{ mouseKeyboardPrimary: false, touch: true, thumbsticks: true, modernHud: true \}/);
  assert.match(settings, /hybrid: \{ mouseKeyboardPrimary: true, touch: true, thumbsticks: true, modernHud: true \}/);
  assert.doesNotMatch(settings, /pcHud|canvasQueue|fullInventory|compactPowerups|verticalRails/);
  assert.match(game, /const touchCapable = viewProfile\.touch/);
  assert.match(game, /const immersive = viewProfile\.modernHud/);
  assert.match(game, /viewProfile\.modernHud && !settings\.compactHud \? <div className="health-rails"/);
  assert.match(game, /className=\{`app-shell modern-hud/);
  assert.match(game, /\{touchCapable \? <div className="touch-controls"/);
  assert.match(game, /data-view-mode=\{viewMode\}/);
});

test('phone portrait reserves measured HUD and control rows around a flexible arena', () => {
  assert.match(game, /phonePortrait[\s\S]*bottomOf\("\.touch-powerup-hud"\)/);
  // Bounded by the effect's own cleanup. Anchored on `observer.disconnect()`
  // rather than a whole return statement so that adding another observer to the
  // same effect does not silently widen this slice to the rest of the file —
  // which is what a stricter anchor did when the swap watcher landed.
  const observerAt = game.indexOf('const observer = new ResizeObserver(measure)');
  const cleanupAt = game.indexOf('observer.disconnect()', observerAt);
  assert.ok(observerAt > 0 && cleanupAt > observerAt, 'the geometry observer and its cleanup are both here');
  const geometryObserver = game.slice(observerAt, cleanupAt);
  assert.doesNotMatch(geometryObserver, /pup-notice-stack/,
    'temporary notices must not participate in HUD measurement or renderer resize');
  assert.match(arenaHudCss, /--portrait-control-deck:[^;]*var\(--stick\)[^;]*var\(--touch-lift/);
  // The deck the arena reserves and the deck the thumbsticks actually sit in
  // have to be the same one, or the control height moves only the budget.
  assert.match(
    arenaHudCss,
    /data-orientation="portrait"\] \.touch-controls \{[^}]*bottom:[^;]*var\(--touch-lift/s,
    'portrait sticks must honour the Low/Middle/High lift, not just reserve for it'
  );
  // --arena-playfield-top is published on .canvas-wrap, so the derived offset
  // has to be declared there too; declared on the shell it resolves to its own
  // fallback and the arena stops tracking the measured HUD.
  assert.match(
    arenaHudCss,
    /data-orientation="portrait"\] \.canvas-wrap \{[^}]*--portrait-arena-top:\s*calc\(var\(--arena-playfield-top/s
  );
  const portraitCanvas = arenaHudCss.match(/data-orientation="portrait"\] \.canvas-wrap > canvas \{.+?\n\}/s)?.[0] ?? '';
  assert.match(portraitCanvas, /top:\s*var\(--portrait-arena-top\)/);
  // A canvas is a replaced element: `top` plus `bottom` with an automatic
  // height keeps its intrinsic ratio and drops `bottom`, which is what left a
  // dead strip above the sticks. The height has to be stated.
  assert.match(
    portraitCanvas,
    /height:\s*calc\(100% - var\(--portrait-arena-top\) - var\(--portrait-control-deck\)\)/
  );
  assert.doesNotMatch(portraitCanvas, /^\s*height:\s*auto;/m);
});

test('phone controls use one bounded proportional scale without changing their orbit', () => {
  const portrait = arenaHudCss.slice(arenaHudCss.indexOf('One proportional scale controls'));
  assert.match(game, /"--touch-control-scale": layout\.form === "phone"[\s\S]*Math\.max\(\.72,[\s\S]*layout\.usableWidth/);
  assert.match(portrait, /--stick:\s*calc\(var\(--touch-base-stick\) \* var\(--touch-control-scale\)\)/);
  assert.match(portrait, /--satellite:\s*calc\(52px \* var\(--touch-control-scale\)\)/);
  assert.match(portrait, /--control-space:\s*calc\(8px \* var\(--touch-control-scale\)\)/);
  assert.match(portrait, /button::before[\s\S]*44px/,
    'shrunk graphics retain an invisible 44px hit surface');
});

test('landscape camera safe inset comes only from permanent HUD geometry', () => {
  assert.match(game, /--camera-safe-top[\s\S]*healthBottom[\s\S]*bottomOf\("\.touch-powerup-hud"\)/);
  assert.match(game, /cameraSafeTop = safeTopCss \* VIEW_WIDTH \/ cssWidth/);
  assert.match(game, /const focalTop = cssWidth > cssHeight \? Math\.min\(renderViewHeight \* \.42, cameraSafeTop\) : 0/);
  assert.doesNotMatch(game.match(/--camera-safe-top[^\n]+/)?.[0] ?? '', /pup-notice/);
});

test('phone HUD cards and inventory use constrained responsive grids', () => {
  assert.match(arenaHudCss, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(arenaHudCss, /\.health-rail \{[^}]*min-width:\s*0[^}]*overflow:\s*hidden/s);
  // Slot count comes from the shared payload ceiling, not a literal.
  assert.match(arenaHudCss, /grid-template-columns:\s*repeat\(var\(--pup-stored-slots, 4\), minmax\(0, 1fr\)\)/);
  assert.match(arenaHudCss, /grid-template-columns:\s*minmax\(0, 1fr\) clamp\(128px, 33vw, 146px\)/);
});


test('victory suction audio rises during pull and stops before the blast', () => {
  const audio = game.slice(game.indexOf('const playVictorySuction'), game.indexOf('const sync'));
  assert.match(audio, /remainingSeconds - 0\.06/);
  assert.match(audio, /frequency\.exponentialRampToValueAtTime\(VICTORY_SUCTION_FREQUENCY\.endHz/);
  assert.match(audio, /filter\.frequency\.exponentialRampToValueAtTime\(6200, end\)/);
  const sequence = game.slice(game.indexOf('if \(game\.victorySequence > 0\)'), game.indexOf('game\.cycles \+= 1'));
  assert.match(sequence, /victorySuctionState/);
  assert.match(sequence, /suction\.active[\s\S]*playVictorySuction\(suction\.frequencyHz, suction\.remainingSeconds\)/);
  assert.match(sequence, /!suction\.active[\s\S]*stopVictorySuction/);
});

test('canvas renderer follows the resolved view without a first-launch gate', () => {
  const renderer = game.slice(
    game.indexOf('const canvas = canvasRef.current'),
    game.indexOf('const currentShip = selectedShip')
  );
  assert.match(renderer, /\[[^\]]*\bviewMode\b[^\]]*\]/,
    'the render effect must follow the automatically resolved or saved view mode');
  assert.match(game, /No first-launch gate/);
  assert.match(game, /`viewMode` always resolves/);
  assert.doesNotMatch(game, /ViewChooser|firstLaunch|setViewModeChosen/);
});


test('touch health rails reserve the complete overlay control stack', () => {
  const controlsOn = css.match(/\.touch-capable\[data-sticks="overlay"\]\[data-touch-controls="on"\] \.health-rails \{[^}]+\}/s)?.[0] ?? '';
  const controlsOff = css.match(/\.touch-capable\[data-sticks="overlay"\]\[data-touch-controls="off"\] \.health-rails \{[^}]+\}/s)?.[0] ?? '';
  assert.match(controlsOn, /var\(--touch-stack-reserve\)/,
    'rails must use the shared stick, utility, safe-area, and height reservation');
  assert.doesNotMatch(controlsOff, /var\(--stick\)/,
    'hidden sticks must not reserve their old height');
  assert.match(controlsOff, /var\(--touch-target\)/,
    'rails must still clear the compact HUD and utility buttons');
});

test('touch-stick height participates in the shared safe-area reservation', () => {
  assert.match(css, /--touch-stack-reserve:[^;]*var\(--touch-lift\)/);
  assert.match(css, /data-touch-height="high"[^}]*--touch-lift:\s*clamp\(24px, 8dvh, 64px\)/);
  assert.match(css, /data-sticks="docked"[^}]*\.touch-controls[^}]*bottom:[^;]*var\(--touch-lift\)/);
  assert.match(css, /data-sticks="overlay"[^}]*touch-action[^}]*bottom:[^;]*var\(--touch-lift\)/);
  assert.match(css, /data-sticks="gutter"[^}]*touch-action[^}]*top:\s*calc\(50% - var\(--touch-lift/);
  assert.doesNotMatch(css, /data-touch-height="high"[^}]*transform:/);
});


test('touch score shares the rules rail and utilities orbit the fire stick', () => {
  assert.match(game, /className="rule-score">SCORE/);
  assert.match(css, /\.modern-hud \.match-bar\s*\{\s*display:\s*none/);
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

test('both action arcs derive from one reflected set of radial offsets', () => {
  const radial = css.slice(css.indexOf('One set of radial offsets is the source of truth'));
  assert.match(radial, /--pup-x:[^;]+;[\s\S]*--spec-x:[^;]+;[\s\S]*--pause-x:[^;]+;/);
  assert.match(radial, /touch-action \.touch-pup[^}]*50% - var\(--pup-x\)/);
  assert.match(radial, /touch-flight \.touch-pup[^}]*50% \+ var\(--pup-x\)/);
  assert.match(radial, /touch-action \.touch-special[^}]*100% - var\(--spec-x\)/);
  assert.match(radial, /touch-flight \.touch-special[^}]*left:\s*var\(--spec-x\)/);
  assert.match(radial, /touch-action \.touch-pause[^}]*100% - var\(--pause-x\)/);
  assert.match(radial, /touch-flight \.touch-pause[^}]*left:\s*var\(--pause-x\)/);
});




test('touch playfield starts below the complete HUD and removes canvas text panels', () => {
  assert.match(game, /const playfieldTop = Math\.ceil\(hudBottom\) \+ 2/);
  assert.match(game, /--arena-canvas-width/);
  assert.match(game, /--arena-canvas-height/);
  const overlay = game.slice(game.indexOf('const drawOverlay'), game.indexOf('// Next weapon in the bin'));
  assert.doesNotMatch(overlay, /WORMHOLE CHARGE|Mission notice|coachLine\(game\)/);
  const reserved = css.slice(css.indexOf('The Touch\/Hybrid HUD occupies a real header lane'));
  assert.match(reserved, /top:\s*var\(--arena-playfield-top/);
  assert.match(reserved, /bottom:\s*0/);
  assert.match(reserved, /height:\s*calc\(100% - var\(--arena-playfield-top/);
  assert.match(reserved, /border-top:\s*2px/);
});


test('landscape tablets reuse the full arena shell and corner controls', () => {
  const tablet = css.slice(
    css.indexOf('Landscape tablets use the full existing arena shell'),
    css.indexOf('Mission Setup uses semantic color families')
  );
  assert.match(tablet, /data-form="tablet"\]\[data-orientation="landscape"/);
  assert.match(tablet, /\.arena-stage\s*\{[\s\S]*?width:\s*100%/);
  assert.match(tablet, /data-sticks="overlay"[^}]*\.touch-flight\s*\{[\s\S]*?bottom:\s*calc\(max\(12px,[^;]*var\(--touch-lift\)/);
  assert.match(tablet, /data-sticks="overlay"[^}]*\.touch-action\s*\{[\s\S]*?bottom:\s*calc\(max\(12px,[^;]*var\(--touch-lift\)/);
  assert.match(tablet, /data-sticks="gutter"[^}]*\.touch-flight\s*\{[\s\S]*?top:\s*calc\(50% - var\(--touch-lift\)/);
  assert.match(tablet, /data-sticks="gutter"[^}]*\.touch-action\s*\{[\s\S]*?top:\s*calc\(50% - var\(--touch-lift\)/);
  assert.doesNotMatch(tablet, /scale|dead.?zone|accel|inertia/i,
    'tablet layout must not alter touch response or gameplay');
});


test('the menu adapts by available space, not by device', () => {
  // The one structural shift is a container query on the panel's own width, so
  // the same component composes correctly at any viewport and inside a drawer.
  assert.match(css, /@container menu \(min-width: 720px\)/);
  assert.match(css, /container-type:\s*inline-size/);
  // Navigation, modes, and the fleet reflow intrinsically. Ship cards retain
  // a readable minimum instead of being squeezed into a fixed column count.
  assert.match(css, /\.menu-nav\s*\{[^}]*repeat\(auto-fit, minmax\(200px, 1fr\)\)/s);
  assert.match(css, /\.mode-grid\s*\{[^}]*repeat\(auto-fit, minmax\(230px, 1fr\)\)/s);
  assert.match(css, /\.ship-grid\s*\{[^}]*repeat\(auto-fit, minmax\(min\(128px, 100%\), 1fr\)\)/s);
  assert.match(css, /data-route="ships"\] \.menu-content\s*\{[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/s);
  assert.match(css, /@container menu \(max-width: 390px\)[\s\S]*?\.ship-grid\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/s);
  // Future long names remain contained by their card and can wrap rather than
  // painting into the adjacent grid cell.
  assert.match(css, /\.ship-card\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.ship-card > \*\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/s);
  assert.match(css, /\.ship-card b\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  // Short viewports scroll the content region, never the page, and never by
  // hiding the primary action.
  assert.match(css, /\.menu-panel\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto/s);
  assert.match(css, /\.menu-content\s*\{[^}]*overflow-y:\s*auto/s);
  // Targets have a floor, and it is not "however small it needs to be".
  assert.match(css, /--control-h:\s*clamp\(44px/);
  assert.match(css, /--touch-target:\s*44px/);
  // The measured arena budget is no longer overridden by an !important query.
  assert.doesNotMatch(css, /--arena-size:[^;]*!important/);
});

test('difficulty and mode copy is derived from the rules, not retyped', () => {
  assert.match(menu, /export function difficultyBlurb/);
  assert.match(menu, /DIFFICULTIES\[id\]/);
  assert.match(menu, /rules\.unlimitedHull/);
  // Player-facing labels are defined once and reused by every screen.
  assert.match(menu, /export const MODE_INFO/);
  assert.equal((menu.match(/Solo PvE/g) ?? []).length, 1);
  assert.equal((menu.match(/PvE Co-op/g) ?? []).length, 1);
  assert.match(menu, /\{MODE_INFO\.pve\.label\}/);
  assert.match(menu, /\{MODE_INFO\.coop\.label\}/);
  assert.match(menu, /<b>\{difficultyLabel\("practice"\)\}<\/b>/);
});


test('arena world and viewport use the shared 1504 by 940 ratio', () => {
  assert.match(game, /const VIEW_WIDTH = 1048/);
  assert.match(game, /const VIEW_HEIGHT = 655/);
  // Arena size moved to app/arena.ts; the ratio it defines is unchanged.
  assert.deepEqual(DEFAULT_ARENA, { width: 1504, height: 940 });
  assert.match(game, /width=\{VIEW_WIDTH\}[\s\S]*height=\{VIEW_HEIGHT\}/);
  assert.match(css, /aspect-ratio:\s*var\(--arena-aspect, 1504\/940\)/);
  assert.doesNotMatch(game, /worldSize:/);
});

test('the pause menu cannot mutate a run the player can resume into', () => {
  const pause = menu.slice(menu.indexOf('export function PauseScreen'));
  // Ship and mode changes are destructive by name and by handler: they end the
  // run before opening the next screen. A plain go("ships") / go("modes") here
  // would leave the old game object alive and resumable while the labels
  // described a different one.
  assert.match(pause, /End Run &amp; Change Ship/);
  assert.match(pause, /End Run &amp; Change Mode/);
  assert.match(pause, /onClick=\{onEndRunAndChangeShip\}/);
  assert.match(pause, /onClick=\{onEndRunAndChangeMode\}/);
  assert.doesNotMatch(pause, /go\("ships"\)/, 'ships must not be reachable without ending the run');
  assert.doesNotMatch(pause, /go\("modes"\)/, 'modes must not be reachable without ending the run');

  // Both funnel through endRun, which tears the run down before navigating.
  assert.match(gameCode, /onEndRunAndChangeShip=\{\(\) => endRun\("ships"\)\}/);
  assert.match(gameCode, /onEndRunAndChangeMode=\{\(\) => endRun\("modes"\)\}/);
  const endRun = gameCode.slice(gameCode.indexOf('const endRun = useCallback'), gameCode.indexOf('const quitRun'));
  assert.match(endRun, /game\.running = false/);
  assert.match(endRun, /setLaunched\(false\)/);
  assert.match(endRun, /gameRef\.current = createGame/);
  // The match is left through the client that owns it, chosen by the running
  // game's mode rather than by the stored preference.
  assert.match(endRun, /game\.mode !== "pve"[\s\S]*?netRef\.current\?\.leave\(\)/);

  // Pause describes the live run, not the preference.
  assert.match(gameCode, /mode=\{hud\.mode\}/);
  // Pausing is a property of being offline, not of being PvE — solo Classic
  // has no opponent to keep running either.
  assert.match(gameCode, /pausable=\{isOfflineMode\(hud\.mode\)\}/);
});

test('Restart Run is solo-only, because the server owns a live match', () => {
  const pause = menu.slice(menu.indexOf('export function PauseScreen'));
  assert.match(pause, /const network = mode !== "pve"/);
  // Restart is rendered only when the run is not a network match.
  assert.match(pause, /\{network \? null : \([\s\S]*?Restart Run[\s\S]*?\)\}/);
  // Leaving is named for what it does in each mode.
  assert.match(pause, /network \? "Leave Match" : "Quit to Main Menu"/);
});

/**
 * The measured HUD bands must survive the rail being *replaced*, not just resized.
 *
 * `--rules-bottom` is measured from `.difficulty-badge` and the health bars hang
 * off it. Those elements were observed exactly once, when the layout effect ran,
 * which held only as long as the same element stayed in the DOM. Rift Run
 * renders its own rules rail — a different element from the one every other mode
 * uses — so entering a run swapped the rail out from under the ResizeObserver.
 * Nothing was left watching the element the band is derived from, the value went
 * stale, and on a 375px screen the health bars sat on top of a rail that had
 * since wrapped to several lines, hiding DEPTH behind the HULL bar.
 *
 * A ResizeObserver cannot see a swap, so this needs a DOM-mutation watcher. The
 * assertions below are about that: re-attach on change, and re-measure.
 */
test('a swapped rules rail re-attaches the observers and re-measures', () => {
  // Two rails exist, and they are different elements — this is the condition
  // that made a one-shot attach wrong in the first place.
  assert.match(game, /className="difficulty-badge rift-run-badge"/, 'Rift Run has its own rail');
  assert.match(game, /className=\{`difficulty-badge \$\{contactActive \? "hazard" : ""\}`\}/, 'every other mode has another');

  assert.ok(game.includes('const swaps = new MutationObserver(() => { attach(); measure(); });'),
    'a swap re-attaches and re-measures');
  assert.ok(game.includes('swaps.observe(wrap, { childList: true, subtree: true });'),
    'and it watches the whole HUD subtree, since the rail is nested');
  assert.ok(game.includes('swaps.disconnect()'), 'and it is torn down with the effect');

  // Attachment is a function that re-queries, not a one-shot loop, so it can be
  // called again after a swap.
  assert.ok(game.includes('const attach = () => {'), 'attachment is repeatable');
  const attachAt = game.indexOf('const attach = () => {');
  const swapsAt = game.indexOf('const swaps = new MutationObserver');
  assert.ok(attachAt > 0 && swapsAt > attachAt, 'defined before the watcher that calls it');
});
