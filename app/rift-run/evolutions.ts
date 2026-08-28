import type { RiftEvolutionId, RiftRunState, RiftWeaponId, RiftWeaponInstance } from "./types";
import { occupiedWeapons, upgradeStack } from "./upgrades";

export type EvolutionDefinition = {
  id: RiftEvolutionId; name: string; sourceWeapon: RiftWeaponId;
  prerequisites: Readonly<Record<string, number>>; description: string;
  modifiers: Partial<{ fireRate: number; damage: number; projectileCount: number; penetration: number; projectileSpeed: number; explosionRadius: number; range: number; coneWidth: number; projectileScale: number }>;
  flags: readonly string[]; visual: string; audio: string;
};

export const RIFT_EVOLUTIONS: readonly EvolutionDefinition[] = [
  { id:"nova-cannon", name:"NOVA CANNON", sourceWeapon:"pulse-cannon", prerequisites:{"rapid-pulse":2,"heavy-pulse":2,"twin-pulse":2}, description:"Heavy multi-shot rounds create compact energy bursts.", modifiers:{damage:.55,projectileScale:1.8,explosionRadius:28}, flags:["radial-impact"], visual:"nova", audio:"pulse-heavy" },
  { id:"hellstorm", name:"HELLSTORM", sourceWeapon:"minigun", prerequisites:{overspin:3,"dense-slugs":2,"twin-barrel":2}, description:"An extreme tracer stream with faster, penetrating rounds.", modifiers:{fireRate:.6,projectileSpeed:.35,penetration:1}, flags:["aggressive-tracers"], visual:"hellstorm", audio:"minigun-heavy" },
  { id:"seismic-rail", name:"SEISMIC RAIL", sourceWeapon:"railgun", prerequisites:{"magnetic-accelerator":3,penetrator:3,"rapid-charge":2}, description:"Penetrating shots create destructive shockwaves.", modifiers:{damage:.65,projectileScale:1.7,explosionRadius:42}, flags:["penetration-shockwave"], visual:"seismic", audio:"rail-heavy" },
  { id:"mirv-battery", name:"MIRV BATTERY", sourceWeapon:"missile-pod", prerequisites:{salvo:2,"high-explosive":3,warhead:2}, description:"Larger independently guided salvos blanket a broad area.", modifiers:{projectileCount:2,explosionRadius:24,projectileScale:1.35}, flags:["wide-salvo","flexible-targeting"], visual:"mirv", audio:"missile-heavy" },
  { id:"inferno-projector", name:"INFERNO PROJECTOR", sourceWeapon:"flamethrower", prerequisites:{"extended-nozzle":2,"wide-burn":2,"hot-mix":3}, description:"An intense crowd-control cone scorches every target hit.", modifiers:{damage:.45,range:55,coneWidth:22}, flags:["scorched"], visual:"inferno", audio:"flame-heavy" },
] as const;
export const RIFT_EVOLUTION_BY_ID = Object.fromEntries(RIFT_EVOLUTIONS.map(x=>[x.id,x])) as Record<RiftEvolutionId, EvolutionDefinition>;

export function activeEvolution(instance: RiftWeaponInstance): RiftEvolutionId | null {
  return typeof instance.evolution.id === "string" ? instance.evolution.id as RiftEvolutionId : null;
}
export function qualifiesForEvolution(state: RiftRunState, instance: RiftWeaponInstance, evolution: EvolutionDefinition): boolean {
  return !activeEvolution(instance) && instance.weaponId === evolution.sourceWeapon && Object.entries(evolution.prerequisites).every(([id,count])=>upgradeStack(state,id,instance.instanceId)>=count);
}
export function eligibleEvolutions(state: RiftRunState) {
  return occupiedWeapons(state).flatMap(({hardpointIndex,weapon})=>RIFT_EVOLUTIONS.filter(e=>qualifiesForEvolution(state,weapon,e)).map(e=>({definition:e,hardpointIndex,weapon})));
}
