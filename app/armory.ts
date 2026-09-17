/**
 * The Armory: what a pilot owns, and what it costs.
 *
 * Two different purchases, and keeping them apart is the whole design:
 *
 *   - **Unlocking** a payload is permanent and expensive. It is bought once
 *     per account and never spent again.
 *   - **Loading** a payload is cheap and consumable. It puts one copy of an
 *     already-unlocked payload into the inventory the next round starts with,
 *     and the round takes it.
 *
 * So money buys access first and ammunition second, and a pilot who has
 * unlocked the whole catalog still has to decide what to carry into this
 * round. A loadout built and then thought better of refunds in full — the
 * charge lands when the round launches with it, not when the button is
 * pressed, so changing your mind before the launch costs nothing.
 *
 * ## What the shop does not touch
 *
 * The rift's drop table. A locked payload still drops in the arena and is
 * still collectable, exactly as before. The lock is on what a pilot may *buy*
 * into the inventory before the round, not on what the rift is allowed to hand
 * them during it. Gating drops would rewrite the drop tables, the Rift Run
 * payload budget and the Classic reference table all at once, and would make a
 * new account's first run poorer than it has ever been.
 *
 * Only sendable payloads are stocked here. The upgrades, the repair and the
 * rare drops apply themselves the instant they are collected and never enter
 * the inventory at all, so there is no slot for a bought one to sit in.
 *
 * Pure data and pure reducers: no storage, no React, no clock.
 */

import { WEAPONS, type PickupId, type PowerId } from "./game-data.ts";
import { PUP_INVENTORY_CAPACITY } from "./pup-inventory.js";

export const WALLET_VERSION = 1 as const;

/**
 * Everything money has bought, per account.
 *
 * `unlocked` is permanent. `loadout` is this round's shopping basket and is
 * emptied by the launch that carries it into the arena.
 */
export type PilotWallet = {
  version: typeof WALLET_VERSION;
  /** Spendable balance, in whole dollars. */
  credits: number;
  /** Everything ever earned, so the account can show what it has done. */
  lifetimeEarned: number;
  /** Payloads bought outright. Always includes the starter grants. */
  unlocked: PowerId[];
  /** Payloads paid for and waiting to be carried into the next round. */
  loadout: PowerId[];
};

/**
 * What a new account starts with.
 *
 * Enough money to make the first Armory visit a real decision rather than a
 * locked door, and two payloads already granted so a pilot who spends nothing
 * can still launch with something loaded.
 */
export const STARTING_CREDITS = 500;
export const STARTER_UNLOCKS: readonly PowerId[] = ["heatseeker", "mines"];

/** Every payload the Armory stocks, in catalog order. */
export const SHOP_PUPS: readonly PowerId[] = (Object.keys(WEAPONS) as PickupId[]).filter(
  (id): id is PowerId => WEAPONS[id].sendable,
);

/**
 * Price, derived from the threat rating the catalog already carries.
 *
 * One rule rather than fourteen hand-written numbers, so a payload that is
 * rebalanced up a threat tier is repriced by that change instead of drifting
 * away from what it is worth. Threat 1 never occurs among sendables today; it
 * is priced anyway so the table is total.
 */
const UNLOCK_BY_THREAT: Record<number, number> = { 1: 300, 2: 900, 3: 1800 };
const LOAD_BY_THREAT: Record<number, number> = { 1: 25, 2: 75, 3: 150 };

export function pupUnlockCost(id: PowerId): number {
  return UNLOCK_BY_THREAT[WEAPONS[id].threat] ?? UNLOCK_BY_THREAT[3];
}

export function pupLoadCost(id: PowerId): number {
  return LOAD_BY_THREAT[WEAPONS[id].threat] ?? LOAD_BY_THREAT[3];
}

export function newPilotWallet(): PilotWallet {
  return {
    version: WALLET_VERSION,
    credits: STARTING_CREDITS,
    lifetimeEarned: 0,
    unlocked: [...STARTER_UNLOCKS],
    loadout: [],
  };
}

/**
 * The server's view of a wallet: signed out, so nothing owned and nothing to spend.
 *
 * Frozen and shared for the same reason `pilot-progression` freezes its own —
 * `useSyncExternalStore` compares snapshots by identity, and a factory here
 * makes every server render look like a change.
 */
export const EMPTY_WALLET: PilotWallet = Object.freeze({
  version: WALLET_VERSION,
  credits: 0,
  lifetimeEarned: 0,
  unlocked: Object.freeze([]) as unknown as PowerId[],
  loadout: Object.freeze([]) as unknown as PowerId[],
});

function isShopPup(value: unknown): value is PowerId {
  return typeof value === "string" && (SHOP_PUPS as readonly string[]).includes(value);
}

/** Accept whatever storage hands back, and return something the game can fly. */
export function normalizeWallet(value: unknown): PilotWallet {
  const fresh = newPilotWallet();
  if (typeof value !== "object" || value === null) return fresh;
  const record = value as Partial<PilotWallet>;
  const credits = Number(record.credits);
  const lifetime = Number(record.lifetimeEarned);
  const unlocked = Array.isArray(record.unlocked) ? record.unlocked.filter(isShopPup) : [];
  const loadout = Array.isArray(record.loadout) ? record.loadout.filter(isShopPup) : [];
  // Starter grants are re-applied rather than trusted, so an account cannot be
  // left with nothing loadable by a corrupted or hand-edited record.
  const owned = new Set<PowerId>([...STARTER_UNLOCKS, ...unlocked]);
  return {
    version: WALLET_VERSION,
    credits: Number.isFinite(credits) && credits > 0 ? Math.floor(credits) : 0,
    lifetimeEarned: Number.isFinite(lifetime) && lifetime > 0 ? Math.floor(lifetime) : 0,
    unlocked: SHOP_PUPS.filter((id) => owned.has(id)),
    // A loadout can only hold what the account owns, and only up to the one
    // inventory ceiling every mode shares.
    loadout: loadout.filter((id) => owned.has(id)).slice(0, PUP_INVENTORY_CAPACITY),
  };
}

export function isPupUnlocked(wallet: PilotWallet, id: PowerId): boolean {
  return wallet.unlocked.includes(id);
}

/** Room left in the basket. The inventory ceiling is shared with the arena. */
export function loadoutSpace(wallet: PilotWallet): number {
  return Math.max(0, PUP_INVENTORY_CAPACITY - wallet.loadout.length);
}

/** What the basket cost, so it can be refunded exactly. */
export function loadoutValue(wallet: PilotWallet): number {
  return wallet.loadout.reduce((total, id) => total + pupLoadCost(id), 0);
}

/**
 * Every purchase answers the same shape, so the UI has one thing to render and
 * one place to read the reason a button did nothing.
 */
export type PurchaseResult = {
  wallet: PilotWallet;
  ok: boolean;
  /** Player-facing, and the only message the Armory shows. */
  reason: string;
};

const unchanged = (wallet: PilotWallet, reason: string): PurchaseResult => ({ wallet, ok: false, reason });

export function unlockPup(wallet: PilotWallet, id: PowerId): PurchaseResult {
  if (!isShopPup(id)) return unchanged(wallet, "That payload is not stocked.");
  if (isPupUnlocked(wallet, id)) return unchanged(wallet, `${WEAPONS[id].name} is already unlocked.`);
  const cost = pupUnlockCost(id);
  if (wallet.credits < cost) return unchanged(wallet, `Not enough funds for ${WEAPONS[id].name}.`);
  return {
    wallet: {
      ...wallet,
      credits: wallet.credits - cost,
      // Held in catalog order rather than purchase order, so the Armory reads
      // the same on every account.
      unlocked: SHOP_PUPS.filter((pup) => pup === id || isPupUnlocked(wallet, pup)),
    },
    ok: true,
    reason: `${WEAPONS[id].name} unlocked.`,
  };
}

export function loadPup(wallet: PilotWallet, id: PowerId): PurchaseResult {
  if (!isShopPup(id)) return unchanged(wallet, "That payload is not stocked.");
  if (!isPupUnlocked(wallet, id)) return unchanged(wallet, `${WEAPONS[id].name} is locked.`);
  if (loadoutSpace(wallet) <= 0) return unchanged(wallet, "Inventory full.");
  const cost = pupLoadCost(id);
  if (wallet.credits < cost) return unchanged(wallet, `Not enough funds for ${WEAPONS[id].name}.`);
  return {
    wallet: { ...wallet, credits: wallet.credits - cost, loadout: [...wallet.loadout, id] },
    ok: true,
    reason: `${WEAPONS[id].short} loaded.`,
  };
}

/** Take one copy back out of the basket, at the price it went in for. */
export function unloadPup(wallet: PilotWallet, index: number): PurchaseResult {
  const id = wallet.loadout[index];
  if (!id) return unchanged(wallet, "Nothing in that slot.");
  const loadout = wallet.loadout.filter((_, at) => at !== index);
  return {
    wallet: { ...wallet, credits: wallet.credits + pupLoadCost(id), loadout },
    ok: true,
    reason: `${WEAPONS[id].short} refunded.`,
  };
}

export function clearLoadout(wallet: PilotWallet): PurchaseResult {
  if (wallet.loadout.length === 0) return unchanged(wallet, "Inventory already empty.");
  return {
    wallet: { ...wallet, credits: wallet.credits + loadoutValue(wallet), loadout: [] },
    ok: true,
    reason: "Inventory cleared and refunded.",
  };
}

/**
 * Launch: the basket becomes the arena's opening stock and the wallet lets go
 * of what the arena took.
 *
 * Returned as a pair rather than mutated, because the caller needs both halves
 * — the stock to seed the run with, and the wallet to persist — and a run that
 * launched with payloads the account still thinks it is holding would hand
 * them out again on the next launch.
 *
 * `capacity` is the run's real payload ceiling, which is not always the
 * Armory's: a Rift Run opens with a single slot and earns its way up. Anything
 * that does not fit stays bought and stays in the basket for a run that has
 * room, rather than being silently destroyed by launching the wrong mode.
 *
 * The stock is handed over oldest-first, so the last payload bought is the one
 * loaded to fire — the same LIFO the arena applies to a payload collected off
 * the floor.
 */
export function consumeLoadout(
  wallet: PilotWallet,
  capacity: number = PUP_INVENTORY_CAPACITY,
): { wallet: PilotWallet; stock: PowerId[] } {
  const room = Math.max(0, Math.floor(Number.isFinite(capacity) ? capacity : 0));
  if (wallet.loadout.length === 0 || room === 0) return { wallet, stock: [] };
  const stock = wallet.loadout.slice(0, room);
  return { wallet: { ...wallet, loadout: wallet.loadout.slice(room) }, stock };
}

/** Banking a finished run. Both totals move together or neither does. */
export function bankCredits(wallet: PilotWallet, earned: number): PilotWallet {
  const amount = Number.isFinite(earned) && earned > 0 ? Math.floor(earned) : 0;
  if (amount <= 0) return wallet;
  return { ...wallet, credits: wallet.credits + amount, lifetimeEarned: wallet.lifetimeEarned + amount };
}
