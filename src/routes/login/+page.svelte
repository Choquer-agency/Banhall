<script lang="ts">
  import { useAuth } from "@mmailaender/convex-auth-svelte/sveltekit";
  import { page } from "$app/state";
  import Button from "$lib/components/ui/Button.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import BuildStamp from "$lib/components/BuildStamp.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";

  const auth = useAuth();
  const { signIn } = auth;
  const manualLogin = $derived(page.url.searchParams.get("manual") === "1");

  let mode = $state<"signIn" | "signUp">("signIn");
  let email = $state("");
  let password = $state("");
  let name = $state("");
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
  });

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    submitting = true;

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
      error =
        mode === "signIn"
          ? "Invalid email or password."
          : `Could not create account: ${err instanceof Error ? err.message : "Unknown error"}`;
    } finally {
      submitting = false;
    }
  }
</script>

{#if auth.isLoading || (!auth.isAuthenticated && !manualLogin && !autoLoginAttempted)}
  <div class="flex flex-1 flex-col items-center justify-center bg-canvas">
    <Spinner />
    <p class="mt-3 text-sm text-gray-400">Signing you in...</p>
  </div>
{:else}
  <div class="flex flex-1 items-center justify-center bg-canvas px-4">
    <div class="w-full max-w-sm">
      <div class="mb-8 text-center">
        <h1 class="text-2xl font-bold tracking-tight text-navy">Banhall</h1>
        <p class="mt-1 text-sm text-gray-500">SR&amp;ED Report Generator</p>
      </div>

      <div class="card p-6 shadow-sm">
        <h2 class="text-title">
          {mode === "signIn" ? "Welcome back" : "Create account"}
        </h2>
        <p class="mt-1 text-sm text-gray-500">
          {mode === "signIn"
            ? "Sign in to your account to continue."
            : "Set up your writer account."}
        </p>

        <form onsubmit={handleSubmit} class="mt-5 flex flex-col gap-4">
          {#if mode === "signUp"}
            <Input
              id="name"
              label="Full name"
              type="text"
              bind:value={name}
              placeholder="Jane Smith"
              required
            />
          {/if}
          <Input
            id="email"
            label="Email"
            type="email"
            bind:value={email}
            placeholder="you@banhall.ca"
            required
          />
          <Input
            id="password"
            label="Password"
            type="password"
            bind:value={password}
            placeholder={mode === "signIn" ? "Enter your password" : "At least 8 characters"}
            required
            minlength={8}
          />

          {#if error}
            <div class="rounded-lg bg-red-50 px-3 py-2">
              <p class="text-sm text-red-600">{error}</p>
            </div>
          {/if}

          <Button type="submit" disabled={submitting} class="mt-1">
            {submitting ? "Please wait..." : mode === "signIn" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <div class="mt-4 text-center">
          <button
            type="button"
            onclick={() => {
              mode = mode === "signIn" ? "signUp" : "signIn";
              error = "";
            }}
            class="text-sm text-gray-500 transition-colors hover:text-navy"
          >
            {mode === "signIn"
              ? "Need an account? Sign up"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </div>

      <p class="mt-6 text-center text-xs text-gray-400">Banhall SR&amp;ED Consulting</p>
      <div class="mt-2 flex justify-center">
        <BuildStamp class="text-gray-300" />
      </div>
    </div>
  </div>
{/if}
