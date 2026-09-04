/**
 * Room rosters, expressed as teams rather than as "the other one".
 *
 * `server/rooms.mjs` grew up around exactly two players, so it could get away
 * with `opponentOf(room, player)` meaning both "my enemy" (1v1) and "my
 * teammate" (co-op). 2v2 breaks that pun: a four-pilot room has one pilot who
 * is neither, and the two meanings have to be separated before anything else
 * can be built.
 *
 * The shapes here are the whole of it:
 *
 *   1v1   two teams of one    — each pilot alone in their own arena
 *   co-op one team of two     — two pilots, one shared arena, no rival team
 *   2v2   two teams of two    — two shared arenas, one rift each
 *
 * A "team" is therefore not a 2v2 concept bolted on; it is the shape every
 * existing mode already had, named. Read that way, 1v1 and co-op are the
 * degenerate cases of the same room, which is why generalising this does not
 * have to change either of them.
 *
 * Deliberately plain `.js` with JSDoc, following `app/shared-arena.js` and
 * `app/pup-inventory.js`: `server/rooms.mjs` imports it at runtime,
 * `app/pvp-client.ts` can import it through TypeScript, and `node --test`
 * imports it directly. One copy of the roster rules for all three.
 *
 * Everything here is a pure function of `{ kind, players }`, so the tests can
 * drive it with plain objects and never open a socket.
 */

/**
 * How many teams a session has, and how many pilots sit on each.
 *
 * @type {Readonly<Record<string, { teams: number, perTeam: number }>>}
 */
export const TEAM_LAYOUTS = Object.freeze({
  pvp: Object.freeze({ teams: 2, perTeam: 1 }),
  coop: Object.freeze({ teams: 1, perTeam: 2 }),
  team: Object.freeze({ teams: 2, perTeam: 2 }),
});

/** Unknown kinds fall back to 1v1 rather than inventing a roster. */
export function teamLayout(kind) {
  return TEAM_LAYOUTS[/** @type {string} */ (kind)] ?? TEAM_LAYOUTS.pvp;
}

/** Total pilots a full room of this kind holds: 1v1 two, co-op two, 2v2 four. */
export function roomCapacity(kind) {
  const layout = teamLayout(kind);
  return layout.teams * layout.perTeam;
}

export function teamCount(kind) {
  return teamLayout(kind).teams;
}

export function teamSize(kind) {
  return teamLayout(kind).perTeam;
}

/** True only for the four-pilot two-team session. */
export function isTeamKind(kind) {
  return kind === "team";
}

/**
 * Which team a pilot is on. Absent means team zero, so any player object
 * created before teams existed still resolves sensibly.
 *
 * @param {{ team?: number } | null | undefined} player
 */
export function teamIndexOf(player) {
  const index = player?.team;
  return Number.isInteger(index) && /** @type {number} */ (index) >= 0 ? /** @type {number} */ (index) : 0;
}

/** @typedef {{ kind?: string, players?: readonly any[] }} RosterRoom */

/**
 * @param {RosterRoom} room
 * @param {number} index
 */
export function membersOfTeam(room, index) {
  return (room.players ?? []).filter((entry) => teamIndexOf(entry) === index);
}

/** Every team's roster, in team order. Empty teams are kept as empty arrays. */
export function teamRosters(room) {
  const teams = teamCount(room.kind);
  return Array.from({ length: teams }, (_, index) => membersOfTeam(room, index));
}

/**
 * The pilots sharing this pilot's arena. Never includes the pilot themselves.
 *
 * In 1v1 this is empty by construction — a lone pilot owns their arena — which
 * is exactly the guarantee `tests/portals.test.mjs` pins.
 */
export function teammatesOf(room, player) {
  const index = teamIndexOf(player);
  return (room.players ?? []).filter((entry) => entry !== player && teamIndexOf(entry) === index);
}

/** The pilots on the other team. Empty in co-op, which has no other team. */
export function rivalsOf(room, player) {
  const index = teamIndexOf(player);
  return (room.players ?? []).filter((entry) => teamIndexOf(entry) !== index);
}

/** Everyone in the room but this pilot, teammates and rivals alike. */
export function othersOf(room, player) {
  return (room.players ?? []).filter((entry) => entry !== player);
}

/**
 * The pilot who simulates this team's arena: the first of the team to join.
 *
 * One host per *team*, not per room — a 2v2 room runs two independent shared
 * arenas, so it has two hosts. In co-op and 1v1 this collapses to the room's
 * first player and its own occupant respectively, which is what both already do.
 */
export function arenaHostOf(room, player) {
  const index = teamIndexOf(player);
  return (room.players ?? []).find((entry) => teamIndexOf(entry) === index) ?? null;
}

export function isArenaHost(room, player) {
  return arenaHostOf(room, player) === player;
}

/**
 * Which team a joining pilot should fill.
 *
 * Balanced fill, lowest index first: pilots one and two of a 2v2 land on
 * opposite teams, three and four fill the gaps. Returns null when the room is
 * already full, which is the caller's cue to refuse the join.
 */
export function nextTeamFor(room) {
  const layout = teamLayout(room.kind);
  let best = null;
  let bestCount = Infinity;
  for (let index = 0; index < layout.teams; index += 1) {
    const count = membersOfTeam(room, index).length;
    if (count >= layout.perTeam) continue;
    if (count < bestCount) {
      best = index;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Seat a group of pilots, in order, across the room's teams.
 *
 * Used when matchmaking hands a whole roster over at once. Returns the seated
 * players so the caller can store them as `room.players`.
 */
export function seatPlayers(kind, players) {
  const room = { kind, players: [] };
  for (const player of players) {
    const index = nextTeamFor(room);
    // A caller that over-fills a room is a bug, not a runtime condition; park
    // the overflow on the last team rather than silently dropping a pilot.
    player.team = index ?? teamCount(kind) - 1;
    room.players.push(player);
  }
  return room.players;
}

export function isRoomFull(room) {
  return (room.players ?? []).length >= roomCapacity(room.kind);
}

/**
 * Is this team out of the round?
 *
 * A team is down when none of its pilots are still flying. That is the direct
 * generalisation of the 1v1 rule — a team of one is down the moment its pilot
 * is — so 1v1 keeps its exact behaviour while 2v2 plays on until both pilots
 * of a team are gone, rather than ending on the first hull to reach zero.
 */
export function isTeamDown(room, index) {
  const members = membersOfTeam(room, index);
  if (members.length === 0) return true;
  return members.every((entry) => entry.eliminated === true);
}

/** The first team still flying that is not this one, or null. */
export function survivingRivalTeam(room, index) {
  const teams = teamCount(room.kind);
  for (let other = 0; other < teams; other += 1) {
    if (other === index) continue;
    if (!isTeamDown(room, other)) return other;
  }
  return null;
}
