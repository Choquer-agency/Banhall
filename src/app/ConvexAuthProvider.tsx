"use client";

import { ConvexAuthProvider as ConvexAuthProviderInner } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { Component, ReactNode, useEffect } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

const RECOVERY_FLAG = "banhall_auth_recovered";

/** Errors that mean the stored auth token is stale/unusable and should be cleared. */
function isStaleAuthError(message?: string | null): boolean {
  if (!message) return false;
  return /parse refresh token|invalid refresh token|invalidaccountid|invalid session/i.test(
    message
  );
}

/**
 * Clear cached Convex auth tokens and reload once. Triggered when a stored
 * token can no longer be parsed/validated (e.g. after a backend restart or
 * key rotation) so the app re-authenticates cleanly instead of white-screening.
 * Guarded by a session flag so it can never loop.
 */
function recoverFromStaleAuth(message?: string | null): boolean {
  if (typeof window === "undefined") return false;
  if (!isStaleAuthError(message)) return false;
  if (sessionStorage.getItem(RECOVERY_FLAG)) return false;
  sessionStorage.setItem(RECOVERY_FLAG, "1");
  try {
    Object.keys(localStorage)
      .filter((k) => k.toLowerCase().includes("convexauth"))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
  window.location.reload();
  return true;
}

/** Catches render-time auth errors and self-heals; rethrows anything unrelated. */
class AuthErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    recoverFromStaleAuth(error?.message);
  }

  render() {
    if (this.state.error) {
      if (isStaleAuthError(this.state.error.message)) {
        return (
          <div className="flex min-h-screen flex-1 items-center justify-center bg-canvas">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        );
      }
      throw this.state.error; // not an auth issue — let it surface
    }
    return this.props.children;
  }
}

/** Catches async auth-token rejections (the provider's background refresh). */
function AuthRecoveryListener() {
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e?.reason;
      recoverFromStaleAuth(
        typeof reason === "string" ? reason : reason?.message
      );
    };
    const onError = (e: ErrorEvent) => recoverFromStaleAuth(e?.message);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    // Once we're past initial load without re-erroring, allow future recovery.
    const t = setTimeout(() => sessionStorage.removeItem(RECOVERY_FLAG), 8000);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
      clearTimeout(t);
    };
  }, []);
  return null;
}

export function ConvexAuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthErrorBoundary>
      <AuthRecoveryListener />
      <ConvexAuthProviderInner client={convex}>
        {children}
      </ConvexAuthProviderInner>
    </AuthErrorBoundary>
  );
}
