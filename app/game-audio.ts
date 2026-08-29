/** Shared Web Audio context ownership and user-gesture unlock. */

export type AudioContextRef = { current: AudioContext | null };
export type AudioContextFactory = () => AudioContext | null;

/**
 * Creates (once) and resumes the game's shared procedural-audio context.
 * Call this directly from a keyboard/pointer interaction: a later RAF is not
 * guaranteed to retain the browser's transient user activation.
 */
export function unlockGameAudio(ref: AudioContextRef, create: AudioContextFactory): AudioContext | null {
  const context = ref.current ?? create();
  if (!context) return null;
  ref.current = context;
  if (context.state !== "running") void context.resume().catch(() => undefined);
  return context;
}
