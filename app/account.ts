/**
 * Pilot accounts.
 *
 * Two things now need an identity rather than a device: a score that counts,
 * and a wallet that persists. Both used to be device-local and anonymous —
 * three initials typed at the end of a run — which meant a score belonged to a
 * browser profile and money would have belonged to one too. Clearing site data
 * or opening the game on a phone started a pilot over.
 *
 * So scores are saved against an account, and refusing to sign in is not a
 * failure state: the run is still played, still settled, still shown on the
 * result card. It is simply not written to any board, and the card says so and
 * offers the way to fix it. Nothing about gameplay is gated on an account.
 *
 * ## Where the account lives
 *
 * On the device, for now. This deployment has no database binding — `.openai/
 * hosting.json` sets `d1` to null and the public boards are an external API
 * that takes initials and no identity at all — so there is nothing to register
 * an account *with* yet. What this module does is own the shape of one: the
 * record, the credential check, the session, and every call site that asks
 * "who is this?". Moving it to a server is then replacing the three storage
 * functions at the bottom of this file, not finding every place in the game
 * that assumed a device.
 *
 * Because of that, the credential handling here is honest about what it is:
 * PBKDF2-SHA-256 over a per-account random salt, so a stored record never
 * holds a password in the clear and two pilots who choose the same password do
 * not produce the same record. That is worth doing and it is not a substitute
 * for a server. A local record can be read and edited by whoever holds the
 * device, and this file does not pretend otherwise — nothing of value is
 * defended by it, only made tidy enough to hand to a real backend later.
 */

import { isDeveloperEmail } from "./mode-access.ts";
import { EMPTY_WALLET, newPilotWallet, normalizeWallet, type PilotWallet } from "./armory.ts";

export const ACCOUNTS_KEY = "breach-runner:accounts:v1";
export const SESSION_KEY = "breach-runner:session:v1";
export const ACCOUNT_VERSION = 1 as const;

/** How many PBKDF2 rounds a sign-in pays for. */
const KDF_ITERATIONS = 150_000;
const KDF_HASH = "SHA-256";
const KDF_BITS = 256;

/** What the rest of the game is allowed to see about a pilot. */
export type PilotAccount = {
  id: string;
  /** Normalized to lower case; the identity a sign-in is matched on. */
  email: string;
  /** Three arcade characters, reused as the pilot's board initials. */
  initials: string;
  createdAt: number;
  /** Set from `mode-access`, so the whole roster is reachable for testing. */
  developer: boolean;
};

/** The record as stored: the account, its credential, and its money. */
export type StoredAccount = PilotAccount & {
  version: typeof ACCOUNT_VERSION;
  salt: string;
  hash: string;
  wallet: PilotWallet;
};

/** Signed in, or not. The wallet is always present so no caller needs a null check. */
export type AccountSession = {
  account: PilotAccount | null;
  wallet: PilotWallet;
};

export const SIGNED_OUT: AccountSession = Object.freeze({ account: null, wallet: EMPTY_WALLET });

/* ------------------------------------------------------------ validation -- */

/**
 * Deliberately permissive.
 *
 * An address is checked for the shape that makes it usable — one @, something
 * either side, a dot in the domain — and not against a regular expression
 * claiming to implement RFC 5322. Over-strict address validation rejects real
 * addresses, and this one is a login key rather than something we post mail
 * to.
 */
export function validateEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return "Enter your email address.";
  if (email.length > 254) return "That email address is too long.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "That does not look like an email address.";
  return null;
}

export const MIN_PASSWORD_LENGTH = 8;

export function validatePassword(value: string): string | null {
  if (!value) return "Choose a password.";
  if (value.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (value.length > 256) return "That password is too long.";
  return null;
}

/** Same rule the arcade boards have always used: three characters, A–Z and 0–9. */
export function normalizeAccountInitials(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
}

export function validateInitials(value: string): string | null {
  return normalizeAccountInitials(value).length === 3 ? null : "Pick three letters or numbers.";
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/* ------------------------------------------------------------ credentials -- */

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (const byte of view) out += byte.toString(16).padStart(2, "0");
  return out;
}

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error("This browser cannot create accounts: Web Crypto is unavailable.");
  return api;
}

export function createSalt(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await subtle().importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle().deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: KDF_ITERATIONS, hash: KDF_HASH },
    key,
    KDF_BITS,
  );
  return toHex(bits);
}

/**
 * Compare in constant time.
 *
 * A local check that an attacker with the device could simply edit around, so
 * this buys nothing here — it is written this way because the same function is
 * what a server implementation would call, and a timing-safe comparison that
 * only exists on the server is one that gets forgotten when the code moves.
 */
export function credentialsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

export function createAccountId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return random;
  return `acct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* --------------------------------------------------------------- records -- */

export function publicAccount(stored: StoredAccount): PilotAccount {
  return {
    id: stored.id,
    email: stored.email,
    initials: stored.initials,
    createdAt: stored.createdAt,
    // Re-derived on every read rather than trusted from storage, so editing
    // the stored record cannot grant the developer roster.
    developer: isDeveloperEmail(stored.email),
  };
}

export function normalizeStoredAccount(value: unknown): StoredAccount | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Partial<StoredAccount>;
  const email = typeof record.email === "string" ? normalizeEmail(record.email) : "";
  if (!email || typeof record.salt !== "string" || typeof record.hash !== "string") return null;
  const createdAt = Number(record.createdAt);
  return {
    version: ACCOUNT_VERSION,
    id: typeof record.id === "string" && record.id ? record.id : createAccountId(),
    email,
    initials: normalizeAccountInitials(typeof record.initials === "string" ? record.initials : ""),
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    developer: isDeveloperEmail(email),
    salt: record.salt,
    hash: record.hash,
    wallet: normalizeWallet(record.wallet),
  };
}

export function parseAccounts(raw: string | null): StoredAccount[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeStoredAccount).filter((account): account is StoredAccount => account !== null);
  } catch {
    return [];
  }
}

/* ----------------------------------------------------------------- store -- */

export type SignUpInput = { email: string; password: string; initials: string };
export type SignInInput = { email: string; password: string };
export type AuthResult = { ok: true; account: PilotAccount } | { ok: false; message: string };

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The account store.
 *
 * A `useSyncExternalStore` source, so every screen that shows a balance or a
 * sign-in state reads the same snapshot and re-renders together. The snapshot
 * is replaced rather than mutated for the same reason: identity comparison is
 * how React decides anything changed.
 */
export function createAccountStore(storage: StorageLike | null = browserStorage()) {
  let accounts: StoredAccount[] = [];
  let snapshot: AccountSession = SIGNED_OUT;
  const listeners = new Set<() => void>();

  function safeRead(key: string): string | null {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  function safeWrite(key: string, value: string) {
    try {
      storage?.setItem(key, value);
    } catch {
      /* Storage can be full or disabled; the session stays live for this tab. */
    }
  }

  function persistAccounts() {
    safeWrite(ACCOUNTS_KEY, JSON.stringify(accounts));
  }

  function find(email: string): StoredAccount | undefined {
    return accounts.find((account) => account.email === normalizeEmail(email));
  }

  function publish(stored: StoredAccount | null) {
    snapshot = stored ? { account: publicAccount(stored), wallet: stored.wallet } : SIGNED_OUT;
    listeners.forEach((listener) => listener());
  }

  function restore() {
    const id = safeRead(SESSION_KEY);
    const stored = id ? accounts.find((account) => account.id === id) ?? null : null;
    snapshot = stored ? { account: publicAccount(stored), wallet: stored.wallet } : SIGNED_OUT;
  }

  try {
    accounts = parseAccounts(storage?.getItem(ACCOUNTS_KEY) ?? null);
  } catch {
    /* Storage can be disabled entirely; the game still runs signed out. */
  }
  restore();

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => SIGNED_OUT,

    /** Whether any account exists on this device, so the form can lead with the right tab. */
    hasAccounts: () => accounts.length > 0,

    async signUp({ email, password, initials }: SignUpInput): Promise<AuthResult> {
      const emailError = validateEmail(email);
      if (emailError) return { ok: false, message: emailError };
      const passwordError = validatePassword(password);
      if (passwordError) return { ok: false, message: passwordError };
      const initialsError = validateInitials(initials);
      if (initialsError) return { ok: false, message: initialsError };
      const normalized = normalizeEmail(email);
      if (find(normalized)) return { ok: false, message: "An account already exists for that email. Sign in instead." };

      const salt = createSalt();
      const stored: StoredAccount = {
        version: ACCOUNT_VERSION,
        id: createAccountId(),
        email: normalized,
        initials: normalizeAccountInitials(initials),
        createdAt: Date.now(),
        developer: isDeveloperEmail(normalized),
        salt,
        hash: await hashPassword(password, salt),
        wallet: newPilotWallet(),
      };
      accounts = [...accounts, stored];
      persistAccounts();
      safeWrite(SESSION_KEY, stored.id);
      publish(stored);
      return { ok: true, account: publicAccount(stored) };
    },

    async signIn({ email, password }: SignInInput): Promise<AuthResult> {
      const stored = find(email);
      // One message for a missing account and a wrong password, so the form
      // does not report which addresses are registered.
      const rejection: AuthResult = { ok: false, message: "That email and password do not match an account." };
      if (!stored) return rejection;
      const hash = await hashPassword(password, stored.salt);
      if (!credentialsMatch(hash, stored.hash)) return rejection;
      safeWrite(SESSION_KEY, stored.id);
      publish(stored);
      return { ok: true, account: publicAccount(stored) };
    },

    signOut() {
      try {
        storage?.removeItem(SESSION_KEY);
      } catch {
        /* Same as above: the sign-out still applies to this session. */
      }
      publish(null);
    },

    /**
     * Change the signed-in pilot's money.
     *
     * A reducer rather than a setter, because every caller is transforming the
     * wallet it just read and a setter invites two of them to race on a stale
     * copy. Signed out, this is a no-op and reports it — that is the whole of
     * "you must be signed in to keep what you earned".
     */
    updateWallet(change: (wallet: PilotWallet) => PilotWallet): boolean {
      const id = snapshot.account?.id;
      if (!id) return false;
      const index = accounts.findIndex((account) => account.id === id);
      if (index < 0) return false;
      const next = normalizeWallet(change(accounts[index].wallet));
      accounts = accounts.map((account, at) => (at === index ? { ...account, wallet: next } : account));
      persistAccounts();
      publish(accounts[index]);
      return true;
    },
  };
}

export const accountStore = createAccountStore();
export type AccountStore = ReturnType<typeof createAccountStore>;
