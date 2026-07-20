<script lang="ts">
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { authClient } from "$lib/authClient";
  import { page } from "$app/state";
  import Button from "$lib/components/ui/Button.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import BuildStamp from "$lib/components/BuildStamp.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";

  const auth = useAuth();
  const manualLogin = $derived(page.url.searchParams.get("manual") === "1");

  async function signInEmail(email: string, password: string) {
    const { error } = await authClient.signIn.email({ email, password });
    if (error) throw new Error(error.message ?? "Sign-in failed");
  }

  let email = $state("");
  let password = $state("");
  let error = $state("");
  let submitting = $state(false);

  // Auto-login: sign in as shared demo user so testers skip the login form
  let autoLoginAttempted = $state(false);

  $effect(() => {
    if (auth.isLoading) return;
    if (auth.isAuthenticated) {
      window.location.href = "/dashboard";
      return;
    }
    if (manualLogin || autoLoginAttempted) return;
    autoLoginAttempted = true;

    const demoEmail = "demo@banhall.ca";
    const demoPassword = "Test12345";

    // demo@ is a permanent account (recreated post-Better-Auth migration);
    // no signUp fallback — signups are invite-only.
    signInEmail(demoEmail, demoPassword)
      .then(() => {
        setTimeout(() => { window.location.href = "/dashboard"; }, 800);
      })
      .catch(() => {
        // Auto-login failed — show the normal login form as fallback
      });
  });

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    submitting = true;

    try {
      await signInEmail(email, password);
      // Wait for auth state to propagate, then redirect
      setTimeout(() => {
        window.location.href = "/dashboard";
      }, 1000);
    } catch (err) {
      console.error("Auth error:", err);
      error = "Invalid email or password.";
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Sign in — Banhall</title>
</svelte:head>

{#if auth.isLoading || (!auth.isAuthenticated && !manualLogin && !autoLoginAttempted)}
  <div class="flex flex-1 flex-col items-center justify-center bg-canvas">
    <Spinner />
    <p class="mt-3 text-sm text-gray-500">Signing you in...</p>
  </div>
{:else}
  <div class="flex min-h-screen flex-1 flex-col items-center justify-center px-4 py-10">
    <!-- Card: logo on the fir brand tile, centered header, form -->
    <div class="login-card card w-full max-w-sm p-8 shadow-sm">
      <div class="flex flex-col items-center text-center">
        <!-- Logo tile: the mark ships white via the same invert AppNav uses,
             seated on the brand fir so it reads on the white card. -->
        <div class="flex h-16 w-16 items-center justify-center rounded-xl bg-navy">
          <img
            src="/logo.png"
            alt="Banhall"
            width="112"
            height="50"
            class="w-12 brightness-0 invert"
          />
        </div>
        <h1 class="mt-5 text-2xl font-semibold tracking-tight text-gray-900">
          Welcome back
        </h1>
        <p class="mt-1.5 text-sm text-gray-600">
          Enter your credentials to access your account.
        </p>
      </div>

      <form onsubmit={handleSubmit} class="mt-7 flex flex-col gap-4">
        <Input
          id="email"
          label="Email"
          type="email"
          bind:value={email}
          placeholder="you@banhall.ca"
          autocomplete="email"
          required
        />
        <Input
          id="password"
          label="Password"
          type="password"
          bind:value={password}
          placeholder="Enter your password"
          autocomplete="current-password"
          required
          minlength={8}
        />

        {#if error}
          <p role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        {/if}

        <Button type="submit" disabled={submitting} class="mt-1 gap-2">
          {#if submitting}
            <Spinner size="sm" class="h-3.5 w-3.5 border-white" />
          {/if}
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>

    <!-- Footer below the card, delayed entrance -->
    <div class="login-footer mt-6 flex w-full max-w-sm flex-col items-center gap-1.5 text-center">
      <p class="text-sm text-gray-500">Banhall SR&amp;ED Consulting</p>
      <BuildStamp class="text-gray-400" />
    </div>
  </div>
{/if}

<style>
  /* Entrance: fade + slight zoom + rise, footer trails the card. */
  .login-card {
    animation: login-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .login-footer {
    animation: login-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.2s both;
  }
  @keyframes login-in {
    from {
      opacity: 0;
      transform: translateY(16px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .login-card,
    .login-footer {
      animation: none;
    }
  }
</style>
