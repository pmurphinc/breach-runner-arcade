# Wormhole Arcade

A modern browser recreation of the classic **Wormhole** arcade game, built from gameplay references and the original downloadable client.

## Play

The current playable build is available at:

https://wormhole.murphtournaments.com

## Controls

| Action | Keyboard |
| --- | --- |
| Move up | `W` or Up arrow |
| Move down | `S` or Down arrow |
| Move left | `A` or Left arrow |
| Move right | `D` or Right arrow |
| Pulse cannon | Space |
| Fire collected power-up | `E` |
| Ship special | `Q` |
| Pause | `P` |

Desktop movement is direct and world-space: `W` accelerates upward, `S`
downward, `A` left, `D` right, and holding two adjacent keys moves diagonally
at the same speed as a cardinal — diagonals are normalized, so no direction is
faster than another. Opposing keys cancel that axis rather than one winning.
The hull turns toward its travel direction unless you are aiming, and keeps its
last heading while drifting. Each ship keeps its own acceleration, top speed,
momentum and retro behaviour, so the frames still handle differently.

Touch controls use a twin-stick layout: the left stick moves the ship while the right stick independently aims and fires the pulse cannon. The **PUP** button is the touch equivalent of `E`, and **SPEC** is the touch equivalent of `Q`. Fullscreen play, high-density canvas rendering, safe-area support, and dedicated layouts for desktop, ultrawide, tablet, phone, and foldable displays are included. Installable PWA mode is planned.

## Game modes

Choose before launching. The selector is in the ship panel on desktop and in
the MENU panel on handhelds; it is a real ARIA radiogroup, so arrow keys,
mouse and touch all work. Your PvE difficulty is remembered on the device.

### PvE

| Mode | Wormhole | Collision shield | Wormhole contact |
| --- | --- | --- | --- |
| `EASY // COLLISION SHIELD` | Locked dead centre | Yes — 40 capacity, 4s recharge | Harmless |
| `DIFFICULT // MOVING VOID` | Orbits, 210px at 0.5°/tick | None | Harmless |
| `HARD MODE // CONTACT HAZARD` | Orbits | None | Damages hull in ticks |

All three rules live in `app/difficulty.ts` as data, with the collision shield
and contact hazard implemented as pure state machines. Nothing in the game loop
branches on a difficulty id, and every value below is tunable in that one file.

**Collision shield (Easy only).** Absorbs 100% of collision damage — walls and
hostile bodies — and nothing else. Bullets, gunship beams and nuke blasts go
straight to hull, as they always have; Hard Mode contact damage bypasses it
too. Whatever the shield cannot absorb overflows to hull. Capacity is 40,
chosen against the damage the game actually deals: a mine or inflator body is
20, a heatseeker 10, a generic hostile 8, a wall scrape 2. So a full shield
eats two mine hits or five ordinary bumps, and the fourth reckless collision in
a row lands on hull. Any collision damage — even damage the shield fully
absorbed — restarts a four-second delay, after which the shield restores to
full. Recharge depends on time alone: `tickCollisionShield` takes no position
and no wormhole argument, so "recharges anywhere" is true by construction.

**Contact hazard (Hard Mode only).** Overlapping the wormhole costs 4% of
maximum hull every 0.5s, capped at 32% of maximum hull per contact episode.
Scaling by maximum hull keeps light and heavy frames equally survivable. The
cap is what guarantees the safety properties: one unbroken episode can never
destroy a full-health pilot, and three separate episodes still leave about 4%
hull, so contact damage alone needs a fourth. A new episode requires leaving
the radius completely, and a 0.6s re-entry grace stops jitter at the boundary
opening extra episodes.

### PvP 1v1

Real-time online 1v1 under Easy rules, with no sign-in — guests get a callsign
like `GUEST-4821`. Each player flies their own arena with a locked centre
wormhole and the collision shield; you shoot your own wormhole to generate
power-ups and send attack power-ups through it to your opponent. Defensive and
utility pickups stay with whoever collected them.

A match is decided by **pilot hull**, not by rival integrity — that is a PvE
objective and is replaced in the PvP HUD so there is never a second,
contradictory victory condition. `P` does not pause a live match; it opens the
menu and says so while play continues.

## Multiplayer architecture

One Railway service hosts both the game and the match server. `vinext` exports
`startProdServer`, which returns the live `node:http.Server`, so
`server/start.mjs` serves the game exactly as `vinext start` does and then
mounts the WebSocket endpoint on the same socket — same injected `PORT`, same
custom domain, no second service and no DNS change.

```
server/start.mjs     production entry (npm start)
server/pvp.mjs       WebSocket transport, origin policy, heartbeats
server/rooms.mjs     authoritative rooms, hull, shield, match results
server/rules.mjs     the Easy rules the server enforces
server/protocol.mjs  message validation, rate limits, invite codes
app/pvp-client.ts    browser client: connection, sequencing, reconnection
```

The server owns everything a client must not be trusted with: room membership,
match identity, ready state, the countdown, weapon transmissions, collision
shield state and recharge timing, damage, hull, and the result. Clients
simulate their own arena for responsiveness and report what hit them; the
server decides what it costs. Sequence numbers make a replayed event a no-op, a
sliding window caps both event rate and total damage per second, and only the
game's real sendable power-ups can be transmitted.

`server/rules.mjs` deliberately duplicates the numbers in `app/difficulty.ts`
rather than importing them, so the production entry does not depend on Node's
experimental TypeScript stripping. `tests/pvp-protocol.test.mjs` and
`tests/pvp-server.test.mjs` assert the two copies agree, including ship hulls
and the sendable weapon list.

**Single-instance limitation.** Rooms are held in memory in one process. That
is correct for short 1v1 matches, but it means a redeploy ends matches in
progress, and scaling to more than one instance would need sticky sessions or
shared room state. There is no such requirement today.

**PvE never depends on any of this.** The mount is wrapped: if the match
service fails to start, the game still serves and the lobby says so. A PvE
player never opens a socket at all.

## Environment variables

None are required. All are optional:

| Variable | Purpose |
| --- | --- |
| `PORT` | Injected by Railway. The server binds `0.0.0.0` on it. |
| `PVP_DISABLED` | Set to `1` to serve single-player only. |
| `PVP_EXTRA_ORIGINS` | Comma-separated extra browser origins (e.g. a staging host). |
| `NEXT_PUBLIC_PVP_URL` | Overrides the socket URL. Defaults to the page's own origin. |
| `NEXT_PUBLIC_MURPH_API_BASE` | Score API base. Defaults to `https://murphtournaments.com`. |

`https://wormhole.murphtournaments.com` is always an allowed origin. Loopback
origins are accepted only when `NODE_ENV` is not `production`, so the deployed
service cannot accept a localhost origin.

## Railway

The existing service needs no configuration change: Railway keeps
auto-detecting `npm run build` and `npm start`, and `npm start` now runs
`server/start.mjs`, which binds `0.0.0.0:$PORT` exactly as `vinext start` did.
Railway proxies WebSocket upgrades on the same domain, so `/pvp` is reachable
at `wss://wormhole.murphtournaments.com/pvp` with no extra setup.

If you ever want the game without multiplayer, set `PVP_DISABLED=1` in the
service variables. Nothing else needs touching — no new service, no DNS, no
domain changes.

## Loop

1. Shoot the rival wormhole with the pulse cannon. Damage fills its charge ring.
2. At 150 damage the wormhole generates a power-up.
3. Fly over the power-up to collect it into the bin (five slots, last in first out).
4. Aim at the wormhole and press `E` (touch: **PUP**) to send an attack power-up back through it.

## Weapons

Every power-up has its own canvas silhouette, projectile, and spawn animation, and each one is identifiable without colour. Hover or focus an inventory slot on desktop — or tap it on a touch screen — to open its information card, or open the **Weapon Codex** from the top bar to read about all of them before you fly.

## Scores

Nothing here asks for an account. Play starts the moment the page loads, and it
stays that way whether or not Murph Tournaments is reachable.

- **Guests.** Your best run is kept in this browser's `localStorage`, under
  `wormhole-arcade:best`. It is never uploaded and never leaves the device.
- **Signed in.** When a run ends you can sign in with Discord to save that score
  to Murph Tournaments, which is what puts you on the global board. The run is
  parked in local storage across the sign-in redirect, so nothing is lost on the
  way there and back. Once signed in, later runs save automatically.
- **The board.** `BOARD` in the top bar shows the top saved runs plus your own
  device best. It lists one row per player — their best run — so a long session
  cannot crowd anyone out.

Scores are reported by the browser and are therefore trusted. That is the
deliberate trade for a board that costs a player nothing to join; the server
applies plausibility bounds and a per-player rate limit, not anti-cheat.

The API lives in the `murphtournaments-website` repository under
`/api/arcade/*`, and is opened cross-origin to this arcade's origin only. Point
the game at a different host by setting `NEXT_PUBLIC_MURPH_API_BASE` at build
time; it defaults to `https://murphtournaments.com`.

## Rendering quality

The top bar cycles between **Auto**, **High**, and **Performance**. Auto starts from device pixel ratio, touch capability, and viewport size, then adapts to measured frame cost, capping canvas resolution and particle counts on lower-powered tablets and phones.

## Run locally

Requirements:

- Node.js 22.13 or newer
- npm

```bash
npm ci
npm run dev
```

Then open the local URL printed by the development server.

## Useful commands

```bash
npm run dev
npm run lint
npm test          # build + every suite; browser suites skip without Playwright
npm run test:pvp  # protocol, match server, socket, and a two-browser match
npm run build
npm start         # production: game + match service on one port
```

Browser-driven suites (`gameplay`, `pvp-gameplay`, `devices`) need Playwright,
which is deliberately not a dependency of this repository. They skip cleanly
when it is missing, so `npm test` stays meaningful on a bare checkout. The
gameplay suite also needs a dev server:

```bash
npx vite --port 5199
WORMHOLE_TEST_URL=http://localhost:5199/ npm run test:gameplay
```

## Project direction

- Refine desktop combat, progression, ships, weapons, and power-ups
- Refine device-specific touch control placement from player feedback
- Add install-to-home-screen support
- Preserve the standalone build so it can also be deployed independently

## Technology

- React 19
- Next.js-compatible routing through Vinext
- TypeScript
- HTML Canvas
- Cloudflare-compatible deployment

## Attribution

This is a fan-made preservation and modernization project inspired by the original Centerfleet/Centerscore **Wormhole**. Original game names, sounds, and other legacy materials remain the property of their respective owners.
