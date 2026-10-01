import { personInitials } from "../../../shared/personInitials";

/**
 * Returning-user memory for the sign-in page (J3, J4). The browser keeps the
 * last account's email and name so a person whose session expired sees
 * "Welcome back, Ana" and only types their password. Decision 58: it is
 * kept after a session expires, not after an explicit sign-out (the sign-out
 * handler calls `forgetLastAccount`), and "Use another account" forgets it.
 * Privacy: on a shared computer the next person sees the name and email
 * until they choose "Use another account".
 */
export const LAST_ACCOUNT_KEY = "banhall.lastAccount.v1";
export const LAST_ACCOUNT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

export type LastAccount = {
  email: string;
  name: string | null;
  firstName: string | null;
  initials: string;
  savedAt: number;
};

type AccountSource = {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
};

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

function parse(raw: string | null, now: number): LastAccount | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const email = text(value.email);
    const savedAt = typeof value.savedAt === "number" ? value.savedAt : NaN;
    if (!email || !email.includes("@") || !Number.isFinite(savedAt)) return null;
    if (now - savedAt > LAST_ACCOUNT_MAX_AGE_MS || savedAt > now + 60_000) return null;
    const name = text(value.name);
    const firstName = text(value.firstName);
    return {
      email,
      name,
      firstName,
      initials: text(value.initials) ?? personInitials({ name, email }),
      savedAt,
    };
  } catch {
    return null;
  }
}

export function readLastAccount(now = Date.now()): LastAccount | null {
  const store = storage();
  const account = parse(store?.getItem(LAST_ACCOUNT_KEY) ?? null, now);
  if (!account) store?.removeItem(LAST_ACCOUNT_KEY);
  return account;
}

/**
 * Save the account. A call with only an email (right after sign-in, before
 * the profile loads) keeps the stored name when the email is the same.
 */
export function rememberAccount(user: AccountSource, now = Date.now()): void {
  const store = storage();
  const email = text(user.email)?.toLowerCase();
  if (!store || !email) return;
  const full = [text(user.firstName), text(user.lastName)].filter(Boolean).join(" ");
  let name = full || text(user.name);
  let firstName = text(user.firstName) ?? (name ? name.split(/\s+/)[0] ?? null : null);
  if (!name) {
    const previous = parse(store.getItem(LAST_ACCOUNT_KEY), now);
    if (previous?.email === email) {
      name = previous.name;
      firstName = previous.firstName;
    }
  }
  const account: LastAccount = {
    email,
    name,
    firstName,
    initials: personInitials({
      firstName: user.firstName,
      lastName: user.lastName,
      name,
      email,
    }),
    savedAt: now,
  };
  try {
    store.setItem(LAST_ACCOUNT_KEY, JSON.stringify(account));
  } catch {
    /* storage full or blocked: the sign-in page simply shows J1 */
  }
}

export function forgetLastAccount(): void {
  storage()?.removeItem(LAST_ACCOUNT_KEY);
}
