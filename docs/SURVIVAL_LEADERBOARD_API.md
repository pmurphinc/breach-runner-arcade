# Survival Leaderboard API

Status: **client implemented, server not built**

The game already reads and writes these two endpoints. They do not exist on the
score service yet, so today every call fails and the client falls back to the
on-device board — a supported state, not a bug. This document is the contract
the client was written against, so the service side can be built without
guessing.

Client code: `fetchSurvivalLeaderboard` and `saveSurvivalScoreToMurph` in
`app/arcade-scores.ts`.

## Why not the existing arcade endpoints

`/api/arcade/scores` ranks a **settled score** from a completed **victory**.
Rift Survival has neither: it is endless, so it has no victory, and it is
ranked by **time survived** rather than by score. Posting survival runs to the
arcade board would rank them against a number that means something else, and
would sort the merged list wrongly for both modes. Hence a separate board with
its own ordering.

## Base URL

Same host as the existing arcade endpoints:
`NEXT_PUBLIC_MURPH_API_BASE`, defaulting to `https://murphtournaments.com`.

No cookies are sent (`credentials: "omit"`). No account is required — three
initials are the whole identity, exactly as on the arcade board.

## GET `/api/arcade/survival-leaderboard`

Query parameters:

| Parameter | Type | Notes |
| --- | --- | --- |
| `limit` | integer | Rows to return. The client asks for 25. Clamp server-side. |
| `ship` | string | Optional. Player-facing ship name (e.g. `Starling`). Omitted for All Ships. |

Response `200 application/json`:

```json
{
  "entries": [
    {
      "id": 1041,
      "rank": 1,
      "initials": "PJM",
      "ship": "Starling",
      "durationSeconds": 947,
      "score": 182400,
      "riftLevel": 16,
      "achievedAt": "2026-08-25T15:19:04Z"
    }
  ]
}
```

- `entries` must be an array. The client drops any row missing a numeric
  `durationSeconds` or a string `initials`, so partial data degrades to fewer
  rows rather than a broken screen.
- `rank` is assigned by the server, and must be consistent with the `ship`
  filter: a filtered request ranks within that ship.
- Any non-200, any non-JSON content type, and any network error are all treated
  identically by the client — it shows the device board and says the global
  board is unavailable.

**Ordering**: `durationSeconds` descending, then `score` descending, then
earliest `achievedAt` first. This matches `compareSurvivalEntries` in
`app/survival-board.ts`, which orders the device board; the two lists should
not disagree about which of two runs is better.

## POST `/api/arcade/survival-scores`

Request body:

```json
{
  "runId": "b0b4b2c1-...",
  "initials": "PJM",
  "ship": "Starling",
  "durationSeconds": 947,
  "score": 182400,
  "riftLevel": 16,
  "breaches": 3
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `runId` | string | Unique per completed run. Use it to make submission idempotent — a retry must not create a second row. |
| `initials` | string | Exactly `/^[A-Z0-9]{3}$/`. The client rejects anything else before sending. |
| `ship` | string | Player-facing ship name. |
| `durationSeconds` | integer ≥ 1 | The rank metric. |
| `score` | integer ≥ 0 | Supporting detail. |
| `riftLevel` | integer ≥ 1 | Peak Rift Level reached. |
| `breaches` | integer ≥ 0 | Times the rift was collapsed and reformed. |

Response `200 application/json`:

```json
{ "rank": 4 }
```

`rank` may be `null` when the server does not compute one. Any other status is
treated as a failure; the client shows the device board and reports that the
global board is not open.

Errors should return `{ "error": "..." }`, which the client surfaces verbatim.

## Server-side validation worth having

The client is the only thing producing these numbers today, so the endpoint
should not trust them:

- **Idempotency on `runId`** is the one that matters most — the client retries.
- `durationSeconds` and `riftLevel` are not independent. A run's Rift Level is
  `floor(durationSeconds / 60) + 1` (see `SURVIVAL_LEVEL_SECONDS` and
  `riftLevelForSeconds` in `app/survival.ts`). A submission where they disagree
  is not a run this build can produce.
- `score` grows with time in a bounded way. At Rift Level *n* the run earns
  `20 + 20 × (n − 1)` points per second survived, plus kills, pickups and
  breach bonuses — so an implausible score for a given duration is worth
  rejecting or flagging.
- Rate-limit by IP as the arcade endpoint does.

## What the client does when this is missing

Everything except the global list still works:

- Runs are recorded on the device board (`wormhole-arcade:survival-board`,
  top 25, ranked by time).
- The result card reports the device rank.
- The Survival board screen shows the device board under a line saying the
  global board is not open yet.

Nothing here needs to change when the endpoint ships — it starts answering and
the global rows appear.
