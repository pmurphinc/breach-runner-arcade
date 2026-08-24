# Game Modes Roadmap

Status: Planning

This document captures the planned expansion of Breach Runner / Project Rift beyond the current core PvE, PvE co-op, and PvP modes. The goal is to increase replayability while reusing the same combat, ship, rift, hazard, weapon, power-up, leaderboard, and presentation systems wherever possible.

## Design Principles

- Keep the core twin-stick arcade combat intact across all modes.
- Reuse existing systems instead of building disconnected mini-games.
- Increase difficulty through new behaviors, combinations, pacing, and arena pressure — not only larger health and damage values.
- Keep mode selection understandable and uncluttered.
- Make modes work across desktop, phone, tablet, and foldable layouts.
- Preserve instant arcade-style access with no account required to play.
- Use three-character initials and global leaderboards where competitive scoring makes sense.
- Build reusable modifiers so campaign, survival, daily challenges, and custom modes can share the same underlying systems.

---

# 1. Rift Survival / Time Challenge

## Core Concept

The player survives as long as possible while the arena continuously becomes more dangerous.

The normal PvE time penalty does not apply. Time survived is the primary score.

Example leaderboard entry:

- Initials
- Ship
- Survival time
- Optional score / defeated hazards / peak rift level

## Difficulty Progression

### 0–2 Minutes — Stable

- Normal hazard frequency
- Normal power-up generation
- Basic mines
- Basic rotating beam behavior

### 2–4 Minutes — Unstable

- Faster hazards
- Increased mine activity
- Faster or more active rift movement
- Hostile beam appears more often

### 4–6 Minutes — Critical

- Multiple mine patterns
- Faster beam rotation
- Temporary rift shields
- More aggressive environmental particles
- Reduced safe space

### 6–10 Minutes — Enraged

- Enrage mechanics become active
- Rift healing
- Shield bursts
- Frequent mines
- Faster attack patterns
- Increased hazard overlap

### 10+ Minutes — Rift Collapse

At this point the mode should become intentionally extreme rather than merely increasing numeric stats.

Possible combinations:

- Double beams
- Gravitational pull
- Mine storms
- Disappearing or unstable power-ups
- Hostile projectile bursts
- Temporarily shrinking arena
- Rift teleportation
- Increased collision danger
- Multiple simultaneous modifiers

The mode should theoretically continue indefinitely.

## Rift Level System

Every fixed interval, such as 60 seconds, increase the visible Rift Level.

Example:

> RIFT LEVEL 11

Use a brief visual and audio pulse without interrupting gameplay.

## Survival Design Rule

Difficulty should primarily scale through:

- behavior
- hazard combinations
- movement
- reduced safe space
- timing pressure
- modifier stacking

Do not rely only on HP and damage inflation.

---

# 2. Campaign Mode

## Core Structure

Initial target:

- 3 Acts
- 5 Levels per Act
- 15 total launch campaign levels

Each act should have a distinct visual identity using different backgrounds, colors, particles, environmental effects, lighting, and arena elements.

Campaign levels should use the same core control scheme and combat systems while changing objectives, hazards, and presentation.

## Act I — First Contact

Visual identity:

- Blue / cyan space
- Cleaner arena
- Lighter particles
- More stable rift presentation

Possible levels:

### Level 1 — Awakening

- Soft introduction to movement, firing, power-ups, and the rift
- Avoid presenting it as a traditional tutorial if possible
- Primary objective: destroy the rift

### Level 2 — Minefield

- Introduce mines as the primary environmental threat

### Level 3 — Solar Wind

- Introduce environmental movement or force that pushes the ship

### Level 4 — Rift Beam

- Introduce the rotating rift beam

### Level 5 — Guardian

- First dedicated boss encounter

## Act II — Corruption

Visual identity:

- Purple / magenta / red space
- More distorted background effects
- More aggressive particles
- More unstable arena presentation

Possible mechanics:

- Corrupted power-ups
- Moving rift
- Gravity effects
- Shielded rift
- Environmental hazards
- More complex mine patterns

Possible Act II boss:

- A primary rift that creates two smaller rifts

## Act III — Collapse

Visual identity:

- Dark red / black / white
- Extreme rift instability
- Star streaks
- Screen distortion
- Debris being pulled toward the rift

Gameplay:

- Combine mechanics introduced in Acts I and II
- Increase overlapping hazards
- Use more aggressive rift behaviors

### Final Level — The Breach

The final encounter should use the fully enraged rift and the strongest version of the game's existing destruction sequence.

Victory presentation:

1. Rift begins sucking nearby objects inward
2. Low tone begins
3. Tone gradually rises in pitch
4. Arena effects intensify
5. Sound stops or peaks immediately before detonation
6. Rift explodes
7. End-game results menu appears

---

# Campaign Objective Types

Campaign levels should not all be variations of "destroy the rift."

Reusable objective types:

## Destroy

Destroy the rift.

## Survive

Survive for a specified amount of time.

## Contain

Keep Rift Stability below a failure threshold.

## Collect / Feed

Collect and feed a required number of payloads into the rift.

## Protect

Protect a stabilization device, ally, or objective for a set period.

## Escape

Survive until an extraction or escape window becomes available.

## Boss

Defeat a unique rift or guardian encounter.

The objective framework should be data-driven so new campaign levels can be created primarily through configuration.

---

# Campaign Achievements

Achievements should reward skill, experimentation, mastery, and unusual play styles.

Possible achievements:

## First Contact

Destroy your first Rift.

## Untouchable

Complete a level without taking hull damage.

## Mine Sweeper

Destroy 25 mines.

## Overkill

Deal significantly more damage than required on the finishing blow.

## Close Call

Win with less than 5% hull remaining.

## Pacifist

Complete a compatible survival objective without firing the primary weapon.

## Speed Runner

Complete a campaign level under its par time.

## Riftwalker

Complete the campaign.

## No Fear

Complete the campaign on Hard.

## What Rift?

Destroy a Hard Rift in under 60 seconds.

Where practical, achievement definitions should be designed so they can later map to Steam and Google Play achievement systems without changing the underlying game logic.

---

# 3. Daily Rift

## Core Concept

Every day, all players receive the same deterministic challenge.

The challenge should use the same:

- arena seed
- rift behavior
- hazard sequence
- power-up sequence
- modifiers
- scoring rules

This allows fair global competition without requiring an account.

Example Daily Rift:

> DAILY RIFT
>
> Moving Void
> Mine Storm
> Power-Up Spawn -30%
> Beam Speed +25%
> Scout Only

Leaderboard:

- Three-character initials
- Completion time or survival time
- Ship if not locked by the challenge
- Score where applicable

The challenge changes on a fixed daily boundary.

## Daily Rift Goals

- Give players a reason to return each day
- Reuse existing modifier infrastructure
- Produce many combinations from a limited number of systems
- Keep the challenge deterministic and competitively fair

---

# 4. Rift Gauntlet / Boss Rush

## Core Concept

Fight a sequence of increasingly difficult rift encounters using one ship and limited recovery between fights.

Possible progression:

1. Standard Rift
2. Moving Rift
3. Shield Rift
4. Twin Rift
5. Gravity Rift
6. Enraged Rift
7. Final Omega Rift

## Between-Round Upgrade Choice

After each boss, present a small choice such as:

- Repair 30% Hull
- Upgrade Weapon
- Gain Shield
- Improve Special Ability
- Increase movement or cooldown performance

This provides a light roguelite layer without turning the game into a large progression RPG.

Boss Rush should be developed after campaign work has produced enough distinct encounters to make the sequence meaningful.

---

# 5. Custom Mutator Mode

## Core Concept

Allow players to build their own challenge by selecting reusable gameplay modifiers.

## Arena Options

- Normal
- Large
- Small
- Shrinking

## Rift Options

- Stationary
- Moving
- Teleporting
- Double Rift

## Hazard Options

- Mines
- Beam
- Gravity
- Meteors / debris
- Projectile storms

## Player Options

- Double speed
- Half hull
- No shields
- Infinite special
- Random weapon

## Chaos Options

- Power-up rain
- Mine storm
- Ricochet shots
- Friendly fire where applicable
- Global speed increase

## Chaos Multiplier

Each modifier should contribute to a difficulty / score multiplier.

Example:

> CHAOS MULTIPLIER: x4.75

Custom scores should use a separate leaderboard or be clearly marked so they are not mixed with standard competitive modes.

---

# Universal Rift Modifier System

This is the most important technical foundation for future modes.

Avoid creating mode-specific versions of the same mechanic, such as separate "Survival Mines," "Campaign Mines," or "Daily Mines."

Instead, create reusable modifiers that any mode can enable.

Initial modifier candidates:

- MineStorm
- FastBeam
- DoubleBeam
- RiftRegen
- RiftShield
- MovingRift
- TeleportingRift
- GravityWell
- ShrinkingArena
- LowPowerUpSpawn
- DoublePowerUpSpawn
- FastProjectiles
- HullDrain
- IncreasedCollisionDamage
- CorruptedPowerUps
- ReducedSafeZone

Each modifier should ideally expose configurable parameters rather than hard-coded values.

Example conceptual data:

```text
modifier: MineStorm
spawnInterval: 3s
maxMines: 12
pattern: radial
```

This system should power:

- Survival escalation
- Campaign levels
- Daily Rift
- Boss encounters
- Custom Mutator Mode
- Future limited-time events

---

# Campaign Level Definition System

Before producing many campaign levels, create a reusable level configuration format.

A campaign level should be describable primarily through data such as:

```text
id
act
level
name
background
palette
particleSet
arenaSize
riftType
riftHealth
riftBehavior
hazards
modifiers
objective
powerUpTable
difficulty
music
boss
parTime
achievementHooks
```

The goal is to make adding later levels mostly a content/configuration task instead of requiring new custom game logic for every stage.

---

# Proposed Play Menu Structure

## PLAY

### ARCADE

- PvE
- Co-op
- PvP

### CHALLENGES

- Rift Survival
- Daily Rift
- Rift Gauntlet

### CAMPAIGN

- Continue
- Level Select
- Achievements

### CUSTOM

- Mutator Mode

Do not create separate Survival Easy / Medium / Hard menu entries. Survival should control its own difficulty through elapsed time and escalating Rift Levels.

---

# Recommended Development Order

## Phase 1 — Rift Survival

Build Survival first because it can reuse the majority of existing gameplay systems and will expose balance problems quickly.

Core work:

- Survival timer
- Rift Level progression
- Escalation rules
- Survival end condition
- Survival result stats

## Phase 2 — Survival Leaderboards

Add dedicated Survival global leaderboards.

Possible views:

- All Ships
- Filter by Ship

Leaderboard data may include:

- initials
- ship
- survival time
- score
- peak Rift Level

## Phase 3 — Universal Modifier System

Formalize reusable modifier definitions and parameter handling before campaign content becomes large.

## Phase 4 — Daily Rift

Build deterministic challenge generation using seeded modifier configurations.

## Phase 5 — Campaign Foundation

Build:

- level definition format
- objective framework
- campaign progression
- save/progression state
- level select
- visual theme switching

## Phase 6 — Campaign Act I

Build and fully polish the first five levels before producing Acts II and III.

If Act I is not fun, creating ten more levels will not solve the underlying problem.

## Phase 7 — Remaining Campaign Acts

Build Acts II and III after the systems and pacing have proven themselves in Act I.

## Phase 8 — Achievements

Add the internal achievement framework and later map it to platform achievement APIs during Steam / Google Play packaging.

## Phase 9 — Rift Gauntlet / Boss Rush

Reuse bosses and special encounters produced during campaign development.

## Phase 10 — Custom Mutator Mode

Expose the modifier framework to players as a configurable challenge mode.

---

# Target Finished Mode Lineup

A strong finished-product lineup would be:

- Arcade PvE
- PvE Co-op
- Real-time PvP
- Rift Survival
- Campaign
- Daily Rift
- Rift Gauntlet / Boss Rush
- Custom Mutator Mode

Custom Mutator Mode is optional for initial commercial release if schedule or polish requires cutting scope.

The priority is a smaller set of strong, differentiated modes built on a shared architecture rather than a large list of shallow modes.
