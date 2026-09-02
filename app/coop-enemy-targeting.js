/** @typedef {{ id: string, x: number, y: number, living: boolean, connected: boolean }} PilotTarget */
/** @typedef {{ x: number, y: number }} TargetOrigin */

/** @param {PilotTarget} pilot */
const usable = (pilot) => pilot.living
  && pilot.connected
  && Number.isFinite(pilot.x)
  && Number.isFinite(pilot.y);

/**
 * Chooses the closest usable pilot. Array order is the deterministic tie
 * breaker, so callers should put the arena host first.
 */
/** @param {TargetOrigin} origin @param {readonly PilotTarget[]} pilots @returns {PilotTarget | null} */
export function nearestPilot(origin, pilots) {
  /** @type {PilotTarget | null} */
  let selected = null;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (const pilot of pilots) {
    if (!usable(pilot)) continue;
    const dx = pilot.x - origin.x;
    const dy = pilot.y - origin.y;
    const distance = dx * dx + dy * dy;
    if (distance < selectedDistance) {
      selected = pilot;
      selectedDistance = distance;
    }
  }
  return selected;
}

/** Velocity for an aimed hostile shot, kept beside selection for regression tests. */
/** @param {TargetOrigin} origin @param {TargetOrigin} target @param {number} speed */
export function hostileShotVelocity(origin, target, speed) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  return { vx: (dx / distance) * speed, vy: (dy / distance) * speed };
}

/**
 * Only the arena host may create hostile attacks in a shared arena.
 *
 * Co-op has always been one; PvP became one when a duel stopped being two
 * private mirrors. Solo modes keep their existing local authority.
 * @param {string} mode @param {string | null | undefined} pilotId @param {string | null | undefined} hostId
 */
export function hasEnemyAttackAuthority(mode, pilotId, hostId) {
  if (mode !== "coop" && mode !== "pvp") return true;
  return Boolean(pilotId) && pilotId === hostId;
}
