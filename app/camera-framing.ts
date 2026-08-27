export type PresentationBounds = { left: number; top: number; right: number; bottom: number };
export type CameraFrame = { camX: number; camY: number; camScale: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Frame a followed ship against presentation pixels that are actually visible. */
export function followCameraFrame(
  player: { x: number; y: number },
  world: { width: number; height: number },
  scale: number,
  playfield: PresentationBounds,
  focalTop = playfield.top,
): CameraFrame {
  const { left, right, bottom } = playfield;
  const top = Math.max(playfield.top, Math.min(focalTop, bottom - 1));
  return {
    camScale: scale,
    camX: clamp((left + right) / 2 - player.x * scale, right - world.width * scale, left),
    camY: clamp((top + bottom) / 2 - player.y * scale, bottom - world.height * scale, top),
  };
}
