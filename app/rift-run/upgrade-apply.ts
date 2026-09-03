import { RIFT_MODIFIER_LIMITS as L, clampModifier } from "./balance.ts";
import type { RiftRunState, RiftWeaponId } from "./types.ts";
import { RIFT_UPGRADE_BY_ID, upgradeStack, type UpgradeChoice } from "./upgrades.ts";
import { createWeaponInstance } from "./weapons.ts";
import { RIFT_EVOLUTION_BY_ID, activeEvolution, qualifiesForEvolution } from "./evolutions.ts";
import {
  RIFT_RUN_MAX_CANNON_TIER,
  RIFT_RUN_MAX_PAYLOAD_SLOTS,
  RIFT_RUN_MAX_SPECIAL_TIER,
  RIFT_RUN_MAX_THRUSTER_TIER,
  RIFT_RUN_TIER_GAINS as G,
} from "./loadout.ts";
import { isRiftRunSpecial } from "./specials.ts";
import { nextLockedHardpointIndex } from "./state.ts";
import type { ShipId } from "../game-data.ts";

/**
 * Advance one of the tiered ladders.
 *
 * Returns the unchanged state when the ladder is already finished, which makes
 * a stale card — one rolled before another choice moved the same track —
 * harmless rather than a way to exceed a cap. The caller sees `state === next`
 * and knows nothing was spent.
 *
 * Cannon and thruster steps pay out twice: the mark, which changes the shots
 * or the engine curve outright, and a modifier on top so the last step of each
 * ladder still lands after the mark has hit its ceiling.
 */
function applyTrack(state: RiftRunState, choice: UpgradeChoice): RiftRunState | null {
  const track = choice.track;
  if (!track) return null;
  const next = structuredClone(state);
  const loadout = next.loadout;
  if (track === "payload-slot") {
    if (loadout.payloadSlots >= RIFT_RUN_MAX_PAYLOAD_SLOTS) return state;
    loadout.payloadSlots += 1;
  } else if (track === "cannon-tier") {
    if (loadout.cannonTier >= RIFT_RUN_MAX_CANNON_TIER) return state;
    loadout.cannonTier += 1;
    next.shipModifiers.cannonDamage += G.cannonDamage;
    next.shipModifiers.cannonFireRate += G.cannonFireRate;
  } else if (track === "thruster-tier") {
    if (loadout.thrusterTier >= RIFT_RUN_MAX_THRUSTER_TIER) return state;
    loadout.thrusterTier += 1;
    next.shipModifiers.movement = clampModifier(next.shipModifiers.movement + G.movement, L.movement);
    next.shipModifiers.handling = clampModifier(next.shipModifiers.handling + G.handling, L.handling);
  } else if (track === "special-unlock") {
    if (loadout.special || next.pendingSpecialChoice) return state;
    // The card installs the mount; which ability goes in it is the pilot's
    // next decision, exactly as unlocking a socket is followed by picking the
    // gun that fills it.
    next.pendingSpecialChoice = true;
  } else if (track === "special-tier") {
    if (!loadout.special || loadout.special.tier >= RIFT_RUN_MAX_SPECIAL_TIER) return state;
    loadout.special = { ...loadout.special, tier: loadout.special.tier + 1 };
  } else if (track === "socket-unlock") {
    const index = nextLockedHardpointIndex(next);
    if (index === null) return state;
    next.hardpoints[index] = { index, status: "available" };
    next.pendingHullGunReward = { hardpointIndex: index, breach: next.riftBreaches };
  } else {
    return null;
  }
  const stack = upgradeStack(next, track) + 1;
  next.upgradeHistory.push({ upgradeId: track, stack, level: next.level - next.pendingLevels + 1 });
  next.pendingLevels = Math.max(0, next.pendingLevels - 1);
  return next;
}

/**
 * Install the Special the pilot picked after an UNLOCK SPECIAL.
 *
 * Rejects anything that is not on Rift Run's own roster, so a stale or
 * hand-made id cannot arm an ability the mode does not offer.
 */
export function chooseRiftRunSpecial(state: RiftRunState, shipId: ShipId): RiftRunState {
  if (!state.pendingSpecialChoice || state.loadout.special || !isRiftRunSpecial(shipId)) return state;
  return { ...state, pendingSpecialChoice: false, loadout: { ...state.loadout, special: { shipId, tier: 1 } } };
}

export function applyUpgrade(state: RiftRunState, choice: UpgradeChoice): RiftRunState {
  const tracked = applyTrack(state, choice);
  if (tracked) return tracked;
  if (choice.evolutionId) {
    const next=structuredClone(state), point=next.hardpoints.find(p=>p.status==="occupied"&&p.weapon.instanceId===choice.targetInstanceId);
    if (!point || point.status!=="occupied" || activeEvolution(point.weapon)) return state;
    const evolution=RIFT_EVOLUTION_BY_ID[choice.evolutionId]; if (!evolution || !qualifiesForEvolution(state,point.weapon,evolution)) return state;
    point.weapon.evolution={id:evolution.id,name:evolution.name}; const m=point.weapon.modifiers,e=evolution.modifiers;
    if(e.fireRate) m.fireRate=clampModifier(m.fireRate+e.fireRate,L.fireRate); if(e.damage) m.damage=clampModifier(m.damage+e.damage,L.damage); if(e.projectileCount) m.projectileCount=clampModifier(m.projectileCount+e.projectileCount,L.projectileCount); if(e.penetration) m.penetration=clampModifier(m.penetration+e.penetration,L.penetration); if(e.projectileSpeed) m.projectileSpeed=clampModifier(m.projectileSpeed+e.projectileSpeed,L.projectileSpeed); if(e.explosionRadius) m.explosionRadius=clampModifier(m.explosionRadius+e.explosionRadius,L.explosionRadius); if(e.range) m.range=clampModifier(m.range+e.range,L.flameRange); if(e.coneWidth) m.coneWidth=clampModifier(m.coneWidth+e.coneWidth,L.flameConeDegrees);
    next.evolutionHistory.push({evolutionId:evolution.id,weaponInstanceId:point.weapon.instanceId,hardpoint:point.index,level:next.level-next.pendingLevels+1}); next.pendingLevels=Math.max(0,next.pendingLevels-1); return next;
  }
  const next=structuredClone(state), def=RIFT_UPGRADE_BY_ID[choice.upgradeId]; if (!def) return state;
  if (def.category === "weapon" || def.category === "hull-gun") {
    const point=next.hardpoints.find(p=>p.status==="occupied" && p.weapon.instanceId===choice.targetInstanceId); if (!point || point.status!=="occupied") return state;
    const m=point.weapon.modifiers;
    if (def.effect==="fireRate") m.fireRate=clampModifier(m.fireRate+def.amount,L.fireRate); else if(def.effect==="damage") m.damage=clampModifier(m.damage+def.amount,L.damage); else if(def.effect==="projectileCount") m.projectileCount=clampModifier(m.projectileCount+def.amount,L.projectileCount); else if(def.effect==="penetration") m.penetration=clampModifier(m.penetration+def.amount,L.penetration); else if(def.effect==="explosionRadius") m.explosionRadius=clampModifier(m.explosionRadius+def.amount,L.explosionRadius); else if(def.effect==="projectileSpeed") m.projectileSpeed=clampModifier(m.projectileSpeed+def.amount,L.projectileSpeed); else if(def.effect==="range") m.range=clampModifier(m.range+def.amount,L.flameRange); else if(def.effect==="coneWidth") m.coneWidth=clampModifier(m.coneWidth+def.amount,L.flameConeDegrees);
  } else if(def.effect==="movement") next.shipModifiers.movement=clampModifier(next.shipModifiers.movement+def.amount,L.movement); else if(def.effect==="handling") next.shipModifiers.handling=clampModifier(next.shipModifiers.handling+def.amount,L.handling); else if(def.effect==="damageReduction") next.shipModifiers.damageReduction=clampModifier(next.shipModifiers.damageReduction+def.amount,L.damageReduction); else if(def.effect==="cannonDamage") next.shipModifiers.cannonDamage+=def.amount; else if(def.effect==="cannonFireRate") next.shipModifiers.cannonFireRate+=def.amount; else if(def.effect==="hull") next.shipModifiers.hull+=def.amount; else if(def.effect==="shield") next.shipModifiers.shield+=def.amount;
  const stack=upgradeStack(next,def.id,choice.targetInstanceId)+1; next.upgradeHistory.push({upgradeId:def.id,targetInstanceId:choice.targetInstanceId,hardpointIndex:choice.hardpointIndex,stack,level:next.level-next.pendingLevels+1}); next.pendingLevels=Math.max(0,next.pendingLevels-1); return next;
}
export function mountUnlockedWeapon(state: RiftRunState, hardpointIndex: number, weaponId: RiftWeaponId): RiftRunState { const next=structuredClone(state), p=next.hardpoints[hardpointIndex]; if (!p || p.status!=="available") return state; next.hardpoints[hardpointIndex]={index:hardpointIndex,status:"occupied",weapon:createWeaponInstance(weaponId,`socket-${hardpointIndex+1}-${next.upgradeHistory.length}`)}; return next; }
