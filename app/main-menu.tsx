"use client";

/**
 * The menu screens.
 *
 * One information architecture for every device. Nothing here asks what kind
 * of hardware is running it; the layout is composed from the room the panel
 * actually has, via container queries and fluid sizing in `globals.css`. A
 * phone and an ultrawide render the same markup and the same words.
 */

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { MenuScreen, MenuSection, OptionRow, SummaryRow, Toggle } from "./ui-system";
import { MenuSectionNav } from "./menu-nav";
import { WEAPONS, type PickupId, type PupClass, type ShipId } from "./game-data";
import { SHIP_ORDER, SHIP_PROFILES } from "./ship-data";
import { DIFFICULTIES, DIFFICULTY_ORDER, type DifficultyId, type GameMode } from "./difficulty";
import { PRODUCT_TAGLINE, PRODUCT_TITLE } from "./product";
import type { MenuRoute } from "./menu-routes";
import { settingsStore, type AimGuide, type CombatHaptics, type SoundLevel, type TouchControlHeight, type TouchControlSize, type ViewMode, type ZoomLevel } from "./view-settings";
import { GAMEPAD_BINDINGS } from "./gamepad";
import { RIFT_RUN_DESCRIPTION, RIFT_RUN_TAGLINE, RIFT_RUN_TITLE } from "./rift-run/data";
import { RIFT_RUN_ARCHETYPES } from "./rift-run/ships";
import { RIFT_RUN_STARTER_HULL, RIFT_RUN_STARTER_SHIP } from "./rift-run/starter-ship";
import { RIFT_RUN_MAX_PAYLOAD_SLOTS, RIFT_RUN_MAX_SOCKETS, RIFT_RUN_STARTING_PAYLOAD_SLOTS } from "./rift-run/loadout";
import {
  TOUCH_PROFILE_HINTS,
  TOUCH_PROFILE_IDS,
  TOUCH_PROFILE_LABELS,
  type TouchProfileId,
} from "./touch-profiles";
import type { PilotProgression } from "./pilot-progression";
import { isDifficultyUnlocked, PROGRESSION_DIFFICULTIES } from "./pilot-progression";
import { drawShipModel } from "./ship-models";
import { drawWeaponGlyph } from "./weapon-art";

/** One line each. A mode a player cannot summarise is a mode they will not pick. */
export const MODE_INFO: Record<GameMode, { label: string; blurb: string }> = {
  pve: { label: "Solo PvE", blurb: "One pilot against the rift. Scores count on the global board." },
  coop: { label: "PvE Co-op", blurb: "Two pilots, one objective. Tougher rift, shared win." },
  pvp: { label: "PvP 1v1", blurb: "Real-time duel under Stable rules. No sign-in needed." },
  classic: {
    label: "Classic Wormhole",
    blurb: "The original loop. Orbiting portals, real payloads, no safety nets.",
  },
};

/**
 * The modes a player can reach, in menu order.
 *
 * Classic Wormhole is deliberately absent. It is shelved, not deleted: the mode
 * builds and passes its suite, but it was designed to imitate a 1v1 and there
 * is no opponent for it -- the versus version needed a shared arena that was
 * rejected. A mode that cannot deliver its own premise should not be on the
 * menu, and the work it produced (square arenas, the orbiting portal model, the
 * reference drop table, the compact HUD) is load-bearing everywhere else, so
 * removing it would break things that have nothing to do with Classic.
 *
 * To bring it back: add "classic" here and restore the card in
 * `PveModesScreen`. Nothing else needs to change.
 */
export const MODE_ORDER: GameMode[] = ["pve", "coop", "pvp"];

/** Every mode the engine knows, shelved ones included. Used by tests. */
export const ALL_MODE_IDS: GameMode[] = ["pve", "coop", "pvp", "classic"];

/**
 * Challenges.
 *
 * A challenge is a solo run with its own rules rather than its own opponent,
 * so it is chosen here instead of in the difficulty list — Rift Survival sets
 * its own difficulty from the clock, and offering "Survival Easy" beside
 * "Survival Hard" would be describing the same run twice.
 */
export const CHALLENGE_INFO = {
  survival: {
    label: "Rift Survival",
    blurb: "Endless. The rift gains a level every minute. Time survived is the score.",
  },
} as const;

/** Difficulty in the player's terms, derived from the rules rather than typed. */
export function difficultyBlurb(id: DifficultyId) {
  const rules = DIFFICULTIES[id];
  if (rules.unlimitedHull) return "Unlimited hull. Not scored.";
  const parts: string[] = [rules.wormhole.kind === "locked" ? "Rift holds centre" : "Rift moves"];
  if (rules.collisionShield.enabled) parts.push("collision shield");
  if (rules.contactHazard.enabled) parts.push("contact hurts");
  return parts.join(" · ");
}

const difficultyLabel = (id: DifficultyId) => DIFFICULTIES[id].shortName.replace(/ MODE$/i, "");

const PUP_CLASS_LABELS: Record<PupClass, string> = {
  payload: "Payload", upgrade: "Upgrade", recovery: "Recovery", rare: "Rare",
};

/** Static menu presentation of the same canonical glyph drawn in the arena. */
export function MenuPupPreview({ pup, size = 88 }: { pup: PickupId; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, size, size);
    context.save();
    context.translate(size / 2, size / 2);
    drawWeaponGlyph(context, pup, size * 0.28, 0, { detail: 1 });
    context.restore();
  }, [pup, size]);
  return <canvas className="game-info-model pup-info-model" ref={canvas} width={size} height={size} data-canonical-pup-preview={pup} aria-hidden="true" />;
}

/** Shared read-only reference, generated from gameplay and selection metadata. */
export function GameInfoContent({ viewMode }: { viewMode: ViewMode }) {
  const touch = viewMode !== "pc";
  return <div className="game-info-content">
    <MenuSection title="How to Play">
      <ol className="how-to">
        <li><b>Charge</b><span>Shoot the rival rift with your cannon until it produces a power-up.</span></li>
        <li><b>Collect</b><span>Fly over the power-up to load it into your bin.</span></li>
        <li><b>Transmit</b><span>Aim at the rift and fire the power-up back through it.</span></li>
      </ol>
      <dl className="control-list game-info-controls">
        <div><dt>Move</dt><dd>{touch ? "Left thumbstick · W A S D · arrows" : "W A S D or arrow keys"}</dd></div>
        <div><dt>Aim &amp; fire</dt><dd>{touch ? "Right thumbstick · mouse · Space" : "Mouse, or Space to fire"}</dd></div>
        <div><dt>Fire PUP</dt><dd>{touch ? "PUP button · E · right mouse" : "E or right mouse"}</dd></div>
        <div><dt>Ship special</dt><dd>{touch ? "SPEC button · Q" : "Q"}</dd></div>
        <div><dt>Menu &amp; pause</dt><dd>P or Escape</dd></div>
      </dl>
    </MenuSection>
    <MenuSection title="Game Modes" hint="Gameplay formats determine who plays and how a run ends.">
      <dl className="control-list mode-info-list">
        {MODE_ORDER.map((id) => <div key={id} data-mode={id}><dt>{MODE_INFO[id].label}</dt><dd>{MODE_INFO[id].blurb}</dd></div>)}
        <div><dt>{CHALLENGE_INFO.survival.label}</dt><dd>{DIFFICULTIES.survival.blurb}</dd></div>
      </dl>
      <h4 className="game-info-subheading">Solo difficulties</h4>
      <dl className="control-list difficulty-info-list">
        {DIFFICULTY_ORDER.map((id) => <div key={id} data-difficulty={id}><dt>{difficultyLabel(id)}</dt><dd>{difficultyBlurb(id)}</dd></div>)}
      </dl>
    </MenuSection>
    <MenuSection title="Rift">
      <p className="menu-hint">The rift turns cannon damage into PUPs. Collect them, aim back at the rift, and transmit Payloads to the rival arena.</p>
      <p className="menu-hint">In Rift Survival, the rift gains a level every minute. It can still be breached: transmitted PUPs collapse it, clear the arena, and bank a bonus before it reforms.</p>
    </MenuSection>
    <MenuSection title="PUPs" hint="Canonical class and effect for every power-up the rift can produce.">
      <div className="game-info-grid pup-info-grid">
        {Object.values(WEAPONS).map((pup) => <article className="game-info-card" key={pup.id} data-pup={pup.id}>
          <MenuPupPreview pup={pup.id} />
          <span className="game-info-kicker">{PUP_CLASS_LABELS[pup.pupClass]}</span><h4>{pup.name}</h4>
          <p>{pup.summary}</p><p>{pup.role}</p>
        </article>)}
      </div>
    </MenuSection>
    <MenuSection title="Ships &amp; Specials">
      <div className="game-info-grid ship-info-grid">
        {SHIP_ORDER.map((id) => { const ship = SHIP_PROFILES[id]; return <article className="game-info-card" key={id} data-ship={id}>
          <MenuShipPreview ship={id} size={96} animated={false} />
          <span className="game-info-kicker">{ship.role}</span><h4>{ship.name}</h4>
          <p><b>{ship.special.name}</b> · {ship.special.cooldownSeconds}s</p><p>{ship.special.description}</p>
        </article>; })}
      </div>
    </MenuSection>
  </div>;
}

export type MenuCallbacks = {
  go: (route: MenuRoute) => void;
  openSettings: () => void;
  back: () => void;
  close: () => void;
};

/** Canonical, presentation-only canvas preview. It owns no game entity or attachments. */
export function MenuShipPreview({ ship, size = 104, animated = true }: { ship: ShipId; size?: number; animated?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const reduced = !animated || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const started = performance.now();
    const paint = (now: number) => {
      context.clearRect(0, 0, size, size);
      context.save();
      context.translate(size / 2, size / 2);
      context.rotate(reduced ? -Math.PI / 8 : (now - started) * 0.00022);
      drawShipModel(context, ship, size / 50);
      context.restore();
      if (!reduced) frame = requestAnimationFrame(paint);
    };
    paint(started);
    return () => cancelAnimationFrame(frame);
  }, [animated, ship, size]);
  return <canvas className="menu-ship-preview" ref={canvas} width={size} height={size} data-canonical-ship-preview={ship} aria-hidden="true" />;
}

/**
 * Keep the persistent setting reflected on the document root so the gameplay
 * control layer can mirror the existing right-stick action targets with CSS
 * without creating a second input implementation.
 */
/**
 * The mirrored-actions preference.
 *
 * Value and setter only. This deliberately does NOT write
 * html[data-mirror-touch-actions] — that used to live here, which meant the
 * attribute only existed once a screen calling this hook had mounted. When the
 * app opened on Ships rather than Home, a pilot who had the setting on
 * launched into a run with the left-hand buttons still hidden by their
 * default display:none,
 * and only opening Settings (or toggling the option off and on) applied it.
 * The game shell owns that attribute now, because the game shell is always
 * mounted.
 */
function useMirroredTouchActionsSetting() {
  const deviceSettings = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
    settingsStore.getServerSnapshot,
  );

  return [
    deviceSettings.mirrorTouchActions,
    (next: boolean) => settingsStore.update({ mirrorTouchActions: next }),
  ] as const;
}

/* ------------------------------------------------------------------ home -- */

/**
 * The main menu.
 *
 * Play dominates and carries the whole launch decision inline: mode,
 * difficulty and ship are shown as their remembered values with a way to
 * change each. A returning player presses one button. A new player sees
 * exactly what they are about to fly before they commit, without being walked
 * through three full-screen steps to get there.
 */
export function HomeScreen({
  mode,
  difficulty,
  ship,
  running,
  onLaunch,
  go,
  openSettings,
  close,
  renderShip,
}: MenuCallbacks & {
  mode: GameMode;
  difficulty: DifficultyId;
  ship: ShipId;
  running: boolean;
  onLaunch: () => void;
  /** The canvas silhouette, supplied by the shell so art stays in one place. */
  renderShip: (id: ShipId, size: number) => React.ReactNode;
}) {
  const network = mode !== "pve";
  // A challenge runs solo, so it rides on the PvE mode and replaces the labels
  // rather than adding a fourth mode nothing else in the shell knows about.
  const survival = difficulty === "survival";

  return (
    <MenuScreen
      route="home"
      onOpenSettings={openSettings}
      title={
        <img
          className="launch-brand-logo"
          src="/branding/breach_runner_logo.webp"
          alt={PRODUCT_TITLE}
          width={800}
          height={320}
        />
      }
      eyebrow={PRODUCT_TAGLINE}
      onBack={close}
      backLabel="Resume"
      // With no run behind it, Home is the root: there is nothing to go back
      // to, and the global Menu button already closes the menu.
      hideBack={!running}
      wide
      // Pinned rather than in the scrolling region, so the primary action is on
      // screen at every height — a landscape phone included.
      footer={
        <button type="button" className="play-button" onClick={onLaunch}>
          {network ? "Find a Match" : "Play"}
        </button>
      }
    >
      <div className="home-layout">
        <section className="play-panel" aria-labelledby="play-heading">
          <h3 id="play-heading" className="sr-only">
            Launch a run
          </h3>

          <div className="play-summary">
            <SummaryRow
              label="Mode"
              value={survival ? CHALLENGE_INFO.survival.label : MODE_INFO[mode].label}
              detail={survival ? CHALLENGE_INFO.survival.blurb : MODE_INFO[mode].blurb}
              onAction={() => go("modes")}
            />
            {mode === "pvp" || survival ? null : (
              <SummaryRow
                label="Difficulty"
                value={difficultyLabel(difficulty)}
                detail={difficultyBlurb(difficulty)}
                onAction={() => go("modes")}
              />
            )}
            {/* The hull is always on screen. Ship choice moved into the lobby,
                which left Home describing a run without saying what it would be
                flown in -- the one part of the decision the player is most
                likely to want to check before pressing Play. */}
            <SummaryRow
              label="Ship"
              value={SHIP_PROFILES[ship].name}
              detail={SHIP_PROFILES[ship].role}
              media={renderShip(ship, 44)}
              onAction={() => go("ships")}
            />
          </div>
        </section>

        <MenuSectionNav
          items={[
            { route: "ships", label: "Ships", hint: "Compare the fleet" },
            { route: "leaderboard", label: "Leaderboard", hint: "Global high scores" },
            { route: "info", label: "Game Info", hint: "How to play" },
          ]}
          onSelect={go}
        />
      </div>
    </MenuScreen>
  );
}

/* ----------------------------------------------------------------- modes -- */

export function GameTypeScreen({ go, back, openSettings }: MenuCallbacks) {
  return <MenuScreen route="modes" onOpenSettings={openSettings} title="Select Game Mode" onBack={back}>
    <div className="mode-grid launch-choice-grid" aria-label="Game type">
      <button type="button" className="mode-card" data-mode="pvp" onClick={() => go("pvp-modes")}><b>PvP</b><small>Competitive multiplayer</small></button>
      <button type="button" className="mode-card" data-mode="pve" onClick={() => go("pve-modes")}><b>PvE</b><small>Rift missions and challenge modes</small></button>
    </div>
  </MenuScreen>;
}

export function PvpModesScreen({ onSelect, back, openSettings }: MenuCallbacks & { onSelect: () => void }) {
  return <MenuScreen route="pvp-modes" onOpenSettings={openSettings} title="Select PvP Mode" onBack={back}>
    <div className="mode-grid"><button type="button" className="mode-card" data-mode="pvp" onClick={onSelect}><b>1v1</b><small>Matchmaking or private match</small></button></div>
  </MenuScreen>;
}

export function PveModesScreen({ onMode, onSurvival, onRiftRun, back, openSettings }: MenuCallbacks & {
  onMode: (mode: "pve" | "coop" | "classic") => void; onSurvival: () => void; onRiftRun: () => void;
}) {
  return <MenuScreen route="pve-modes" onOpenSettings={openSettings} title="Select PvE Mode" onBack={back}>
    <div className="mode-grid pve-mode-grid">
      <button type="button" className="mode-card" data-mode="pve" onClick={() => onMode("pve")}><b>{MODE_INFO.pve.label}</b><small>One pilot against the rift</small></button>
      <button type="button" className="mode-card" data-mode="coop" onClick={() => onMode("coop")}><b>{MODE_INFO.coop.label}</b><small>Two pilots, shared objective</small></button>
      <button type="button" className="mode-card" data-mode="survival" onClick={onSurvival}><b>Rift Survival</b><small>Endless escalating challenge</small></button>
      <button type="button" className="mode-card" data-mode="rift-run" onClick={onRiftRun}><b>{RIFT_RUN_TITLE}</b><small>{RIFT_RUN_TAGLINE}</small></button>
      {/* Classic Wormhole is shelved -- see MODE_ORDER. The card is commented
          out rather than deleted so bringing it back is a one-line change:
          <button type="button" className="mode-card" data-mode="classic" onClick={() => onMode("classic")}><b>{MODE_INFO.classic.label}</b><small>{MODE_INFO.classic.blurb}</small></button>
      */}
    </div>
  </MenuScreen>;
}

/**
 * Roster selection inside a lobby.
 *
 * Deliberately not a link to the Ships screen. Navigating away to choose and
 * then navigating back is what made ship choice feel like a step in launching
 * the game; picking in place makes it part of preparing the round, so a pilot
 * can adjust for the mode, the difficulty or the last round without losing the
 * screen they were on. The full stat sheet still lives on the Ships screen.
 */
export function LobbyShipPicker({ ship, onSelectShip, renderShip }: {
  ship: ShipId; onSelectShip: (id: ShipId) => void; renderShip: (id: ShipId, size: number) => React.ReactNode;
}) {
  const profile = SHIP_PROFILES[ship];
  return <MenuSection title="Ship" hint="Change your ship any time before the round starts.">
    <div className="lobby-ship-picker">
      <div className="ship-grid lobby-ship-grid" role="radiogroup" aria-label="Choose your ship">
        {SHIP_ORDER.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={ship === id}
            className={`ship-card ${ship === id ? "active" : ""}`} onClick={() => onSelectShip(id)}>
            <span className="ship-card-art" aria-hidden="true">{renderShip(id, 40)}</span>
            <b>{SHIP_PROFILES[id].name}</b>
            {ship === id ? <span className="ship-card-check" aria-hidden="true">✓</span> : null}
          </button>
        ))}
      </div>
      <p className="menu-hint lobby-ship-summary" aria-live="polite">
        <b>{profile.name}</b> · {profile.role} · Special {profile.special.name}
      </p>
    </div>
  </MenuSection>;
}

/**
 * The pre-round lobby for the solo and co-op PvE modes.
 *
 * Ship choice lives here rather than on the way in to the game. The lobby
 * answers "how do you want to play *this round*?", so the hull is picked in
 * place — beside the difficulty it will fly at — and can be changed again
 * without leaving the screen. Rift Run has no equivalent control on purpose:
 * every run there starts with the same issued starter ship.
 */
export function DifficultyScreen({ ship, mode, difficulty, progression, onDifficulty, onSelectShip, onLaunch, go, back, openSettings, renderShip }: MenuCallbacks & {
  ship: ShipId; mode: "pve" | "coop"; difficulty: DifficultyId; progression: PilotProgression;
  onDifficulty: (id: DifficultyId) => void; onSelectShip: (id: ShipId) => void; onLaunch: () => void;
  renderShip: (id: ShipId, size: number) => React.ReactNode;
}) {
  return <MenuScreen route="difficulty" onOpenSettings={openSettings} title="Round Setup" onBack={back}
    footer={<button type="button" className="play-button" onClick={onLaunch} disabled={!isDifficultyUnlocked(difficulty, progression)}>{mode === "coop" ? "Continue to Co-op" : "Play"}</button>}>
    <button type="button" className="selected-mode-card" onClick={() => go("pve-modes")}><span>Selected mode</span><b>{MODE_INFO[mode].label}</b></button>
    <LobbyShipPicker ship={ship} onSelectShip={onSelectShip} renderShip={renderShip} />
    <MenuSection title="Difficulty" hint="Complete each tier to unlock the next.">
      <div className="difficulty-progression" role="radiogroup" aria-label="PvE difficulty">
        {PROGRESSION_DIFFICULTIES.map((id) => { const unlocked=isDifficultyUnlocked(id, progression); const prerequisite=id === "difficult" ? "STABLE" : "VOLATILE"; return <button key={id} type="button" role="radio" aria-checked={difficulty===id} disabled={!unlocked} aria-disabled={!unlocked} className={`difficulty-card ${difficulty===id ? "active" : ""} ${unlocked ? "unlocked" : "locked"}`} onClick={() => onDifficulty(id)}><span className="option-check" aria-hidden="true">{difficulty===id ? "✓" : !unlocked ? "🔒" : ""}</span><b>{difficultyLabel(id)}</b><small>{unlocked ? difficultyBlurb(id) : `Complete ${prerequisite} to unlock`}</small><em>{progression.completedDifficulties.includes(id) ? "Completed" : unlocked ? "Available" : `Complete ${prerequisite} to unlock`}</em></button>; })}
      </div>
      <div className="simulation-option"><button type="button" role="radio" aria-checked={difficulty==="practice"} className={`difficulty-card ${difficulty==="practice" ? "active" : ""}`} onClick={() => onDifficulty("practice")}><span className="option-check">{difficulty==="practice" ? "✓" : ""}</span><b>{difficultyLabel("practice")}</b><small>Practice / unscored</small><em>Training</em></button></div>
    </MenuSection>
  </MenuScreen>;
}

/* -------------------------------------------------------------- Rift Run -- */

/**
 * The Rift Run lobby.
 *
 * There is no ship choice here, and that absence is the design rather than an
 * omission: every Rift Run begins on the same stripped starter frame, and the
 * ship's identity is created by the upgrades taken during the run. What the
 * lobby does instead is tell the pilot exactly what they are being handed and
 * what they are being handed it for — the starting loadout on one side, the
 * kinds of ship a run can grow into on the other.
 */
export function RiftRunSetupScreen({
  onLaunch,
  back,
  openSettings,
  renderShip,
}: MenuCallbacks & {
  onLaunch: () => void;
  renderShip: (id: ShipId, size: number) => React.ReactNode;
}) {
  return (
    <MenuScreen
      route="rift-run"
      onOpenSettings={openSettings}
      title={RIFT_RUN_TITLE}
      eyebrow={RIFT_RUN_TAGLINE}
      onBack={back}
      wide
      footer={<button type="button" className="play-button" onClick={onLaunch}>Start Run</button>}
    >
      <p className="menu-hint rift-run-intro">{RIFT_RUN_DESCRIPTION}</p>
      <div className="rift-run-layout">
        <section className="ship-detail rift-run-detail">
          <div className="ship-detail-art" aria-hidden="true">{renderShip(RIFT_RUN_STARTER_HULL, 112)}</div>
          <h3>{RIFT_RUN_STARTER_SHIP.name}</h3>
          <p className="ship-detail-role">Standard issue · No class · No special</p>
          <ul className="rift-starter-loadout" aria-label="Starting loadout">
            <li><span>PAYLOAD</span><b>{RIFT_RUN_STARTING_PAYLOAD_SLOTS} / {RIFT_RUN_MAX_PAYLOAD_SLOTS} SLOTS</b></li>
            <li><span>MAIN CANNON</span><b>CANNON I</b></li>
            <li><span>THRUSTERS</span><b>THRUSTERS I</b></li>
            <li><span>SPECIAL</span><b>LOCKED</b></li>
            <li><span>HULL WEAPONS</span><b>0 / {RIFT_RUN_MAX_SOCKETS} SOCKETS</b></li>
          </ul>
          <p className="menu-hint">
            Every run starts here. Rift Energy earns upgrade choices, and each choice
            improves one of five competing systems.
          </p>
        </section>
        <section className="rift-run-archetypes" aria-label="Build archetypes">
          <h3>WHAT YOU CAN BUILD</h3>
          <p className="menu-hint">
            The fleet are reference builds, not starting choices. Hybrids that match no
            preset are the point.
          </p>
          <ul>
            {RIFT_RUN_ARCHETYPES.map((archetype) => (
              <li key={archetype.id}>
                <span className="ship-card-art" aria-hidden="true">{renderShip(archetype.id, 40)}</span>
                <div><b>{archetype.label}</b><small>{archetype.summary}</small></div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </MenuScreen>
  );
}

/* ----------------------------------------------------------------- ships -- */

/**
 * The fleet, as a grid of real choices.
 *
 * Enough to decide with — silhouette, name, role, the stats that differ, and
 * the special — and nothing more. The full stat table lives on the focused
 * ship rather than on all eight at once.
 */
export function ShipsScreen({
  ship,
  onSelect,
  onLaunch,
  back,
  openSettings,
  renderShip,
}: MenuCallbacks & {
  ship: ShipId;
  onSelect: (id: ShipId) => void;
  onLaunch: () => void;
  /** The canvas silhouette, supplied by the shell so art stays in one place. */
  renderShip: (id: ShipId, size: number) => React.ReactNode;
}) {
  const profile = SHIP_PROFILES[ship];
  const stats = useMemo(() => profile.stats, [profile]);

  return (
    <MenuScreen
      route="ships"
      onOpenSettings={openSettings}
      title="Ships"
      onBack={back}
      wide
      footer={
        <button type="button" className="play-button" onClick={onLaunch}>
          Confirm {profile.name}
        </button>
      }
    >
      <div className="ships-layout">
        <div className="ship-grid" role="radiogroup" aria-label="Choose a ship">
          {SHIP_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={ship === id}
              className={`ship-card ${ship === id ? "active" : ""}`}
              onClick={() => onSelect(id)}
            >
              <span className="ship-card-art" aria-hidden="true">
                {renderShip(id, 44)}
              </span>
              <b>{SHIP_PROFILES[id].name}</b>
              <small>{SHIP_PROFILES[id].role}</small>
              {ship === id ? (
                <span className="ship-card-check" aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <section className="ship-detail" aria-live="polite">
          <div className="ship-detail-art" aria-hidden="true">
            <MenuShipPreview ship={ship} size={132} />
          </div>
          <h3>{profile.name}</h3>
          <p className="ship-detail-role">
            {profile.role} · {profile.experience}
          </p>

          <ul className="ship-stats">
            {stats.map((stat) => (
              <li key={stat.key}>
                <span>{stat.label}</span>
                <b>{stat.display}</b>
                <i aria-hidden="true">
                  <em style={{ width: `${Math.round(stat.fraction * 100)}%` }} />
                </i>
              </li>
            ))}
          </ul>

          <div className="ship-special">
            <span>
              Special · {profile.special.cooldownSeconds}s cooldown
            </span>
            <b>{profile.special.name}</b>
            <p>{profile.special.description}</p>
          </div>
        </section>
      </div>
    </MenuScreen>
  );
}

/* -------------------------------------------------------------- settings -- */

export const SETTINGS_TABS = [
  { id: "controls", label: "Controls" },
  { id: "audio", label: "Audio" },
  { id: "video", label: "Video" },
  { id: "hud", label: "HUD" },
  { id: "gameInfo", label: "Game Info" },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];

export function SettingsScreen({
  back,
  openSettings,
  viewMode,
  storedViewMode,
  onViewMode,
  thumbsticks,
  onThumbsticks,
  touchSize,
  onTouchSize,
  touchHeight,
  onTouchHeight,
  sound,
  onSound,
  soundLevel,
  onSoundLevel,
  combatHaptics,
  onCombatHaptics,
  cannonHitSound,
  onCannonHitSound,
  aimGuide,
  onAimGuide,
  compactHud,
  onCompactHud,
  touchProfile,
  onTouchProfile,
  onEditTouchLayout,
  cameraLock,
  onCameraLock,
  zoom,
  onZoom,
  initials,
  onInitials,
}: MenuCallbacks & {
  viewMode: ViewMode;
  storedViewMode: ViewMode | null;
  onViewMode: (next: ViewMode | null) => void;
  thumbsticks: boolean;
  onThumbsticks: (next: boolean) => void;
  touchSize: TouchControlSize;
  onTouchSize: (next: TouchControlSize) => void;
  touchHeight: TouchControlHeight;
  onTouchHeight: (next: TouchControlHeight) => void;
  sound: boolean;
  onSound: (next: boolean) => void;
  soundLevel: SoundLevel;
  onSoundLevel: (next: SoundLevel) => void;
  combatHaptics: CombatHaptics;
  onCombatHaptics: (next: CombatHaptics) => void;
  cannonHitSound: boolean;
  onCannonHitSound: (next: boolean) => void;
  aimGuide: AimGuide;
  onAimGuide: (next: AimGuide) => void;
  compactHud: boolean;
  onCompactHud: (next: boolean) => void;
  touchProfile: TouchProfileId;
  onTouchProfile: (next: TouchProfileId) => void;
  onEditTouchLayout: () => void;
  cameraLock: boolean;
  onCameraLock: (next: boolean) => void;
  zoom: ZoomLevel;
  onZoom: (next: ZoomLevel) => void;
  initials: string;
  onInitials: (next: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("controls");
  const tabsId = useId();
  const [mirrorTouchActions, onMirrorTouchActions] = useMirroredTouchActionsSetting();
  const mirrorDisabled = viewMode === "pc" || !thumbsticks;
  const mirrorHint = viewMode === "pc"
    ? "Touch or Both only"
    : !thumbsticks
      ? "Turn Thumbsticks on first"
      : "Duplicates PUP, SPEC, and Pause around the movement stick";

  const selectAdjacentTab = (current: SettingsTab, direction: number) => {
    const currentIndex = SETTINGS_TABS.findIndex(({ id }) => id === current);
    const next = SETTINGS_TABS[(currentIndex + direction + SETTINGS_TABS.length) % SETTINGS_TABS.length];
    setActiveTab(next.id);
    document.getElementById(`${tabsId}-tab-${next.id}`)?.focus();
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tab: SettingsTab) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    selectAdjacentTab(tab, event.key === "ArrowRight" ? 1 : -1);
  };

  return (
    <MenuScreen route="settings" title="Settings" onBack={back} onOpenSettings={openSettings}>
      <div className="settings-tabs" role="tablist" aria-label="Settings categories">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            id={`${tabsId}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`${tabsId}-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => onTabKeyDown(event, tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        className="settings-tab-panel"
        id={`${tabsId}-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-tab-${activeTab}`}
      >
      {activeTab === "controls" ? <>
      <MenuSection title="Arcade identity" hint="Used automatically for future scores.">
        <div className="initials-field">
          <label htmlFor="menu-player-initials">Initials</label>
          <input
            id="menu-player-initials"
            value={initials}
            maxLength={3}
            inputMode="text"
            enterKeyHint="done"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onInitials(event.target.value)}
          />
        </div>
      </MenuSection>
      <MenuSection title="Controls">
        <OptionRow
          label="Input"
          value={storedViewMode ?? "auto"}
          options={[
            { id: "auto", label: "Auto", hint: `Detected: ${viewMode.toUpperCase()}` },
            { id: "touch", label: "Touch" },
            { id: "pc", label: "Mouse & Keys" },
            { id: "hybrid", label: "Both" },
          ]}
          onChange={(next) => onViewMode(next === "auto" ? null : (next as ViewMode))}
        />
        <OptionRow
          label="Touch profile"
          value={touchProfile}
          disabled={viewMode === "pc"}
          options={TOUCH_PROFILE_IDS.map((id) => ({
            id,
            label: TOUCH_PROFILE_LABELS[id],
            hint: TOUCH_PROFILE_HINTS[id],
          }))}
          onChange={onTouchProfile}
        />
        {touchProfile === "custom" ? (
          <div className="simulation-option">
            <button type="button" className="difficulty-card" onClick={onEditTouchLayout}>
              <b>Edit Custom layout</b>
              <small>Drag each control to place and size it</small>
            </button>
          </div>
        ) : null}
        <Toggle
          label="Thumbsticks"
          value={thumbsticks}
          onChange={onThumbsticks}
          disabled={viewMode === "pc"}
          hint={viewMode === "pc" ? "Touch or Both only" : undefined}
        />
        <Toggle
          label="Left-side action buttons"
          value={mirrorTouchActions}
          onChange={onMirrorTouchActions}
          disabled={mirrorDisabled}
          hint={mirrorHint}
        />
        <OptionRow
          label="Touch control size"
          value={touchSize}
          disabled={viewMode === "pc"}
          options={[
            { id: "small", label: "Small" },
            { id: "medium", label: "Medium" },
            { id: "large", label: "Large" },
          ]}
          onChange={onTouchSize}
        />
        <OptionRow
          label="Touch stick height"
          value={touchHeight}
          disabled={viewMode === "pc" || !thumbsticks}
          options={[
            { id: "low", label: "Low" },
            { id: "middle", label: "Middle" },
            { id: "high", label: "High" },
          ]}
          onChange={onTouchHeight}
        />
        <OptionRow
          label="Vibration"
          value={combatHaptics}
          options={[
            { id: "off", label: "Off" },
            { id: "gun", label: "Gun Feedback", hint: "Pulse when your cannon hits" },
            { id: "hull", label: "Hull Feedback", hint: "Pulse when hull takes damage" },
            { id: "both", label: "Both" },
          ]}
          onChange={onCombatHaptics}
        />
        <div className="controller-controls" aria-labelledby="controller-controls-title">
          <h4 id="controller-controls-title">Controller Controls</h4>
          <div>
            <h5>Flight</h5>
            <dl className="control-list">
              <div><dt>Move</dt><dd>{GAMEPAD_BINDINGS.axes.move.label}</dd></div>
              <div><dt>Aim &amp; primary fire</dt><dd>{GAMEPAD_BINDINGS.axes.aim.label}</dd></div>
              <div><dt>Fire PUP</dt><dd>{GAMEPAD_BINDINGS.buttons.firePup.label}</dd></div>
              <div><dt>Special</dt><dd>{GAMEPAD_BINDINGS.buttons.special.label}</dd></div>
              <div><dt>Previous PUP</dt><dd>{GAMEPAD_BINDINGS.buttons.previousPup.label}</dd></div>
              <div><dt>Next PUP</dt><dd>{GAMEPAD_BINDINGS.buttons.nextPup.label}</dd></div>
              <div><dt>Pause</dt><dd>{GAMEPAD_BINDINGS.buttons.pause.label}</dd></div>
            </dl>
          </div>
          <div>
            <h5>Menus</h5>
            <dl className="control-list">
              <div><dt>Navigate</dt><dd>{GAMEPAD_BINDINGS.menuNavigation.label}</dd></div>
              <div><dt>Select</dt><dd>{GAMEPAD_BINDINGS.buttons.confirm.label}</dd></div>
              <div><dt>Back</dt><dd>{GAMEPAD_BINDINGS.buttons.cancel.label}</dd></div>
            </dl>
          </div>
        </div>
      </MenuSection></> : null}

      {activeTab === "audio" ? <MenuSection title="Audio">
        <Toggle label="Sound" value={sound} onChange={onSound} />
        <OptionRow
          label="Volume"
          value={soundLevel}
          disabled={!sound}
          options={[
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
          ]}
          onChange={onSoundLevel}
        />
        <Toggle
          label="Cannon Hit Sound"
          value={cannonHitSound}
          onChange={onCannonHitSound}
          disabled={!sound}
          hint="Short impact marker for normal pulse-cannon hits"
        />
      </MenuSection> : null}

      {activeTab === "video" ? <MenuSection title="Video">
        <OptionRow
          label="Perspective"
          value={cameraLock ? "follow" : "arena"}
          options={[
            { id: "follow", label: "Follow Ship", hint: "The arena moves around your ship" },
            { id: "arena", label: "Full Arena", hint: "Fit the entire arena on screen" },
          ]}
          onChange={(next) => onCameraLock(next === "follow")}
        />
        <OptionRow
          label="Zoom"
          value={zoom}
          disabled={!cameraLock}
          options={[
            { id: "wide", label: "Wide", hint: "0.85×" },
            { id: "standard", label: "Standard", hint: "1.00×" },
            { id: "close", label: "Close", hint: "1.15×" },
            { id: "closer", label: "Closer", hint: "1.30×" },
          ]}
          onChange={onZoom}
        />
        {!cameraLock ? <p className="menu-hint">Full Arena always fits the entire arena.</p> : null}
      </MenuSection> : null}

      {activeTab === "hud" ? <MenuSection title="HUD">
        <OptionRow
          label="Aim Guide"
          value={aimGuide}
          options={[
            { id: "off", label: "Off" },
            { id: "short", label: "Short" },
            { id: "long", label: "Long" },
          ]}
          onChange={onAimGuide}
        />
        <Toggle
          label="Compact HUD"
          value={compactHud}
          onChange={onCompactHud}
          hint="Slim hull and shield gauges beside your ship, with the payload frame on the right"
        />
      </MenuSection> : null}

      {activeTab === "gameInfo" ? <MenuSection title="Game Info">
        <GameInfoContent viewMode={viewMode} />
      </MenuSection> : null}

      </div>
    </MenuScreen>
  );
}

/* ------------------------------------------------------------------ info -- */

export function InfoScreen({
  back,
  go,
  openSettings,
  viewMode,
  onCodex,
}: MenuCallbacks & { viewMode: ViewMode; onCodex: () => void }) {
  return (
    <MenuScreen route="info" title="Game Info" onBack={back} onOpenSettings={openSettings} wide>
      <GameInfoContent viewMode={viewMode} />
      <MenuSection title="More detail">
        <button type="button" className="menu-link-button" onClick={onCodex} aria-haspopup="dialog">
          Open the weapon codex
        </button>
        <button type="button" className="menu-link-button" onClick={() => go("ships")}>
          Compare the fleet
        </button>
      </MenuSection>
    </MenuScreen>
  );
}

/* ----------------------------------------------------------------- pause -- */

/**
 * Pause.
 *
 * Same shell, same words, same primary-action treatment as every other
 * screen. Resume is the primary action; the one destructive item — abandoning
 * the run — is separated and named for what it does.
 */
export function PauseScreen({
  go,
  openSettings,
  close,
  mode,
  onRestart,
  onQuit,
  onEndRunAndChangeShip,
  onEndRunAndChangeMode,
  pausable,
}: MenuCallbacks & {
  /** The mode the live run is actually being played in, not the preference. */
  mode: GameMode;
  onRestart: () => void;
  onQuit: () => void;
  onEndRunAndChangeShip: () => void;
  onEndRunAndChangeMode: () => void;
  /** Network matches keep running behind the menu; say so rather than lying. */
  pausable: boolean;
}) {
  const network = mode !== "pve";
  return (
    <MenuScreen
      route="pause"
      onOpenSettings={openSettings}
      title="Paused"
      eyebrow={pausable ? undefined : `${MODE_INFO[mode].label} — the match keeps running`}
      onBack={close}
      backLabel="Resume"
      footer={
        <button type="button" className="play-button" onClick={close}>
          Resume
        </button>
      }
    >
      <MenuSection>
        <div className="pause-actions">
          {/*
            Restart is a client-side start() and belongs to solo play only. In
            a live match the server owns the session, so restarting locally
            would desync the two clients rather than begin anything.
          */}
          {network ? null : (
            <button type="button" onClick={onRestart}>
              Restart Run
            </button>
          )}
          {/*
            Named for what they do. Both end the current run before opening the
            next screen, so the player cannot change the configuration and then
            resume the old simulation under the new labels.
          */}
          <button type="button" onClick={onEndRunAndChangeShip}>
            End Run &amp; Change Ship
          </button>
          <button type="button" onClick={onEndRunAndChangeMode}>
            End Run &amp; Change Mode
          </button>
          <button type="button" onClick={() => go("info")}>
            Game Info
          </button>
          <button type="button" onClick={() => go("leaderboard")}>
            Leaderboard
          </button>
        </div>
      </MenuSection>

      <MenuSection>
        <button type="button" className="danger-button" onClick={onQuit}>
          {network ? "Leave Match" : "Quit to Main Menu"}
        </button>
        <p className="menu-section-hint">
          {network ? "This leaves the match and returns to the main menu." : "This ends the current run."}
        </p>
      </MenuSection>
    </MenuScreen>
  );
}
