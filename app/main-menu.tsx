"use client";

/**
 * The menu screens.
 *
 * One information architecture for every device. Nothing here asks what kind
 * of hardware is running it; the layout is composed from the room the panel
 * actually has, via container queries and fluid sizing in `globals.css`. A
 * phone and an ultrawide render the same markup and the same words.
 */

import { useMemo } from "react";
import { MenuScreen, MenuSection, OptionRow, SummaryRow, Toggle } from "./ui-system";
import { MenuSectionNav } from "./menu-nav";
import { SHIPS, type ShipId } from "./game-data";
import { SHIP_ORDER, SHIP_PROFILES } from "./ship-data";
import { DIFFICULTIES, DIFFICULTY_ORDER, type DifficultyId, type GameMode } from "./difficulty";
import { PRODUCT_TAGLINE, PRODUCT_TITLE } from "./product";
import type { MenuRoute } from "./menu-routes";
import type { SoundLevel, TouchControlSize, ViewMode } from "./view-settings";

/** One line each. A mode a player cannot summarise is a mode they will not pick. */
export const MODE_INFO: Record<GameMode, { label: string; blurb: string }> = {
  pve: { label: "Solo PvE", blurb: "One pilot against the rift. Scores count on the global board." },
  coop: { label: "PvE Co-op", blurb: "Two pilots, one objective. Tougher rift, shared win." },
  pvp: { label: "PvP 1v1", blurb: "Real-time duel under Easy rules. No sign-in needed." },
};

export const MODE_ORDER: GameMode[] = ["pve", "coop", "pvp"];

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

export type MenuCallbacks = {
  go: (route: MenuRoute) => void;
  back: () => void;
  close: () => void;
};

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
  close,
}: MenuCallbacks & {
  mode: GameMode;
  difficulty: DifficultyId;
  ship: ShipId;
  running: boolean;
  onLaunch: () => void;
}) {
  const profile = SHIP_PROFILES[ship];
  const network = mode !== "pve";
  // A challenge runs solo, so it rides on the PvE mode and replaces the labels
  // rather than adding a fourth mode nothing else in the shell knows about.
  const survival = difficulty === "survival";

  return (
    <MenuScreen
      route="home"
      title={PRODUCT_TITLE}
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
            <SummaryRow
              label="Ship"
              value={profile.name}
              detail={profile.role}
              onAction={() => go("ships")}
            />
          </div>
        </section>

        <MenuSectionNav
          items={[
            { route: "ships", label: "Ships", hint: "Compare the fleet" },
            { route: "leaderboard", label: "Leaderboard", hint: "Global high scores" },
            { route: "settings", label: "Settings", hint: "Controls, audio, display" },
            { route: "info", label: "Game Info", hint: "How to play" },
          ]}
          onSelect={go}
        />
      </div>
    </MenuScreen>
  );
}

/* ----------------------------------------------------------------- modes -- */

export function ModesScreen({
  mode,
  difficulty,
  onMode,
  onDifficulty,
  onSurvival,
  onLaunch,
  back,
}: MenuCallbacks & {
  mode: GameMode;
  difficulty: DifficultyId;
  onMode: (next: GameMode) => void;
  onDifficulty: (next: DifficultyId) => void;
  /** Switch the launch selection to the endless Rift Survival challenge. */
  onSurvival: () => void;
  onLaunch: () => void;
}) {
  const survival = difficulty === "survival";
  return (
    <MenuScreen
      route="modes"
      title="Game Modes"
      onBack={back}
      footer={
        <button type="button" className="play-button" onClick={onLaunch}>
          {mode === "pve" ? "Play" : "Find a Match"}
        </button>
      }
    >
      <MenuSection title="Arcade">
        <div className="mode-grid" role="radiogroup" aria-label="Arcade mode">
          {MODE_ORDER.map((id) => {
            // A challenge suppresses the arcade tick: the run about to launch
            // is Survival, and two ticked cards would be two answers to one
            // question.
            const active = !survival && mode === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`mode-card ${active ? "active" : ""}`}
                data-mode={id}
                onClick={() => onMode(id)}
              >
                <span className="option-check" aria-hidden="true">
                  {active ? "✓" : ""}
                </span>
                <b>{MODE_INFO[id].label}</b>
                <small>{MODE_INFO[id].blurb}</small>
              </button>
            );
          })}
        </div>
      </MenuSection>

      <MenuSection title="Challenges" hint="Solo runs with their own rules.">
        <div className="mode-grid" role="radiogroup" aria-label="Challenge">
          <button
            type="button"
            role="radio"
            aria-checked={survival}
            className={`mode-card ${survival ? "active" : ""}`}
            data-mode="survival"
            onClick={onSurvival}
          >
            <span className="option-check" aria-hidden="true">
              {survival ? "✓" : ""}
            </span>
            <b>{CHALLENGE_INFO.survival.label}</b>
            <small>{CHALLENGE_INFO.survival.blurb}</small>
          </button>
        </div>
      </MenuSection>

      {mode === "pvp" || survival ? null : (
        <MenuSection title="Difficulty">
          <OptionRow
            label="Difficulty"
            columns="stack"
            value={difficulty}
            options={DIFFICULTY_ORDER.map((id) => ({
              id,
              label: difficultyLabel(id),
              hint: difficultyBlurb(id),
            }))}
            onChange={onDifficulty}
          />
        </MenuSection>
      )}
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
      title="Ships"
      onBack={back}
      wide
      footer={
        <button type="button" className="play-button" onClick={onLaunch}>
          Play as {profile.name}
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
            {renderShip(ship, 132)}
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
            {profile.special.derivedFrom ? (
              <em className="ship-special-source">{profile.special.derivedFrom}</em>
            ) : null}
            <p>{profile.special.description}</p>
            {profile.special.differences.length > 0 ? (
              <ul className="ship-special-diff">
                {profile.special.differences.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      </div>
    </MenuScreen>
  );
}

/* -------------------------------------------------------------- settings -- */

export function SettingsScreen({
  back,
  viewMode,
  storedViewMode,
  onViewMode,
  thumbsticks,
  onThumbsticks,
  touchSize,
  onTouchSize,
  sound,
  onSound,
  soundLevel,
  onSoundLevel,
  cameraLock,
  onCameraLock,
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
  sound: boolean;
  onSound: (next: boolean) => void;
  soundLevel: SoundLevel;
  onSoundLevel: (next: SoundLevel) => void;
  cameraLock: boolean;
  onCameraLock: (next: boolean) => void;
  initials: string;
  onInitials: (next: string) => void;
}) {
  return (
    <MenuScreen route="settings" title="Settings" onBack={back}>
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
        <Toggle
          label="Thumbsticks"
          value={thumbsticks}
          onChange={onThumbsticks}
          disabled={viewMode === "pc"}
          hint={viewMode === "pc" ? "Touch or Both only" : undefined}
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
      </MenuSection>

      <MenuSection title="Audio">
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
      </MenuSection>

      <MenuSection title="Display">
        <Toggle
          label="Camera lock"
          value={cameraLock}
          onChange={onCameraLock}
          hint="Keep the camera centred on your ship"
        />
      </MenuSection>

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
    </MenuScreen>
  );
}

/* ------------------------------------------------------------------ info -- */

export function InfoScreen({
  back,
  go,
  viewMode,
  onCodex,
}: MenuCallbacks & { viewMode: ViewMode; onCodex: () => void }) {
  const touch = viewMode !== "pc";
  return (
    <MenuScreen route="info" title="Game Info" onBack={back} wide>
      <MenuSection title="How to play">
        <ol className="how-to">
          <li>
            <b>Charge</b>
            <span>Shoot the rival rift with your cannon until it produces a power-up.</span>
          </li>
          <li>
            <b>Collect</b>
            <span>Fly over the power-up to load it into your bin.</span>
          </li>
          <li>
            <b>Transmit</b>
            <span>Aim at the rift and fire the power-up back through it.</span>
          </li>
        </ol>
      </MenuSection>

      <MenuSection title="Controls">
        <dl className="control-list">
          <div>
            <dt>Move</dt>
            <dd>{touch ? "Left thumbstick · W A S D · arrows" : "W A S D or arrow keys"}</dd>
          </div>
          <div>
            <dt>Aim &amp; fire</dt>
            <dd>{touch ? "Right thumbstick · mouse · Space" : "Mouse, or Space to fire"}</dd>
          </div>
          <div>
            <dt>Fire power-up</dt>
            <dd>{touch ? "PUP button · E · right mouse" : "E or right mouse"}</dd>
          </div>
          <div>
            <dt>Ship special</dt>
            <dd>{touch ? "SPEC button · Q" : "Q"}</dd>
          </div>
          <div>
            <dt>Menu &amp; pause</dt>
            <dd>P or Escape</dd>
          </div>
        </dl>
      </MenuSection>

      <MenuSection title="Power-ups" hint="Every power-up the rift can produce.">
        <button type="button" className="menu-link-button" onClick={onCodex} aria-haspopup="dialog">
          Open the weapon codex
        </button>
      </MenuSection>

      <MenuSection title="Difficulty">
        <dl className="control-list">
          {DIFFICULTY_ORDER.map((id) => (
            <div key={id}>
              <dt>{difficultyLabel(id)}</dt>
              <dd>{difficultyBlurb(id)}</dd>
            </div>
          ))}
        </dl>
      </MenuSection>

      <MenuSection title="Challenges">
        <dl className="control-list">
          <div>
            <dt>{CHALLENGE_INFO.survival.label}</dt>
            <dd>
              {DIFFICULTIES.survival.blurb} The rift can still be breached: send power-ups back
              through it to collapse it, clear the arena, and bank a bonus before it reforms.
            </dd>
          </div>
        </dl>
      </MenuSection>

      <MenuSection title="Ships">
        <dl className="control-list">
          {SHIPS.map((s) => (
            <div key={s.id}>
              <dt>{s.name}</dt>
              <dd>{s.role}</dd>
            </div>
          ))}
        </dl>
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
          <button type="button" onClick={() => go("settings")}>
            Settings
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
