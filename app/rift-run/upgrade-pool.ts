import type { RiftRunState } from "./types";
import { RIFT_UPGRADES, occupiedWeapons, upgradeStack, type UpgradeChoice } from "./upgrades";
import { RIFT_WEAPON_BY_ID } from "./weapons";
import { eligibleEvolutions } from "./evolutions";

function hash(text: string): number { let h=2166136261; for (let i=0;i<text.length;i++) { h^=text.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function random(seed: string, index: number): number { let x=hash(`${seed}:${index}`); x^=x<<13; x^=x>>>17; x^=x<<5; return (x>>>0)/4294967296; }

export function eligibleUpgradeChoices(state: RiftRunState): UpgradeChoice[] {
  return RIFT_UPGRADES.flatMap(def => {
    if (def.category === "weapon") return occupiedWeapons(state).flatMap(({ hardpointIndex, weapon }) => {
      if (def.weapons && !def.weapons.includes(weapon.weaponId) || def.excludes?.includes(weapon.weaponId) || upgradeStack(state, def.id, weapon.instanceId) >= def.maxStacks) return [];
      return [{ key: `${def.id}:${weapon.instanceId}`, upgradeId: def.id, targetInstanceId: weapon.instanceId, hardpointIndex, title: def.name, target: `${RIFT_WEAPON_BY_ID[weapon.weaponId].name} · HARDPOINT ${hardpointIndex+1}`, description: def.description }];
    });
    if (def.id === "hardpoint-online" && !state.hardpoints.some(p => p.status === "locked")) return [];
    if (def.id === "shield-capacitor" && state.shipClass === "light") return [];
    if (upgradeStack(state, def.id) >= def.maxStacks) return [];
    return [{ key: def.id, upgradeId: def.id, title: def.name, target: def.category.toUpperCase(), description: def.description }];
  });
}

export function rollUpgradeChoices(state: RiftRunState, count=3): { choices: UpgradeChoice[]; nextRollIndex: number } {
  const pool=eligibleUpgradeChoices(state), weighted=pool.map((choice,i)=>({choice, n:random(state.seed,state.rollIndex+i)})).sort((a,b)=>a.n-b.n);
  const evolutions=eligibleEvolutions(state).map(({definition,hardpointIndex,weapon},i)=>({ n:random(state.seed,state.rollIndex+pool.length+i), choice:{key:`evolution:${definition.id}:${weapon.instanceId}`,upgradeId:`evolution:${definition.id}`,evolutionId:definition.id,targetInstanceId:weapon.instanceId,hardpointIndex,title:definition.name,target:`${RIFT_WEAPON_BY_ID[weapon.weaponId].name} · HARDPOINT ${hardpointIndex+1}`,description:definition.description,kind:"evolution" as const}})).sort((a,b)=>a.n-b.n);
  const choices=weighted.slice(0,count).map(x=>x.choice);
  if (evolutions[0]) choices.splice(0,1,evolutions[0].choice);
  return { choices, nextRollIndex: state.rollIndex+pool.length+evolutions.length };
}
