import { RIFT_MODIFIER_LIMITS as L, clampModifier } from "./balance";
import type { RiftRunState, RiftWeaponId } from "./types";
import { RIFT_UPGRADE_BY_ID, upgradeStack, type UpgradeChoice } from "./upgrades";
import { createWeaponInstance } from "./weapons";

export function applyUpgrade(state: RiftRunState, choice: UpgradeChoice): RiftRunState {
  const next=structuredClone(state), def=RIFT_UPGRADE_BY_ID[choice.upgradeId]; if (!def) return state;
  if (def.category === "weapon") {
    const point=next.hardpoints.find(p=>p.status==="occupied" && p.weapon.instanceId===choice.targetInstanceId); if (!point || point.status!=="occupied") return state;
    const m=point.weapon.modifiers;
    if (def.effect==="fireRate") m.fireRate=clampModifier(m.fireRate+def.amount,L.fireRate); else if(def.effect==="damage") m.damage=clampModifier(m.damage+def.amount,L.damage); else if(def.effect==="projectileCount") m.projectileCount=clampModifier(m.projectileCount+def.amount,L.projectileCount); else if(def.effect==="penetration") m.penetration=clampModifier(m.penetration+def.amount,L.penetration); else if(def.effect==="explosionRadius") m.explosionRadius=clampModifier(m.explosionRadius+def.amount,L.explosionRadius); else if(def.effect==="projectileSpeed") m.projectileSpeed=clampModifier(m.projectileSpeed+def.amount,L.projectileSpeed); else if(def.effect==="range") m.range=clampModifier(m.range+def.amount,L.flameRange); else if(def.effect==="coneWidth") m.coneWidth=clampModifier(m.coneWidth+def.amount,L.flameConeDegrees);
  } else if(def.effect==="hardpoint") { const p=next.hardpoints.find(p=>p.status==="locked"); if (!p) return state; next.hardpoints[p.index]={index:p.index,status:"available"}; choice={...choice,hardpointIndex:p.index}; }
  else if(def.effect==="movement") next.shipModifiers.movement=clampModifier(next.shipModifiers.movement+def.amount,L.movement); else if(def.effect==="hull") next.shipModifiers.hull+=def.amount; else if(def.effect==="shield") next.shipModifiers.shield+=def.amount;
  const stack=upgradeStack(next,def.id,choice.targetInstanceId)+1; next.upgradeHistory.push({upgradeId:def.id,targetInstanceId:choice.targetInstanceId,hardpointIndex:choice.hardpointIndex,stack,level:next.level-next.pendingLevels+1}); next.pendingLevels=Math.max(0,next.pendingLevels-1); return next;
}
export function mountUnlockedWeapon(state: RiftRunState, hardpointIndex: number, weaponId: RiftWeaponId): RiftRunState { const next=structuredClone(state), p=next.hardpoints[hardpointIndex]; if (!p || p.status!=="available") return state; next.hardpoints[hardpointIndex]={index:hardpointIndex,status:"occupied",weapon:createWeaponInstance(weaponId,`socket-${hardpointIndex+1}-${next.upgradeHistory.length}`)}; return next; }
