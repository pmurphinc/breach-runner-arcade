---
title: Classic Mode & PvP Fidelity — Plan
project: Breach Runner (Project Rift)
status: Approved — gating decisions made
created: 2026-08-31
branch: claude/breach-runner-classic-wormhole-2mls24
tags: [breach-runner, planning, classic-mode, pvp, wormhole]
---

# Classic Mode & PvP Fidelity — Plan

> **Vault note.** This document is the deliverable for the "Classic Wormhole mode + PvP fidelity" planning
> request. It is stored in the repo so it survives the ephemeral build container. Drop a copy into
> `02 - Projects/Breach Runner` in the Obsidian vault.

## 0. What is and is not covered here

**Covered:** a complete, prioritised plan for (a) a Classic game mode that reproduces the original
Wormhole Redux experience as closely as is legally safe, and (b) bringing PvP's *gameplay* in line with
the original — specifically rift blooms and cannon fire.

**Not covered — blocked:** the four vault notes at
`C:\Users\pmurp\OneDrive\Documents\Obsidian Vault\02 - Projects\Breach Runner`.
This planning session ran in a remote Linux container with no access to that machine or to OneDrive,
so the two Rift Run notes could not be read, merged, or conflict-checked, and the to-do note could not
be consulted. Section 9 holds the merge procedure and the exact hand-off needed to finish it.

Because the to-do note was unavailable, the PvP requirements below were reconstructed **from the original
client itself** rather than from the note. That is the stronger source for mechanics, but the note may
carry priorities or intent that this plan does not. Section 9.2 lists what to re-check against it.

---

## 1. Reference: what the original actually does

Derived by disassembling the supplied `whclient.exe` (a Java archive; ~63 `.java` sources plus classes for
"Wormhole Redux", `wormholeredux.com`). Everything in this section is **observed behaviour and numbers** —
the facts a reimplementation needs. No original code, art, audio, ship names, or descriptive text is
carried into this project (see §8).

### 1.1 The core loop

1. Every player owns one **portal** that orbits the arena centre.
2. Shooting **any** portal with your normal cannon makes it bleed a **power-up** into the arena.
3. You fly over the power-up to bank it (5-slot inventory).
4. Self-buffs apply on pickup. **Attack** power-ups are launched with a separate key.
5. Launching an attack power-up **into a rival's portal** makes that portal spawn hostiles — at *their*
   portal, credited to *you*. You attack through your opponent's own wormhole.
6. Ships also shoot each other directly. Death removes the pilot *and their portal*.
   Last pilot (or team) standing wins.

### 1.2 Simulation and arena

| Fact | Value |
| --- | --- |
| Tick | 15 ms (~66.7 Hz) |
| Ship velocity decay | ×0.995 per tick |
| Wall behaviour | **Bounce**, coefficient −0.5 (not a wrap) |
| Arena shape | Square, scales with opponent count |
| Arena size | 873² (1 opp) / 1310² (2–3) / 1572² (4+) |
| Portal orbit radius | 150 / 240 / 280 to match the three sizes above |
| Portal orbit rate | 0.5°/tick, all portals share it |
| Bullet speed / life | 10 units/tick, 100 ticks |
| Camera | Scrolling, centred on the pilot |

### 1.3 Portals

- Drawn as nested ellipses from radius 30 out to 60, colour-cycled in the owner's colour, captioned with
  the owner's name.
- **Warp-in** on spawn: expands from the arena centre outward to orbit radius, step `max(6, remaining/3)`.
- Indestructible. They accumulate cannon damage; **every 150 damage sheds exactly one power-up** at the
  portal, then the counter resets to zero.
- A launched power-up that hits a portal is queued and fires **30 ticks later**, spawning hostiles at that
  portal tagged with the sender's slot.
- Off-screen portals are tracked with a **breadcrumb trail**: `orbitRadius / 35` dots drawn from the arena
  centre toward each rival portal, in team colour (squares for one team, circles for the other).

### 1.4 The power-up table (20 entries)

Indices are the original's; they already match this project's `PowerId` ordering.

**Self-buffs (0–5), never launchable:**

| # | Effect |
| --- | --- |
| 0 | Gun upgrade — advance one shot level (4 levels) |
| 1 | Thrust upgrade — +0.1 max thrust |
| 2 | Retros — enables reverse thrust |
| 3 | Invulnerability — `max(450, current + 200)` ticks (≈6.75 s) |
| 4 | Clear screen — wipes hostiles |
| 5 | +30 health |

**Launchable attacks (6–19)** with hostiles spawned per launch:

| # | Kind | Count | Notes |
| --- | --- | --- | --- |
| 6 | Heat seeker | 12 | Spawn at portal, random headings, thrust 8→7, damage 50/10 |
| 7 | Turret | 1 | Orbits its portal at 115, engages within 260, fires every 16 ticks |
| 8 | Mines | 15 | Radial, 24° apart, speed 6.0 |
| 9 | UFO | 3 | 40 hp, thrust 5.0 |
| 10 | Inflator | 4 | 30 hp |
| 11 | Minelayer | 2 | 50 hp, max speed 5.0 |
| 12 | Gunship | 1 | 50 hp, thrust 4.0, strafe → retreat → kamikaze states |
| 13 | Scarab | 2 | 20 hp, thrust 5.0 |
| 14 | Nuke | 1 | Launched outward from portal, 9-tick fuse, blast grows +30/tick to 1000, damage `max(5, 40·(1000−r)/1000)` |
| 15 | Wallcrawler | 1 | 150 hp, tracks arena walls |
| 16 | Sweep beam | 1 | Anchored to portal, 45-tick form, 320-tick sweep |
| 17 | EMP | 1 | 65-tick form, 320-radius flash, 150-tick disable |
| 18 | Ghost | 1 + upgrade level | Punt-able, 14.0 initial velocity |
| 19 | Artillery | 2 | 10 hp, teleports when pressured |

**Drop roll** when a portal sheds a power-up:

- **⅓ chance** — a self-buff. Rolls 0–5, re-rolling anything already maxed (gun, thrust, retros).
  Time-gated substitutions: after 120 s invulnerability becomes heat seeker and clear-screen becomes
  turret; after 80 s health has a ¾ chance of becoming nuke; after 60 s health becomes nuke.
- **⅔ chance** — a launchable attack, uniform over indices 6–16 (11 kinds), or 6–19 (14 kinds) when the
  table has "all power-ups" enabled. A rolled nuke is re-rolled once on a coin flip, halving its rate.

**Lifetime:** indestructible for 20 ticks after spawning, destructible after, expires at 1200 ticks (~18 s).

### 1.5 Cannon fire

Four shot levels, indexed by gun upgrade count:

| Level | Damage | Shots | Max in flight | Tick delay |
| --- | --- | --- | --- | --- |
| 0 | 10 | 1 | 20 | 8 |
| 1 | 14 | 1 | 14 | 6 |
| 2 | 8 | 2 | 28 | 6 |
| 3 | 10 | 2 | 34 | 6 |

The "max in flight" is a **live quota**, not a magazine: a bullet frees its slot when it expires or hits.
Level 2 trades damage for a wider two-round spread; level 3 restores the damage.

### 1.6 Ships

Eight hulls. The project already carries all eight under these internal ids.

| Id | Turn °/tick | Max thrust | Accel | Hull | Gun start | Thrust start | Tracking cannon | Special |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tank | 3 | 5.0 | 0.10 | 280 | 2 | 0 | — | — |
| wing | 3 | 7.0 | 0.25 | 240 | 1 | 1 | — | — |
| squid | 3 | 10.0 | 0.48 | 200 | 0 | 3 | — | — |
| rabbit | 3 | 12.0 | 0.35 | 180 | 0 | 2 | 1 turret, rate 12 | — |
| turtle | 3 | 4.5 | 0.15 | 250 | 1 | 1 | — | Screen-clear cannon, self-damaging |
| flash | 3 | 1.0 | 0.10 | 190 | 3 | 3 | — | Swap between two handling profiles; cannot upgrade |
| hunter | 3 | 4.8 | 0.30 | 220 | 0 | 1 | — | 3 missile salvos, 20 s regen |
| flagship | 1.5 | 2.0 | 0.11 | 300 | 0 | 2 | 2 turrets, rate 14 | Attract pickups / repel enemies; disables guns and thrust while held |

### 1.7 Controls

`↑`/`W`/`I`/`Num8` thrust · `←→`/`A D`/`J L`/`Num4 6` rotate · `Space`/`Num0` cannon ·
`F`/`Num3` launch power-up · `R` ship special · `Q` self-destruct.

(The in-client help text still says `D` for the special — stale. `D` is turn-right; the special moved to `R`.)

---

## 2. Where Breach Runner already matches

Good news first: the engine is closer to the original than a rebuild would suggest, and several
constants are already identical.

| System | Status |
| --- | --- |
| Tick rate | ✅ `TICK_MS = 15` — exact match |
| Portal bloom threshold | ✅ `PORTAL_THRESHOLD = 150` — exact match |
| Shot levels | ✅ `SHOT_LEVELS` matches all four rows exactly |
| Enemy spawn counts | ✅ `ENEMY_COUNTS` matches the ratio table exactly |
| Bullet speed | ✅ 10 units/tick |
| Portal orbit rate | ✅ 0.5°/tick |
| Power-up roster | ✅ All 14 launchables and 6 self-buffs present under matching ids |
| Fleet roster | ✅ All eight hulls present, plus two originals (Kestrel, Warden) |
| Inventory | ✅ Slot-based launch stock |
| Enemy hulls | 🟡 Close but drifted (turret 45 vs 50, minelayer 55 vs 50, gunship 80 vs 50, scarab 35 vs 20) |

## 3. Where it diverges

| # | System | Original | Breach Runner today | Weight |
| --- | --- | --- | --- | --- |
| D1 | **PvP topology** | One shared arena, all pilots and portals in it | **Mirrored arenas.** Each client simulates its own; `transmit` moves a payload to the rival's arena as abstract integrity damage | 🔴 Largest gap |
| D2 | **Portals per arena** | One per player, all visible and shootable | One rival rift | 🔴 |
| D3 | **PvP portal motion** | Orbits at 0.5°/tick | `WORMHOLE_MOTION = "locked"` — dead centre, static | 🔴 |
| D4 | **Ship-vs-ship combat** | Direct — cannons hit rival hulls | Absent. No pilot ever shoots another pilot | 🔴 |
| D5 | **Sent attacks** | Real hostiles spawn at the victim's portal and hunt them | Flat integrity damage via `rivalDamageFor` (12/18/24) | 🔴 |
| D6 | **Win condition** | Last pilot/team standing; kills tracked | Rival integrity depleted | 🟠 |
| D7 | **Arena** | Square, scales 873–1572 with player count | Fixed 1504×940 landscape | 🟠 |
| D8 | **Orbit radius** | 150 / 240 / 280 by count | Fixed 210 | 🟡 |
| D9 | **Blooming** | Any portal blooms for anyone who shoots it | Single rift, single owner | 🟠 |
| D10 | **Ship handling** | See §1.6 | Rebalanced; hull matches on 5 of 8, speed/turn on none | 🟡 (intentional) |
| D11 | **Death** | Kills your portal too | No portal ownership to remove | 🟠 |
| D12 | **Teams** | Beta/Gamma, team win, balanced-teams option | 1v1 only | 🟢 Later |
| D13 | **Radar** | Breadcrumb dots per rival portal | Off-screen indicators exist, not portal-aware | 🟡 |
| D14 | **Walls** | Bounce at −0.5 | Bounce present, coefficient differs | 🟢 |
| D15 | **Self-destruct** | `Q` | Absent | 🟢 |

**D1 is the crux.** Every other PvP item is cheap once the arena is shared and expensive while it is not.
The current design is a *correspondence* game — two solitaires trading damage numbers. The original is a
*duel*. Nothing else on this list changes that; D1 alone does.

---

## 4. Workstream A — Classic mode

A new mode reproducing §1 as faithfully as the legal guardrails permit.

**A1. Mode plumbing.** Add `classic` to `GameMode` in `difficulty.ts`, `MenuRoute`/`MODE_INFO`/`MODE_ORDER`
in `menu-routes.ts` and `main-menu.tsx`. It is a peer of `pvp`/`pve`/`coop`, not a difficulty. It needs its
own entry in `MODE_INFO` and a card on the PvP modes screen (and a solo variant on the PvE screen).

**A2. Classic rule set.** A `DifficultyRules`-shaped preset that pins the §1.2 numbers: bounce −0.5,
decay 0.995, orbit rate 0.5, orbit radius by opponent count, no collision shield, no contact hazard,
no enrage. Classic's whole point is that it is *not* tuned like the modern modes, so it must not inherit
`DIFFICULTIES.easy`.

**A3. Square scaling arena.** `WORLD_WIDTH`/`WORLD_HEIGHT` are module constants today; they need to become
per-game values so a Classic match can be 873²/1310²/1572². This is the single most invasive change in
Workstream A — `game.tsx` reads the world size in the camera, the spawn scatter, the wall bounce, the
canvas letterboxing, and the off-screen indicators. Do this as its own commit, before anything else in A.

**A4. Multi-portal model.** Generalise the single `portalX/portalY/portalCharge/portalThreshold` fields
into a list of portals, each with an owner, orbit phase, damage accumulator and warp-in state. Everything
that currently reads `game.portalX` becomes a lookup. Also its own commit — every later item depends on it.

**A5. Classic drop table.** Implement §1.4's roll exactly, including the maxed-buff re-roll, the four time
gates, and the nuke coin-flip. This is what makes the early game feel like the original: mostly attacks,
buffs that stop appearing once you have them.

**A6. Classic ship stat set.** A `CLASSIC_SHIPS` table carrying §1.6's numbers, selected when the mode is
`classic`, leaving `SHIPS` untouched for every other mode. Do **not** retune `SHIPS` toward the original —
COMMERCIALIZATION.md commits to an independent balance pass, and the two goals conflict.

**A7. Classic HUD.** Kills counter, the permanent-upgrade strip (gun ×N, rapid fire, thrust ×N, retros),
the 5-slot inventory, and the breadcrumb portal trail from §1.3.

**A8. Self-destruct.** `Q`. Trivial, and it matters for stuck-in-a-corner play.

**A9. Ship specials at Classic behaviour.** Turtle's self-damaging screen clear, Flash's profile swap with
upgrades locked out, Hunter's 3-salvo/20 s regen, Flagship's attract-repel that disables guns and thrust
while held, and the Rabbit/Flagship tracking turrets. Several exist already in modern form and need a
Classic variant rather than a rewrite.

## 5. Workstream B — PvP fidelity

**B1. Shared-arena PvP (D1–D4).** **DECIDED: B1b — host-authoritative shared arena.** The options as
weighed:

- **B1a — Full shared arena, server-authoritative.** Both pilots, all portals, all hostiles in one
  simulation the server owns; clients render and send input. Correct, matches the original, and is a
  rewrite of the PvP server. `rooms.mjs` currently arbitrates *claims* about damage; it would need to run
  the game. Largest effort by a wide margin.
- **B1b — Shared arena, host-authoritative.** One client simulates and relays, exactly as co-op already
  does — `rooms.mjs` documents the host-relay pattern for enemy snapshots, and `RemoteMotion` already
  interpolates a remote ship. Reuses working machinery, gives a real duel, and costs the host a latency
  advantage. **← Chosen.** It is how the original worked in practice, and the co-op path proves the
  pattern in this codebase.

  *Implementation notes for B1b:* the host runs the authoritative loop and relays world snapshots on the
  co-op channel; the guest sends input and renders. `rules.mjs` stays authoritative over hull, shield and
  results — the host reports damage events through the existing `damage` message rather than asserting
  hull directly, so the server's anti-cheat window still applies. Host selection reuses co-op's
  "first player is arena host". A host disconnect must migrate or forfeit rather than strand the match;
  the existing 20 s reconnection grace is the hook.
- **B1c — Keep mirrored arenas, deepen the simulation.** Sent power-ups spawn real hostiles in the
  victim's arena instead of flat damage. Cheapest, fixes D5, and leaves D1–D4 permanently unfixed. Pilots
  still never see each other. **Not recommended** as an endpoint, but it is a legitimate stepping stone
  and it is worth doing *anyway* — see B2.

**B2. Sent attacks spawn real hostiles (D5).** Replace `rivalDamageFor`'s flat 12/18/24 with the actual
§1.4 spawn at the victim's portal, credited to the sender. Independent of B1 — worth shipping under the
current topology, and it is the single biggest felt improvement per unit of work in this plan. A nuke
should arrive as a nuke, not as 24 points.

**B3. Orbiting PvP portals (D3).** Flip `WORMHOLE_MOTION` off `"locked"` for PvP and give it the Classic
orbit. Cheap, and it removes the static-target feel.

**B4. Both portals present and shootable (D2, D9).** Once portals are a list (A4), a PvP arena carries the
pilot's own and the rival's. Either can be shot for blooms; only the rival's accepts your launches.

**B5. Ship-vs-ship cannon fire (D4).** Depends entirely on B1. Under B1b: the host resolves pilot-bullet
vs pilot-hull and reports damage through the existing `damage` message, so `rules.mjs` stays authoritative
over hull and shield.

**B6. Elimination win condition (D6, D11).** Destroying a pilot removes their portal and ends the match
(1v1) or reduces the team (later). Kills tracked and shown.

**B7. Portal breadcrumbs (D13).** Extend `offscreen-indicators.ts` with the §1.3 trail so the rival portal
is findable in a large arena.

## 6. Priority list

Ordered for delivery. Each phase leaves the game shippable.

### P0 — Unblock (do first, no code)
| | Item |
| --- | --- |
| P0.1 | Get the four vault notes into a readable place (§9). Merge the Rift Run pair, surface conflicts. |
| ~~P0.2~~ | ~~Decide B1a/B1b/B1c~~ — ✅ **B1b, host-authoritative shared arena.** P4 unblocked. |
| ~~P0.3~~ | ~~Decide the player-facing mode name~~ — ✅ **"Classic Wormhole"**, internal id `classic`. A1 unblocked. |

### P1 — Highest value per unit of work, no topology change
| | Item | Refs |
| --- | --- | --- |
| P1.1 | Sent power-ups spawn real hostiles instead of flat damage | B2, D5 |
| P1.2 | Unlock PvP portal orbit | B3, D3 |
| P1.3 | Reconcile enemy hull values with §1.4 | §2 |

*Ships as: "PvP attacks are real again." No new mode, no protocol change, no server rewrite.*

### P2 — Foundations for Classic
| | Item | Refs |
| --- | --- | --- |
| P2.1 | Per-game arena dimensions, square support | A3, D7 |
| P2.2 | Multi-portal model | A4, D2 |
| P2.3 | Mode plumbing for `classic` | A1 |
| P2.4 | Classic rule preset | A2, D8, D14 |

*Nothing player-visible ships here except the mode stub. This is the refactor that makes P3 small.*

### P3 — Classic mode playable
| | Item | Refs |
| --- | --- | --- |
| P3.1 | Classic drop table with time gates | A5 |
| P3.2 | Classic ship stat set | A6, D10 |
| P3.3 | Classic HUD, kills, upgrade strip | A7 |
| P3.4 | Portal breadcrumb trail | A7, B7, D13 |
| P3.5 | Self-destruct | A8, D15 |
| P3.6 | Classic solo vs. hostile-only arena (playable without an opponent) | A9 |

### P4 — Shared-arena PvP
| | Item | Refs |
| --- | --- | --- |
| P4.1 | Host-authoritative shared arena: host runs the loop, guest sends input and renders | B1b |
| P4.2 | Ship-vs-ship cannon fire | B5, D4 |
| P4.3 | Both portals live in a PvP arena | B4 |
| P4.4 | Elimination win, portal death, kill tracking | B6, D6, D11 |
| P4.5 | Host migration or clean forfeit on host disconnect | B1b |

### P5 — Beyond the original's floor
| | Item | Refs |
| --- | --- | --- |
| P5.1 | Classic ship specials at original behaviour | A9 |
| P5.2 | 3+ player free-for-all, arena scaling by count | D7 |
| P5.3 | Teams | D12 |

## 7. Decisions needed from you

**Q1 — PvP topology. ✅ DECIDED: B1b, host-authoritative shared arena.** Reuses the co-op relay pattern.
P4 is planned against this.

**Q2 — Mode name. ✅ DECIDED: "Classic Wormhole",** internal id `classic`.

The trade-off was raised and the call is made; recording it here so the reasoning is on file for the
pre-submission review. The name is legacy branding that `COMMERCIALIZATION.md` Phase 1 otherwise removed,
so it is the one piece of inherited identity in the mode. That makes the rest of §8 load-bearing: with the
name retained, everything else about Classic Wormhole — ship names, power-up names, art, audio, HUD
layout, colour scheme — must stay on this project's own identity, so the mode reads as *Breach Runner's
classic mode*, not as a reproduction of another product. Two concrete follow-ups:

- Add "trademark clearance on the mode name" to the pre-submission checklist in `COMMERCIALIZATION.md`,
  alongside the existing store-name check. Mechanics carry no trademark exposure; a mode name can.
- Keep the id `classic` everywhere in code, saves and payloads, so the player-facing string is a single
  label in `MODE_INFO` that can be changed at any point before submission without a migration.

**Q3 — Classic ship stats.** Ship §1.6's numbers as a Classic-only table (recommended), or leave Classic
on the current balance? The former makes Classic feel authentic; the latter keeps one balance surface.

**Q4 — Scope of Classic.** PvP-only, or also a solo Classic against hostiles? *Recommendation: both* —
solo Classic is nearly free once P2 and P3 land, and it makes the mode testable without a second player.

**Q5 — Ordering.** P1 before P2, as written? It delays Classic to get PvP improvements out sooner. The
alternative is going straight to the P2 refactor.

## 8. Copyright and IP guardrails

Not legal advice — a working discipline for this project, consistent with `COMMERCIALIZATION.md` and
`ASSET_PROVENANCE.md`.

**Safe to reproduce.** Game mechanics, rules, systems and balance numbers are not protected by copyright —
they are ideas and methods of operation, not expression. Orbiting portals, a 150-damage bloom threshold,
a 12-missile salvo, four shot levels, ⅓/⅔ drop weighting: all reimplementable.

**Not safe, and not being used here.**
- **Code.** Nothing from the decompiled client is copied. Every number in §1 was *observed* and is being
  reimplemented in this project's own TypeScript.
- **Names and text.** The original ship names, power-up names, and the ship description prose stay out.
  The project already renamed the fleet and the pickup catalog; Classic mode must use those names.
- **Art and audio.** No sprites, no WAVs, no colour scheme, no HUD layout lifted. `ASSET_PROVENANCE.md`
  governs, and every Classic-mode asset gets an entry.
- **Trade dress.** Do not reproduce the original's screen layout, lobby, or visual identity even where the
  mechanics match.

**Trademark.** The mechanics are the mode; the name is the risk. The mode ships as **"Classic Wormhole"**
(Q2), so the name goes on the pre-submission trademark check rather than being designed around. Everything
else in the mode stays on Breach Runner's own identity.

**Action:** add a Classic-mode section to `ASSET_PROVENANCE.md` when P3 starts, recording that the mode's
rules were independently implemented from observed behaviour, with no source material carried over.

## 9. Rift Run note merge — hand-off

### 9.1 What is needed

The two Rift Run notes and the to-do note could not be reached from this container. To finish:
paste their contents into the session, or commit them somewhere reachable, or copy them into the repo.
No note will be edited or deleted before the conflicts are shown and you have approved.

### 9.2 Merge procedure once the notes land

1. Read all four; classify every claim as **agreeing**, **complementary**, or **conflicting**.
2. Build the merged Rift Run note from the union of the complementary material, keeping the more detailed
   phrasing where both say the same thing.
3. **Report every conflict before touching anything** — each as: what note A says, what note B says, which
   one the code currently implements, and a recommendation. The code is the tie-breaker for anything about
   current behaviour; you are the tie-breaker for intent.
4. Only after your sign-off: write the merged note, and leave the originals in place unless you say
   otherwise.
5. Cross-check the to-do note against §3 and §6 — specifically its blooms / cannon-fire / Classic-PvP
   items — and fold anything it raises that this plan misses into the priority list.

### 9.3 Code facts useful for the merge

Where the notes disagree about current Rift Run behaviour, these are what the code does today:

- Base rift integrity `200` (`rift-run/rift-damage.ts`), damage scale `0.05`.
- Hardpoint unlocks at breaches `1, 3, 5` (`rift-run/hardpoint-milestones.ts`).
- Depth levels `[1, 3, 5, 7, 11]`, collapse at depth index 4, 2 levels per breach (`rift-run/escalation.ts`).
- Energy rewards: normal kill 8, tough 15, major 28, rift-damage ratio 0.12 (`rift-run/progression.ts`).
- 5 weapons, 5 evolutions (`rift-run/weapons.ts`, `evolutions.ts`).
- Difficulty escalates on every breach (most recent merge on `main`).

---

## 10. One-line summary

The engine already agrees with the original on tick rate, bloom threshold, shot levels and spawn counts —
the fidelity gap is **not** in the numbers, it is that PvP is two separate arenas trading abstract damage
instead of one arena where two pilots shoot each other and each other's portals. Fix the payloads first
(P1), refactor arena and portals into plural (P2), ship Classic Wormhole (P3), then move PvP onto one
host-authoritative shared arena (P4).
