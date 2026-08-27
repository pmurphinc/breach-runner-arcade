/** Action-based browser Gamepad API adapter for standard Xbox/PlayStation maps. */
export type GamepadActions = {
  moveX: number; moveY: number; aimX: number; aimY: number;
  fireMain: boolean; firePup: boolean; special: boolean;
  previousPup: boolean; nextPup: boolean; pause: boolean;
  confirm: boolean; cancel: boolean; menuX: number; menuY: number;
};

export const GAMEPAD_DEAD_ZONE = 0.2;

/** Canonical standard-gamepad map shared by input handling and Settings. */
export const GAMEPAD_BINDINGS = {
  axes: {
    move: { x: 0, y: 1, label: "Left Stick" },
    aim: { x: 2, y: 3, label: "Right Stick" },
  },
  buttons: {
    confirm: { indices: [0], label: "A / Cross" },
    cancel: { indices: [1], label: "B / Circle" },
    previousPup: { indices: [4, 14], label: "LB / L1 or D-pad Left" },
    nextPup: { indices: [5, 15], label: "RB / R1 or D-pad Right" },
    special: { indices: [6], label: "LT / L2" },
    firePup: { indices: [7], label: "RT / R2" },
    pause: { indices: [9], label: "Menu / Options" },
  },
  menuNavigation: { label: "Left Stick / D-pad" },
} as const;

const axis = (value = 0) => Math.abs(value) < GAMEPAD_DEAD_ZONE ? 0 : Math.sign(value) * (Math.abs(value) - GAMEPAD_DEAD_ZONE) / (1 - GAMEPAD_DEAD_ZONE);

/** Canvas-space heading used by movement, facing and projectile code. */
export function headingDegrees(x: number, y: number): number | null {
  return Math.hypot(x, y) > 0 ? Math.atan2(y, x) * 180 / Math.PI : null;
}

/** Rising-edge helper. Holding a button never manufactures another press. */
export function pressedOnce(current: boolean, previous: boolean) {
  return current && !previous;
}

export function readStandardGamepad(pad: Gamepad): GamepadActions {
  const pressed = (index: number) => Boolean(pad.buttons[index]?.pressed);
  const anyPressed = (indices: readonly number[]) => indices.some(pressed);
  const { axes, buttons } = GAMEPAD_BINDINGS;
  return {
    moveX: axis(pad.axes[axes.move.x]), moveY: axis(pad.axes[axes.move.y]), aimX: axis(pad.axes[axes.aim.x]), aimY: axis(pad.axes[axes.aim.y]),
    fireMain: Math.hypot(axis(pad.axes[axes.aim.x]), axis(pad.axes[axes.aim.y])) > 0,
    firePup: anyPressed(buttons.firePup.indices), special: anyPressed(buttons.special.indices), previousPup: anyPressed(buttons.previousPup.indices),
    nextPup: anyPressed(buttons.nextPup.indices), pause: anyPressed(buttons.pause.indices), confirm: anyPressed(buttons.confirm.indices), cancel: anyPressed(buttons.cancel.indices),
    menuX: (pressed(15) ? 1 : 0) - (pressed(14) ? 1 : 0),
    menuY: (pressed(13) ? 1 : 0) - (pressed(12) ? 1 : 0),
  };
}

export const EMPTY_GAMEPAD: GamepadActions = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fireMain: false, firePup: false, special: false, previousPup: false, nextPup: false, pause: false, confirm: false, cancel: false, menuX: 0, menuY: 0 };

/** Hot-plug boundary: absence/disconnect yields controller-neutral state only. */
export function controllerStateForPads(pads: readonly (Gamepad | null)[]): GamepadActions {
  const pad = pads.find((candidate) => candidate?.connected && candidate.mapping === "standard");
  return pad ? readStandardGamepad(pad) : EMPTY_GAMEPAD;
}
