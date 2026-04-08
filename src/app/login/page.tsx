"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function LoginPage() {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();

  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Auto-login: sign in as shared demo user so testers skip the login form
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) {
      window.location.href = "/dashboard";
      return;
    }
    if (autoLoginAttempted) return;
    setAutoLoginAttempted(true);

    const demoEmail = "demo@banhall.ca";
    const demoPassword = "BanhallDemo2026!";

    signIn("password", { email: demoEmail, password: demoPassword, flow: "signIn" })
      .then((result) => {
        if (result.signingIn) {
          setTimeout(() => { window.location.href = "/dashboard"; }, 800);
        }
      })
      .catch(() => {
        // First time: account doesn't exist yet, so create it
        signIn("password", {
          email: demoEmail,
          password: demoPassword,
          name: "Banhall Team",
          flow: "signUp",
        })
          .then((result) => {
            if (result.signingIn) {
              setTimeout(() => { window.location.href = "/dashboard"; }, 800);
            }
          })
          .catch(() => {
            // Auto-login failed — show the normal login form as fallback
          });
      });
  }, [isAuthenticated, isLoading, autoLoginAttempted, signIn]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const params: Record<string, string> = { email, password, flow: mode };
      if (mode === "signUp") params.name = name;
      const result = await signIn("password", params);
      if (result.signingIn) {
        // Wait for auth state to propagate, then redirect
        setTimeout(() => {
          window.location.href = "/dashboard";
        }, 1000);
      }
    } catch (err) {
      console.error("Auth error:", err);
      setError(
        mode === "signIn"
          ? "Invalid email or password."
          : `Could not create account: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading || (!isAuthenticated && !autoLoginAttempted)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-canvas">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy border-t-transparent" />
        <p className="mt-3 text-sm text-gray-400">Signing you in...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-navy">
            Banhall
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            SR&ED Report Generator
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">
            {mode === "signIn" ? "Welcome back" : "Create account"}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {mode === "signIn"
              ? "Sign in to your account to continue."
              : "Set up your writer account."}
          </p>

          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
            {mode === "signUp" && (
              <Input
                id="name"
                label="Full name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
                required
                autoFocus
              />
            )}
            <Input
              id="email"
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@banhall.ca"
              required
              autoFocus={mode === "signIn"}
            />
            <Input
              id="password"
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={
                mode === "signIn" ? "Enter your password" : "At least 8 characters"
              }
              required
              minLength={8}
            />

            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <Button type="submit" disabled={submitting} className="mt-1">
              {submitting
                ? "Please wait..."
                : mode === "signIn"
                  ? "Sign in"
                  : "Create account"}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => {
                setMode(mode === "signIn" ? "signUp" : "signIn");
                setError("");
              }}
              className="text-sm text-gray-500 hover:text-navy transition-colors"
            >
              {mode === "signIn"
                ? "Need an account? Sign up"
                : "Already have an account? Sign in"}
            </button>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Banhall SR&ED Consulting
        </p>
      </div>
    </div>
  );
}
