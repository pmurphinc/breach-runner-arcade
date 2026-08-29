import { riftEnergyProgress } from "./progression.ts";
import type { RiftRunState } from "./types.ts";

/** Lightweight world-space Rift Run ring. The ordinary portal charge ring remains inside it. */
export function drawRiftEnergyRing(context: CanvasRenderingContext2D, x: number, y: number, state: RiftRunState | null, time: number): void {
  if (!state || state.status !== "active") return;
  const progress = riftEnergyProgress(state);
  const pulse = progress.ready ? 0.72 + Math.sin(time * 0.01) * 0.2 : 0.72;
  context.save();
  context.translate(x, y);
  context.lineWidth = progress.ready ? 5 : 3;
  context.strokeStyle = "rgba(104,242,255,.18)";
  context.beginPath(); context.arc(0, 0, 73, 0, Math.PI * 2); context.stroke();
  context.globalAlpha = pulse;
  context.strokeStyle = progress.ready ? "#b8ff72" : "#68f2ff";
  context.lineCap = "round";
  context.beginPath(); context.arc(0, 0, 73, -Math.PI / 2, -Math.PI / 2 + progress.fraction * Math.PI * 2); context.stroke();
  if (progress.ready) {
    context.globalAlpha = 0.28 + pulse * 0.25;
    context.lineWidth = 2;
    context.beginPath(); context.arc(0, 0, 79, 0, Math.PI * 2); context.stroke();
  }
  context.restore();
}
