/**
 * What a Rift Run upgrade screen offers.
 *
 * Two rules do all the work here.
 *
 * **Only usable choices enter the pool.** A card the pilot cannot benefit from
 * is worse than no card: it silently shrinks a three-choice screen to two. So
 * a maxed ladder produces nothing, a definition at its stack cap produces
 * nothing, a hull-gun perk with no matching gun mounted produces nothing, and
 * a second UNLOCK SPECIAL cannot exist because the ladder that produces it has
 * already moved on. `eligibleUpgradeChoices` is the single gate; the roll below
 * only samples what it returns.
 *
 * **The five systems compete.** A screen shows at most one card per ship
 * system, so the question is always "which part of my ship?" rather than
 * "which of these three cannon perks?". With five systems and three slots
 * there is a real trade-off on every screen, and no system can crowd the
 * others out just by owning more cards than they do.
 */

import type { RiftRunState } from "./types.ts";
import { RIFT_SYSTEMS, type RiftSystemId } from "./loadout.ts";
import { RIFT_UPGRADES, occupiedWeapons, upgradeStack, type UpgradeChoice } from "./upgrades.ts";
import { RIFT_WEAPON_BY_ID } from "./weapons.ts";
import { eligibleEvolutions } from "./evolutions.ts";
import { trackChoices } from "./tracks.ts";

/** Cards shown on one upgrade screen. Three of the five systems, never repeated. */
export const RIFT_UPGRADE_CARDS = 3;

function hash(text: string): number { let h=2166136261; for (let i=0;i<text.length;i++) { h^=text.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function random(seed: string, index: number): number { let x=hash(`${seed}:${index}`); x^=x<<13; x^=x>>>17; x^=x<<5; return (x>>>0)/4294967296; }

/** Every card the current build could actually use, ladders included. */
export function eligibleUpgradeChoices(state: RiftRunState): UpgradeChoice[] {
  const definitions = RIFT_UPGRADES.flatMap(def => {
    if (def.category === "weapon" || def.category === "hull-gun") return occupiedWeapons(state).flatMap(({ hardpointIndex, weapon }) => {
      if (def.weapons && !def.weapons.includes(weapon.weaponId) || def.excludes?.includes(weapon.weaponId) || !def.repeatable && upgradeStack(state, def.id, weapon.instanceId) >= def.maxStacks) return [];
      return [{ key: `${def.id}:${weapon.instanceId}`, upgradeId: def.id, system: def.system, gameplayCategory: def.gameplayCategory, targetInstanceId: weapon.instanceId, hardpointIndex, title: def.name, target: `${RIFT_WEAPON_BY_ID[weapon.weaponId].name} · HARDPOINT ${hardpointIndex+1}`, description: def.description }];
    });
    const stack = upgradeStack(state, def.id);
    if (!def.repeatable && stack >= def.maxStacks) return [];
    // The card's eyebrow already names the ship system, so repeating the old
    // gameplay category underneath it was noise. How far along this particular
    // upgrade is says something the pilot cannot read anywhere else.
    const target = Number.isFinite(def.maxStacks) ? `STACK ${stack + 1} / ${def.maxStacks}` : `STACK ${stack + 1}`;
    return [{ key: def.id, upgradeId: def.id, system: def.system, gameplayCategory: def.gameplayCategory, title: def.name, target, description: def.description }];
  });
  return [...trackChoices(state), ...definitions];
}

/** Every eligible card belonging to one ship system. */
export function choicesForSystem(state: RiftRunState, system: RiftSystemId): UpgradeChoice[] {
  return eligibleUpgradeChoices(state).filter((choice) => choice.system === system);
}

/** The systems that still have something to offer this build. */
export function liveSystems(state: RiftRunState): RiftSystemId[] {
  const pool = eligibleUpgradeChoices(state);
  return RIFT_SYSTEMS.filter((system) => pool.some((choice) => choice.system === system));
}

export function rollUpgradeChoices(state: RiftRunState): { choices: UpgradeChoice[]; nextRollIndex: number } {
  const pool = eligibleUpgradeChoices(state);

  // An evolution is the loudest thing that can happen to a build, so when one
  // is available it takes the hull slot outright rather than queueing behind
  // three ordinary hull perks.
  const evolutions = eligibleEvolutions(state)
    .map(({ definition, hardpointIndex, weapon }, i) => ({
      n: random(state.seed, state.rollIndex + pool.length + i),
      choice: { key:`evolution:${definition.id}:${weapon.instanceId}`, upgradeId:`evolution:${definition.id}`, system:"hull" as const, gameplayCategory:"offensive" as const, evolutionId:definition.id, targetInstanceId:weapon.instanceId, hardpointIndex, title:definition.name, target:`${RIFT_WEAPON_BY_ID[weapon.weaponId].name} · HARDPOINT ${hardpointIndex+1}`, description:definition.description, kind:"evolution" as const },
    }))
    .sort((a, b) => a.n - b.n);

  // Systems are ordered by the run's own seed and then filled in that order,
  // so which three of the five appear is itself part of the decision rather
  // than a fixed rotation the pilot can plan around.
  //
  // The one exception: an available evolution takes the hull slot to the front
  // of the queue. An evolution is the largest single change a build can
  // undergo — new behaviour, new projectiles, new sound — and losing one to a
  // shuffle would be losing the mode's loudest moment to chance.
  const shuffled = RIFT_SYSTEMS
    .map((system, i) => ({ system, n: random(state.seed, state.rollIndex + pool.length * 2 + i) }))
    .sort((a, b) => a.n - b.n)
    .map(({ system }) => system);
  const ordered: RiftSystemId[] = evolutions[0]
    ? ["hull", ...shuffled.filter((system) => system !== "hull")]
    : shuffled;

  const choices: UpgradeChoice[] = [];
  ordered.forEach((system, slot) => {
    if (choices.length >= RIFT_UPGRADE_CARDS) return;
    if (system === "hull" && evolutions[0]) { choices.push(evolutions[0].choice); return; }
    const candidates = pool.filter((choice) => choice.system === system);
    const picked = candidates
      .map((choice, i) => ({ choice, n: random(state.seed, state.rollIndex + (slot + 3) * (pool.length + 1) + i) }))
      .sort((a, b) => a.n - b.n)[0];
    if (picked) choices.push(picked.choice);
  });

  return { choices, nextRollIndex: state.rollIndex + (pool.length + 1) * (RIFT_SYSTEMS.length + 3) + evolutions.length };
}
