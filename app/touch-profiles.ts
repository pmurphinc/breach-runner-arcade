/**
 * Named touch-control layouts.
 *
 * Two profiles, and the split matters:
 *
 * - **M-Sticks** is exactly what the game has always done — a twin-stick pair
 *   positioned by the responsive `data-sticks` rules (docked, overlay, gutter)
 *   and sized by a three-step preset. It is untouched by anything here, and it
 *   stays the default. Nothing in this module is allowed to change it.
 * - **Custom** replaces those rules with explicit per-element geometry the
 *   player sets by hand, for pilots whose thumbs do not agree with the presets.
 *
 * Everything is pure and serialisable, so a layout can be validated, clamped,
 * mirrored, exported and re-imported without a DOM.
 *
 * ## Coordinate convention
 *
 * Borrowed deliberately, because it is the part that makes handedness cheap:
 *
 * - **x runs toward the screen centre**, measured inward from the element's own
 *   anchored edge. `x: 0` hugs that edge. It is never "distance from the left",
 *   which is what makes mirroring a one-field change instead of an arithmetic
 *   pass over every element.
 * - **y runs down** from the vertical centre of the viewport. Negative is above
 *   centre, positive below.
 *
 * Sizes and offsets are CSS pixels.
 */

export type TouchProfileId = "m-sticks" | "custom";

export const TOUCH_PROFILE_IDS = ["m-sticks", "custom"] as const;

export const TOUCH_PROFILE_LABELS: Record<TouchProfileId, string> = {
  "m-sticks": "M-Sticks",
  custom: "Custom",
};

export const TOUCH_PROFILE_HINTS: Record<TouchProfileId, string> = {
  "m-sticks": "The standard twin-stick layout. Size and height follow the presets.",
  custom: "Place and size every control yourself.",
};

/** Every control a Custom layout can place. */
export type TouchElementId = "move" | "aim" | "pup" | "spec" | "pause";

export const TOUCH_ELEMENT_IDS = ["move", "aim", "pup", "spec", "pause"] as const;

export const TOUCH_ELEMENT_LABELS: Record<TouchElementId, string> = {
  move: "Move",
  aim: "Aim",
  pup: "PUP",
  spec: "SPEC",
  pause: "Pause",
};

/** Which controls are sticks. Only these carry a dead zone. */
export const TOUCH_STICK_IDS = ["move", "aim"] as const;

export function isTouchStick(id: TouchElementId): id is (typeof TOUCH_STICK_IDS)[number] {
  return id === "move" || id === "aim";
}

/**
 * Which edge an element is anchored to, given the player's handedness.
 *
 * Right-handed puts aiming and the action buttons under the right thumb and
 * steering under the left — the same arrangement the reference layout describes
 * as "right-handed, steering on the left".
 */
export type TouchHand = "right" | "left";

export function touchElementEdge(id: TouchElementId, handed: TouchHand): "left" | "right" {
  const dominant = handed === "right" ? "right" : "left";
  const off = handed === "right" ? "left" : "right";
  return id === "move" ? off : dominant;
}

export type TouchElementGeometry = {
  /** Outer diameter, CSS px. */
  size: number;
  /** Inward from this element's anchored edge. */
  x: number;
  /** Down from the vertical centre of the viewport. */
  y: number;
  /** Sticks only: dead-zone diameter, always smaller than `size`. */
  deadzone: number;
};

export type CustomTouchLayout = {
  version: 1;
  handed: TouchHand;
  elements: Record<TouchElementId, TouchElementGeometry>;
};

export const CUSTOM_TOUCH_LAYOUT_VERSION = 1;

/**
 * Bounds for every field, as [min, max].
 *
 * These are the numbers the editor shows beside each input, so they are the
 * player's only cue about how far a control can travel. Deliberately generous
 * at the top end — a large tablet has room for a 300px stick — and floored at a
 * size that still clears the 44px minimum touch target.
 */
export const TOUCH_ELEMENT_RANGES = {
  size: {
    move: [88, 300],
    aim: [88, 300],
    pup: [44, 180],
    spec: [44, 180],
    pause: [44, 140],
  },
  deadzone: [0, 96],
  x: [-16, 340],
  y: [-460, 460],
} as const;

/**
 * Clamp, guarding only NaN.
 *
 * Infinity is deliberately left to clamp naturally to the matching bound rather
 * than being lumped in with NaN: a value that is too large means "as far as this
 * goes", and snapping it to the opposite end of the range would move a control
 * across the screen. NaN has no such reading, so it takes the low bound.
 */
function clampTo(value: number, range: readonly [number, number]) {
  if (Number.isNaN(value)) return range[0];
  return Math.min(range[1], Math.max(range[0], value));
}

function sizeRange(id: TouchElementId): readonly [number, number] {
  return TOUCH_ELEMENT_RANGES.size[id];
}

/**
 * Force one element's geometry into range.
 *
 * The dead zone is clamped against the element's own size as well as its
 * absolute bounds: a dead zone at or above the stick diameter would swallow the
 * whole control and leave a stick that cannot be pushed. Non-sticks have no dead
 * zone and are normalised to zero rather than carrying a stale value forward.
 */
export function clampTouchElement(id: TouchElementId, geometry: TouchElementGeometry): TouchElementGeometry {
  const size = Math.round(clampTo(geometry.size, sizeRange(id)));
  const deadzoneCeiling = Math.floor(size * 0.6);
  return {
    size,
    x: Math.round(clampTo(geometry.x, TOUCH_ELEMENT_RANGES.x)),
    y: Math.round(clampTo(geometry.y, TOUCH_ELEMENT_RANGES.y)),
    deadzone: isTouchStick(id)
      ? Math.round(Math.min(deadzoneCeiling, clampTo(geometry.deadzone, TOUCH_ELEMENT_RANGES.deadzone)))
      : 0,
  };
}

/**
 * The starting Custom layout.
 *
 * Chosen to land close to where the overlay preset already puts things, so
 * switching to Custom is not a jarring jump before the player has moved
 * anything. It is a starting point, not a copy of M-Sticks — M-Sticks is
 * responsive and this is not, so the two cannot agree at every viewport.
 */
export function defaultCustomTouchLayout(): CustomTouchLayout {
  return {
    version: CUSTOM_TOUCH_LAYOUT_VERSION,
    handed: "right",
    elements: {
      move: { size: 132, x: 12, y: 150, deadzone: 20 },
      aim: { size: 132, x: 12, y: 150, deadzone: 20 },
      pup: { size: 68, x: 18, y: 34, deadzone: 0 },
      spec: { size: 68, x: 96, y: 34, deadzone: 0 },
      pause: { size: 52, x: 18, y: -150, deadzone: 0 },
    },
  };
}

/**
 * Swap the layout's handedness.
 *
 * One field. Because x is measured inward from each element's own edge rather
 * than from the left of the screen, flipping which edge an element anchors to
 * mirrors the whole layout without touching a single coordinate.
 */
export function mirrorCustomTouchLayout(layout: CustomTouchLayout): CustomTouchLayout {
  return { ...layout, handed: layout.handed === "right" ? "left" : "right" };
}

function normalizeElement(id: TouchElementId, value: unknown): TouchElementGeometry {
  const fallback = defaultCustomTouchLayout().elements[id];
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<TouchElementGeometry>;
  return clampTouchElement(id, {
    size: typeof candidate.size === "number" ? candidate.size : fallback.size,
    x: typeof candidate.x === "number" ? candidate.x : fallback.x,
    y: typeof candidate.y === "number" ? candidate.y : fallback.y,
    deadzone: typeof candidate.deadzone === "number" ? candidate.deadzone : fallback.deadzone,
  });
}

/**
 * Accept anything and return a usable layout.
 *
 * Import runs untrusted text through here, and so does every read of persisted
 * settings, so a partial, stale or hostile payload has to degrade to defaults
 * field by field rather than throwing or producing a layout with a control
 * parked off-screen.
 */
export function normalizeCustomTouchLayout(value: unknown): CustomTouchLayout {
  const base = defaultCustomTouchLayout();
  if (!value || typeof value !== "object") return base;
  const candidate = value as Partial<CustomTouchLayout>;
  const source = candidate.elements as Record<string, unknown> | undefined;
  const elements = {} as Record<TouchElementId, TouchElementGeometry>;
  for (const id of TOUCH_ELEMENT_IDS) elements[id] = normalizeElement(id, source?.[id]);
  return {
    version: CUSTOM_TOUCH_LAYOUT_VERSION,
    handed: candidate.handed === "left" ? "left" : "right",
    elements,
  };
}

export function isTouchProfileId(value: unknown): value is TouchProfileId {
  return value === "m-sticks" || value === "custom";
}

/** Export payload. Pretty-printed because a player may well read or edit it. */
export function serializeCustomTouchLayout(layout: CustomTouchLayout): string {
  return JSON.stringify(normalizeCustomTouchLayout(layout), null, 2);
}

/** Import. Malformed text yields defaults rather than an exception. */
export function parseCustomTouchLayout(text: string): CustomTouchLayout {
  try {
    return normalizeCustomTouchLayout(JSON.parse(text));
  } catch {
    return defaultCustomTouchLayout();
  }
}

/**
 * The CSS custom properties a Custom layout publishes.
 *
 * Returned as data rather than written to the DOM here, so the mapping stays
 * testable and has exactly one definition. `--touch-<id>-edge` carries the
 * anchored side so the stylesheet can switch between `left:` and `right:`
 * without knowing anything about handedness.
 */
export function customTouchLayoutVariables(layout: CustomTouchLayout): Record<string, string> {
  const normalized = normalizeCustomTouchLayout(layout);
  const variables: Record<string, string> = {};
  for (const id of TOUCH_ELEMENT_IDS) {
    const geometry = normalized.elements[id];
    variables[`--touch-${id}-size`] = `${geometry.size}px`;
    variables[`--touch-${id}-x`] = `${geometry.x}px`;
    variables[`--touch-${id}-y`] = `${geometry.y}px`;
    variables[`--touch-${id}-edge`] = touchElementEdge(id, normalized.handed);
    if (isTouchStick(id)) variables[`--touch-${id}-deadzone`] = `${geometry.deadzone}px`;
  }
  return variables;
}
