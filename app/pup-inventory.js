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
