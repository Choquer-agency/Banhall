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

  // Better Auth email/password. Shapes the old convex-auth "signIn('password',
  // {flow})" calls onto authClient.signIn.email / signUp.email.
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
        <h2 class="text-title">Welcome back</h2>
        <p class="mt-1 text-sm text-gray-500">Sign in to your account to continue.</p>

        <form onsubmit={handleSubmit} class="mt-5 flex flex-col gap-4">
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
            placeholder="Enter your password"
            required
            minlength={8}
          />

          {#if error}
            <div class="rounded-lg bg-red-50 px-3 py-2">
              <p class="text-sm text-red-600">{error}</p>
            </div>
          {/if}

          <Button type="submit" disabled={submitting} class="mt-1">
            {submitting ? "Please wait..." : "Sign in"}
          </Button>
        </form>

      </div>

      <p class="mt-6 text-center text-xs text-gray-400">Banhall SR&amp;ED Consulting</p>
      <div class="mt-2 flex justify-center">
        <BuildStamp class="text-gray-300" />
      </div>
    </div>
  </div>
{/if}
