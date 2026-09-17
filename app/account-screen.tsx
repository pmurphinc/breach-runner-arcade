"use client";

/**
 * Sign in, or create a pilot account.
 *
 * One screen with two modes rather than two screens, because the answer to
 * "have you been here before?" is the only thing that differs and a player who
 * guesses wrong should not have to navigate to correct it. The form leads with
 * Create when the device has never held an account and with Sign in when it
 * has, which is right almost every time and costs one tap when it is not.
 *
 * Nothing here blocks play. The screen is reached from Home and from the
 * result card, and both of those are offers: a signed-out pilot still flies,
 * still sees their score settled, and is told plainly what signing in would
 * have kept.
 */

import { useState, type FormEvent } from "react";
import { MenuScreen, MenuSection } from "./ui-system";
import type { MenuCallbacks } from "./main-menu";
import { formatCredits } from "./currency";
import {
  MIN_PASSWORD_LENGTH,
  accountStore,
  normalizeAccountInitials,
  type AccountSession,
} from "./account";
import { SHOP_PUPS } from "./armory";

type Panel = "sign-in" | "create";

export function AccountScreen({
  session,
  go,
  openSettings,
  back,
}: MenuCallbacks & { session: AccountSession }) {
  // A device that already holds an account is almost always a returning pilot.
  const [panel, setPanel] = useState<Panel>(() => (accountStore.hasAccounts() ? "sign-in" : "create"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [initials, setInitials] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const account = session.account;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const result =
      panel === "create"
        ? await accountStore.signUp({ email, password, initials })
        : await accountStore.signIn({ email, password });
    setBusy(false);
    if (result.ok) {
      // The password is dropped the instant it stops being needed rather than
      // left sitting in component state for the life of the screen.
      setPassword("");
      setEmail("");
      setInitials("");
      return;
    }
    setError(result.message);
  };

  if (account) {
    const unlocked = session.wallet.unlocked.length;
    return (
      <MenuScreen
        route="account"
        onOpenSettings={openSettings}
        title="Pilot Account"
        eyebrow="IDENTITY // SIGNED IN"
        onBack={back}
        footer={
          <button type="button" className="play-button" onClick={() => go("armory")}>
            Open the Armory
          </button>
        }
      >
        <MenuSection title="Signed in" hint="Scores and money are saved against this account.">
          <dl className="control-list account-summary">
            <div><dt>Email</dt><dd>{account.email}</dd></div>
            <div><dt>Initials</dt><dd>{account.initials}</dd></div>
            <div><dt>Balance</dt><dd>{formatCredits(session.wallet.credits)}</dd></div>
            <div><dt>Lifetime earned</dt><dd>{formatCredits(session.wallet.lifetimeEarned)}</dd></div>
            <div><dt>Payloads unlocked</dt><dd>{unlocked} / {SHOP_PUPS.length}</dd></div>
            {account.developer ? <div><dt>Access</dt><dd>Developer · every mode unlocked</dd></div> : null}
          </dl>
        </MenuSection>
        <MenuSection title="Session">
          <p className="menu-hint">
            Signing out leaves the account on this device. Runs flown signed out are played and
            settled as usual, but nothing is written to a board and nothing is banked.
          </p>
          <button type="button" className="run-action" onClick={() => accountStore.signOut()}>
            SIGN OUT
          </button>
        </MenuSection>
      </MenuScreen>
    );
  }

  const creating = panel === "create";

  return (
    <MenuScreen
      route="account"
      onOpenSettings={openSettings}
      title={creating ? "Create Account" : "Sign In"}
      eyebrow="IDENTITY // REQUIRED TO SAVE SCORES"
      onBack={back}
    >
      <MenuSection
        title={creating ? "New pilot" : "Returning pilot"}
        hint="An account keeps your scores, your money and everything you have unlocked."
      >
        <div className="account-panel-switch" role="tablist" aria-label="Account action">
          <button
            type="button"
            role="tab"
            aria-selected={!creating}
            className={creating ? "" : "active"}
            onClick={() => { setPanel("sign-in"); setError(""); }}
          >
            SIGN IN
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={creating}
            className={creating ? "active" : ""}
            onClick={() => { setPanel("create"); setError(""); }}
          >
            CREATE ACCOUNT
          </button>
        </div>

        <form className="account-form" onSubmit={submit}>
          <label htmlFor="account-email">Email</label>
          <input
            id="account-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <label htmlFor="account-password">Password</label>
          <input
            id="account-password"
            type="password"
            autoComplete={creating ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby={creating ? "account-password-help" : undefined}
          />
          {creating ? (
            <small id="account-password-help">At least {MIN_PASSWORD_LENGTH} characters.</small>
          ) : null}

          {creating ? (
            <>
              <label htmlFor="account-initials">Board initials</label>
              <input
                id="account-initials"
                value={initials}
                maxLength={3}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setInitials(normalizeAccountInitials(event.target.value))}
                aria-describedby="account-initials-help"
              />
              <small id="account-initials-help">Three letters or numbers. This is how you appear on the boards.</small>
            </>
          ) : null}

          {error ? <p className="run-status warn" role="alert">{error}</p> : null}

          <button type="submit" className="play-button" disabled={busy}>
            {busy ? "WORKING…" : creating ? "Create account" : "Sign in"}
          </button>
        </form>
      </MenuSection>

      <MenuSection title="What an account is for">
        <ul className="account-benefits">
          <li>Scores are written to the device and global boards.</li>
          <li>Money earned in a run is banked instead of discarded.</li>
          <li>Unlocked payloads and the pre-round loadout stay with you.</li>
        </ul>
        <p className="menu-hint">
          Accounts are stored on this device while the game runs without a backend. Do not reuse a
          password you use anywhere else.
        </p>
      </MenuSection>
    </MenuScreen>
  );
}
