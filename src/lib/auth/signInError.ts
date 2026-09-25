/**
 * The login form's error message for a failed Better Auth sign-in.
 *
 * Better Auth resolves a failed request with `{ error: { status, code,
 * message } }`. Only credential failures should blame the email or password.
 * A 403 origin rejection (signing in from 127.0.0.1, a LAN IP or any address
 * missing from the trusted origins) means the address is wrong, not the
 * password.
 */

export type SignInFailure = {
  status?: number;
  code?: string;
};

// Better Auth's origin-check codes (better-auth/dist/api/middlewares/origin-check).
const ORIGIN_ERROR_CODES = new Set([
  "INVALID_ORIGIN",
  "MISSING_OR_NULL_ORIGIN",
  "CROSS_SITE_NAVIGATION_LOGIN_BLOCKED",
]);

export const SIGN_IN_MESSAGES = {
  credentials: "Check your @banhall.com email address and password.",
  offline: "You're offline. Reconnect and try signing in again.",
  origin: "Open Banhall at its usual address to sign in.",
  rateLimited: "Too many sign-in attempts. Wait a minute, then try again.",
} as const;

export function signInErrorMessage(
  failure: SignInFailure | null | undefined,
  { online }: { online: boolean },
): string {
  if (!online) return SIGN_IN_MESSAGES.offline;
  if (failure?.code && ORIGIN_ERROR_CODES.has(failure.code)) return SIGN_IN_MESSAGES.origin;
  if (failure?.status === 429) return SIGN_IN_MESSAGES.rateLimited;
  return SIGN_IN_MESSAGES.credentials;
}

/** Thrown by the login form's sign-in call so the status and code survive. */
export class SignInError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(failure: { message?: string; status?: number; code?: string }) {
    super(failure.message || "Sign-in failed");
    this.name = "SignInError";
    this.status = failure.status;
    this.code = failure.code;
  }
}
