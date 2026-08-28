import type { RiftShipClass, RiftWeaponId } from "./types";

export const RIFT_RUN_TITLE = "RIFT RUN";
export const RIFT_RUN_TAGLINE = "A Roguelite Game Mode";
export const RIFT_RUN_DESCRIPTION =
  "Enter the Rift, mount weapons, evolve your ship, clear escalating sectors, and push deeper for greater rewards.";

export const STARTING_WEAPON: RiftWeaponId = "standard-cannon";

export const RIFT_SHIP_CLASSES: Record<RiftShipClass, {
  label: string;
  maximumHardpoints: 1 | 2 | 3;
  mobility: "highest" | "balanced" | "lowest";
  durability: "lowest" | "balanced" | "highest";
}> = {
  light: { label: "Light", maximumHardpoints: 1, mobility: "highest", durability: "lowest" },
  medium: { label: "Medium", maximumHardpoints: 2, mobility: "balanced", durability: "balanced" },
  heavy: { label: "Heavy", maximumHardpoints: 3, mobility: "lowest", durability: "highest" },
};
