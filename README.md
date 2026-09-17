# Breach Runner

**Weaponize the rift.**

Breach Runner is an original fast-paced twin-stick space combat game developed under the internal project name **Project Rift**. The game is being polished first as a web release; Android/Google Play and Windows/Steam packaging are planned only after the core game, menus, balance, and presentation are considered release-ready.

## Current playable build

Development deployment:

`https://wormhole.murphtournaments.com`

The existing hostname and repository name are retained for development compatibility and are not the commercial product identity.

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

### What is currently playable

Only **PvP 1v1** and **Rift Survival** are open. Every other card on Mode Select is shown locked: the title is drawn as usual and the rest of the card is replaced by "Work in progress", so the roster is visible without inviting anyone into a mode that is not ready to be judged. Locked modes are neither deleted nor hidden — they build, they pass their suites, and most of the engine is shared with the open ones.

The lock is one list, `AVAILABLE_MODE_CARDS` in `app/mode-access.ts`, and opening a mode is adding its id to it. It is enforced twice on purpose: on Mode Select, where it can be explained, and again inside `start()`, because the mode preference is restored from local storage and Home's Play never passes through Mode Select. A pilot whose remembered mode has since been locked has that preference rewritten to something playable rather than being shown a Play button that does nothing.

`DEVELOPER_EMAILS` in the same file names the accounts that bypass the lock entirely and see the whole roster, so unfinished modes stay reachable for testing without a build flag that could ship enabled by accident.

Difficulty rules include a stationary-rift collision-shield mode, a moving-rift mode, and a hard contact-hazard mode.

### Challenges

Challenges are solo runs that bring their own rules instead of their own opponent, and they are chosen under **Menu → Game Modes → Challenges** rather than from the difficulty list.

- **Rift Survival** — endless. The arena gains a **Rift Level** every minute, and the mode has no win condition: time survived is the score.

Survival escalates through five stages, and each one changes behaviour rather than inflating numbers:

| Stage | From | What changes |
| --- | --- | --- |
| Stable | 0:00 | The rift holds centre. Ordinary hostile waves. |
| Unstable | 2:00 | The rift breaks orbit, sweep beams appear, waves come faster, and the full hostile catalogue opens. |
| Critical | 4:00 | Rift contact burns hull, and its contact radius keeps growing. |
| Enraged | 6:00 | The rift enrages: it regenerates, answers with mixed waves, and mine storms intensify. |
| Rift Collapse | 10:00 | Double sweep beams, a gravity well, a shielding rift, and the tightest wave cadence. |

The rift is still worth attacking. Sending a power-up back through it damages its integrity as usual, and driving that to zero **breaches** it: the arena is swept, the run banks a bonus that scales with the Rift Level reached, and the rift reforms with more integrity than before. Runs end when the pilot's hull does.

Survival escalation is data rather than loop logic. `app/survival.ts` owns the whole curve — the Rift Level clock, the stage table, the hazard cadences, and a `DifficultyRules` object re-derived on every level — and `tests/survival.test.mjs` checks it without a browser.

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

## Pilot accounts

Saving a score requires an account. Playing does not: a signed-out pilot flies the whole run, sees it settled, and sees exactly what it earned — the run simply is not written to any board, on this device or the public one, because there is no identity to attach it to. The result card says so and offers the way through.

Accounts live on the device for now (`app/account.ts`). This deployment has no database binding — `.openai/hosting.json` sets `d1` to null, and the public boards are an external API that takes initials and no identity at all — so there is nothing to register an account *with* yet. What the module owns is the shape of one: the record, the credential check, the session, and every call site that asks "who is this?". Credentials are stored as PBKDF2-SHA-256 over a per-account random salt, so no stored record holds a password in the clear. That is worth doing and it is not a substitute for a server; a local record can be read and edited by whoever holds the device. Moving to a real backend is replacing the storage functions at the bottom of that file, not finding every place in the game that assumed a device.

An account supplies the three-character board initials, so signing in also answers the question the result card used to ask.

## Money and the Armory

Every action the game already notices pays a few dollars: charging the rift with the cannon, removing rift integrity with a payload, destroying a hostile, collecting a PUP, breaching, and winning. The live total sits beside the score in the HUD, and it is banked into the signed-in pilot's account when the run ends.

Money is deliberately **not** derived from score. Score ranks a run and is settled with a time penalty; money persists across runs and is spent. Tying them together would mean either a leaderboard that rewards farming or a shop a good run cannot stock, so both are paid out side by side from the same events (`app/currency.ts`).

The Armory (**Home → Armory**) sells two different things, and keeping them apart is the design:

- **Unlocking** a payload is permanent and expensive, bought once per account.
- **Loading** a payload is cheap and consumable: one copy in the inventory the next round starts with.

So money buys access first and ammunition second, and a pilot who owns the whole catalog still has to decide what to carry into this round. Prices are derived from the threat rating the weapon catalog already carries, so a payload rebalanced up a tier is repriced by that change rather than drifting. A basket refunds in full until the round launches with it; the charge lands at launch, not at the button press.

The Armory does not touch the rift's drop table. A locked payload still drops in the arena and is still collectable exactly as before — the lock is on what a pilot may *buy* into the inventory before the round, not on what the rift may hand them during it. Only sendable payloads are stocked, because the upgrades, the repair and the rare drops apply themselves on contact and never enter the inventory at all.

A purchased inventory is taken only up to the run's own payload ceiling (Rift Run opens with a single slot); anything that does not fit stays bought. In a network match the server owns the inventory ledger, so each seeded payload is reported as an ordinary `collect` rather than pushed into the local array alone.

## Scoring and arcade identity

A qualifying solo PvE score can be locked using three-character arcade initials. Initials come from the signed-in account and are remembered on the device. Practice runs are not submitted.

The global board is still an arcade board — three characters, one row — but a run now reaches it through an account rather than anonymously. Local bests are retained on-device under the same rule.

Rift Survival is ranked by **time survived** rather than by a settled score, so it has its own board rather than sharing the arcade one — a single merged list would be sorted wrongly for one of them. The leaderboard screen carries both, switchable, and the Survival board can be filtered to a single ship.

The device keeps a top-25 Survival board (`wormhole-arcade:survival-board`) ranked by time, then score, then whoever got there first. A run that places prompts for initials exactly as an arcade victory does.

The public Survival board reads and writes `/api/arcade/survival-leaderboard` and `/api/arcade/survival-scores`. **Those endpoints are not built on the score service yet**, so the client currently falls back to the device board and says the global board is not open — a supported state rather than a failure. `docs/SURVIVAL_LEADERBOARD_API.md` is the contract the client was written against; nothing here needs to change when the service ships.

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

## Matchmaking deployment invariant

PvP 1v1 Quick Match has one server-owned logical queue,
`PVP_1V1_QUICK_MATCH`. Difficulty and all other client metadata are excluded
from its key, and every PvP room is normalized to Easy gameplay rules. Co-op
queues and private-code rooms remain separate.

The production entry point creates one HTTP server and mounts exactly one
`MatchServer` on it; a second mount on the same server is rejected. The current
Railway deployment is operated as one service replica/process, so all `/pvp`
WebSockets reach that in-memory `MatchServer`. **This service must remain at one
Railway replica.** The repository has no shared cross-replica queue: increasing
Railway replica count (or running a Node cluster) would fragment matchmaking
and requires moving queue and room coordination to a shared transactional
backend before scaling. Railway's live replica count is deployment state and
cannot be verified from this source checkout.

The current development domain remains allowed by the multiplayer origin policy. Installed Android and Steam client origins will be addressed during the later packaging/networking phase.

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
