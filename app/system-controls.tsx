"use client";

/**
 * The global system layer: Menu and Fullscreen.
 *
 * This exists exactly once, outside every screen, and sits at the top of the
 * z-index scale. That is the whole point. Previously these two controls lived
 * in the page header, which the ship-select and mission-setup overlays painted
 * straight over — they were in the DOM with a real bounding box, so they
 * looked present to any test that measured them, but `elementFromPoint` said
 * another element owned every pixel. They were unusable on 5 of 6 screens.
 *
 * Nothing here knows which screen is showing. Screens cannot cover it, cannot
 * disable it, and must not render their own copy.
 */

import { useCallback, useSyncExternalStore } from "react";

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void>;
};
type FullscreenElement = Element & { webkitRequestFullscreen?: () => Promise<void> };

function currentFullscreenElement(): Element | null {
  const owner = document as FullscreenDocument;
  return document.fullscreenElement ?? owner.webkitFullscreenElement ?? null;
}

/**
 * Fullscreen state, subscribed rather than assumed.
 *
 * `requestFullscreen` can be refused — a permissions policy, a browser that
 * only allows it for video, a gesture the browser did not accept — so the
 * request's resolution is never treated as the answer. `fullscreenchange` is,
 * which also keeps the label right when the player leaves fullscreen with Esc
 * or a system gesture instead of the button.
 */
function subscribeFullscreen(listener: () => void) {
  document.addEventListener("fullscreenchange", listener);
  document.addEventListener("webkitfullscreenchange", listener);
  return () => {
    document.removeEventListener("fullscreenchange", listener);
    document.removeEventListener("webkitfullscreenchange", listener);
  };
}

const fullscreenSnapshot = () => Boolean(currentFullscreenElement());
const fullscreenServerSnapshot = () => false;

/** Support cannot change for the life of the document, so there is nothing to
 *  subscribe to — but the value still has to be read on the client only. */
const subscribeNever = () => () => {};

/**
 * iPhone Safari still gates the Fullscreen API for non-video elements. A
 * control that is visible and silently does nothing is worse than no control,
 * so this decides whether it is offered at all.
 */
function fullscreenSupportedSnapshot() {
  const owner = document as FullscreenDocument;
  const element = document.documentElement as FullscreenElement;
  return (
    Boolean(document.fullscreenEnabled) ||
    Boolean(owner.webkitFullscreenEnabled) ||
    typeof element.webkitRequestFullscreen === "function"
  );
}

export function useFullscreen(target: () => Element | null) {
  const active = useSyncExternalStore(
    subscribeFullscreen,
    fullscreenSnapshot,
    fullscreenServerSnapshot
  );
  const supported = useSyncExternalStore(
    subscribeNever,
    fullscreenSupportedSnapshot,
    fullscreenServerSnapshot
  );

  /** Always called straight from a click, never from an effect or a timer. */
  const toggle = useCallback(async () => {
    const owner = document as FullscreenDocument;
    try {
      if (currentFullscreenElement()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else await owner.webkitExitFullscreen?.();
        return;
      }
      const element = (target() ?? document.documentElement) as FullscreenElement;
      if (element.requestFullscreen) await element.requestFullscreen({ navigationUI: "hide" });
      else await element.webkitRequestFullscreen?.();
    } catch {
      // Refused. `fullscreenchange` never fires, so the label stays correct on
      // its own and the player simply keeps playing windowed.
    }
  }, [target]);

  return { active, supported, toggle };
}

export type GlobalSystemControlsProps = {
  /** True while a menu is open, so the button can offer the way back. */
  menuOpen: boolean;
  onToggleMenu: () => void;
  fullscreen: boolean;
  fullscreenSupported: boolean;
  onToggleFullscreen: () => void;
  /** Dims the layer during play without ever removing it. */
  dimmed: boolean;
};

/** A passive build marker displayed beside the product logo. */
export function BuildWatermark() {
  return (
    <div className="build-watermark" aria-hidden="true">
      ALPHA BUILD
    </div>
  );
}

export default function GlobalSystemControls({
  menuOpen,
  onToggleMenu,
  fullscreen,
  fullscreenSupported,
  onToggleFullscreen,
  dimmed,
}: GlobalSystemControlsProps) {
  return (
    <div className="system-controls" data-dimmed={dimmed ? "true" : "false"}>
      <button
        type="button"
        className="system-button system-menu"
        aria-expanded={menuOpen}
        onClick={onToggleMenu}
      >
        <span className="system-glyph" aria-hidden="true">
          {menuOpen ? "✕" : "☰"}
        </span>
        <span className="system-text">{menuOpen ? "Close" : "Menu"}</span>
      </button>

      {fullscreenSupported ? (
        <button
          type="button"
          className="system-button system-fullscreen"
          aria-pressed={fullscreen}
          onClick={onToggleFullscreen}
          // The visible text already changes with state; this keeps the
          // accessible name changing with it rather than going stale.
          aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          <span className="system-glyph" aria-hidden="true">
            {fullscreen ? "⤡" : "⤢"}
          </span>
          <span className="system-text">{fullscreen ? "Exit Fullscreen" : "Fullscreen"}</span>
        </button>
      ) : null}
    </div>
  );
}
