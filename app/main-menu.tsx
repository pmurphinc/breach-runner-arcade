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
import { MenuActionButton, MenuScreen, MenuSection, OptionRow, SummaryRow, Toggle } from "./ui-system";
import { WEAPONS, type PickupId, type PupClass, type ShipId } from "./game-data";
import { SHIP_ORDER, SHIP_PROFILES } from "./ship-data";
import {
  FLIGHT_SCHEMES,
  FLIGHT_SCHEME_HINTS,
  FLIGHT_SCHEME_LABELS,
  type FlightScheme,
} from "./flight-controls";
import { difficultyCardStyle } from "./arena-palettes";
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
  team: { label: "PvP 2v2", blurb: "You and an ally share one rift, against a rival pair sharing theirs." },
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
export const MODE_ORDER: GameMode[] = ["pve", "coop", "pvp", "team"];

/** Every mode the engine knows, shelved ones included. Used by tests. */
export const ALL_MODE_IDS: GameMode[] = ["pve", "coop", "pvp", "team", "classic"];

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
 * Play dominates the launch screen and carries the mode decision inline.
 * Difficulty and ship selection intentionally live on the following setup
 * screens, so the launch action stays visible at every viewport size. A
 * returning player presses one button; a new player can configure the rest
 * after choosing a mode.
 */
export function HomeScreen({
  mode,
  running,
  onLaunch,
  go,
  openSettings,
  close,
}: MenuCallbacks & {
  mode: GameMode;
  running: boolean;
  onLaunch: () => void;
}) {
  const network = mode !== "pve";
  const modeLabel = MODE_INFO[mode].label;
  const modeBlurb = MODE_INFO[mode].blurb;

  return (
    <MenuScreen
      route="home"
      onOpenSettings={openSettings}
      title=""
      eyebrow="SYSTEM READY // LAUNCH DECK"
      onBack={close}
      backLabel="Resume"
      hideBack={!running}
      wide
    >
      <div className="main-menu-stage">
        <header className="main-menu-brand-lockup">
          <span className="menu-stage-kicker">BREACH RUNNER // ARCADE COMMAND</span>
          <img
            className="launch-brand-logo"
            src="/branding/breach_runner_logo.webp"
            alt={PRODUCT_TITLE}
            width={800}
            height={320}
          />
          <p>{PRODUCT_TAGLINE}</p>
        </header>

        <section className="launch-console" aria-labelledby="launch-console-title">
          <div className="launch-console-scanline" aria-hidden="true" />
          <div className="launch-console-header">
            <div>
              <span className="menu-stage-kicker">CURRENT MISSION</span>
              <h3 id="launch-console-title">Prepare to Breach</h3>
            </div>
            <div className="launch-status-cluster" aria-label="Run status">
              <span><i aria-hidden="true" />{network ? "NETWORK" : "SOLO"}</span>
              <span>{running ? "RUN ACTIVE" : "READY"}</span>
            </div>
          </div>

          <div className="launch-console-body launch-console-body-simple">
            <div className="launch-briefing launch-briefing-wide">
              <span className="menu-stage-kicker">MISSION PROFILE</span>
              <h4>{modeLabel}</h4>
              <p>{modeBlurb}</p>
              <div className="launch-summary-grid">
                <SummaryRow
                  label="Mode"
                  value={modeLabel}
                  detail="Choose difficulty and ship after selecting a mode"
                  onAction={() => go("modes")}
                />
              </div>
            </div>
          </div>

          <MenuActionButton
            className="launch-command"
            tone="primary"
            icon="▶"
            label={network ? "Find a Match" : "Play"}
            detail={running ? "Resume the current sortie" : "Enter the rift and begin the run"}
            onClick={onLaunch}
          />
        </section>

        <nav className="home-command-deck" aria-label="Command deck">
          <MenuActionButton icon="✦" label="Ships" detail="Choose your hull" onClick={() => go("ships")} />
          <MenuActionButton icon="↗" label="Leaderboard" detail="Review high scores" onClick={() => go("leaderboard")} />
          <MenuActionButton icon="?" label="Game Info" detail="Controls and codex" onClick={() => go("info")} />
        </nav>
      </div>
    </MenuScreen>
  );
}

/* ----------------------------------------------------------------- modes -- */

/**
 * Every mode, on one screen.
 *
 * This used to be three: a PvP-or-PvE fork, then a list inside whichever branch
 * you picked. Two taps to answer one question, and the first tap asked
 * something the player was not thinking in -- nobody sits down wanting "PvE",
 * they want Rift Run, or a duel. Worse, Home already showed the mode, so
 * pressing it opened a screen that asked a broader question than the one being
 * answered.
 *
 * Six cards, ordered solo-first because that is what a session opens in and
 * what most sessions stay in. The grouping needs no caption of its own: every
 * label in MODE_INFO already names the shape it belongs to.
 */
export function GameTypeScreen({ onMode, onSurvival, onRiftRun, onVersus, back, openSettings, currentMode }: MenuCallbacks & {
  onMode: (mode: "pve" | "coop" | "classic") => void;
  onSurvival: () => void;
  onRiftRun: () => void;
  onVersus: (mode: "pvp" | "team") => void;
  currentMode?: GameMode;
}) {
  const defaultSelection = currentMode === "coop" || currentMode === "pvp" || currentMode === "team" ? currentMode : "pve";
  const [selected, setSelected] = useState<"pve" | "rift-run" | "survival" | "coop" | "pvp" | "team">(defaultSelection);

  const activate = (id: typeof selected) => {
    setSelected(id);
    if (id === "rift-run") onRiftRun();
    else if (id === "survival") onSurvival();
    else if (id === "pvp" || id === "team") onVersus(id);
    else onMode(id);
  };

  const cards = [
    { id: "pve" as const, label: MODE_INFO.pve.label, detail: MODE_INFO.pve.blurb, tag: "SOLO // STANDARD", accent: "cyan" },
    { id: "rift-run" as const, label: RIFT_RUN_TITLE, detail: RIFT_RUN_TAGLINE, tag: "ROGUELITE // DEPTH", accent: "pink" },
    { id: "survival" as const, label: "Rift Survival", detail: "Endless escalating challenge", tag: "ENDLESS // SCORE", accent: "amber" },
    { id: "coop" as const, label: MODE_INFO.coop.label, detail: MODE_INFO.coop.blurb, tag: "CO-OP // SHARED", accent: "lime" },
    { id: "pvp" as const, label: MODE_INFO.pvp.label, detail: MODE_INFO.pvp.blurb, tag: "VERSUS // DUEL", accent: "pink" },
    { id: "team" as const, label: MODE_INFO.team.label, detail: MODE_INFO.team.blurb, tag: "VERSUS // TEAM", accent: "purple" },
  ];
  const selectedCard = cards.find((card) => card.id === selected) ?? cards[0];

  return (
    <MenuScreen route="modes" onOpenSettings={openSettings} title="Mode Select" eyebrow="MISSION ARCHIVE // CHOOSE YOUR RUN" onBack={back} wide>
      <div className="mode-command-layout">
        <aside className="mode-selection-console" aria-live="polite">
          <span className="menu-stage-kicker">SELECTED PROTOCOL</span>
          <div className={`mode-selection-sigil accent-${selectedCard.accent}`} aria-hidden="true">
            <span>{selectedCard.id === "rift-run" ? "R" : selectedCard.id === "survival" ? "∞" : selectedCard.id === "pve" ? "1" : "2"}</span>
          </div>
          <p className="mode-selection-tag">{selectedCard.tag}</p>
          <h3>{selectedCard.label}</h3>
          <p>{selectedCard.detail}</p>
          <div className="mode-selection-footer"><span>STATUS</span><b>READY TO DEPLOY</b></div>
        </aside>

        <section className="mode-catalog" aria-label="Available game modes">
          <div className="mode-catalog-header">
            <div><span className="menu-stage-kicker">AVAILABLE RUNS</span><h3>Choose your breach vector</h3></div>
            <span className="mode-count">{cards.length.toString().padStart(2, "0")} MODES</span>
          </div>
          <div className="mode-card-matrix">
            {cards.map((card, index) => (
              <button
                key={card.id}
                type="button"
                className={`mode-launch-card ${selected === card.id ? "selected" : ""} accent-${card.accent}`}
                data-mode={card.id}
                onClick={() => activate(card.id)}
                style={{ "--mode-index": index } as React.CSSProperties}
              >
                <span className="mode-card-index">0{index + 1}</span>
                <span className="mode-card-orbit" aria-hidden="true"><i /></span>
                <span className="mode-card-copy"><small>{card.tag}</small><b>{card.label}</b><em>{card.detail}</em></span>
                <span className="mode-card-enter" aria-hidden="true">ENTER ↗</span>
              </button>
            ))}
          </div>
          <div className="mode-catalog-footer">
            <MenuActionButton className="mode-deploy-button" tone="primary" icon="▶" label="Deploy selected mode" detail={`${selectedCard.label} // press to enter`} onClick={() => activate(selected)} />
            <span className="menu-footnote">Arrow keys / controller to navigate · Enter to select · Esc to return</span>
          </div>
        </section>
      </div>
    </MenuScreen>
  );
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
        {PROGRESSION_DIFFICULTIES.map((id) => { const unlocked=isDifficultyUnlocked(id, progression); const prerequisite=id === "difficult" ? "STABLE" : "VOLATILE"; return <button key={id} type="button" role="radio" aria-checked={difficulty===id} disabled={!unlocked} aria-disabled={!unlocked} className={`difficulty-card ${difficulty===id ? "active" : ""} ${unlocked ? "unlocked" : "locked"}`} style={difficultyCardStyle(id) as React.CSSProperties} onClick={() => onDifficulty(id)}><span className="option-check" aria-hidden="true">{difficulty===id ? "✓" : !unlocked ? "🔒" : ""}</span><b>{difficultyLabel(id)}</b><small>{unlocked ? difficultyBlurb(id) : `Complete ${prerequisite} to unlock`}</small><em>{progression.completedDifficulties.includes(id) ? "Completed" : unlocked ? "Available" : `Complete ${prerequisite} to unlock`}</em></button>; })}
      </div>
      <div className="simulation-option"><button type="button" role="radio" aria-checked={difficulty==="practice"} className={`difficulty-card ${difficulty==="practice" ? "active" : ""}`} style={difficultyCardStyle("practice") as React.CSSProperties} onClick={() => onDifficulty("practice")}><span className="option-check">{difficulty==="practice" ? "✓" : ""}</span><b>{difficultyLabel("practice")}</b><small>Practice / unscored</small><em>Training</em></button></div>
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

const SETTINGS_TAB_META: Record<SettingsTab, { icon: string; hint: string }> = {
  controls: { icon: "⌁", hint: "Input and pilot identity" },
  audio: { icon: "◖", hint: "Sound and feedback" },
  video: { icon: "◫", hint: "Perspective and zoom" },
  hud: { icon: "◇", hint: "Combat readouts" },
  gameInfo: { icon: "?", hint: "Rules and reference" },
};

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
  flightScheme,
  onFlightScheme,
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
  flightScheme: FlightScheme;
  onFlightScheme: (next: FlightScheme) => void;
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
    <MenuScreen route="settings" title="Settings" eyebrow="SYSTEM CONFIG // PILOT PREFERENCES" onBack={back} onOpenSettings={openSettings} wide>
      <div className="settings-console">
        <aside className="settings-rail">
          <span className="menu-stage-kicker">CONFIGURATION</span>
          <h3>Ship systems</h3>
          <p>Adjust the interface around the way you fly.</p>
          <div className="settings-nav" role="tablist" aria-label="Settings categories">
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
                <span className="settings-nav-icon" aria-hidden="true">{SETTINGS_TAB_META[tab.id].icon}</span>
                <span><b>{tab.label}</b><small>{SETTINGS_TAB_META[tab.id].hint}</small></span>
                <i aria-hidden="true">›</i>
              </button>
            ))}
          </div>
          <div className="settings-rail-tip"><span>TIP</span><p>Changes apply immediately. Use the same panel with keyboard, controller, mouse, or touch.</p></div>
        </aside>
        <section className="settings-workspace">
          <header className="settings-workspace-header">
            <div><span className="menu-stage-kicker">ACTIVE MODULE</span><h3>{SETTINGS_TABS.find((tab) => tab.id === activeTab)?.label}</h3></div>
            <span className="settings-module-code">CFG // {activeTab.toUpperCase()}</span>
          </header>
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
        {/* Above the layout, because it decides what the sticks *do*; the
            layout only decides where they sit. */}
        <OptionRow
          label="Flight controls"
          value={flightScheme}
          disabled={viewMode === "pc"}
          options={FLIGHT_SCHEMES.map((id) => ({
            id,
            label: FLIGHT_SCHEME_LABELS[id],
            hint: FLIGHT_SCHEME_HINTS[id],
          }))}
          onChange={(next) => onFlightScheme(next as FlightScheme)}
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
        </section>
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
