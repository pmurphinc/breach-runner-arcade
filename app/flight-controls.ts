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

import { NO_INTENT, type MovementIntent, type MovementKeys } from "./movement.ts";

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

/* ------------------------------------------------ Classic on a keyboard -- */

/**
 * Degrees the hull turns per tick while a turn key is held.
 *
 * At the 15ms tick this is 280 degrees a second, so a full turn takes about
 * one and a third seconds. Fast enough to bring the nose onto something that
 * is shooting at you, slow enough that steering is a thing you do rather than
 * a direction you select -- which is the entire difference between this and
 * the twin-stick scheme.
 */
export const CLASSIC_TURN_DEGREES_PER_TICK = 4.2;

export type ClassicKeyboardFlight = {
  /** The hull's new heading in degrees. Always a number: the hull always points somewhere. */
  heading: number;
  /** What to fly. Magnitude 0 while turning without thrust. */
  intent: MovementIntent;
};

/**
 * Classic's keyboard: A and D turn the hull, W drives it along its own nose.
 *
 * This is the same arrangement as Classic's left stick, expressed in keys. The
 * twin-stick scheme reads WASD as an absolute screen direction -- W means fly
 * up-screen -- which is a different game: there the ship is a cursor you point
 * at a place, and here it is a vehicle you steer.
 *
 * Turning without thrust is an **active intent with a magnitude of zero**, the
 * same mechanism the stick's deadzone uses. `facingFor` reads the heading and
 * acceleration scales by the magnitude, so the hull comes round while the
 * engine stays cold, and no new physics is involved.
 *
 * S is deliberately unmapped. The original had no reverse, and giving the key
 * a thrust vector opposite the nose would fight `facingFor`, which turns the
 * hull to whatever the intent points at -- the ship would flip rather than back
 * up. Reverse belongs to the retros upgrade, not to a key.
 */
export function classicKeyboardFlight(
  keys: MovementKeys,
  heading: number,
  turnPerTick = CLASSIC_TURN_DEGREES_PER_TICK,
): ClassicKeyboardFlight {
  const safeHeading = Number.isFinite(heading) ? heading : 0;
  // Opposing turn keys cancel, matching how the directional scheme treats a
  // held left and right.
  const turn = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const next = safeHeading + turn * turnPerTick;

  if (keys.up) return { heading: next, intent: { active: true, heading: next, magnitude: 1 } };
  if (turn !== 0) return { heading: next, intent: { active: true, heading: next, magnitude: 0 } };
  return { heading: safeHeading, intent: NO_INTENT };
}

/**
 * Whether a pointer's position should turn the hull.
 *
 * False under Classic, and it has to be: the hull's heading is the pilot's to
 * set with the turn keys, and `facingFor` gives an aim heading priority over
 * everything else -- so a mouse that kept setting one would pin the nose to the
 * cursor and make A and D do nothing at all. The two cannot both own the
 * heading. Mouse buttons still fire and still launch; only the pointing stops.
 */
export function pointerAims(profile: ControlProfile): boolean {
  return rightControlAims(profile);
}
