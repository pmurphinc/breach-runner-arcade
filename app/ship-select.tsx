"use client";

/**
 * The arcade ship-selection scene.
 *
 * This is the first thing a player sees: a grid of every frame, a detail panel
 * that updates as they move through it, and an explicit confirmation before
 * anything launches. Silhouettes are drawn with the game's own canvas
 * primitive rather than shipped as images, so the scene costs no extra assets
 * and always matches what flies in the arena.
 *
 * Interaction is deliberately explicit on every input method: a tap highlights
 * and inspects, and only SELECT SHIP commits. Nothing here can start a match
 * by accident.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SHIPS, type ShipId } from "./game-data";
import {
  SHIP_ORDER,
  SHIP_PROFILES,
  compareShips,
  type ShipProfile,
  type StatComparison,
} from "./ship-data";
import { drawShipShape } from "./weapon-art";

/** One silhouette, drawn from the same primitive the arena uses. */
const ShipSilhouette = memo(function ShipSilhouette({
  id,
  size,
  dim = false,
  spin = false,
}: {
  id: ShipId;
  size: number;
  dim?: boolean;
  spin?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    let frame = 0;
    let angle = -Math.PI / 2;

    const paint = () => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, size, size);
      context.save();
      context.translate(size / 2, size / 2);
      context.rotate(angle);
      // The Flagship is drawn larger than the rest, so scale to the tile.
      context.scale(size / 90, size / 90);
      context.lineWidth = dim ? 1.6 : 2.2;
      context.strokeStyle = dim ? "#5d7d88" : "#69ecff";
      context.fillStyle = dim ? "rgba(93, 125, 136, .10)" : "rgba(86, 226, 255, .14)";
      drawShipShape(context, id, id === "flagship" ? 1.5 : 1.9);
      context.fill();
      context.stroke();
      context.restore();
    };

    paint();
    if (!spin) return;

    // A slow drift, not a spin: enough to read as alive without becoming
    // motion. Reduced-motion callers simply pass spin={false}.
    const tick = () => {
      angle += 0.004;
      paint();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dim, id, size, spin]);

  return <canvas ref={canvasRef} style={{ width: size, height: size }} aria-hidden="true" />;
});

/** A comparison row: bar plus both exact values, never colour alone. */
function ComparisonRow({ row, inspecting }: { row: StatComparison; inspecting: boolean }) {
  return (
    <div className="cmp-row" data-direction={row.direction}>
      <span className="cmp-label">{row.label}</span>
      <div className="cmp-bars">
        <div className="cmp-bar"><i style={{ width: `${Math.round(row.fraction * 100)}%` }} /></div>
        {inspecting ? (
          <div className="cmp-bar against">
            <i style={{ width: `${Math.round(row.againstFraction * 100)}%` }} />
          </div>
        ) : null}
      </div>
      <span className="cmp-value">{row.display}</span>
      {inspecting ? (
        <span className="cmp-delta">
          {row.direction === "same" ? "same as selected" : `${row.deltaDisplay} vs selected`}
        </span>
      ) : null}
    </div>
  );
}

function ShipDetail({
  profile,
  comparedWith,
  onSelect,
}: {
  profile: ShipProfile;
  /** The confirmed ship, when the player is inspecting a different one. */
  comparedWith: ShipId | null;
  onSelect: () => void;
}) {
  const rows = useMemo(
    () => compareShips(profile.id, comparedWith ?? profile.id),
    [comparedWith, profile.id]
  );
  const inspecting = comparedWith !== null && comparedWith !== profile.id;

  return (
    <section className="ship-detail" aria-live="polite">
      <header>
        <p className="detail-role">{profile.role}</p>
        <h3>{profile.name}</h3>
        <p className="detail-tier">
          <span>Suggested experience</span>
          <b>{profile.experience}</b>
        </p>
      </header>

      {profile.locked ? (
        <p className="detail-lock">
          <b>LOCKED</b> {profile.lockRequirement}
        </p>
      ) : null}

      <p className="detail-playstyle">{profile.playstyle}</p>

      <div className="detail-special">
        <span>Special ability</span>
        <b>{profile.special.name}</b>
        <p>{profile.special.description}</p>
        <small>
          Press <kbd>{profile.specialInput.keyboard}</kbd> on a keyboard, or{" "}
          <kbd>{profile.specialInput.touch}</kbd> on touch · {profile.special.cooldownSeconds}s cooldown
        </small>
      </div>

      <div className="detail-traits">
        <div>
          <span>Strengths</span>
          <ul>{profile.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        <div>
          <span>Weaknesses</span>
          <ul>{profile.weaknesses.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      </div>

      <div className="detail-stats">
        <span className="detail-stats-head">
          {inspecting ? `Compared with ${SHIP_PROFILES[comparedWith].name}` : "Statistics"}
        </span>
        {rows.map((row) => (
          <ComparisonRow key={row.key} row={row} inspecting={inspecting} />
        ))}
      </div>

      <button
        type="button"
        className="detail-select"
        onClick={onSelect}
        disabled={profile.locked}
      >
        {profile.locked ? `NEEDS ${profile.unlock}` : "SELECT SHIP"}
      </button>
    </section>
  );
}

export type ShipSelectProps = {
  /** The ship that will fly unless the player picks another. */
  selected: ShipId;
  onConfirm: (id: ShipId) => void;
  /** Shown only when there is somewhere to go back to. */
  onBack?: () => void;
  reducedMotion: boolean;
  /** Locks the grid once a PvP countdown has begun. */
  locked?: boolean;
};

export default function ShipSelect({
  selected,
  onConfirm,
  onBack,
  reducedMotion,
  locked = false,
}: ShipSelectProps) {
  // Highlight starts on the remembered ship, so a returning player sees their
  // frame already picked out but still has to confirm it.
  const [focused, setFocused] = useState<ShipId>(selected);
  const [confirming, setConfirming] = useState<ShipId | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const profile = SHIP_PROFILES[focused];

  const confirm = useCallback(
    (id: ShipId) => {
      if (locked || SHIP_PROFILES[id].locked) return;
      // A brief confirmation beat before Mission Setup, so the choice lands.
      setConfirming(id);
      const delay = reducedMotion ? 0 : 420;
      window.setTimeout(() => onConfirm(id), delay);
    },
    [locked, onConfirm, reducedMotion]
  );

  /** Arrow keys and WASD walk the grid; Enter confirms; Escape goes back. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (locked) return;
    const columns = columnCount(gridRef.current);
    const index = SHIP_ORDER.indexOf(focused);
    let next = index;

    switch (event.key) {
      case "ArrowRight": case "d": case "D": next = index + 1; break;
      case "ArrowLeft": case "a": case "A": next = index - 1; break;
      case "ArrowDown": case "s": case "S": next = index + columns; break;
      case "ArrowUp": case "w": case "W": next = index - columns; break;
      case "Home": next = 0; break;
      case "End": next = SHIP_ORDER.length - 1; break;
      case "Enter": case " ":
        event.preventDefault();
        confirm(focused);
        return;
      case "Escape":
        if (onBack) { event.preventDefault(); onBack(); }
        return;
      default:
        return;
    }

    event.preventDefault();
    const clamped = Math.max(0, Math.min(SHIP_ORDER.length - 1, next));
    setFocused(SHIP_ORDER[clamped]);
  };

  // Keep the DOM focus on the highlighted tile so keyboard focus is always
  // visible and screen readers follow the selection.
  useEffect(() => {
    const tile = gridRef.current?.querySelector<HTMLButtonElement>(`[data-ship="${focused}"]`);
    if (tile && document.activeElement !== tile && gridRef.current?.contains(document.activeElement)) {
      tile.focus();
    }
  }, [focused]);

  return (
    <div className="ship-select" data-confirming={confirming ? "true" : "false"}>
      <div className="select-head">
        <p className="select-pilot">PILOT ONE</p>
        <h2>SELECT YOUR SHIP</h2>
        <p className="select-sub">
          {SHIPS.length} frames in the hangar. Highlight one to read it, then confirm to launch.
        </p>
      </div>

      <div className="select-body">
        <div
          className="ship-grid"
          role="radiogroup"
          aria-label="Choose a ship"
          ref={gridRef}
          onKeyDown={onKeyDown}
        >
          {SHIP_ORDER.map((id) => {
            const entry = SHIP_PROFILES[id];
            const isFocused = id === focused;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={isFocused}
                data-ship={id}
                data-locked={entry.locked ? "true" : "false"}
                data-selected={id === selected ? "true" : "false"}
                tabIndex={isFocused ? 0 : -1}
                disabled={locked}
                className={`ship-tile ${isFocused ? "focused" : ""}`}
                // A tap highlights and inspects. It never launches: only the
                // explicit SELECT SHIP action commits.
                onClick={() => setFocused(id)}
                onMouseEnter={() => { if (!locked) setFocused(id); }}
                onDoubleClick={() => confirm(id)}
              >
                <ShipSilhouette
                  id={id}
                  size={72}
                  dim={entry.locked}
                  spin={isFocused && !reducedMotion}
                />
                <b>{entry.name.replace(/^The /, "")}</b>
                <small>{entry.role}</small>
                <i className="tile-state">
                  {entry.locked ? entry.unlock : id === selected ? "SELECTED" : "AVAILABLE"}
                </i>
              </button>
            );
          })}
        </div>

        <ShipDetail
          profile={profile}
          comparedWith={selected}
          onSelect={() => confirm(focused)}
        />
      </div>

      <div className="select-foot">
        {onBack ? (
          <button type="button" className="select-back" onClick={onBack}>BACK</button>
        ) : <span />}
        <p className="select-hint">
          Arrow keys or WASD to move · Enter to confirm · tap a frame to inspect it
        </p>
      </div>

      {confirming ? (
        <div className="select-confirm" role="status">
          <ShipSilhouette id={confirming} size={120} spin={!reducedMotion} />
          <b>{SHIP_PROFILES[confirming].name}</b>
          <span>READY FOR LAUNCH</span>
        </div>
      ) : null}
    </div>
  );
}

/** How many tiles fit on a row right now, so arrow keys walk the real grid. */
function columnCount(grid: HTMLElement | null) {
  if (!grid) return 4;
  const styles = getComputedStyle(grid);
  const columns = styles.gridTemplateColumns.split(" ").filter(Boolean).length;
  return Math.max(1, columns);
}
