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

import { teamSize } from "./team-rooms.js";

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

// ------------------------------------------------------- friendly fire --

/**
 * Can this round damage a pilot? Never, if it belongs to a teammate.
 *
 * The owner's rule, stated once and enforced at the only place a round has
 * ever been able to hurt a pilot. Today no teammate round is ever placed in
 * your arena, so the rule holds by construction — this is what keeps it
 * holding the moment one is. An `ally` round is paint and nothing else.
 *
 * The other half of the rule — that two pilots' rounds cannot cancel each
 * other out — needs no code: the game has no shot-versus-shot collision at
 * all. Rounds interact with hostiles, rifts and loose PUPs, never with other
 * rounds, so there is nothing for a teammate's fire to interfere with.
 *
 * @param {{ ally?: boolean } | null | undefined} bullet
 */
export function canDamagePilot(bullet) {
  return !bullet?.ally;
}

// ----------------------------------------------------- shared-arena balance --

/**
 * How many pilots fly inside one arena.
 *
 * This is the number the PvE balance actually depends on, and naming it is the
 * point. Co-op doubled the rift's integrity and every hostile wave not because
 * it was called "co-op" but because two pilots were shooting one rift; a 2v2
 * team is two pilots sharing one rift for exactly the same reason, so it earns
 * exactly the same doubling by asking the same question. Solo, 1v1 and Classic
 * all answer one and keep the balance they have always had.
 *
 * Deliberately derived from the roster in `team-rooms.js` rather than a second
 * table here: `teamSize` already says how many pilots a team holds, and a
 * shared arena holds exactly one team.
 *
 * @param {string | null | undefined} kind
 */
export function arenaPilotCount(kind) {
  return teamSize(kind);
}

/**
 * The PvE load multiplier for an arena: one rift, split N ways.
 *
 * Clamped at one so an unrecognised mode can only ever fall back to the solo
 * balance, never to a rift with zero integrity.
 *
 * @param {string | null | undefined} kind
 */
export function arenaLoadScale(kind) {
  return Math.max(1, arenaPilotCount(kind));
}

// ----------------------------------------------- shared-arena authority --

/**
 * The guest of a shared arena: the pilot who renders the world rather than
 * simulating it, and therefore reports its actions to the host instead of
 * applying them locally.
 *
 * Phrased as the exact comparison co-op has always made, generalised only in
 * *which kinds* it applies to. That matters more than it looks: a stricter
 * form — one that also demanded a non-empty pilot id — would flip the answer
 * for a client with no lobby state and quietly change what co-op does when the
 * socket is not up. Co-op keeps its behaviour to the character; 2v2 inherits
 * it.
 *
 * @param {string | null | undefined} kind
 * @param {string | null | undefined} pilotId
 * @param {string | null | undefined} hostId
 */
export function isArenaGuest(kind, pilotId, hostId) {
  if (!isSharedArenaKind(kind)) return false;
  return pilotId !== hostId;
}

/**
 * The host of a shared arena: the pilot who owns hostiles, loose PUPs and the
 * world snapshot the teammate reads.
 *
 * Requires a known pilot id, because "I am the host" is a claim and an
 * unidentified client has no standing to make it. `isArenaGuest` is
 * deliberately *not* the negation of this — see its note.
 *
 * @param {string | null | undefined} kind
 * @param {string | null | undefined} pilotId
 * @param {string | null | undefined} hostId
 */
export function isArenaHostPilot(kind, pilotId, hostId) {
  if (!isSharedArenaKind(kind)) return false;
  return Boolean(pilotId) && pilotId === hostId;
}
