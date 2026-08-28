import type { RiftRunState } from "./types.ts";
import { RIFT_UPGRADES, occupiedWeapons, upgradeStack, type UpgradeChoice } from "./upgrades.ts";
import { RIFT_WEAPON_BY_ID } from "./weapons.ts";
import { eligibleEvolutions } from "./evolutions.ts";

function hash(text: string): number { let h=2166136261; for (let i=0;i<text.length;i++) { h^=text.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function random(seed: string, index: number): number { let x=hash(`${seed}:${index}`); x^=x<<13; x^=x>>>17; x^=x<<5; return (x>>>0)/4294967296; }

export function eligibleUpgradeChoices(state: RiftRunState): UpgradeChoice[] {
  return RIFT_UPGRADES.flatMap(def => {
    if (def.category === "weapon") return occupiedWeapons(state).flatMap(({ hardpointIndex, weapon }) => {
      if (def.weapons && !def.weapons.includes(weapon.weaponId) || def.excludes?.includes(weapon.weaponId) || !def.repeatable && upgradeStack(state, def.id, weapon.instanceId) >= def.maxStacks) return [];
      return [{ key: `${def.id}:${weapon.instanceId}`, upgradeId: def.id, gameplayCategory: def.gameplayCategory, targetInstanceId: weapon.instanceId, hardpointIndex, title: def.name, target: `${RIFT_WEAPON_BY_ID[weapon.weaponId].name} · HARDPOINT ${hardpointIndex+1}`, description: def.description }];
    });
    if (def.id === "hardpoint-online" && (state.riftBreaches === 0 || state.hardpoints.some(p => p.status === "available") || !state.hardpoints.some(p => p.status === "locked"))) return [];
    if (def.id === "shield-capacitor" && state.shipClass === "light") return [];
    if (!def.repeatable && upgradeStack(state, def.id) >= def.maxStacks) return [];
    return [{ key: def.id, upgradeId: def.id, gameplayCategory: def.gameplayCategory, title: def.name, target: def.gameplayCategory.toUpperCase(), description: def.description }];
  });
}

export function rollUpgradeChoices(state: RiftRunState): { choices: UpgradeChoice[]; nextRollIndex: number } {
  const pool=eligibleUpgradeChoices(state);
  const pick=(category: UpgradeChoice["gameplayCategory"], offset:number) => pool.filter(x=>x.gameplayCategory===category).map((choice,i)=>({choice,n:random(state.seed,state.rollIndex+offset+i)})).sort((a,b)=>a.n-b.n)[0]?.choice;
  const evolutions=eligibleEvolutions(state).map(({definition,hardpointIndex,weapon},i)=>({ n:random(state.seed,state.rollIndex+pool.length+i), choice:{key:`evolution:${definition.id}:${weapon.instanceId}`,upgradeId:`evolution:${definition.id}`,gameplayCategory:"offensive" as const,evolutionId:definition.id,targetInstanceId:weapon.instanceId,hardpointIndex,title:definition.name,target:`${RIFT_WEAPON_BY_ID[weapon.weaponId].name} · HARDPOINT ${hardpointIndex+1}`,description:definition.description,kind:"evolution" as const}})).sort((a,b)=>a.n-b.n);
  const choices=[evolutions[0]?.choice ?? pick("offensive",0),pick("defensive",pool.length),pick("mobility",pool.length*2)].filter((x): x is UpgradeChoice => Boolean(x));
  return { choices, nextRollIndex: state.rollIndex+pool.length*3+evolutions.length };
}
