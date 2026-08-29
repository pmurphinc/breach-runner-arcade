# Arcade leaderboard difficulty filter

The Global Board client requests difficulty-relative results from the external
Murph score service:

```http
GET /api/arcade/leaderboard?limit=10
GET /api/arcade/leaderboard?limit=10&difficulty=easy
GET /api/arcade/leaderboard?limit=10&difficulty=difficult
GET /api/arcade/leaderboard?limit=10&difficulty=hard
```

`difficulty` is optional. The service must accept only `easy`, `difficult`, or
`hard` when present. Invalid values should return `400 Bad Request`.

The filter must be applied to scored classic PvE victories **before** ordering,
rank assignment, and limiting. A filtered response's `rank` is its placement
within that difficulty, beginning at 1. Practice, Survival, Rift Run, co-op,
and PvP records are not eligible for this endpoint.

Conceptually, the service query is:

```sql
SELECT ...
FROM arcade_scores
WHERE (:difficulty IS NULL OR difficulty = :difficulty)
ORDER BY score DESC, duration_seconds ASC, achieved_at ASC
LIMIT :limit
```

The backend for this endpoint is not part of this repository. The client sends
the parameter rather than filtering a limited mixed response, and rejects a
filtered response containing a different difficulty so an older service cannot
silently display a known-mixed board as a filtered ranking.
