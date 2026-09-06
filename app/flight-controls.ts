/**
 * How a thumbstick becomes flight.
 *
 * Two schemes, and the difference is what the sticks *mean*.
 *
 * **Classic** is the original Wormhole arrangement, and the one this game is
 * likely to be found by: the left stick both aims the hull and works the
 * throttle, separated by a deadzone. Inside the deadzone the ship turns and
 * does not accelerate, so a small push is a pure course correction; past the
 * deadzone the engine lights and the ship drives the way it is facing. The
 * right-hand control is not a stick at all — it is the trigger, and shots leave
 * along whatever heading the hull already holds.
 *
 * **Twin-stick** is what this game shipped with: the left stick is thrust in a
 * direction and the right stick aims independently, so the ship can strafe
 * while shooting somewhere else.
 *
 * The whole difference lives in two numbers per frame — a heading and a
 * throttle — which is why this module returns exactly that and nothing else.
 * The simulation already scales acceleration by `intent.magnitude` and already
 * turns the hull whenever an intent carries a heading, so "turn without
 * accelerating" needs no new physics: it is an active intent with a magnitude
 * of zero.
 */

export type ControlProfile = "classic" | "twinStick";

export const CONTROL_PROFILES: readonly ControlProfile[] = ["classic", "twinStick"];

export const CONTROL_PROFILE_LABELS: Record<ControlProfile, string> = {
  classic: "CLASSIC",
  twinStick: "TWIN STICK",
};

export const CONTROL_PROFILE_HINTS: Record<ControlProfile, string> = {
  classic: "Left stick turns; push past the ring to burn. Right pad fires ahead.",
  twinStick: "Left stick flies, right stick aims and fires independently.",
};

export function isControlProfile(value: unknown): value is ControlProfile {
  return typeof value === "string" && (CONTROL_PROFILES as readonly string[]).includes(value);
}

/**
 * Travel below which the stick is treated as centred.
 *
 * A finger resting dead centre still jitters by a pixel or two, and turning the
 * hull to chase that reads as the ship twitching on its own. Expressed as a
 * fraction of the stick's travel so it scales with the layout rather than
 * assuming a size.
 */
export const STICK_CENTRE_FRACTION = 0.08;

export type StickFlight = {
  /** Degrees, or null when the stick is centred and the hull should hold. */
  heading: number | null;
  /** 0 inside the deadzone, ramping to 1 at full travel. */
  throttle: number;
};

const CENTRED: StickFlight = { heading: null, throttle: 0 };

/**
 * Read one stick under the Classic scheme.
 *
 * `deadzone` and `maxTravel` are both in the stick's own pixels, so a layout
 * that resizes the stick keeps the same feel. A deadzone at or beyond full
 * travel would leave the throttle unreachable, so it is clamped below it — a
 * pilot who drags the ring to the edge of the editor gets a very stiff stick,
 * never a dead one.
 */
export function classicStickFlight(x: number, y: number, maxTravel: number, deadzone: number): StickFlight {
  const travel = Math.hypot(x, y);
  const reach = Math.max(1, maxTravel);
  if (travel <= reach * STICK_CENTRE_FRACTION) return CENTRED;

  const heading = (Math.atan2(y, x) * 180) / Math.PI;
  const ring = Math.min(Math.max(0, deadzone), reach * 0.9);
  if (travel <= ring) return { heading, throttle: 0 };

  // Ramped from the ring rather than stepped at it: a throttle that snaps from
  // nothing to full the instant the stick crosses a line makes the boundary
  // itself the thing you have to aim at.
  const span = Math.max(1, reach - ring);
  return { heading, throttle: Math.min(1, (travel - ring) / span) };
}

/**
 * Read one stick under the twin-stick scheme: any travel is full commitment.
 *
 * Kept here beside Classic so the two are read together and the difference is
 * legible, rather than one living in a module and the other inline in the loop.
 */
export function twinStickFlight(x: number, y: number, maxTravel: number): StickFlight {
  const travel = Math.hypot(x, y);
  const reach = Math.max(1, maxTravel);
  if (travel <= reach * STICK_CENTRE_FRACTION) return CENTRED;
  return { heading: (Math.atan2(y, x) * 180) / Math.PI, throttle: 1 };
}

/** The reading for whichever scheme is in force. */
export function stickFlight(
  scheme: ControlProfile,
  x: number,
  y: number,
  maxTravel: number,
  deadzone: number,
): StickFlight {
  return scheme === "classic"
    ? classicStickFlight(x, y, maxTravel, deadzone)
    : twinStickFlight(x, y, maxTravel);
}

/**
 * Whether the right-hand control aims, or only fires.
 *
 * Classic shoots along the hull's own heading, so there is nothing for a second
 * stick to point at and the control is a trigger. Twin-stick aims with it.
 */
export function rightControlAims(scheme: ControlProfile): boolean {
  return scheme === "twinStick";
}

/**
 * The deadzone to use, in stick pixels.
 *
 * The adjustable Classic layout authors a deadzone, and it does so against its own
 * stick size rather than against the measured one — a 132px stick with a 20px
 * ring. Twin Stick is responsive and authors nothing. So the authored value is
 * read as a *proportion* of the stick it was drawn on and re-applied to the
 * stick actually on screen, which keeps the editor meaningful at any size and
 * still gives every other layout a sensible ring.
 *
 * The fallback is a third of travel: enough room to line up a shot without the
 * engine catching, small enough that reaching the throttle is not a stretch.
 */
export const CLASSIC_DEADZONE_FRACTION = 0.34;

/**
 * The ring as a share of the stick's travel, 0 to 0.9.
 *
 * Split out and exported because two places need it and they must agree:
 * the loop, which turns it into pixels to decide when the engine lights,
 * and the drawn ring the player aims with. They did not agree before this --
 * the editor drew the deadzone at half its real size, so a pilot lining up
 * against the picture was burning the engine well inside it.
 *
 * The authored value is a *radius* on a stick of `size`. Its share of that
 * stick's own travel is what transfers to whatever size is really on screen,
 * which is what keeps an authored layout meaningful at any viewport.
 */
export function classicDeadzoneShare(
  authored: { deadzone: number; size: number } | null,
): number {
  if (!authored || authored.size <= 0) return CLASSIC_DEADZONE_FRACTION;
  return Math.max(0, Math.min(0.9, authored.deadzone / (authored.size / 2)));
}

export function classicDeadzone(
  maxTravel: number,
  authored: { deadzone: number; size: number } | null,
): number {
  return maxTravel * classicDeadzoneShare(authored);
}
