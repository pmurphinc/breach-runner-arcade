/** Kestrel hull repaired each second by one available PUP in its inventory. */
export const PUP_REGEN_HP_PER_SECOND = 0.25;

/** Apply the passive from the authoritative inventory over elapsed simulation time. */
export function pupRegenHull(
  shipId,
  hull,
  maxHull,
  storedPups,
  elapsedSeconds,
) {
  if (shipId !== "kestrel" || storedPups <= 0 || hull <= 0 || hull >= maxHull || elapsedSeconds <= 0) return hull;
  const inventoryCount = Math.max(0, Math.floor(storedPups));
  return Math.min(maxHull, hull + inventoryCount * PUP_REGEN_HP_PER_SECOND * elapsedSeconds);
}
