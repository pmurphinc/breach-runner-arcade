/**
 * The roster rules, on their own.
 *
 * `app/team-rooms.js` is deliberately pure — plain objects in, plain answers
 * out — so the part of 2v2 that is easiest to get quietly wrong (who is my
 * teammate, who is my enemy, who hosts my arena) can be proven without a
 * socket, a room, or a running match anywhere in sight.
 *
 * The load-bearing claim in here is that 1v1 and co-op are the *degenerate*
 * cases of the same shape rather than separate ones: if these assertions hold,
 * generalising the room could not have changed either of them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TEAM_LAYOUTS,
  arenaHostOf,
  isArenaHost,
  isRoomFull,
  isTeamDown,
  isTeamKind,
  membersOfTeam,
  nextTeamFor,
  othersOf,
  rivalsOf,
  roomCapacity,
  seatPlayers,
  survivingRivalTeam,
  teamCount,
  teamIndexOf,
  teamLayout,
  teamRosters,
  teamSize,
  teammatesOf,
} from "../app/team-rooms.js";

const pilot = (id) => ({ id, eliminated: false });

/** Seat a fresh roster of the given size and hand back the room. */
function room(kind, count) {
  const players = Array.from({ length: count }, (_, index) => pilot(`p${index + 1}`));
  return { kind, players: seatPlayers(kind, players) };
}

// ------------------------------------------------------------------ shapes --

test("every mode is the same room with a different roster shape", () => {
  assert.deepEqual(teamLayout("pvp"), { teams: 2, perTeam: 1 }, "1v1: two teams of one");
  assert.deepEqual(teamLayout("coop"), { teams: 1, perTeam: 2 }, "co-op: one team of two");
  assert.deepEqual(teamLayout("team"), { teams: 2, perTeam: 2 }, "2v2: two teams of two");
  assert.equal(roomCapacity("pvp"), 2);
  assert.equal(roomCapacity("coop"), 2);
  assert.equal(roomCapacity("team"), 4, "2v2 is the only four-seat room");
  assert.equal(teamCount("coop"), 1, "co-op has nobody to be a rival");
  assert.equal(teamSize("pvp"), 1, "a 1v1 pilot is a team of one");
  assert.ok(Object.isFrozen(TEAM_LAYOUTS));
});

test("an unknown kind falls back to 1v1 rather than inventing a roster", () => {
  assert.deepEqual(teamLayout("nonsense"), TEAM_LAYOUTS.pvp);
  assert.deepEqual(teamLayout(undefined), TEAM_LAYOUTS.pvp);
  assert.equal(roomCapacity(null), 2);
});

test("only the four-pilot session counts as a team kind", () => {
  assert.equal(isTeamKind("team"), true);
  assert.equal(isTeamKind("coop"), false, "co-op is one team, not two");
  assert.equal(isTeamKind("pvp"), false);
});

// ------------------------------------------------------------------ seating --

test("2v2 seats pilots on alternating sides", () => {
  const teams = room("team", 4).players.map(teamIndexOf);
  assert.deepEqual(teams, [0, 1, 0, 1], "the first two are opponents, not allies");
});

test("co-op seats both pilots on one team", () => {
  assert.deepEqual(room("coop", 2).players.map(teamIndexOf), [0, 0]);
});

test("1v1 seats the two pilots on opposite teams", () => {
  assert.deepEqual(room("pvp", 2).players.map(teamIndexOf), [0, 1]);
});

test("the next seat is the emptiest team, and null once the room is full", () => {
  const empty = { kind: "team", players: [] };
  assert.equal(nextTeamFor(empty), 0);
  const half = room("team", 2);
  assert.equal(nextTeamFor(half), 0, "team zero has the free seat once one each is in");
  assert.equal(nextTeamFor(room("team", 4)), null, "a full room refuses a fifth pilot");
  assert.equal(nextTeamFor(room("pvp", 2)), null);
  assert.equal(nextTeamFor(room("coop", 2)), null);
});

test("a room is full at capacity and not before", () => {
  assert.equal(isRoomFull(room("team", 3)), false, "three pilots is not a 2v2");
  assert.equal(isRoomFull(room("team", 4)), true);
  assert.equal(isRoomFull(room("pvp", 1)), false);
  assert.equal(isRoomFull(room("pvp", 2)), true);
});

// -------------------------------------------------------------- relationships --

test("2v2 tells teammates and rivals apart", () => {
  const r = room("team", 4);
  const [one, two, three, four] = r.players;
  assert.deepEqual(teammatesOf(r, one), [three], "one and three share an arena");
  assert.deepEqual(rivalsOf(r, one), [two, four], "and fight the other two");
  assert.deepEqual(teammatesOf(r, two), [four]);
  assert.deepEqual(rivalsOf(r, two), [one, three]);
  assert.deepEqual(othersOf(r, one), [two, three, four]);
  assert.deepEqual(teamRosters(r), [[one, three], [two, four]]);
});

test("a 1v1 pilot has no teammate, only a rival", () => {
  const r = room("pvp", 2);
  const [alpha, bravo] = r.players;
  assert.deepEqual(teammatesOf(r, alpha), [], "1v1 is one pilot per arena, and shares nothing");
  assert.deepEqual(rivalsOf(r, alpha), [bravo]);
  assert.deepEqual(rivalsOf(r, bravo), [alpha]);
});

test("a co-op pilot has a teammate and no rival at all", () => {
  const r = room("coop", 2);
  const [alpha, bravo] = r.players;
  assert.deepEqual(teammatesOf(r, alpha), [bravo]);
  assert.deepEqual(rivalsOf(r, alpha), [], "the co-op rival is a wormhole, not a pilot");
});

test("a pilot with no team recorded is treated as team zero", () => {
  assert.equal(teamIndexOf({}), 0);
  assert.equal(teamIndexOf(null), 0);
  assert.equal(teamIndexOf({ team: 1 }), 1);
  assert.equal(teamIndexOf({ team: -1 }), 0, "a nonsense index must not open a third arena");
});

// ------------------------------------------------------------------- hosting --

test("each team hosts its own arena", () => {
  const r = room("team", 4);
  const [one, two, three, four] = r.players;
  assert.equal(arenaHostOf(r, one), one);
  assert.equal(arenaHostOf(r, three), one, "the teammate defers to the same host");
  assert.equal(arenaHostOf(r, two), two, "the other team hosts its own, separate arena");
  assert.equal(arenaHostOf(r, four), two);
  assert.equal(isArenaHost(r, one), true);
  assert.equal(isArenaHost(r, three), false);
  assert.equal(isArenaHost(r, two), true, "a 2v2 room has two hosts, not one");
});

test("co-op hosting is unchanged: the first pilot in the room", () => {
  const r = room("coop", 2);
  assert.equal(arenaHostOf(r, r.players[1]), r.players[0]);
  assert.equal(isArenaHost(r, r.players[0]), true);
});

test("a 1v1 pilot hosts their own arena and nobody else's", () => {
  const r = room("pvp", 2);
  assert.equal(isArenaHost(r, r.players[0]), true);
  assert.equal(isArenaHost(r, r.players[1]), true);
  assert.equal(arenaHostOf(r, r.players[0]), r.players[0]);
});

// -------------------------------------------------------------- elimination --

test("a team is down only when every one of its pilots is", () => {
  const r = room("team", 4);
  const [one, two, three] = r.players;
  one.eliminated = true;
  assert.equal(isTeamDown(r, 0), false, "one hull at zero must not end a 2v2");
  three.eliminated = true;
  assert.equal(isTeamDown(r, 0), true);
  assert.equal(isTeamDown(r, 1), false);
  assert.equal(survivingRivalTeam(r, 0), 1, "the other team wins");
  two.eliminated = true;
  r.players[3].eliminated = true;
  assert.equal(survivingRivalTeam(r, 0), null, "nobody left flying anywhere");
});

test("a team of one is down the moment its pilot is, which is the 1v1 rule", () => {
  const r = room("pvp", 2);
  r.players[0].eliminated = true;
  assert.equal(isTeamDown(r, 0), true);
  assert.equal(survivingRivalTeam(r, 0), 1);
});

test("an empty team counts as down rather than as invincible", () => {
  assert.equal(isTeamDown({ kind: "team", players: [] }, 1), true);
  assert.deepEqual(membersOfTeam({ kind: "team", players: [] }, 0), []);
});
