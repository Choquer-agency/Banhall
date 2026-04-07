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

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [isAuthenticated, isLoading, router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await signIn("password", {
        email,
        password,
        name: mode === "signUp" ? name : undefined,
        flow: mode,
      });
      router.replace("/dashboard");
    } catch {
      setError(
        mode === "signIn"
          ? "Invalid email or password."
          : "Could not create account. Email may already be in use."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-canvas">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy border-t-transparent" />
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
