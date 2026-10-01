import { beforeEach, describe, expect, it } from "vitest";
import {
  LAST_ACCOUNT_KEY,
  LAST_ACCOUNT_MAX_AGE_MS,
  forgetLastAccount,
  readLastAccount,
  rememberAccount,
} from "./lastAccount";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

const NOW = 1_790_000_000_000;

describe("lastAccount", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
  });

  it("remembers the email, name, first name and initials", () => {
    rememberAccount({ email: " Ana.Ruiz@Banhall.com ", firstName: "Ana", lastName: "Ruiz" }, NOW);
    expect(readLastAccount(NOW)).toEqual({
      email: "ana.ruiz@banhall.com",
      name: "Ana Ruiz",
      firstName: "Ana",
      initials: "AR",
      savedAt: NOW,
    });
  });

  it("keeps the stored name when the same email is saved without one", () => {
    rememberAccount({ email: "ana@banhall.com", firstName: "Ana", lastName: "Ruiz" }, NOW);
    rememberAccount({ email: "ANA@banhall.com" }, NOW + 1);
    expect(readLastAccount(NOW + 1)).toMatchObject({ name: "Ana Ruiz", firstName: "Ana", savedAt: NOW + 1 });
    rememberAccount({ email: "sam@banhall.com" }, NOW + 2);
    expect(readLastAccount(NOW + 2)).toMatchObject({ email: "sam@banhall.com", name: null, firstName: null, initials: "S" });
  });

  it("reads a bad or expired value as no account and clears it", () => {
    localStorage.setItem(LAST_ACCOUNT_KEY, "{not json");
    expect(readLastAccount(NOW)).toBeNull();
    expect(localStorage.getItem(LAST_ACCOUNT_KEY)).toBeNull();

    localStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify({ email: "no-at-sign", savedAt: NOW }));
    expect(readLastAccount(NOW)).toBeNull();

    rememberAccount({ email: "ana@banhall.com", name: "Ana Ruiz" }, NOW);
    expect(readLastAccount(NOW + LAST_ACCOUNT_MAX_AGE_MS)).not.toBeNull();
    expect(readLastAccount(NOW + LAST_ACCOUNT_MAX_AGE_MS + 1)).toBeNull();
  });

  it("forgets the account", () => {
    rememberAccount({ email: "ana@banhall.com" }, NOW);
    forgetLastAccount();
    expect(readLastAccount(NOW)).toBeNull();
  });
});
