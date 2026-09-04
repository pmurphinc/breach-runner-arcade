/**
 * The shared arena: two pilots, one rift, one set of PUPs.
 *
 * The module is exercised directly — it is plain `.js` precisely so that the
 * rules both the browser and the server obey can be tested without a canvas or
 * a socket. The last group checks how `app/game.tsx` and `server/rooms.mjs`
 * actually consume it, since Node cannot import the `.tsx` and the wiring is
 * as easy to get wrong as the rules.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PUP_CLAIM_REACH,
  PUP_CLAIM_TIMEOUT_MS,
  SHARED_ARENA_KINDS,
  beginPupClaim,
  canDamagePilot,
  claimPup,
  createPupClaimTracker,
  createPupLedger,
  expirePupClaims,
  hasArenaAuthority,
  isPupClaimPending,
  isSharedArenaKind,
  pupIdentity,
  resetPupClaims,
  resetPupLedger,
  serializePups,
  settlePupClaim,
  trackPupPositions,
} from "../app/shared-arena.js";
import { PICKUP_IDS, parseClientMessage } from "../server/protocol.mjs";

const source = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");
const rooms = readFileSync(new URL("../server/rooms.mjs", import.meta.url), "utf8");

// ------------------------------------------------------- which modes share --

test("co-op and 2v2 share an arena; 1v1 never does", () => {
  assert.deepEqual([...SHARED_ARENA_KINDS], ["coop", "team"]);
  assert.equal(isSharedArenaKind("coop"), true);
  assert.equal(isSharedArenaKind("team"), true);
  // The hard constraint: a 1v1 pilot is alone in their own arena with their
  // own rift. A shared-arena PvP was built once and reverted.
  assert.equal(isSharedArenaKind("pvp"), false);
  assert.equal(isSharedArenaKind("pve"), false);
  assert.equal(isSharedArenaKind(undefined), false);
});

test("only the arena host simulates a shared world; solo modes keep authority", () => {
  assert.equal(hasArenaAuthority("coop", "p1", "p1"), true);
  assert.equal(hasArenaAuthority("coop", "p2", "p1"), false);
  assert.equal(hasArenaAuthority("team", "p2", "p1"), false);
  // Nothing about single player or 1v1 changes.
  assert.equal(hasArenaAuthority("pve", null, null), true);
  assert.equal(hasArenaAuthority("pvp", "p2", "p1"), true);
});

// ------------------------------------------------------------- PUP identity --

test("a loose PUP is named once and keeps that name", () => {
  const game = { nextPupId: 0 };
  const pup = { x: 1, y: 2 };
  const first = pupIdentity(game, pup);
  assert.equal(first, 1);
  assert.equal(pupIdentity(game, pup), first, "re-naming would break every claim");
  assert.equal(pupIdentity(game, { x: 0, y: 0 }), 2);
});

test("serialising names every live PUP, skips dead ones and honours the cap", () => {
  const game = { nextPupId: 0 };
  const pickups = [
    { x: 10, y: 20, vx: 1, vy: 2, type: "nuke", life: 900, phase: 0.5 },
    { x: 0, y: 0, vx: 0, vy: 0, type: "health", life: 0, phase: 0 },
    { x: 30, y: 40, vx: -1, vy: 0, type: "shield", life: 400, phase: 1 },
  ];
  const wire = serializePups(game, pickups);
  assert.deepEqual(wire.map((pup) => pup.pupId), [1, 2]);
  assert.deepEqual(wire.map((pup) => pup.type), ["nuke", "shield"]);
  // Velocity and phase travel too, so the teammate's PUPs drift and spin
  // between snapshots instead of teleporting on each relay.
  assert.equal(wire[0].vx, 1);
  assert.equal(wire[0].phase, 0.5);

  const many = Array.from({ length: 80 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, type: "nuke", life: 5, phase: 0 }));
  assert.equal(serializePups({ nextPupId: 0 }, many).length, 48);
});

test("every PUP the game can shed is nameable on the wire", () => {
  // The shared arena has to describe upgrade and recovery pickups too, not
  // just the attack payloads a pilot may transmit.
  for (const id of ["gun", "thrust", "retros", "shield", "clear", "health", "ricochet", "nuke", "beam"]) {
    assert.ok(PICKUP_IDS.includes(id), `${id} is not describable in a world snapshot`);
  }
});

// --------------------------------------------------------------- the race --

test("first claim wins and the loser is told who took it", () => {
  const ledger = createPupLedger();
  trackPupPositions(ledger, [{ pupId: 7, x: 100, y: 100 }]);

  const first = claimPup(ledger, 7, "p1", { x: 105, y: 100 }, 1_000);
  assert.deepEqual(first, { ok: true, winner: "p1" });

  const second = claimPup(ledger, 7, "p2", { x: 100, y: 104 }, 1_001);
  assert.equal(second.ok, false, "two pilots cannot both collect one PUP");
  assert.equal(second.winner, "p1", "the loser must be told who did, so it can clear its arena");
});

test("re-asking as the winner is idempotent", () => {
  const ledger = createPupLedger();
  trackPupPositions(ledger, [{ pupId: 3, x: 0, y: 0 }]);
  claimPup(ledger, 3, "p1", { x: 0, y: 0 }, 1);
  const again = claimPup(ledger, 3, "p1", { x: 0, y: 0 }, 2);
  assert.equal(again.ok, true);
  assert.equal(again.winner, "p1");
});

test("a PUP the host never published cannot be claimed", () => {
  const ledger = createPupLedger();
  trackPupPositions(ledger, [{ pupId: 1, x: 0, y: 0 }]);
  const outcome = claimPup(ledger, 999, "p1", { x: 0, y: 0 }, 1);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.winner, null);
  assert.equal(outcome.reason, "unknown_pup");
});

test("a claim from across the arena is refused, a near miss is not", () => {
  const ledger = createPupLedger();
  trackPupPositions(ledger, [{ pupId: 5, x: 700, y: 400 }]);

  const far = claimPup(ledger, 5, "cheat", { x: 40, y: 40 }, 1);
  assert.equal(far.ok, false);
  assert.equal(far.reason, "out_of_reach");

  // Generous on purpose: the claimant's last reported position lags, and the
  // teammate sees PUPs on an interpolation delay. Rejecting an honest claim on
  // a bad connection is worse than tolerating a near one.
  const near = claimPup(ledger, 5, "p2", { x: 700 + PUP_CLAIM_REACH - 1, y: 400 }, 2);
  assert.equal(near.ok, true, "a claim inside the reach must survive");
});

test("a claim with no known position is allowed through", () => {
  // A pilot who has not sent a position yet is not a cheater.
  const ledger = createPupLedger();
  trackPupPositions(ledger, [{ pupId: 2, x: 0, y: 0 }]);
  assert.equal(claimPup(ledger, 2, "p1", null, 1).ok, true);
});

test("the ledger does not grow for the length of the round", () => {
  const ledger = createPupLedger();
  trackPupPositions(ledger, [{ pupId: 1, x: 0, y: 0 }]);
  claimPup(ledger, 1, "p1", { x: 0, y: 0 }, 1);
  assert.equal(ledger.claims.size, 1);
  // A collected PUP vanishes from later snapshots. The decision survives a
  // couple of frames so a duplicate claim still loses, then it is dropped.
  for (let i = 0; i < 4; i += 1) trackPupPositions(ledger, []);
  assert.equal(ledger.claims.size, 0, "decisions must not accumulate");
});

test("a decision survives long enough for a duplicate claim to lose", () => {
  const ledger = createPupLedger();
  trackPupPositions(ledger, [{ pupId: 1, x: 0, y: 0 }]);
  claimPup(ledger, 1, "p1", { x: 0, y: 0 }, 1);
  trackPupPositions(ledger, []);
  assert.equal(claimPup(ledger, 1, "p2", { x: 0, y: 0 }, 2).winner, "p1");
});

test("a new round starts a clean race", () => {
  const ledger = createPupLedger();
  trackPupPositions(ledger, [{ pupId: 1, x: 0, y: 0 }]);
  claimPup(ledger, 1, "p1", { x: 0, y: 0 }, 1);
  resetPupLedger(ledger);
  assert.equal(ledger.claims.size, 0);
  // Ids restart from one on a fresh host, so a stale ledger would refuse
  // every claim in the next round.
  trackPupPositions(ledger, [{ pupId: 1, x: 0, y: 0 }]);
  assert.equal(claimPup(ledger, 1, "p2", { x: 0, y: 0 }, 2).winner, "p2");
});

// ----------------------------------------------------- the claimant's half --

test("a PUP is claimed once, not once per frame", () => {
  const tracker = createPupClaimTracker();
  assert.equal(beginPupClaim(tracker, 4, 1_000), 1);
  assert.equal(beginPupClaim(tracker, 4, 1_016), null, "a held claim must not resend every tick");
  assert.equal(isPupClaimPending(tracker, 4), true);
  assert.equal(isPupClaimPending(tracker, 5), false);
});

test("the three verdicts are the three things an arena can do", () => {
  const tracker = createPupClaimTracker();

  beginPupClaim(tracker, 1, 0);
  assert.equal(settlePupClaim(tracker, 1, "me", "me"), "granted");
  assert.equal(isPupClaimPending(tracker, 1), false);

  beginPupClaim(tracker, 2, 0);
  assert.equal(settlePupClaim(tracker, 2, "them", "me"), "taken");

  beginPupClaim(tracker, 3, 0);
  assert.equal(settlePupClaim(tracker, 3, null, "me"), "released");

  // A PUP the teammate won while we were not racing for it still has to leave
  // this screen, so it is "taken" rather than a no-op.
  assert.equal(settlePupClaim(tracker, 9, "them", "me"), "taken");
});

test("an unanswered claim releases the PUP instead of hiding it forever", () => {
  const tracker = createPupClaimTracker();
  beginPupClaim(tracker, 6, 1_000);
  assert.deepEqual(expirePupClaims(tracker, 1_000 + PUP_CLAIM_TIMEOUT_MS - 1), []);
  assert.deepEqual(expirePupClaims(tracker, 1_000 + PUP_CLAIM_TIMEOUT_MS), [6]);
  assert.equal(isPupClaimPending(tracker, 6), false);
  // Released, so flying at it again starts a fresh claim.
  assert.equal(beginPupClaim(tracker, 6, 5_000), 2);
});

test("resetting clears pending claims for the next round", () => {
  const tracker = createPupClaimTracker();
  beginPupClaim(tracker, 1, 0);
  resetPupClaims(tracker);
  assert.equal(isPupClaimPending(tracker, 1), false);
});

// ------------------------------------------------------------ friendly fire --

test("a teammate's round cannot damage a pilot", () => {
  assert.equal(canDamagePilot({ enemy: true, damage: 20 }), true);
  assert.equal(canDamagePilot({ enemy: true, damage: 20, ally: true }), false, "no friendly fire");
  assert.equal(canDamagePilot(null), true);
});

test("the one path that can hurt a pilot asks the friendly-fire rule first", () => {
  // There is exactly one place in the game loop where a round damages a
  // pilot. Pinning the guard to it is what makes "no friendly fire" a
  // permanent property rather than a thing that happens to be true today.
  assert.ok(
    source.includes('if (canDamagePilot(bullet) && dist(bullet, player) < 13)'),
    "the hostile-projectile hit must be gated on canDamagePilot",
  );
  const hits = source.split('damagePlayer(game, bullet.damage').length - 1;
  assert.equal(hits, 1, "a second bullet-to-pilot damage path would need the same guard");
});

test("rounds are never tested against other rounds", () => {
  // The other half of the owner's rule — that two pilots' rounds must not
  // cancel each other out — needs no guard, because the game has no
  // shot-versus-shot collision for a teammate's fire to take part in. Rounds
  // are only ever tested against hostiles, rifts, pilots and loose PUPs.
  const nested = source.match(/for \(const \w+ of game\.bullets\)[\s\S]{0,400}?for \(const \w+ of game\.bullets\)/);
  assert.equal(nested, null, "a nested bullet scan would be a shot-versus-shot test");
});

// ------------------------------------------------------------- the wiring --

test("a world snapshot carries the PUPs both pilots race for", () => {
  const parsed = parseClientMessage(JSON.stringify({
    type: "world",
    seq: 1,
    roundId: 1,
    portalX: 700,
    portalY: 400,
    portalAngle: 0,
    enemies: [],
    enemyBullets: [],
    pups: [{ pupId: 1, type: "nuke", x: 10, y: 20, vx: 1, vy: 1, life: 500, phase: 0 }],
  }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.message.pups.length, 1);
  assert.equal(parsed.message.pups[0].pupId, 1);
});

test("a world snapshot without PUPs stays valid and means none", () => {
  const parsed = parseClientMessage(JSON.stringify({
    type: "world", seq: 1, roundId: 1, portalX: 0, portalY: 0, portalAngle: 0,
    enemies: [], enemyBullets: [],
  }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.message.pups, []);
});

test("a malformed or oversized PUP list is refused", () => {
  const world = (pups) => parseClientMessage(JSON.stringify({
    type: "world", seq: 1, roundId: 1, portalX: 0, portalY: 0, portalAngle: 0,
    enemies: [], enemyBullets: [], pups,
  }));
  assert.equal(world([{ pupId: 0, type: "nuke", x: 0, y: 0, vx: 0, vy: 0, life: 1, phase: 0 }]).ok, false);
  assert.equal(world([{ pupId: 1, type: "not_a_pup", x: 0, y: 0, vx: 0, vy: 0, life: 1, phase: 0 }]).ok, false);
  assert.equal(world([{ pupId: 1, type: "nuke", x: "x", y: 0, vx: 0, vy: 0, life: 1, phase: 0 }]).ok, false);
  assert.equal(world(Array.from({ length: 49 }, (_, i) => ({
    pupId: i + 1, type: "nuke", x: 0, y: 0, vx: 0, vy: 0, life: 1, phase: 0,
  }))).ok, false);
});

test("a claim is validated before any room logic sees it", () => {
  const claim = (body) => parseClientMessage(JSON.stringify({ type: "pup_claim", ...body }));
  assert.equal(claim({ seq: 1, roundId: 1, pupId: 4 }).ok, true);
  assert.equal(claim({ seq: 1, roundId: 0, pupId: 4 }).ok, false);
  assert.equal(claim({ seq: -1, roundId: 1, pupId: 4 }).ok, false);
  assert.equal(claim({ seq: 1, roundId: 1, pupId: 0 }).ok, false);
  assert.equal(claim({ seq: 1, roundId: 1 }).ok, false);
});

test("the room relays PUPs and resets the ledger between rounds", () => {
  // One ledger per team, because a 2v2 room runs two arenas: the referee that
  // settles one team's race must never see, or answer for, the other team's.
  assert.ok(rooms.includes("trackPupPositions(this.pupLedgerFor(room, player), world.pups ?? [])"));
  assert.ok(rooms.includes("for (const ledger of room.pupLedgers) resetPupLedger(ledger)"));
  // The gates that used to name co-op explicitly are the seam 2v2 slots into.
  assert.equal(rooms.includes('room.kind !== "coop"'), false, "shared-arena gates must not be co-op-only");
  assert.ok(rooms.includes("isSharedArenaKind(room.kind)"));
});

test("the arena host publishes named PUPs and the teammate adopts them", () => {
  assert.ok(source.includes("pups: serializePups(game, game.pickups)"));
  assert.ok(source.includes("game.pickups = world.pups.map"));
});

test("touching a PUP in a shared arena claims it rather than collecting it", () => {
  // The payload must not be awarded before the referee answers: inventory is a
  // server-owned LIFO ledger and a revoked award would desynchronise it.
  assert.ok(source.includes("netRef.current?.claimPup(pickup.pupId)"));
  assert.ok(source.includes('if (verdict === "granted") resolvePlayerPickup(game, pickup, "physical")'));
});

test("solo and 1v1 collection is untouched", () => {
  // Matched with \s* rather than a literal newline: this repo is checked out
  // CRLF on Windows and LF in CI, and a lone pilot's pickup path should not
  // depend on which.
  assert.match(
    source,
    /if \(!sharedArena\) \{\s*resolvePlayerPickup\(game, pickup, "physical"\);/,
    "a lone pilot still collects a PUP by flying over it",
  );
});
