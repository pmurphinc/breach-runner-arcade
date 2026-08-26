/**
 * One layout calculation for the whole interface.
 *
 * Previously the arena size lived in JavaScript while the cockpit width lived
 * in CSS, and the two guessed at each other. That is how Wide could hand the
 * cockpit 2040px on a 2048px screen and push controls off the edge. Everything
 * that decides how much room the interface has is now computed here, from
 * measured numbers, and the shell and CSS both read the result.
 *
 * Pure: `budgetFor` takes a plain description of the viewport and returns a
 * plain budget, so every preset can be tested at any size without a browser.
 */

/** The three screen presets that replaced Compact / Standard / Wide. */
export type ScreenPreset = "fit" | "balanced" | "arena";

export const SCREEN_PRESETS: ScreenPreset[] = ["fit", "balanced", "arena"];

export const PRESET_LABELS: Record<ScreenPreset, string> = {
  fit: "Fit Screen",
  balanced: "Balanced",
  arena: "Arena Focus",
};

export const PRESET_BLURBS: Record<ScreenPreset, string> = {
  fit: "Everything on screen, guaranteed. The arena gives way before any control does.",
  balanced: "A bigger arena with every control still in place. Side panels scroll on their own.",
  arena: "The largest possible arena. Panels become drawers and the essentials stay overlaid.",
};

/** Anything invalid or missing falls back to the safest preset. */
export const DEFAULT_PRESET: ScreenPreset = "fit";

export function isScreenPreset(value: unknown): value is ScreenPreset {
  return typeof value === "string" && (SCREEN_PRESETS as string[]).includes(value);
}

export function normalizePreset(value: unknown): ScreenPreset {
  return isScreenPreset(value) ? value : DEFAULT_PRESET;
}

/** Where touch controls should come from, independent of layout mode. */
export type TouchControlMode = "auto" | "show" | "hide";

export type SticksMode = "docked" | "overlay" | "gutter";

/** Everything measured about the viewport, gathered in one place. */
export type ViewportInput = {
  /** visualViewport width when available, so browser chrome is accounted for. */
  width: number;
  height: number;
  /** visualViewport.scale — pinch zoom and browser zoom both land here. */
  scale: number;
  dpr: number;
  safeTop: number;
  safeRight: number;
  safeBottom: number;
  safeLeft: number;
  /** Touch hardware is detected separately from layout mode, on purpose. */
  touch: boolean;
  /** No precise pointer: a real handheld rather than a touchscreen laptop. */
  coarse: boolean;
  touchControls: TouchControlMode;
  /** Relative size of the thumbsticks, chosen by the player. */
  stickScale: number;
};

/**
 * Fixed chrome heights, in CSS pixels, kept in step with globals.css.
 * These are budget line items, not guesses: every one of them is a strip the
 * arena cannot use.
 */
export const CHROME = {
  top: 48,
  /** Match bar: score, hull, opponent state. */
  hud: 44,
  /** Power-up inventory plus the primary action. */
  dock: 62,
  gap: 6,
} as const;

/** Below this the arena stops being playable, so something else must give. */
export const MIN_ARENA = 220;

export type LayoutBudget = {
  preset: ScreenPreset;
  orientation: "portrait" | "landscape";
  form: "phone" | "tablet" | "desktop";
  /** A real handheld, as opposed to a touchscreen laptop. */
  handheld: boolean;
  /** Too narrow for an inline control row; the menu drawer takes over. */
  narrow: boolean;
  /** Square arena edge in CSS pixels. */
  arena: number;
  stick: number;
  sticks: SticksMode;
  /** Whether thumbsticks are rendered at all. */
  showTouchControls: boolean;
  /** How the informational side panels behave at this size. */
  panels: "full" | "scroll" | "drawer";
  /** True when the arena had to be trimmed to keep a control on screen. */
  trimmed: boolean;
  /** Usable space after safe-area insets, for the shell to lay out within. */
  usableWidth: number;
  usableHeight: number;
};

function cap(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Should thumbsticks appear at all? Capability and preference, not layout. */
export function resolveTouchControls(input: ViewportInput) {
  if (input.touchControls === "show") return true;
  if (input.touchControls === "hide") return false;
  return input.touch;
}

/**
 * Works out how much room everything gets.
 *
 * The order matters: fixed chrome is subtracted first, then touch controls if
 * they are visible, and the arena takes what is left — never the other way
 * round. That is what guarantees a control is never pushed off screen.
 */
export function budgetFor(input: ViewportInput, preset: ScreenPreset): LayoutBudget {
  const safePreset = normalizePreset(preset);

  // Browser zoom shrinks the CSS pixels available; visualViewport already
  // reports the zoomed size, so scale is only used to keep the minimum arena
  // honest at high zoom.
  const usableWidth = Math.max(0, input.width - input.safeLeft - input.safeRight);
  const usableHeight = Math.max(0, input.height - input.safeTop - input.safeBottom);

  const shortEdge = Math.min(usableWidth, usableHeight);
  const orientation = usableWidth >= usableHeight ? "landscape" : "portrait";
  const handheld = input.touch && (input.coarse || shortEdge < 950);
  const form: LayoutBudget["form"] = !input.touch
    ? "desktop"
    : shortEdge < 600
      ? "phone"
      : "tablet";
  const narrow = usableWidth <= 980;
  const showTouchControls = resolveTouchControls(input);

  // Arena Focus turns panels into drawers; Fit and Balanced keep them, but
  // anything narrow has no room for a permanent panel either way.
  const panels: LayoutBudget["panels"] =
    safePreset === "arena" || narrow ? "drawer" : safePreset === "fit" ? "scroll" : "scroll";

  const gap = CHROME.gap;
  const stickBase = orientation === "landscape"
    // Phone landscape controls float over the playfield.  They deliberately
    // use a smaller visual disc than tablet/desktop touch controls while the
    // hit surface remains at least 78px (well above the 44px target).
    ? form === "phone"
      ? Math.min(usableWidth * 0.115, usableHeight * 0.25)
      : Math.min(usableWidth * 0.16, usableHeight * 0.34)
    : Math.min(usableWidth * 0.3, usableHeight * 0.24);
  // Scale after clamping, not before: on a large tablet the natural size
  // already hits the ceiling, so scaling first meant the player's size
  // preference did nothing at all.
  const stick = showTouchControls
    ? Math.round(cap(cap(stickBase, 96, 150) * input.stickScale, 72, 190))
    : 0;

  // Every strip the arena cannot use. The dock carries the inventory and the
  // primary action, so it is never negotiable.
  const fixedChrome = CHROME.top + CHROME.dock + gap * 3;
  const withHud = fixedChrome + CHROME.hud;

  let arena: number;
  let sticks: SticksMode;
  let trimmed = false;

  if (orientation === "landscape") {
    if (form === "phone") {
      // A phone is not a miniature tablet.  Its arena is a viewport and the
      // HUD/sticks overlay it; no portrait-shaped centre column or gutters.
      sticks = "overlay";
      arena = usableHeight < MIN_ARENA + 80 ? MIN_ARENA : usableWidth;
      trimmed = usableHeight < MIN_ARENA + 80;
    } else {
      // Beside the arena keeps it completely clear, but on a short wide screen
      // the gutters cost more than floating the sticks over the lower corners.
      const gutterWidth = showTouchControls ? 2 * (stick + 20) : 0;
      // Gutters change how much *width* the arena gets, not how much height:
      // the inventory and primary action still sit below it. Subtracting only
      // the top bar here is what used to push the dock off a wide screen.
      const gutterArena = Math.min(usableHeight - fixedChrome, usableWidth - gutterWidth - gap * 2);
      // Same vertical budget as the gutter arrangement — overlaying the sticks
      // changes what covers the arena, not how much height the chrome needs.
      const overlayArena = Math.min(usableWidth - gap * 2, usableHeight - fixedChrome);
      const preferOverlay = safePreset === "arena" || overlayArena > gutterArena * 1.15;
      sticks = showTouchControls ? (preferOverlay ? "overlay" : "gutter") : "overlay";
      arena = preferOverlay || !showTouchControls ? overlayArena : gutterArena;
    }
  } else {
    const full = usableWidth - gap * 2;
    // Prefer the arrangement where nothing overlaps the arena, but only while
    // the arena still gets most of the width.
    const dockedArena = Math.min(full, usableHeight - withHud - stick - gap);
    const overlayArena = Math.min(full, usableHeight - fixedChrome);
    const canDock = showTouchControls && safePreset !== "arena" && dockedArena >= full * 0.82;
    sticks = canDock ? "docked" : "overlay";
    arena = canDock ? dockedArena : overlayArena;
  }

  // Fit Screen never lets the arena win an argument with a control. Balanced
  // gives the arena more room; Arena Focus gives it everything left over.
  if (safePreset === "fit" && !(form === "phone" && orientation === "landscape")) {
    const ceiling = Math.min(usableWidth - gap * 2, usableHeight - fixedChrome);
    if (arena > ceiling) {
      arena = ceiling;
      trimmed = true;
    }
  }

  if (arena < MIN_ARENA) {
    // The screen genuinely cannot fit everything. Hold the arena at its minimum
    // and let the shell scroll its panels rather than shrink into uselessness.
    arena = MIN_ARENA;
    trimmed = true;
  }

  return {
    preset: safePreset,
    orientation,
    form,
    handheld,
    narrow,
    arena: Math.round(arena),
    stick,
    sticks,
    showTouchControls,
    panels,
    trimmed,
    usableWidth: Math.round(usableWidth),
    usableHeight: Math.round(usableHeight),
  };
}

/**
 * Reads the live viewport.
 *
 * Prefers `visualViewport`, which reports what is actually visible once
 * browser chrome, the on-screen keyboard and pinch zoom are taken into
 * account; `innerWidth`/`innerHeight` is the fallback.
 */
export function readViewport(
  touchControls: TouchControlMode = "auto",
  stickScale = 1
): ViewportInput {
  const visual = typeof window !== "undefined" ? window.visualViewport : null;
  const width = visual?.width ?? window.innerWidth;
  const height = visual?.height ?? window.innerHeight;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  // Fire OS Silk can report a fine pointer and zero touch points despite being
  // touch-only, so its user agent counts as touch hardware.
  const uaTouch = /Android|\bSilk\/|Kindle|KF[A-Z]{2,}/i.test(navigator.userAgent);
  const safe = readSafeAreaInsets();

  return {
    width,
    height,
    scale: visual?.scale ?? 1,
    dpr: window.devicePixelRatio || 1,
    ...safe,
    touch: uaTouch || navigator.maxTouchPoints > 0 || coarse || "ontouchstart" in window,
    coarse,
    touchControls,
    stickScale,
  };
}

/** Safe-area insets, read from CSS custom properties the shell publishes. */
function readSafeAreaInsets() {
  try {
    const styles = getComputedStyle(document.documentElement);
    const read = (name: string) => Number.parseFloat(styles.getPropertyValue(name)) || 0;
    return {
      safeTop: read("--safe-top"),
      safeRight: read("--safe-right"),
      safeBottom: read("--safe-bottom"),
      safeLeft: read("--safe-left"),
    };
  } catch {
    return { safeTop: 0, safeRight: 0, safeBottom: 0, safeLeft: 0 };
  }
}

/** True when two budgets would render identically, to skip React work. */
export function budgetsEqual(a: LayoutBudget, b: LayoutBudget) {
  return (
    a.preset === b.preset &&
    a.orientation === b.orientation &&
    a.form === b.form &&
    a.handheld === b.handheld &&
    a.narrow === b.narrow &&
    a.arena === b.arena &&
    a.stick === b.stick &&
    a.sticks === b.sticks &&
    a.showTouchControls === b.showTouchControls &&
    a.panels === b.panels &&
    a.trimmed === b.trimmed &&
    a.usableWidth === b.usableWidth &&
    a.usableHeight === b.usableHeight
  );
}
