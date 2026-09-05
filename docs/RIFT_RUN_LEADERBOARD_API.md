# Rift Run Leaderboard API

Status: **client implemented, server not built**

The game already reads and writes these two endpoints. They do not exist on the
score service yet, so today every call fails and the client falls back to the
on-device board — a supported state, not a bug. This document is the contract
the client was written against, so the service side can be built without
guessing.

Client code: `fetchRiftRunLeaderboard` and `saveRiftRunScoreToMurph` in
`app/arcade-scores.ts`. Device board and ranking rules: `app/rift-run-board.ts`.

## Why a third board

There are now three orderings, and each one is wrong for the other two modes.

| Board | Ranks on | Why not the others |
| --- | --- | --- |
| `/api/arcade/scores` | settled score from a **victory** | Rift Run is endless. It has no victory and no settled score. |
| `/api/arcade/survival-*` | **time survived** | A careful Rift Run that reaches depth eight can take *less* time than a cautious one that dies at depth two. Time ranks Rift Run backwards. |
| `/api/arcade/rift-run-*` | **depth** — rifts broken through | — |

Depth is the metric because it is what the mode is built around: the ruleset,
the hazards, the payload budget and the hardpoint unlocks all escalate off it.
"I got to depth six" is the sentence a pilot says after a run.

Merging any two of these into one list would sort it wrongly for both.

## Ranking rules

The service must order rows the same way the device board does
(`compareRiftRunEntries`), or a pilot's global rank will disagree with the
device rank shown on their own result card:

1. **`depth` descending.**
2. **`score` descending** breaks a tie. This does real work — depth is a small
   number, so most of a board is tied on it.
3. **Earliest `achievedAt` wins** a total tie. Whoever got there first keeps the
   higher rank rather than being pushed down by a later equal.

`level` is deliberately *not* a tie-break: it climbs on the same rift energy
that drives score, so it would only ever break a tie score had already broken.

There is **no `ship` field**, and this is not an omission. Every Rift Run
launches on the same issued starter frame, so a ship column would print one
value on every row and a ship filter would offer one option. (The Survival
board carries both because Survival flies the roster.)

## Base URL

Same host as the existing arcade endpoints: `NEXT_PUBLIC_MURPH_API_BASE`,
defaulting to `https://murphtournaments.com`.

No cookies are sent (`credentials: "omit"`). No account is required — three
initials are the whole identity, exactly as on the other two boards.

## GET `/api/arcade/rift-run-leaderboard`

Query parameters:

| Parameter | Type | Notes |
| --- | --- | --- |
| `limit` | integer | Rows to return. The client asks for 25. Clamp server-side. |

Response `200 application/json`:

```json
{
  "entries": [
    {
      "id": 2207,
      "rank": 1,
      "initials": "PJM",
      "depth": 11,
      "level": 24,
      "score": 148300,
      "durationSeconds": 812,
      "achievedAt": "2026-09-04T21:00:11Z"
    }
  ]
}
```

- `entries` must be an array. The client drops any row missing a numeric
  `depth` or a string `initials`, so partial data degrades to fewer rows rather
  than to a broken board.
- Anything that is not a `200` with a JSON content type is treated as "the
  global board is unavailable", and the client shows the device board with a
  status line. It never surfaces an error to the player.

## POST `/api/arcade/rift-run-scores`

Request body:

```json
{
  "runId": "0f6c1f7a-2c9e-4f0a-9c2e-6b9a2f5d4e11",
  "initials": "PJM",
  "depth": 11,
  "level": 24,
  "score": 148300,
  "durationSeconds": 812
}
```

- `runId` is unique per completed run. Treat a repeat as the **same** run and
  return its existing rank rather than inserting a second row — the client can
  submit once on the result card and again when a restored summary re-renders.
- `initials` is exactly three characters matching `[A-Z0-9]{3}`. The client
  enforces this before sending; enforce it again server-side.
- The client never submits a Practice run, and never submits a run with no
  `depth`.

Response `200 application/json`:

```json
{ "rank": 4 }
```

`rank` may be `null` when the run did not place. Any non-`200` is reported to
the player as "your device board is safe" — the device record is written first
and never depends on this call.
