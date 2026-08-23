"use client";

/**
 * Single-screen carousel used to choose one of Wormhole Arcade's eight ships.
 * The model stays central while exact, colour-coded statistics surround it.
 * Arrow buttons, swipe-friendly direct dots, keyboard arrows/A/D and an
 * explicit SELECT SHIP action all change or confirm the same focused frame.
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { SHIPS, type ShipId } from "./game-data";
import { SHIP_ORDER, SHIP_PROFILES } from "./ship-data";
import { drawShipShape } from "./weapon-art";

const ShipSilhouette = memo(function ShipSilhouette({
  id,
  size,
  spin = false,
}: {
  id: ShipId;
  size: number;
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
      context.scale(size / 90, size / 90);
      context.lineWidth = 2.2;
      context.strokeStyle = "#69ecff";
      context.fillStyle = "rgba(86, 226, 255, .14)";
      drawShipShape(context, id, id === "flagship" ? 1.5 : 1.9);
      context.fill();
      context.stroke();
      context.restore();
    };

    paint();
    if (!spin) return;
    const tick = () => {
      angle += 0.004;
      paint();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [id, size, spin]);

  return <canvas ref={canvasRef} style={{ width: size, height: size }} aria-hidden="true" />;
});

const CARD_ORDER = [
  { key: "hull", label: "HULL" },
  { key: "maxSpeed", label: "SPEED" },
  { key: "gun", label: "GUN" },
  { key: "thrust", label: "THRUST" },
  { key: "turn", label: "HANDLING" },
  { key: "acceleration", label: "ACCEL" },
] as const;

export type ShipSelectProps = {
  selected: ShipId;
  onConfirm: (id: ShipId) => void;
  onBack?: () => void;
  reducedMotion: boolean;
  /** Locks selection once a PvP countdown has begun. */
  locked?: boolean;
};

export default function ShipSelect({
  selected,
  onConfirm,
  onBack,
  reducedMotion,
  locked = false,
}: ShipSelectProps) {
  const [focused, setFocused] = useState<ShipId>(selected);
  const [confirming, setConfirming] = useState<ShipId | null>(null);
  const carouselRef = useRef<HTMLDivElement>(null);
  const profile = SHIP_PROFILES[focused];
  const index = SHIP_ORDER.indexOf(focused);

  const move = useCallback((direction: -1 | 1) => {
    if (locked) return;
    const next = (SHIP_ORDER.indexOf(focused) + direction + SHIP_ORDER.length) % SHIP_ORDER.length;
    setFocused(SHIP_ORDER[next]);
  }, [focused, locked]);

  const confirm = useCallback(() => {
    if (locked) return;
    setConfirming(focused);
    const delay = reducedMotion ? 0 : 420;
    window.setTimeout(() => onConfirm(focused), delay);
  }, [focused, locked, onConfirm, reducedMotion]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (locked) return;
    if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setFocused(SHIP_ORDER[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      setFocused(SHIP_ORDER[SHIP_ORDER.length - 1]);
    } else if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
      event.preventDefault();
      confirm();
    } else if (event.key === "Escape" && onBack) {
      event.preventDefault();
      onBack();
    }
  };

  return (
    <div className="ship-select" data-confirming={confirming ? "true" : "false"}>
      <header className="select-head">
        <p className="select-pilot">PILOT ONE · FRAME {index + 1}/{SHIPS.length}</p>
        <h2>SELECT YOUR SHIP</h2>
      </header>

      <div
        className="ship-carousel"
        role="radiogroup"
        aria-label="Choose a ship"
        aria-activedescendant={`ship-dot-${focused}`}
        tabIndex={0}
        ref={carouselRef}
        onKeyDown={onKeyDown}
      >
        <div className="carousel-title" aria-live="polite">
          <p>{profile.role}</p>
          <h3>{profile.name}</h3>
          <span>{focused === selected ? "CURRENT SELECTION" : "AVAILABLE"}</span>
        </div>

        <button type="button" className="carousel-arrow previous" onClick={() => move(-1)} disabled={locked} aria-label="Previous ship">‹</button>

        <div className="carousel-stage">
          <div className="carousel-model">
            <span className="model-orbit" aria-hidden="true" />
            <ShipSilhouette id={focused} size={210} spin={!reducedMotion} />
          </div>

          {CARD_ORDER.map(({ key, label }) => {
            const stat = profile.stats.find((entry) => entry.key === key)!;
            return (
              <article className="carousel-stat" data-stat={key} key={key}>
                <span>{label}</span>
                <b>{stat.display}</b>
                <div aria-hidden="true"><i style={{ width: `${Math.round(stat.fraction * 100)}%` }} /></div>
              </article>
            );
          })}
        </div>

        <button type="button" className="carousel-arrow next" onClick={() => move(1)} disabled={locked} aria-label="Next ship">›</button>

        <section className="carousel-special">
          <span>SPECIAL · <kbd>Q</kbd> / <kbd>SPEC</kbd> · {profile.special.cooldownSeconds}S</span>
          <b>{profile.special.name}</b>
          <p>{profile.special.description}</p>
        </section>

        <p className="carousel-playstyle">{profile.playstyle}</p>

        <div className="carousel-dots" aria-label="All ships">
          {SHIP_ORDER.map((id, dotIndex) => (
            <button
              id={`ship-dot-${id}`}
              key={id}
              type="button"
              role="radio"
              aria-checked={id === focused}
              data-ship={id}
              onClick={() => { if (!locked) setFocused(id); }}
              disabled={locked}
              aria-label={`${SHIP_PROFILES[id].name}, frame ${dotIndex + 1} of ${SHIP_ORDER.length}`}
            >
              <span>{dotIndex + 1}</span>
            </button>
          ))}
        </div>

        <footer className="carousel-actions">
          {onBack ? <button type="button" className="select-back" onClick={onBack}>BACK</button> : <span />}
          <p>← → or A / D to browse · Enter to confirm</p>
          <button type="button" className="detail-select" onClick={confirm} disabled={locked}>SELECT SHIP</button>
        </footer>
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
