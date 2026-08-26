/** Action-based browser Gamepad API adapter for standard Xbox/PlayStation maps. */
export type GamepadActions = {
  moveX: number; moveY: number; aimX: number; aimY: number;
  fireMain: boolean; firePup: boolean; special: boolean;
  previousPup: boolean; nextPup: boolean; pause: boolean;
  confirm: boolean; cancel: boolean; menuX: number; menuY: number;
};

export const GAMEPAD_DEAD_ZONE = 0.2;
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
  return {
    moveX: axis(pad.axes[0]), moveY: axis(pad.axes[1]), aimX: axis(pad.axes[2]), aimY: axis(pad.axes[3]),
    fireMain: Math.hypot(axis(pad.axes[2]), axis(pad.axes[3])) > 0,
    firePup: pressed(7), special: pressed(6), previousPup: pressed(4) || pressed(14),
    nextPup: pressed(5) || pressed(15), pause: pressed(9), confirm: pressed(0), cancel: pressed(1),
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
