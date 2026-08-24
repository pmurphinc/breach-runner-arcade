# Breach Runner

**Weaponize the rift.**

Breach Runner is an original fast-paced twin-stick space combat game developed under the internal project name **Project Rift**. The game is being polished first as a web release; Android/Google Play and Windows/Steam packaging are planned only after the core game, menus, balance, and presentation are considered release-ready.

## Current playable build

Development deployment:

`https://breachrunner.murphtournaments.com`

The canonical web deployment now uses the Breach Runner subdomain. Internal compatibility ids remain unchanged where renaming them would risk saves, networking, or score data.

## Core loop

1. Shoot the central rift with the pulse cannon.
2. Damage charges the rift until it generates a pickup or attack payload.
3. Fly over pickups to collect upgrades or store sendable payloads.
4. Fire stored attack payloads back through the rift.
5. Survive escalating hazards and eliminate the rival objective or opposing pilot, depending on the mode.

## Modes

- **Solo PvE** — destroy the rival objective while surviving its attacks.
- **PvE Co-op** — two pilots fight through the same objective loop together.
- **PvP 1v1** — each pilot flies their own arena while transmitting attack payloads to the opponent.
- **Practice** — unlimited-hull training without leaderboard submission.

Difficulty rules include a stationary-rift collision-shield mode, a moving-rift mode, and a hard contact-hazard mode.

## Fleet

The commercial-facing fleet currently contains eight distinct frames:

- **Ironclad** — heavy brawler
- **Starling** — balanced interceptor
- **Phantom** — high-speed scout
- **Needle** — guided-strike corvette
- **Rampart** — defensive bruiser
- **Switchback** — shape-shifter
- **Talon** — missile corvette
- **Leviathan** — command vessel

Each frame has its own hull, handling, acceleration, starting equipment, strengths, weaknesses, experience tier, and active special. Player-facing names live in `app/game-data.ts`; older internal ids remain stable only to protect saved settings, tests, multiplayer payloads, and compatibility.

## Weapons and pickups

The rift can produce utility upgrades and sendable attack/hazard payloads. The current commercial-facing catalog includes Cannon Upgrade, Engine Upgrade, Retro Thrusters, Shield Field, Nova Burst, Hull Repair, Tracker Swarm, Orbital Sentry, Void Mines, Raider Drones, Plasma Bloom, Mine Carrier, Assault Frigate, Scavenger, Core Bomb, Rim Crawler, Sweep Beam, Pulse Scrambler, Phase Shade, and Siege Battery.

Every pickup has a procedural canvas silhouette, projectile/deployment behavior, spawn feedback, readable label, and information-card description. Internal ids are compatibility keys and are not intended as product branding.

## Controls

### Desktop

| Action | Control |
| --- | --- |
| Thrust | `WASD` or arrow keys |
| Aim | Mouse |
| Pulse cannon | Mouse 1 / Space |
| Fire stored payload | Mouse 2 / `E` |
| Ship special | `Q` |
| Pause/menu | `P` |

Movement is inertial rather than grid based. Thrust adds acceleration to current velocity, diagonal thrust is normalized, and each frame keeps distinct acceleration, top speed, directional response, momentum, and upgrade behavior.

### Touch

Touch play uses a twin-stick layout: the left stick controls movement and the right stick aims/fires. **PUP** fires the stored payload and **SPEC** activates the ship special. Dedicated layout logic supports phones, tablets, foldables, landscape play, safe areas, fullscreen, and high-density canvas rendering.

## Scoring and arcade identity

A qualifying solo PvE score can be locked using three-character arcade initials. Initials are remembered on the device and reused until changed in **Menu → Game Info**. Practice runs are not submitted.

The global board is designed like a classic arcade leaderboard: no account is required merely to enter initials and compete. Local bests are also retained on-device.

## Multiplayer architecture

One Railway service hosts the web game and WebSocket match server.

```text
server/start.mjs     production entry
server/pvp.mjs       WebSocket transport, origin policy, heartbeats
server/rooms.mjs     authoritative rooms, hull, shield, match results
server/rules.mjs     server-enforced match rules
server/protocol.mjs  validation, rate limits, invite codes
app/pvp-client.ts    browser client and reconnection logic
```

The server owns room membership, match identity, ready state, countdown, transmitted weapon events, collision-shield state, damage, hull, and results. Clients simulate their own arena for responsiveness. Solo PvE does not require a WebSocket connection.

Rooms are currently held in memory, so a deploy ends matches in progress and multi-instance scaling would require sticky sessions or shared room state.

## Audio and visual effects

Most special-event audio is synthesized at runtime with Web Audio. The four file-based effects (`fire.wav`, `explosion.wav`, `magic.wav`, and `thrust.wav`) were replaced during the commercial cleanup with newly generated original waveforms.

Ships, pickups, projectiles, rift effects, particles, and much of the game presentation are drawn procedurally in application code rather than loaded from sprite sheets.

See `ASSET_PROVENANCE.md` for the commercial-use record and `COMMERCIALIZATION.md` for the release cleanup checklist.

## Victory sequence

A PvE victory resolves through a staged rift-collapse cinematic. Gameplay freezes, arena objects are pulled inward, the rift collapses toward a singularity, and the sequence ends in a layered blast with particles, shockwaves, audio, and supported-device haptics. Reduced-motion preferences remove or reduce the strongest motion effects.

## View and menu system

The game includes explicit Touch, PC, and Hybrid view profiles plus Fit Screen, Balanced, and Arena Focus screen presets. Layout budgeting reacts to viewport size, browser chrome, software keyboards, safe areas, orientation changes, fullscreen, and foldable/tablet dimensions.

The menu exposes play actions, display options, controls/audio, initials, the weapon codex, leaderboard, fleet information, and multiplayer access without duplicating the main selection/setup flows.

## Environment variables

All are optional:

| Variable | Purpose |
| --- | --- |
| `PORT` | Production server port, normally injected by Railway. |
| `PVP_DISABLED` | Set to `1` to disable multiplayer. |
| `PVP_EXTRA_ORIGINS` | Additional allowed browser origins for staging/testing. |
| `NEXT_PUBLIC_PVP_URL` | Override the multiplayer socket URL. |
| `NEXT_PUBLIC_MURPH_API_BASE` | Override the score API base. |
| `NEXT_PUBLIC_GAME_TITLE` | Override the commercial product title for staging or testing. |

The canonical Breach Runner web domain is allowed by the multiplayer origin policy; the former Wormhole subdomain remains a temporary backend-only migration alias during the DNS cutover. Installed Android and Steam client origins will be addressed during the later packaging/networking phase.

## Run locally

Requirements:

- Node.js 22.13 or newer
- npm

```bash
npm ci
npm run dev
```

Useful checks:

```bash
npm run build
npm test
npm run lint
```

## Commercialization status

Phase 1 establishes **Breach Runner** as the player-facing commercial identity while separating it from legacy naming and undocumented assets and intentionally preserving internal compatibility ids. The project is **not yet store-ready**. Before Google Play or Steam submission it still needs final original fleet silhouettes and key art, store assets, dependency/license notices, installed-client packaging, controller work for PC, compliance review, and release testing.

See:

- `COMMERCIALIZATION.md`
- `ASSET_PROVENANCE.md`
- `PROJECT_DESCRIPTION.md`
