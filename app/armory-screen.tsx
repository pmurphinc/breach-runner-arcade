"use client";

/**
 * The Armory.
 *
 * Two purchases on one screen, because they are one decision: what you can
 * carry, and what you are carrying. The catalog on the right sells permanent
 * unlocks; the inventory strip at the top is this round's basket, and it draws
 * exactly the slots the arena will hand the pilot — the same
 * `PUP_INVENTORY_CAPACITY` the HUD paints, so the strip is a preview rather
 * than an analogy.
 *
 * Every price is visible before it is paid and every basket purchase is
 * refundable until the round launches, so the screen can be explored without
 * anyone losing money to a mis-tap.
 *
 * Signed out, this screen sells nothing. There is nowhere to keep it: money is
 * banked against an account, and a shop that took payment into a wallet that
 * evaporates at the end of the session would be worse than a locked door. So
 * the locked door says what it is and offers the way through it.
 */

import { useState } from "react";
import { MenuScreen, MenuSection } from "./ui-system";
import type { MenuCallbacks } from "./main-menu";
import { MenuPupPreview } from "./main-menu";
import { WEAPONS, type PowerId } from "./game-data";
import { PUP_INVENTORY_CAPACITY } from "./pup-inventory";
import { formatCredits } from "./currency";
import type { AccountSession } from "./account";
import {
  SHOP_PUPS,
  clearLoadout,
  isPupUnlocked,
  loadPup,
  loadoutSpace,
  loadoutValue,
  pupLoadCost,
  pupUnlockCost,
  unloadPup,
  unlockPup,
  type PilotWallet,
  type PurchaseResult,
} from "./armory";

export function ArmoryScreen({
  session,
  onWallet,
  onLaunch,
  go,
  openSettings,
  back,
}: MenuCallbacks & {
  session: AccountSession;
  /** Applies a reducer to the signed-in pilot's wallet. False when signed out. */
  onWallet: (change: (wallet: PilotWallet) => PilotWallet) => boolean;
  /** Optional shortcut straight into a round with what was just bought. */
  onLaunch?: () => void;
}) {
  const [notice, setNotice] = useState("");
  const wallet = session.wallet;

  const apply = (change: (wallet: PilotWallet) => PurchaseResult) => {
    let message = "";
    const saved = onWallet((current) => {
      const result = change(current);
      message = result.reason;
      return result.wallet;
    });
    setNotice(saved ? message : "Sign in to spend or earn money.");
  };

  if (!session.account) {
    return (
      <MenuScreen
        route="armory"
        onOpenSettings={openSettings}
        title="Armory"
        eyebrow="SUPPLY // ACCOUNT REQUIRED"
        onBack={back}
        footer={
          <button type="button" className="play-button" onClick={() => go("account")}>
            Sign in or create an account
          </button>
        }
      >
        <MenuSection title="No pilot signed in">
          <p className="menu-hint">
            Money is banked against an account, so the Armory needs one before it can sell anything.
            Runs flown signed out still play in full — they simply bank nothing and save no score.
          </p>
        </MenuSection>
      </MenuScreen>
    );
  }

  const space = loadoutSpace(wallet);
  const basket = loadoutValue(wallet);

  return (
    <MenuScreen
      route="armory"
      onOpenSettings={openSettings}
      title="Armory"
      eyebrow="SUPPLY // SPEND WHAT YOU EARNED"
      onBack={back}
      wide
      footer={
        onLaunch ? (
          <button type="button" className="play-button" onClick={onLaunch}>
            Launch with this inventory
          </button>
        ) : undefined
      }
    >
      <div className="armory-balance" role="status" aria-live="polite">
        <span className="menu-stage-kicker">BALANCE</span>
        <b className="armory-credits">{formatCredits(wallet.credits)}</b>
        <small>Lifetime earned {formatCredits(wallet.lifetimeEarned)}</small>
      </div>

      {notice ? <p className="run-status armory-notice" role="status">{notice}</p> : null}

      <MenuSection
        title="Round inventory"
        hint={`Bought payloads are carried into the next round and used up by it. ${space} of ${PUP_INVENTORY_CAPACITY} slots free.`}
      >
        <div className="armory-loadout" aria-label="Payloads loaded for the next round">
          {Array.from({ length: PUP_INVENTORY_CAPACITY }, (_, slot) => {
            const id = wallet.loadout[slot];
            if (!id) {
              return (
                <div key={slot} className="armory-slot empty" aria-label={`Slot ${slot + 1}, empty`}>
                  <span aria-hidden="true">·</span>
                  <small>EMPTY</small>
                </div>
              );
            }
            return (
              <button
                key={slot}
                type="button"
                className="armory-slot filled"
                onClick={() => apply((current) => unloadPup(current, slot))}
                aria-label={`Slot ${slot + 1}, ${WEAPONS[id].name}. Refund ${formatCredits(pupLoadCost(id))}.`}
              >
                <MenuPupPreview pup={id} size={52} />
                <b>{WEAPONS[id].short}</b>
                <small>REFUND {formatCredits(pupLoadCost(id))}</small>
              </button>
            );
          })}
        </div>
        <div className="armory-loadout-actions">
          <span className="menu-footnote">Inventory value {formatCredits(basket)}</span>
          <button
            type="button"
            className="run-action"
            disabled={wallet.loadout.length === 0}
            onClick={() => apply(clearLoadout)}
          >
            CLEAR AND REFUND
          </button>
        </div>
      </MenuSection>

      <MenuSection
        title="Payload catalog"
        hint="Unlocking is permanent. Loading buys one copy for the next round."
      >
        <div className="armory-catalog">
          {SHOP_PUPS.map((id: PowerId) => {
            const meta = WEAPONS[id];
            const owned = isPupUnlocked(wallet, id);
            const unlockCost = pupUnlockCost(id);
            const loadCost = pupLoadCost(id);
            const carried = wallet.loadout.filter((held) => held === id).length;
            return (
              <article key={id} className={`armory-card ${owned ? "owned" : "locked"}`} data-pup={id}>
                <span className="armory-card-art" aria-hidden="true"><MenuPupPreview pup={id} size={56} /></span>
                <div className="armory-card-copy">
                  <b>{meta.name}</b>
                  <small>{meta.summary}</small>
                  <span className="armory-card-tags">
                    <i>THREAT {meta.threat}</i>
                    {carried > 0 ? <i className="carried">×{carried} LOADED</i> : null}
                  </span>
                </div>
                <div className="armory-card-actions">
                  {owned ? (
                    <button
                      type="button"
                      className="armory-buy"
                      disabled={space <= 0 || wallet.credits < loadCost}
                      onClick={() => apply((current) => loadPup(current, id))}
                    >
                      LOAD {formatCredits(loadCost)}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="armory-unlock"
                      disabled={wallet.credits < unlockCost}
                      onClick={() => apply((current) => unlockPup(current, id))}
                    >
                      UNLOCK {formatCredits(unlockCost)}
                    </button>
                  )}
                  {/* An owned payload needs no caption: the button says LOAD
                      and names the price. A locked one needs the second price,
                      so the unlock can be judged against what it then costs to
                      keep carrying. */}
                  {owned ? null : <small>then {formatCredits(loadCost)} per copy</small>}
                </div>
              </article>
            );
          })}
        </div>
      </MenuSection>
    </MenuScreen>
  );
}
