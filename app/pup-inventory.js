/**
 * Shared gameplay/network ceiling for available payload PUPs.
 *
 * One ceiling for every mode. Five matches the original Wormhole client, which is the number
 * Classic Wormhole has to hit for fidelity, and it suits the rest of the game too — a five-deep
 * stock keeps payload timing a live decision instead of letting a pilot hoard ten and dump them.
 *
 * Capacity counts the loaded payload: 5 is one loaded plus four stored (see `pupInventoryLayout`).
 * The compact HUD draws exactly this many slots, so changing this number changes that frame.
 *
 * Rift Run is the one mode that does not start here — it opens with a single slot and earns its
 * way up to this cap.
 */
export const PUP_INVENTORY_CAPACITY = 5;

/** Build the LIFO stock's left-to-right HUD presentation. */
/** @template T
 * @param {readonly T[]} stock
 * @param {number} capacity
 */
export function pupInventoryLayout(stock, capacity) {
  const loaded = stock.at(-1) ?? null;
  const storedCapacity = Math.max(0, capacity - 1);
  const stored = stock.slice(0, -1).slice(-storedCapacity);
  return {
    loaded,
    // Right alignment puts the next-to-load PUP beside the loaded window.
    stored: Array(Math.max(0, storedCapacity - stored.length)).fill(null).concat(stored),
  };
}

/**
 * Remove the payload currently loaded to fire from the LIFO inventory.
 * Applied upgrades never enter this array, so this cannot alter ship stats.
 * @template T
 * @param {T[]} stock
 * @returns {T | null}
 */
export function consumeLoadedPup(stock) {
  return stock.pop() ?? null;
}
