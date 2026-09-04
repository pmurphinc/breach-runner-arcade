/**
 * The shared arena: two pilots, one rift, one set of power-ups.
 *
 * Co-op and 2v2 are the same thing seen twice. In both, a *team* of two flies
 * inside one arena around one rift, sees the same hostiles, sees the same loose
 * PUPs shed by that rift, and races each other to touch them first. The only
 * difference is what the team is shooting at: co-op fights a server-owned rival
 * rift, 2v2 sends its payloads at the opposing team's rift. Nothing in this
 * module knows which of those it is, which is the point — there is one
 * synchronised-arena implementation rather than a co-op one and a team one that
 * drift apart.
 *
 * Deliberately plain `.js` with JSDoc types, following `app/pup-inventory.js`
 * and `app/coop-enemy-targeting.js`: `server/rooms.mjs` imports it at runtime,
 * `app/game.tsx` imports it through TypeScript, and `node --test` imports it
 * directly. One copy of the rules, reachable from all three.
 *
 * What lives here is the part that has to agree across the wire: identity,
 * arbitration, and the friendly-fire guards. Rendering and physics stay in the
 * game loop.
 */

/**
 * Session kinds that put a team inside one arena.
 *
 * `pvp` is deliberately absent and must stay absent. In 1v1 each pilot is alone
 * in their own arena with their own rift and they fight by sending payloads
 * into each other's — a shared-arena 1v1 was built once, rejected, and
 * reverted. `tests/portals.test.mjs` pins that model. 2v2 shares an arena
 * *within* a team and never across teams, so a four-pilot match is two shared
 * arenas, not one.
 */
export const SHARED_ARENA_KINDS = Object.freeze(["coop", "team"]);

/** @param {string | null | undefined} kind */
export function isSharedArenaKind(kind) {
  return SHARED_ARENA_KINDS.includes(/** @type {string} */ (kind));
}

/**
 * Only the arena host simulates the shared world; the teammate renders it.
 *
 * Generalises the co-op-only `hasEnemyAttackAuthority` to every shared-arena
 * kind. Solo modes keep their existing local authority, so a single-player run
 * is unaffected by any of this.
 *
 * @param {string} kind Session kind: "solo", "coop", "team", "pvp".
 * @param {string | null | undefined} pilotId
 * @param {string | null | undefined} hostId
 */
export function hasArenaAuthority(kind, pilotId, hostId) {
  if (!isSharedArenaKind(kind)) return true;
  return Boolean(pilotId) && pilotId === hostId;
}

// ------------------------------------------------------------- PUP identity --

/**
 * How close a claimant must be to a PUP for the server to believe the claim.
 *
 * Deliberately far more generous than the client's own pickup radius (32). The
 * server is checking for a fabricated claim from across the arena, not
 * adjudicating a near miss: the claimant's last reported position is up to a
 * position-update apart from where they actually were, and the teammate sees
 * PUPs on a ~50ms interpolation delay. A tight bound here would reject honest
 * claims on a bad connection, which is a far worse failure than letting a
 * cheater claim a PUP they were nearly touching.
 */
export const PUP_CLAIM_REACH = 120;

/**
 * How long a sent claim stays pending before the client gives up on it.
 *
 * A claim that is never answered — a dropped frame, a host that went away —
 * would otherwise hide that PUP for the rest of the round. On expiry the PUP
 * comes back and can be flown at again.
 */
export const PUP_CLAIM_TIMEOUT_MS = 2_000;

/**
 * Stamp a stable id onto a loose PUP, mirroring `enemyIdentity`.
 *
 * Loose PUPs were pure position-and-type with no identity, which is fine when
 * only one machine can see them. The moment two pilots race for the same PUP,
 * both sides need to name it to agree on who got it.
 *
 * @param {{ nextPupId?: number }} counter Usually the game state itself.
 * @param {{ pupId?: number }} pup
 */
export function pupIdentity(counter, pup) {
  if (!pup.pupId) {
    counter.nextPupId = (counter.nextPupId ?? 0) + 1;
    pup.pupId = counter.nextPupId;
  }
  return pup.pupId;
}

/**
 * @typedef {{ pupId: number, type: string, x: number, y: number,
 *   vx: number, vy: number, life: number, phase: number }} SharedPup
 */

/**
 * The host's view of the loose PUPs, ready for the wire.
 *
 * Velocity and phase travel with position so the teammate's PUPs drift and spin
 * between snapshots instead of teleporting every relay tick.
 *
 * @param {{ nextPupId?: number }} counter
 * @param {readonly any[]} pickups
 * @param {number} limit
 * @returns {SharedPup[]}
 */
export function serializePups(counter, pickups, limit = 48) {
  /** @type {SharedPup[]} */
  const out = [];
  for (const pickup of pickups) {
    if (out.length >= limit) break;
    if (pickup.life <= 0) continue;
    out.push({
      pupId: pupIdentity(counter, pickup),
      type: pickup.type,
      x: pickup.x,
      y: pickup.y,
      vx: pickup.vx,
      vy: pickup.vy,
      life: pickup.life,
      phase: pickup.phase,
    });
  }
  return out;
}

// -------------------------------------------------- claim referee (server) --

/**
 * The authoritative record of which PUPs have already been taken.
 *
 * Lives on the room, not on either client, so the race is settled in one place
 * for both pilots. It is a ledger of *decisions*, not of PUPs: the host still
 * owns spawning and physics, and the server only ever answers "who touched
 * number 7 first".
 */
export function createPupLedger() {
  return { claims: new Map(), lastPositions: new Map() };
}

/**
 * Record where the host says each live PUP is, so claims can be sanity checked.
 *
 * Also drops the decision record for PUPs that no longer exist, which is what
 * keeps the ledger from growing for the length of the round.
 *
 * @param {ReturnType<typeof createPupLedger>} ledger
 * @param {readonly SharedPup[]} pups
 */
export function trackPupPositions(ledger, pups) {
  ledger.lastPositions.clear();
  for (const pup of pups) ledger.lastPositions.set(pup.pupId, { x: pup.x, y: pup.y });
  for (const pupId of [...ledger.claims.keys()]) {
    // A claimed PUP legitimately vanishes from the next snapshot — that is what
    // being collected looks like. Keep the decision one extra beat so a
    // duplicate claim still loses rather than being treated as a fresh PUP.
    const claim = ledger.claims.get(pupId);
    if (!ledger.lastPositions.has(pupId)) {
      claim.orphanedSnapshots = (claim.orphanedSnapshots ?? 0) + 1;
      if (claim.orphanedSnapshots > 2) ledger.claims.delete(pupId);
    } else {
      claim.orphanedSnapshots = 0;
    }
  }
}

/**
 * Settle one claim. First valid claimant wins; everyone else is told who did.
 *
 * The distance check is the only thing standing between this and a client that
 * claims every id it has ever seen, and it is intentionally loose — see
 * `PUP_CLAIM_REACH`. A claim for an unknown id is refused outright: the host's
 * snapshot is the only thing that brings a PUP into existence.
 *
 * @param {ReturnType<typeof createPupLedger>} ledger
 * @param {number} pupId
 * @param {string} pilotId
 * @param {{ x: number, y: number } | null} position Claimant's last known position.
 * @param {number} now
 * @returns {{ ok: boolean, winner: string | null, reason?: string }}
 */
export function claimPup(ledger, pupId, pilotId, position, now = Date.now()) {
  const existing = ledger.claims.get(pupId);
  if (existing) {
    // Not an error: the loser of a race asked a fair question and gets a
    // truthful answer. Re-asking as the winner is idempotent.
    return { ok: existing.pilotId === pilotId, winner: existing.pilotId, reason: "already_claimed" };
  }

  const known = ledger.lastPositions.get(pupId);
  if (!known) return { ok: false, winner: null, reason: "unknown_pup" };
  if (position && Math.hypot(known.x - position.x, known.y - position.y) > PUP_CLAIM_REACH) {
    return { ok: false, winner: null, reason: "out_of_reach" };
  }

  ledger.claims.set(pupId, { pilotId, at: now, orphanedSnapshots: 0 });
  return { ok: true, winner: pilotId };
}

/** @param {ReturnType<typeof createPupLedger>} ledger */
export function resetPupLedger(ledger) {
  ledger.claims.clear();
  ledger.lastPositions.clear();
}

// --------------------------------------------------- claim tracker (client) --

/**
 * The claiming pilot's local half of the race.
 *
 * Touching a PUP hides it immediately — the arcade needs that to feel
 * instant — but does *not* award it. The payload only lands once the server
 * says the claim won, because inventory is a server-owned LIFO ledger and
 * awarding a payload we might have to take back would desynchronise it. A PUP
 * therefore takes about one round trip to actually arrive, and a lost race
 * simply un-hides it.
 */
export function createPupClaimTracker() {
  return { pending: new Map(), seq: 0 };
}

/**
 * Begin a claim: hide the PUP and return the sequence number to send.
 * Returns null when a claim for this PUP is already in flight.
 *
 * @param {ReturnType<typeof createPupClaimTracker>} tracker
 * @param {number} pupId
 * @param {number} now
 */
export function beginPupClaim(tracker, pupId, now = Date.now()) {
  if (tracker.pending.has(pupId)) return null;
  tracker.seq += 1;
  tracker.pending.set(pupId, { seq: tracker.seq, at: now });
  return tracker.seq;
}

/** True when this PUP should be hidden from the local arena right now. */
export function isPupClaimPending(tracker, pupId) {
  return tracker.pending.has(pupId);
}

/**
 * Apply the server's answer.
 *
 * A `null` winner means the referee released the PUP without awarding it —
 * usually a claim that arrived before the host's snapshot had introduced that
 * id. The PUP comes straight back rather than staying hidden for the full
 * timeout, so a race for a PUP that has only just been shed still feels live.
 *
 * Three outcomes, because the caller has exactly three things it can do:
 * collect the payload, take the PUP off the screen, or put it back.
 *
 * @returns {"granted" | "taken" | "released"}
 */
export function settlePupClaim(tracker, pupId, winnerId, selfId) {
  tracker.pending.delete(pupId);
  if (winnerId === null || winnerId === undefined) return "released";
  return winnerId === selfId ? "granted" : "taken";
}

/**
 * Un-hide claims that were never answered. Returns the freed PUP ids.
 *
 * @param {ReturnType<typeof createPupClaimTracker>} tracker
 * @param {number} now
 * @param {number} timeoutMs
 * @returns {number[]}
 */
export function expirePupClaims(tracker, now = Date.now(), timeoutMs = PUP_CLAIM_TIMEOUT_MS) {
  /** @type {number[]} */
  const freed = [];
  for (const [pupId, claim] of tracker.pending) {
    if (now - claim.at < timeoutMs) continue;
    tracker.pending.delete(pupId);
    freed.push(pupId);
  }
  return freed;
}

/** @param {ReturnType<typeof createPupClaimTracker>} tracker */
export function resetPupClaims(tracker) {
  tracker.pending.clear();
}

// ------------------------------------------------------- ally fire (both) --

/**
 * Rounds fired by the teammate, for the wire.
 *
 * These exist so the shared arena actually looks shared — before this, a
 * teammate's cannon fire was invisible and the arena only agreed about
 * hostiles. They are visual: `ally` rounds carry no damage across the wire and
 * are never asked to.
 *
 * @param {readonly any[]} bullets
 * @param {number} limit
 */
export function serializeAllyShots(bullets, limit = 64) {
  const out = [];
  for (const bullet of bullets) {
    if (out.length >= limit) break;
    if (bullet.enemy || bullet.life <= 0) continue;
    out.push({
      x: bullet.x,
      y: bullet.y,
      vx: bullet.vx,
      vy: bullet.vy,
      life: bullet.life,
      color: typeof bullet.color === "string" ? bullet.color : "#8ef",
    });
  }
  return out;
}

/**
 * Turn a wire ally shot into a local bullet that cannot hurt anyone.
 *
 * The three flags are the whole friendly-fire guarantee and they are set in
 * exactly one place on purpose. `enemy: false` keeps it off the incoming-fire
 * paths, `damage: 0` means even a missed guard costs nothing, and `ally: true`
 * is what every collision test below excludes.
 */
export function allyShotToBullet(shot) {
  return {
    x: shot.x,
    y: shot.y,
    vx: shot.vx,
    vy: shot.vy,
    life: shot.life,
    color: shot.color,
    damage: 0,
    enemy: false,
    ally: true,
  };
}

/**
 * Can this round damage a pilot?
 *
 * The owner's rule, stated once: a teammate's rounds pass straight through you.
 * Ally rounds are painted, and that is all they do.
 */
export function canDamagePilot(bullet) {
  return !bullet?.ally;
}

/**
 * Can these two rounds cancel each other out?
 *
 * No — never, when either belongs to a teammate. Two pilots shooting the same
 * rift from opposite sides would otherwise spend the whole round shooting each
 * other's shots down, which is exactly the interference the design forbids.
 */
export function shotsInterfere(a, b) {
  if (a?.ally || b?.ally) return false;
  // Beyond the ally rule this stays as it was: only hostile-versus-friendly
  // rounds have ever interacted, and same-side rounds never have.
  return Boolean(a?.enemy) !== Boolean(b?.enemy);
}

/** Ally rounds are decoration and must never enter the local shot budget. */
export function countsTowardOwnShotBudget(bullet) {
  return !bullet?.ally;
}

/** Ally rounds must not damage hostiles either — the host already scored them. */
export function canDamageHostile(bullet) {
  return !bullet?.ally;
}
