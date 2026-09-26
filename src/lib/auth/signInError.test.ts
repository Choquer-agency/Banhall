import { describe, expect, it } from "vitest";
import { SIGN_IN_MESSAGES, SignInError, signInErrorKind, signInErrorMessage } from "./signInError";

const online = { online: true };

describe("sign-in error message", () => {
  it("says to use the usual address for an origin rejection", () => {
    // 127.0.0.1 or a LAN address: {"message":"Invalid origin","code":"INVALID_ORIGIN"}, 403.
    expect(signInErrorMessage({ status: 403, code: "INVALID_ORIGIN" }, online)).toBe(
      "Open Banhall at its usual address to sign in.",
    );
    expect(signInErrorMessage({ status: 403, code: "MISSING_OR_NULL_ORIGIN" }, online)).toBe(SIGN_IN_MESSAGES.origin);
    expect(SIGN_IN_MESSAGES.origin).not.toMatch(/password/i);
  });

  it("never says which field was wrong for wrong credentials (J2)", () => {
    expect(signInErrorMessage({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" }, online)).toBe(
      "Wrong email or password. Check both and try again.",
    );
    expect(signInErrorMessage(null, online)).toBe(SIGN_IN_MESSAGES.credentials);
    expect(signInErrorKind({ status: 401 }, online)).toBe("credentials");
  });

  it("blames only the password when the account is already known (J4)", () => {
    expect(signInErrorMessage({ status: 401 }, { online: true, knownAccount: true })).toBe(
      "Wrong password. Try again.",
    );
    expect(signInErrorMessage({ status: 429 }, { online: true, knownAccount: true })).toBe(
      SIGN_IN_MESSAGES.rateLimited,
    );
    expect(signInErrorKind({ status: 429 }, online)).toBe("rateLimited");
    expect(signInErrorKind(null, { online: false })).toBe("offline");
  });

  it("says so when offline or rate limited", () => {
    expect(signInErrorMessage({ status: 403, code: "INVALID_ORIGIN" }, { online: false })).toBe(SIGN_IN_MESSAGES.offline);
    expect(signInErrorMessage({ status: 429 }, online)).toBe(SIGN_IN_MESSAGES.rateLimited);
  });

  it("keeps status and code on the thrown error", () => {
    const error = new SignInError({ status: 403, code: "INVALID_ORIGIN", message: "Invalid origin" });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Invalid origin");
    expect(signInErrorMessage(error, online)).toBe(SIGN_IN_MESSAGES.origin);
  });
});
