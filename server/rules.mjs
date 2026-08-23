/**
 * The server's copy of the rules it has to enforce.
 *
 * PvP runs Easy rules, and the server — not the browser — owns the collision
 * shield and hull maths. It therefore needs these numbers at runtime.
 *
 * This is a deliberate duplicate of `app/difficulty.ts` rather than an import:
 * the app module is TypeScript, and depending on Node's experimental type
 * stripping inside the production entry point is not a risk worth taking for a
 * handful of constants. `tests/pvp-protocol.test.mjs` asserts the two copies
 * agree numerically, so they cannot drift apart silently.
 */

/** Absorption before hull is exposed. Mirrors DIFFICULTIES.easy. */
export const COLLISION_SHIELD_CAPACITY = 40;

/**
 * Simulation step, matching TICK_MS in app/difficulty.ts.
 *
 * The client counts the recharge delay in whole ticks, so four seconds is
 * really 267 ticks. Deriving the server's millisecond budget the same way
 * keeps PvP and PvE identical instead of five milliseconds apart.
 */
export const TICK_MS = 15;
export const COLLISION_SHIELD_RECHARGE_TICKS = 267;

/** Uninterrupted milliseconds without collision damage before a full restore. */
export const COLLISION_SHIELD_RECHARGE_MS =
  COLLISION_SHIELD_RECHARGE_TICKS * TICK_MS;

/** PvP wormholes are locked in the centre of each arena. */
export const WORMHOLE_MOTION = "locked";

/** PvP never applies the Hard Mode contact hazard. */
export const CONTACT_HAZARD_ENABLED = false;

/**
 * A player's authoritative combat state.
 *
 * The shield is stored as a charge plus the timestamp of the last collision,
 * so recharge is derived on read rather than driven by a server-side timer.
 * That keeps the process idle between events and makes the result identical
 * however long the gap between messages is.
 */
export function createCombatState(maxHull) {
  return {
    maxHull,
    hull: maxHull,
    shieldCharge: COLLISION_SHIELD_CAPACITY,
    lastCollisionAt: 0,
  };
}

/** Shield charge as of `now`, applying any recharge that has become due. */
export function shieldChargeAt(state, now) {
  if (state.shieldCharge >= COLLISION_SHIELD_CAPACITY) return COLLISION_SHIELD_CAPACITY;
  if (state.lastCollisionAt && now - state.lastCollisionAt >= COLLISION_SHIELD_RECHARGE_MS) {
    return COLLISION_SHIELD_CAPACITY;
  }
  return state.shieldCharge;
}

/** Milliseconds left on the recharge delay, for the opponent-facing HUD. */
export function rechargeRemaining(state, now) {
  if (shieldChargeAt(state, now) >= COLLISION_SHIELD_CAPACITY) return 0;
  return Math.max(0, COLLISION_SHIELD_RECHARGE_MS - (now - state.lastCollisionAt));
}

/**
 * Applies one validated damage event.
 *
 * `source` decides whether the collision shield is consulted at all, matching
 * the single-player split exactly: only genuine collisions touch the shield,
 * everything else goes straight to hull.
 */
export function applyDamage(state, source, amount, now) {
  state.shieldCharge = shieldChargeAt(state, now);

  let absorbed = 0;
  let toHull = amount;

  if (source === "collision") {
    absorbed = Math.min(state.shieldCharge, amount);
    state.shieldCharge -= absorbed;
    toHull = amount - absorbed;
    // Any collision damage restarts the delay, including one fully absorbed.
    state.lastCollisionAt = now;
  }

  state.hull = Math.max(0, state.hull - toHull);
  return { absorbed, toHull, destroyed: state.hull <= 0 };
}

/** Snapshot for broadcasting. Percentages so the HUD needs no rule knowledge. */
export function snapshot(state, now) {
  const charge = shieldChargeAt(state, now);
  return {
    hull: Math.round(state.hull),
    maxHull: state.maxHull,
    shieldPct: Math.round((charge / COLLISION_SHIELD_CAPACITY) * 100),
    rechargeMs: rechargeRemaining(state, now),
  };
}
