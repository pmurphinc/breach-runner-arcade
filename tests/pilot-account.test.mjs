/**
 * Accounts, and what depends on having one.
 *
 * The store is exercised against an in-memory storage rather than a browser,
 * which is the whole reason it takes one: the credential path, the session
 * restore and the wallet gate are all decidable without rendering anything.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MIN_PASSWORD_LENGTH,
  createAccountStore,
  normalizeAccountInitials,
  parseAccounts,
  validateEmail,
  validateInitials,
  validatePassword,
} from "../app/account.ts";
import { bankCredits } from "../app/armory.ts";

const game = readFileSync(new URL("../app/game.tsx", import.meta.url), "utf8");

function memoryStorage() {
  const cells = new Map();
  return {
    getItem: (key) => (cells.has(key) ? cells.get(key) : null),
    setItem: (key, value) => cells.set(key, value),
    removeItem: (key) => cells.delete(key),
    cells,
  };
}

const CREDENTIALS = { email: "pilot@example.com", password: "orbital-decay-7", initials: "ace" };

test("creating an account signs the pilot in and gives them a wallet", async () => {
  const store = createAccountStore(memoryStorage());
  assert.equal(store.getSnapshot().account, null, "a fresh device is signed out");

  const result = await store.signUp(CREDENTIALS);
  assert.equal(result.ok, true);
  const { account, wallet } = store.getSnapshot();
  assert.equal(account.email, "pilot@example.com");
  assert.equal(account.initials, "ACE", "initials are normalized to the arcade form");
  assert.equal(account.developer, false);
  assert.ok(wallet.credits > 0, "a new pilot can afford something");
  assert.ok(wallet.unlocked.length > 0, "and owns something to load");
});

test("the stored record never holds the password", async () => {
  const storage = memoryStorage();
  const store = createAccountStore(storage);
  await store.signUp(CREDENTIALS);
  const raw = [...storage.cells.values()].join("|");
  assert.ok(!raw.includes(CREDENTIALS.password), "the password does not appear in storage");
  const [stored] = parseAccounts(storage.cells.get("breach-runner:accounts:v1"));
  assert.ok(stored.salt.length >= 16, "a per-account salt");
  assert.ok(stored.hash.length >= 32, "and a derived hash");
  assert.notEqual(stored.hash, stored.salt);
});

test("a wrong password is rejected, and says nothing about which emails exist", async () => {
  const store = createAccountStore(memoryStorage());
  await store.signUp(CREDENTIALS);
  store.signOut();

  const wrong = await store.signIn({ email: CREDENTIALS.email, password: "not-it-at-all" });
  const missing = await store.signIn({ email: "nobody@example.com", password: CREDENTIALS.password });
  assert.equal(wrong.ok, false);
  assert.equal(missing.ok, false);
  assert.equal(wrong.message, missing.message, "one message, so the form is not an account oracle");
  assert.equal(store.getSnapshot().account, null);

  const right = await store.signIn({ email: "  PILOT@example.com ", password: CREDENTIALS.password });
  assert.equal(right.ok, true, "email matching ignores case and surrounding space");
});

test("an account, its money and its unlocks survive a reload", async () => {
  const storage = memoryStorage();
  const first = createAccountStore(storage);
  await first.signUp(CREDENTIALS);
  first.updateWallet((wallet) => bankCredits(wallet, 1200));
  const expected = first.getSnapshot().wallet.credits;

  const second = createAccountStore(storage);
  assert.equal(second.getSnapshot().account?.email, CREDENTIALS.email, "the session is restored");
  assert.equal(second.getSnapshot().wallet.credits, expected);
});

test("the project owner's account carries developer access", async () => {
  const store = createAccountStore(memoryStorage());
  await store.signUp({ email: "pmurphinc@gmail.com", password: "rift-runner-dev", initials: "PJM" });
  assert.equal(store.getSnapshot().account.developer, true);
});

test("developer access is derived from the email, not read from storage", async () => {
  const storage = memoryStorage();
  const store = createAccountStore(storage);
  await store.signUp(CREDENTIALS);
  // Hand-edit the stored record the way anyone holding the device could.
  const forged = JSON.parse(storage.cells.get("breach-runner:accounts:v1"));
  forged[0].developer = true;
  storage.cells.set("breach-runner:accounts:v1", JSON.stringify(forged));

  const reloaded = createAccountStore(storage);
  assert.equal(reloaded.getSnapshot().account.developer, false, "the flag is re-derived on read");
});

test("signed out, there is no wallet to change", () => {
  const store = createAccountStore(memoryStorage());
  assert.equal(store.updateWallet((wallet) => bankCredits(wallet, 500)), false);
  assert.equal(store.getSnapshot().wallet.credits, 0);
});

test("signing out leaves the account behind and can be undone", async () => {
  const store = createAccountStore(memoryStorage());
  await store.signUp(CREDENTIALS);
  store.signOut();
  assert.equal(store.getSnapshot().account, null);
  assert.equal(store.hasAccounts(), true, "the form leads with Sign in next time");
  assert.equal((await store.signIn(CREDENTIALS)).ok, true);
});

test("input is validated before anything is stored", () => {
  assert.ok(validateEmail("not-an-email"));
  assert.equal(validateEmail("pilot@example.com"), null);
  assert.ok(validatePassword("short"));
  assert.equal(validatePassword("x".repeat(MIN_PASSWORD_LENGTH)), null);
  assert.ok(validateInitials("ab"));
  assert.equal(validateInitials("a1z"), null);
  assert.equal(normalizeAccountInitials("a-b c d"), "ABC");
});

test("a run flown signed out is played and settled, but never saved", () => {
  // The gate is one branch, taken before any board is touched, and the card
  // reports it rather than claiming the run was saved on this device.
  assert.match(game, /const banked = signedIn;/);
  assert.match(game, /if \(!signedIn\) \{[\s\S]*?setSaveState\(\{ status: "idle" \}\);\s*return;/);
  assert.match(game, /const storedInitials = signedIn \? settings\.playerInitials : "";/);
  assert.match(game, /NOT SIGNED IN \/\/ SCORE NOT SAVED/);
  assert.match(game, /\{summary\.banked \? \(<>/, "the save-state chain only renders for a saved run");
});
