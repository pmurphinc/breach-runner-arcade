"use client";

/**
 * Shared menu primitives.
 *
 * Every menu surface is built from these, so a new screen inherits the safe
 * layout, the focus handling and the arcade styling instead of inventing its
 * own. That is the fix for the drift: there is no longer a place to put a
 * one-off rule, because screens do not own their own chrome.
 */

import { useCallback, useEffect, useRef, type ReactNode } from "react";

/** Focusable things, for the trap and for roving focus. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab inside an open screen and sends Escape back.
 *
 * Roving-tabindex controls (the segmented selectors) carry `tabindex="-1"` on
 * every option but the active one, so they are filtered out — including them
 * is what previously made the "last" element the wrong one and let Tab escape.
 */
export function useScreenKeys(
  panel: React.RefObject<HTMLElement | null>,
  onBack: () => void,
  enabled = true
) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        onBack();
        return;
      }
      if (event.key !== "Tab") return;
      /*
       * The trap spans the screen *and* the global system layer.
       *
       * Menu and Fullscreen live outside the dialog by design, so a trap
       * scoped to the panel alone would make them unreachable by keyboard for
       * as long as any menu is open — controls that are required to be
       * available everywhere, to everyone. Including the layer keeps the
       * keyboard inside the two things that are actually on screen.
       */
      const system = document.querySelector(".system-controls");
      const focusable = [
        ...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
        ...(system?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
      ]
        .filter((element) => element.tabIndex >= 0 && element.offsetParent !== null)
        // Sorted into document order, because the system layer is rendered
        // before the screens. Concatenating the two lists would put the wrong
        // element last, and the wrap would then hand focus to the page behind.
        .sort((a, b) =>
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
        );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enabled, onBack, panel]);
}

export type MenuScreenProps = {
  /** Shown in the screen header. */
  title: string;
  /** Small line above the title. Optional; most screens do not need one. */
  eyebrow?: string;
  onBack: () => void;
  /** Label for the back control — "Resume" when the game is behind it. */
  backLabel?: string;
  /**
   * Hides the back control on a root screen with nothing behind it. The global
   * Menu button still closes the menu, so there is never a dead end.
   */
  hideBack?: boolean;
  /** Pinned below the scrolling region: the screen's primary action. */
  footer?: ReactNode;
  children: ReactNode;
  /** Widens the content column for screens that genuinely use the room. */
  wide?: boolean;
  /** Marks the screen for styling hooks and tests. */
  route: string;
};

/**
 * The one screen container.
 *
 * `grid-template-rows: auto minmax(0, 1fr) auto` is what makes short viewports
 * work: the header and footer are sized by content and the middle region takes
 * what is left, down to zero, and scrolls. The primary action therefore cannot
 * be pushed off the bottom of a landscape phone, which is exactly what used to
 * happen — and no screen has to opt into that behaviour.
 */
export function MenuScreen({
  title,
  eyebrow,
  onBack,
  backLabel = "Back",
  hideBack = false,
  footer,
  children,
  wide = false,
  route,
}: MenuScreenProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = `screen-${route}-title`;

  useScreenKeys(panelRef, onBack);

  useEffect(() => {
    // Focus the panel itself rather than the first control, so a screen does
    // not open with a random button looking pressed, but the keyboard is still
    // inside the dialog straight away.
    panelRef.current?.focus({ preventScroll: true });
  }, [route]);

  return (
    <div className="menu-screen" data-route={route} data-wide={wide ? "true" : "false"}>
      <div
        className="menu-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="menu-header">
          {hideBack ? null : (
            <button type="button" className="menu-back" onClick={onBack}>
              <span aria-hidden="true">‹</span>
              {backLabel}
            </button>
          )}
          <div className="menu-heading">
            {eyebrow ? <p className="menu-eyebrow">{eyebrow}</p> : null}
            <h2 id={headingId}>{title}</h2>
          </div>
        </header>

        <div className="menu-content">{children}</div>

        {footer ? <footer className="menu-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

/** A titled group inside a screen. */
export function MenuSection({
  title,
  hint,
  children,
}: {
  title?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="menu-section">
      {title ? <h3>{title}</h3> : null}
      {hint ? <p className="menu-section-hint">{hint}</p> : null}
      {children}
    </section>
  );
}

/**
 * A row of options that behaves as one control.
 *
 * ARIA radiogroup with roving tabindex: one tab stop, arrows to move, Home and
 * End to jump. That is the shape a gamepad d-pad maps onto without changes,
 * which is the point — the controller work later is a matter of feeding key
 * events in, not restructuring the menu.
 */
export function OptionRow<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  columns = "auto",
}: {
  label: string;
  value: T;
  options: readonly { id: T; label: string; hint?: string }[];
  onChange: (next: T) => void;
  disabled?: boolean;
  columns?: "auto" | "stack";
}) {
  const groupId = `opt-${label.replace(/\W+/g, "-").toLowerCase()}`;

  const move = useCallback(
    (delta: number) => {
      const index = options.findIndex((option) => option.id === value);
      const next = options[(index + delta + options.length) % options.length];
      if (next) onChange(next.id);
    },
    [onChange, options, value]
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      onChange(options[0].id);
    } else if (event.key === "End") {
      event.preventDefault();
      onChange(options[options.length - 1].id);
    }
  };

  return (
    <div className="option-row" data-columns={columns}>
      <span className="option-label" id={groupId}>
        {label}
      </span>
      <div
        className="option-choices"
        role="radiogroup"
        aria-labelledby={groupId}
        onKeyDown={onKeyDown}
      >
        {options.map((option) => {
          const active = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              disabled={disabled}
              className={active ? "active" : ""}
              data-choice={option.id}
              onClick={() => onChange(option.id)}
            >
              {/* The check mark carries the state as well as the colour, so
                  selection is never signalled by colour alone. */}
              <span className="option-check" aria-hidden="true">
                {active ? "✓" : ""}
              </span>
              <b>{option.label}</b>
              {option.hint ? <small>{option.hint}</small> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** On/off, as a real switch. */
export function Toggle({
  label,
  value,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="ui-toggle">
      <span className="ui-toggle-label">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!value)}
      >
        <i aria-hidden="true" />
        <span>{value ? "ON" : "OFF"}</span>
      </button>
    </div>
  );
}

/**
 * A summary line with an inline way to change it.
 *
 * This is what replaces walking the player through a full screen per choice:
 * the value is visible where the decision is made, and editing it is opt-in.
 */
export function SummaryRow({
  label,
  value,
  detail,
  actionLabel = "Change",
  onAction,
}: {
  label: string;
  value: string;
  detail?: string;
  actionLabel?: string;
  onAction: () => void;
}) {
  return (
    <div className="summary-row">
      <div className="summary-text">
        <span>{label}</span>
        <b>{value}</b>
        {detail ? <small>{detail}</small> : null}
      </div>
      <button type="button" className="summary-action" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}
