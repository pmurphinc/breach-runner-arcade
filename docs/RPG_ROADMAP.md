# RPG / Ship Build Roadmap

Status: Planning

This document defines a lightweight RPG layer for Breach Runner / Project Rift. The goal is to add long-term build identity, ship customization, classes, talent choices, and progression without slowing down or replacing the immediate twin-stick arcade combat.

The RPG system should make players think, "this is my build," while keeping every match readable, fast, and balanced.

## Design Principles

- Preserve the core arcade loop. Players should still be able to launch into a game quickly.
- Keep the RPG layer simple enough to understand at a glance.
- Prefer meaningful mechanical choices over dozens of tiny percentage upgrades.
- Separate the physical ship Frame from the player's Class and Talent choices.
- Make different Frame + Class combinations viable instead of creating one obvious best ship.
- Let progression unlock more options, not permanent raw power over new players.
- Keep competitive PvP on an equal build budget.
- Allow solo PvE, co-op, survival, campaign, and PvP to share the same underlying build system.
- Keep temporary in-run power-ups separate from permanent career progression.
- Design every system for desktop, phone, tablet, and foldable interfaces.

---

# 1. Core RPG Structure

The build system is divided into three primary layers:

1. **Frame** — the physical ship and its base handling profile.
2. **Class** — the player's broad combat role and playstyle.
3. **Talents** — a small set of chosen modifiers that specialize the class.

Optional equipment and cosmetic systems can sit around these three layers later, but they should not be required for the first RPG release.

Example:

> Frame: Scout  
> Class: Interceptor  
> Talents: Phase Dash, Momentum, Scavenger, Slipstream

The same Frame can support multiple Classes.

Example:

- Scout + Assault = fast glass cannon
- Scout + Guardian = evasive shield build
- Scout + Interceptor = extreme mobility / positioning build
- Vanguard + Assault = heavy gunship
- Vanguard + Guardian = durable fortress
- Vanguard + Interceptor = slow but highly disruptive control build

This combination system creates replayability without requiring dozens of unique ships.

---

# 2. Launch Classes

Initial target: **3 Classes**.

These should represent three clearly different ways to approach the arena.

## Assault

Theme: **Aggression / Damage / Pressure**

Assault players push toward danger, attack the rift aggressively, and convert offensive momentum into more damage.

### Strengths

- High weapon output
- Strong burst damage
- Better attack payload generation
- Rewards staying close to threats
- Strong finishing potential

### Weaknesses

- Lower survivability
- Less forgiving positioning
- Limited defensive recovery

### Example Talents

#### Overcharge

Weapon pickups temporarily increase fire rate.

#### Executioner

Deal increased damage to enemies or the rift below a low-health threshold.

#### Rift Hunter

Deal increased damage while fighting inside a defined rift danger zone.

#### Chain Reaction

Destroyed mines or hazards damage nearby hostile targets.

#### Kill Recharge

Destroying a hostile target restores a small amount of weapon energy or charge.

#### Berserk

When the player's shield breaks, gain a short burst of increased weapon output.

#### Heavy Shot

Reduce fire rate but increase projectile impact, knockback, or penetration.

#### Payload Specialist

Generate attack payloads more efficiently from rift damage or offensive pickups.

### Assault Design Rule

The class should feel powerful when the player is actively attacking, but it should not simply receive the highest numbers with no meaningful downside.

---

## Guardian

Theme: **Defense / Survival / Stability**

Guardian players survive conditions that would destroy other builds and create breathing room during chaotic encounters.

### Strengths

- Strong shields
- Better hull protection
- Hazard resistance
- Emergency survival tools
- Forgiving for newer players

### Weaknesses

- Lower burst damage
- Reduced mobility or acceleration
- Less offensive pressure

### Example Talents

#### Emergency Barrier

Automatically create a temporary shield when hull falls below a critical threshold.

#### Reactive Armor

Taking collision or explosive damage briefly increases damage resistance.

#### Fortress

Remaining within a small area for a short period strengthens shield recharge or damage resistance.

The activation requirement must be short enough that the talent does not encourage passive camping.

#### Second Wind

Once per run or match, survive otherwise lethal damage with minimal hull remaining.

#### Blast Shield

Reduce damage from mines, explosions, and environmental hazards.

#### Shield Pulse

A full shield recharge briefly pushes nearby hazards or hostile projectiles away.

#### Reinforced Hull

Increase effective hull durability while slightly reducing acceleration.

#### Stabilizer

Reduce knockback, gravitational pull, and forced movement effects.

### Guardian Design Rule

Guardian should improve survival, not create an unkillable ship. Defensive gains should trade against damage, mobility, cooldowns, or other build resources.

---

## Interceptor

Theme: **Mobility / Positioning / Control**

Interceptor is the third primary playstyle. It wins through movement, timing, arena manipulation, pickup control, and avoiding danger rather than directly maximizing damage or armor.

This should have the highest mechanical skill ceiling of the launch classes.

### Strengths

- Excellent mobility
- Better repositioning
- Strong pickup control
- Rewards dodging and near misses
- Can manipulate engagement distance

### Weaknesses

- Lower sustained durability
- Requires more player skill
- Mistakes are punished heavily

### Example Talents

#### Phase Dash

A short dash can pass through hostile projectiles or selected hazards.

It should not allow the player to ignore every environmental danger.

#### Momentum

Deal increased weapon damage while moving above a speed threshold.

#### Scavenger

Increase power-up attraction radius.

#### Slipstream

A near miss temporarily increases speed or acceleration.

#### Ghost

A successful perfect dodge grants a very brief invulnerability window.

#### Vector Shift

Sharp direction changes receive improved acceleration for a short period.

#### Mine Runner

Reduce mine trigger radius or delay mine activation slightly when passing nearby.

#### Ricochet

Selected projectiles gain a limited bounce or penetration behavior.

### Interceptor Design Rule

Mobility cannot become permanent invulnerability. Dash, dodge, and repositioning tools must require timing and expose recovery windows.

---

# 3. Future Class — Engineer / Support

Do not include Engineer in the first RPG release unless co-op systems are mature enough to support it.

Theme: **Support / Utility / Team Control**

Possible abilities:

- Repair allied hull
- Recharge allied shields
- Deploy temporary repair drones
- Deploy limited turrets
- Improve power-up efficiency
- Share weapon energy
- Strengthen attack payloads
- Revive or stabilize an eliminated ally in eligible modes
- Temporarily disable hazards

## Why Engineer Is Later

A pure support role risks being:

- weak or awkward in solo PvE
- difficult to balance in 1v1 PvP
- mandatory in co-op if healing is too strong

Engineer should only be added when every mode has a clear rule for how its utility works.

---

# 4. Frames

A Frame is the physical ship chassis.

Frames should define handling and durability, not force a particular Class.

Initial target: **4 to 5 Frames**.

Possible launch set:

| Frame | Hull | Shield | Speed | Handling | Primary Identity |
| --- | --- | --- | --- | --- | --- |
| Scout | Low | Low | Very High | Very High | Extreme agility |
| Fighter | Medium | Medium | High | High | Balanced all-rounder |
| Vanguard | Very High | High | Low | Low | Heavy durable chassis |
| Striker | Medium | Low | Medium | Medium | Weapon-focused platform |
| Experimental | Low | Medium | High | Medium | Unusual mechanics / advanced play |

Exact values should be tested in gameplay rather than locked by this table.

## Frame Rules

Each Frame should have:

- Base hull
- Base shield
- Maximum speed
- Acceleration
- Turning / steering response
- Collision characteristics
- One clear intrinsic characteristic at most

Avoid giving each Frame a complete class kit. Otherwise Frame selection and Class selection become redundant.

### Example Frame Intrinsics

Scout:

- Slightly smaller collision profile

Fighter:

- No major bonus; intentionally balanced

Vanguard:

- Reduced forced movement from collisions and gravity

Striker:

- Slightly improved base weapon handling

Experimental:

- One unusual mechanic, such as altered dash behavior or power-up interaction

Frame intrinsics should remain small enough that Class + Talent choices are still the primary build-defining layer.

---

# 5. Talent Trees

Talent trees should remain intentionally small.

Initial target per Class:

- 8 to 10 total talents
- 4 to 5 active talent selections in a completed build
- A limited number of branches
- No filler nodes required only to reach the interesting talents

The player should not be able to equip every talent simultaneously.

## Example Structure

```text
ASSAULT

              Overcharge
                  |
          +-------+-------+
          |               |
      Rapid Fire      Heavy Shot
          |               |
    Kill Recharge     Rift Hunter
          +-------+-------+
                  |
               Berserk
```

This is an organizational example, not a final dependency layout.

## Talent Design Rules

Prefer talents that change gameplay behavior.

Good:

- Dash through projectiles
- Destroyed mines cause chain reactions
- Shield break activates a temporary offensive state
- Power-ups pull toward the player
- High-speed movement increases damage

Avoid talent trees dominated by:

- +2% damage
- +3% damage
- +4% damage
- +2% shield
- +1% movement speed

Small numeric modifiers can support a mechanic, but they should not be the primary reason a talent exists.

## Respec

Players should be able to respec freely outside a match.

Do not charge currency or impose long cooldowns for experimenting with builds.

The game should encourage players to try combinations.

---

# 6. Build Budget and Balance

A core rule of the RPG system:

**Veteran players unlock more options, not permanent statistical superiority.**

This is especially important for PvP.

## PvP Build Budget

All players should operate under the same build limits.

Example only:

- 1 Frame
- 1 Class
- 4 or 5 Talent slots
- 1 starting weapon package
- Fixed equipment budget

A player with 50 hours may have more Frames, Talents, cosmetics, and weapon options available, but cannot equip more total power than a newer player.

## PvP Rules

- Normalize build slot counts.
- Avoid permanent account-level damage, hull, or shield bonuses.
- Keep unlockable gear side-grade focused.
- Show opponent Class / Frame clearly enough to understand their capabilities.
- Consider displaying key equipped talents before competitive matches if hidden builds prove frustrating.
- Balance around counterplay, not hard counters.

## PvE Rules

PvE can allow somewhat more expressive builds because players are fighting the game rather than each other.

However, avoid permanent stat inflation that makes earlier content meaningless.

Higher difficulties should remain challenging through enemy behavior, hazards, modifiers, and encounter design.

---

# 7. Career Progression vs Run Progression

The RPG layer should use two separate progression systems.

## Career Progression

Persistent between games.

Career progression can unlock:

- Frames
- Classes
- Talent choices
- Starting weapon options
- Equipment side-grades
- Ship skins
- Trail effects
- Rift effects
- Titles
- Profile badges
- Achievements
- Challenge rewards

Career progression should mostly expand build variety and presentation.

## Run Progression

Temporary and reset when the game or run ends.

Examples:

- Weapon pickups
- Power-ups
- Temporary upgrades
- Attack payloads
- Temporary shields
- In-run buffs
- Mode-specific modifiers

The RPG system must not replace the existing arcade power-up loop.

The ideal relationship is:

> Career build defines how you play.  
> Run pickups define what happens to you this match.

---

# 8. Progression Loop

Basic long-term loop:

```text
PLAY
  |
Earn XP / Frame XP / challenge progress
  |
Unlock a new option
  |
Adjust Frame / Class / Talents
  |
Try the build in another mode or difficulty
  |
Complete achievements / challenges
  |
Unlock additional side-grades and cosmetics
  |
PLAY AGAIN
```

The loop should reinforce experimentation rather than raw grinding.

---

# 9. XP and Unlock Structure

Keep progression understandable.

Possible structure:

## Account / Career Level

Unlocks broad systems and content.

Examples:

- additional Frames
- additional Classes
- additional talent choices
- cosmetic rewards
- challenge tiers

## Frame Mastery

Optional secondary progression for players who favor a particular Frame.

Frame Mastery should primarily unlock:

- cosmetics
- alternate visual parts
- trails
- banners
- titles
- side-grade options

Avoid large permanent combat bonuses from mastery levels.

## Class Mastery

Optional later system.

Could unlock:

- additional talent choices
- alternate ability visuals
- class-themed cosmetics
- advanced challenges

Do not create simultaneous Career, Frame, Class, Weapon, and Season XP systems at launch. That would make the RPG layer unnecessarily complicated.

Recommended first release:

- Career Level
- Optional Frame Mastery only if needed

---

# 10. Campaign Integration

Campaign is a natural place to introduce the RPG system gradually.

Possible progression:

## Early Campaign

- Choose first Frame
- Learn movement and core combat
- Introduce Frame strengths / weaknesses

## Early-Mid Campaign

- Unlock first Class
- Introduce Class identity
- Allow initial talent selection

## Mid Campaign

- Unlock additional talents
- Introduce enemies and hazards that reward different playstyles

## Late Campaign

- Require stronger build understanding
- Introduce elite enemy combinations
- Encourage respec and experimentation

## Boss / Major Rift Encounters

Boss encounters should reward different strategies without requiring one specific Class.

Examples:

- Assault wins through high-risk damage windows
- Guardian survives dangerous phases more easily
- Interceptor uses mobility to exploit positional openings

Campaign should teach buildcraft naturally instead of opening with a large talent screen before the player understands the game.

---

# 11. Survival / Time Challenge Integration

Rift Survival is an ideal mode for build experimentation.

Each Class should have a different path to a strong survival score:

Assault:

- Destroy threats before the arena becomes overwhelmed

Guardian:

- Endure extreme hazard combinations

Interceptor:

- Navigate increasingly unsafe space and maintain pickup control

Leaderboards may eventually support filters for:

- Overall
- Frame
- Class
- Difficulty / modifier set

Do not fragment leaderboards into too many categories until the player population supports it.

---

# 12. Co-op Integration

Classes should create natural teamwork without forcing rigid MMO roles.

The game should not require:

- tank
- healer
- damage dealer

Instead, each Class remains independently playable.

Examples:

Assault:

- clears threats quickly

Guardian:

- survives dangerous objective positions

Interceptor:

- collects distant power-ups and controls hazardous areas

Future Engineer:

- amplifies team utility

Co-op bonuses should reward complementary builds without making duplicate Classes invalid.

Two Assault players should still be viable.

---

# 13. Starting Weapons and Equipment

Do not build a large inventory system during the first RPG milestone.

If starting equipment is added, use a small side-grade pool.

Possible categories:

- Primary cannon behavior
- Special ability
- Utility module

Example primary choices:

- Rapid cannon
- Heavy cannon
- Spread cannon

These should trade characteristics rather than form a simple rarity ladder.

Example:

Rapid Cannon:

- high fire rate
- lower individual impact

Heavy Cannon:

- slower
- stronger impact
- better penetration

Spread Cannon:

- strong close range
- weaker precision at distance

Avoid random loot rarity such as common / rare / epic / legendary stat escalation unless the design direction changes substantially later.

---

# 14. Ship Customization

Ship customization can provide a major long-term reward system without affecting balance.

Possible cosmetic slots:

- Hull paint
- Accent color
- Engine trail
- Projectile effect
- Shield effect
- Rift victory effect
- Ship emblem
- Nameplate
- Cockpit / light accent

Possible visual Frame parts later:

- Wings
- Engines
- fins
- armor panels

If interchangeable parts affect gameplay, they should use the same fixed build-budget philosophy as Talents and equipment.

Do not allow cosmetic purchases or unlocks to alter hitboxes.

---

# 15. Build Presets

Once the RPG system has enough choices to justify it, allow saved presets.

Initial target:

- 3 saved builds

Possible examples:

- Scout Interceptor — Survival
- Vanguard Guardian — Co-op
- Striker Assault — PvE Hard

A preset stores:

- Frame
- Class
- Talents
- Eligible starting equipment
- Cosmetic configuration if desired

Players should still be able to launch quickly using their last selected build.

---

# 16. UI / Menu Structure

Keep RPG setup separate from the immediate Play menu whenever possible.

Possible main navigation:

- Play
- Ship
- Leaderboards
- Achievements
- Settings

## Ship Screen

Suggested flow:

### Frame

Select chassis and see:

- Hull
- Shield
- Speed
- Handling
- Frame intrinsic

### Class

Choose:

- Assault
- Guardian
- Interceptor

### Talents

Show the selected Class's compact talent tree.

### Loadout

Only include this tab once starting equipment is implemented.

### Appearance

Cosmetics and ship visuals.

## Quick Play Requirement

The player should not be forced through the RPG menu every time.

From Play:

- show currently equipped build
- provide a small "Change Build" action
- allow immediate launch with the current build

---

# 17. Player Readability

Build systems fail when players cannot understand what changed.

Every active talent should provide clear feedback where appropriate.

Examples:

- Phase Dash produces a distinct phase visual and sound.
- Berserk changes weapon or ship effects briefly.
- Emergency Barrier visibly deploys around the ship.
- Slipstream shows a short movement effect.
- Chain Reaction has a recognizable explosion effect.

Avoid requiring the player to inspect a combat log to know whether their build works.

---

# 18. Balance Philosophy

Balance around three questions:

1. Does every Class have a clear strength?
2. Does every Class have a meaningful weakness?
3. Can another skilled player or encounter meaningfully respond to that strength?

## Avoid

- One Frame being objectively best for every Class
- One Talent being mandatory in every build
- Permanent stat advantages from account age
- Excessive cooldown reduction loops
- Infinite shield / healing loops
- Permanent invulnerability chains
- Movement builds that cannot realistically be hit
- Defensive builds that stall PvP indefinitely
- Damage builds that erase opponents before they can respond

## Balance Targets

The initial goal is not perfect mathematical equality.

The goal is:

- multiple viable builds
- understandable strengths
- clear counterplay
- no dominant mandatory combination
- skill remains more important than progression time

---

# 19. Suggested Initial Content Scope

First complete RPG release:

- 4 Frames
- 3 Classes
- 8 Talents per Class
- 4 equipped Talent slots
- Free respec outside matches
- Career progression
- Build save / persistence
- Basic cosmetic customization
- PvE integration
- Campaign integration hooks
- Survival integration hooks
- PvP normalized build rules

This produces:

- 4 Frames
- 3 Classes
- 24 talent choices
- many useful Frame + Class + Talent combinations

without turning the game into a traditional inventory-heavy RPG.

---

# 20. Recommended Implementation Order

## Phase 1 — Build Data Foundation

Create reusable data definitions for:

- Frames
- Classes
- Talents
- Build validation
- Build persistence

No major progression UI is required yet.

## Phase 2 — Frame Separation

Move existing ship differences into a formal Frame system.

Verify that:

- stats are data-driven
- handling remains consistent across input modes
- Frames do not accidentally encode complete Class identities

## Phase 3 — Three Classes

Add:

- Assault
- Guardian
- Interceptor

Start with one simple class passive or defining mechanic each before implementing the full talent trees.

## Phase 4 — Talent System

Add:

- compact talent trees
- 4 equipped talent slots
- free respec
- build validation
- gameplay feedback

Test each Talent individually before testing complex combinations.

## Phase 5 — Ship / Build UI

Add:

- Frame selection
- Class selection
- Talent selection
- current build summary
- build persistence

Keep immediate Play access intact.

## Phase 6 — Career Progression

Add XP and unlock sequencing.

Progression should unlock choices gradually rather than create raw permanent power.

## Phase 7 — Mode Integration

Integrate the build system with:

- existing PvE
- PvE co-op
- PvP
- Rift Survival
- Campaign
- future challenge modes

## Phase 8 — Balance Pass

Collect data for:

- Class pick rate
- Frame pick rate
- Talent pick rate
- win rate by combination
- survival time by combination
- PvE completion rate
- PvP match duration

Use this data to identify mandatory Talents, weak Frames, and dominant combinations.

## Phase 9 — Cosmetic Expansion

Once the gameplay system is stable, expand:

- paints
- trails
- effects
- emblems
- mastery cosmetics

## Phase 10 — Engineer Evaluation

Only after co-op is stable, prototype the Engineer / Support Class and determine whether it improves the game without becoming mandatory.

---

# 21. Systems to Avoid at Initial Release

Do not add all of these simply because they are common RPG mechanics:

- random stat loot
- gear rarity tiers
- item durability
- crafting materials
- large inventory grids
- consumable stockpiles
- permanent PvP stat upgrades
- dozens of character levels
- skill-point currencies that punish respec
- multiple overlapping XP bars
- complex armor-slot systems

These systems would work against the fast arcade identity of Breach Runner unless a future design need clearly justifies them.

---

# 22. Long-Term Expansion Possibilities

After the core RPG system proves successful, possible additions include:

- Engineer / Support Class
- additional Frames
- alternate Class specializations
- advanced challenge Talents
- seasonal cosmetic rewards
- Frame mastery cosmetics
- class-specific achievements
- build-specific leaderboard filters
- co-op synergy bonuses
- rare cosmetic drops from difficult campaign bosses
- named build presets
- community build sharing

Any expansion should preserve the rule that additional progression means more ways to play, not unavoidable power creep.

---

# 23. Final Direction

The RPG layer should remain an **arcade build system**, not become a separate RPG game bolted onto Breach Runner.

The target identity is:

> Pick a Frame.  
> Pick a Class.  
> Choose a few meaningful Talents.  
> Launch immediately.  
> Let skill, movement, weapons, power-ups, and the rift decide the fight.

Recommended launch archetypes:

- **Assault** — damage and aggression
- **Guardian** — defense and survival
- **Interceptor** — mobility, positioning, and control

Recommended later archetype:

- **Engineer** — support and utility

The system succeeds if two players can choose the same Frame and still feel like they are flying genuinely different ships because of their Class, Talents, and playstyle — while neither player has an unfair advantage simply because they have played longer.
