import type { VictoryVisualState } from "./victory-sequence";

export const RIFT_LABEL = "RIVAL RIFT";

export type RiftLabelTransform = {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const easeOut = (value: number) => 1 - (1 - clamp01(value)) ** 2;

/** Stable, inexpensive pseudo-random values: a character keeps one trajectory for the whole blast. */
function characterSeed(index: number, salt: number) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export function riftLabelCharacterTransform(
  index: number,
  characterX: number,
  labelY: number,
  riftX: number,
  riftY: number,
  visual: VictoryVisualState | null,
  reducedMotion: boolean,
): RiftLabelTransform {
  if (!visual) return { x: characterX, y: labelY, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };

  const p = clamp01(visual.phaseProgress);
  const dx = riftX - characterX;
  const dy = riftY - labelY;
  const jitter = reducedMotion ? 0 : (characterSeed(index, 1) - 0.5) * 2;

  if (visual.phase === "freeze") {
    return {
      x: characterX + dx * p * 0.015 + jitter * p * 0.55,
      y: labelY + dy * p * 0.015 - jitter * p * 0.35,
      rotation: 0,
      scaleX: 1 - p * 0.015,
      scaleY: 1,
      opacity: 1,
    };
  }

  if (visual.phase === "pull") {
    return {
      x: characterX + dx * p * 0.13 + jitter * p * 1.15,
      y: labelY + dy * p * 0.13 - jitter * p * 0.65,
      rotation: reducedMotion ? 0 : jitter * p * 0.025,
      scaleX: 1 - p * 0.16,
      scaleY: 1 - p * 0.1,
      opacity: 1 - p * 0.08,
    };
  }

  if (visual.phase === "collapse") {
    const inward = easeOut(p) * 0.92;
    return {
      x: characterX + dx * inward + jitter * (1 - p) * 1.6,
      y: labelY + dy * inward - jitter * (1 - p),
      rotation: reducedMotion ? 0 : jitter * p * 0.09,
      scaleX: Math.max(0.04, 1 - p * 0.92),
      scaleY: Math.max(0.04, 1 - p * 0.86),
      opacity: Math.max(0, 1 - p * 1.15),
    };
  }

  const travel = easeOut(p);
  const radialAngle = Math.atan2(labelY - riftY, characterX - riftX);
  const angle = radialAngle + (characterSeed(index, 2) - 0.5) * 1.7;
  const distance = (reducedMotion ? 7 : 72 + characterSeed(index, 3) * 92) * travel;
  const rotationDirection = characterSeed(index, 4) < 0.5 ? -1 : 1;
  return {
    x: characterX + Math.cos(angle) * distance,
    y: labelY + Math.sin(angle) * distance + (characterSeed(index, 5) - 0.5) * distance * 0.35,
    rotation: reducedMotion ? 0 : rotationDirection * (0.35 + characterSeed(index, 6) * 1.3) * travel,
    scaleX: 1 + p * (characterSeed(index, 7) * 0.2 - 0.05),
    scaleY: 1 + p * (characterSeed(index, 8) * 0.2 - 0.05),
    opacity: Math.max(0, 1 - p * 1.45),
  };
}

export function drawRiftLabel(
  ctx: CanvasRenderingContext2D,
  labelX: number,
  labelY: number,
  riftX: number,
  riftY: number,
  visual: VictoryVisualState | null,
  reducedMotion: boolean,
) {
  if (!visual) {
    ctx.fillText(RIFT_LABEL, labelX, labelY);
    return;
  }

  const widths = new Array<number>(RIFT_LABEL.length);
  let totalWidth = 0;
  for (let index = 0; index < RIFT_LABEL.length; index += 1) {
    widths[index] = ctx.measureText(RIFT_LABEL[index]).width;
    totalWidth += widths[index];
  }

  let cursor = labelX - totalWidth / 2;
  ctx.save();
  ctx.textAlign = "center";
  for (let index = 0; index < RIFT_LABEL.length; index += 1) {
    const character = RIFT_LABEL[index];
    const characterX = cursor + widths[index] / 2;
    cursor += widths[index];
    if (character === " ") continue;
    const transform = riftLabelCharacterTransform(index, characterX, labelY, riftX, riftY, visual, reducedMotion);
    if (transform.opacity <= 0) continue;
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.rotate(transform.rotation);
    ctx.scale(transform.scaleX, transform.scaleY);
    ctx.globalAlpha *= transform.opacity;
    ctx.fillText(character, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}
