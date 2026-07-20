<script lang="ts">
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { authClient } from "$lib/authClient";
  import { page } from "$app/state";
  import Button from "$lib/components/ui/Button.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import BuildStamp from "$lib/components/BuildStamp.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";

  const auth = useAuth();
  // Suppress the demo auto-login after an explicit sign-out: either via the
  // ?manual=1 flag, or the sessionStorage marker UserMenu sets (covers the
  // case where another page's auth $effect redirected to a bare /login
  // before the flagged navigation landed).
  const manualLogin = $derived.by(() => {
    if (page.url.searchParams.get("manual") === "1") return true;
    if (typeof sessionStorage !== "undefined") {
      return sessionStorage.getItem("banhall:manual-signout") === "1";
    }
    return false;
  });

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
      // Fresh session — future sign-outs start clean.
      sessionStorage.removeItem("banhall:manual-signout");
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
  <!-- Full-bleed split: fir brand field · ledger-paper form column -->
  <div class="grid min-h-screen flex-1 lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
    <!-- Brand field: the app bar's material at page scale. Wordmark floats
         free on the fir — no container. -->
    <div class="brand-field relative hidden flex-col justify-between overflow-hidden bg-navy px-12 py-12 lg:flex xl:px-16">
      <img
        src="/logo.png"
        alt="Banhall"
        width="308"
        height="138"
        class="brand-mark -ml-3 w-40 self-start brightness-0 invert"
      />

      <div class="brand-copy max-w-md">
        <p class="text-3xl font-semibold leading-tight tracking-tight text-white xl:text-4xl" style="text-wrap: balance">
          The interview is the evidence. The report writes to the form.
        </p>
        <p class="mt-4 text-base leading-relaxed text-white/60">
          Transcripts in — disciplined, CRA-ready project descriptions out.
        </p>
      </div>

      <p class="text-sm text-white/40">Banhall SR&amp;ED Consulting</p>

      <!-- The nav's signature baseline rule, closing the panel -->
      <div aria-hidden="true" class="nav-baseline absolute inset-x-0 bottom-0 h-0.5"></div>
    </div>

    <!-- Form column on ledger paper -->
    <div class="flex flex-col justify-center px-6 py-12 sm:px-12 xl:px-20">
      <div class="form-col mx-auto w-full max-w-sm">
        <!-- Mobile: wordmark inline, tinted to fir on paper — no container -->
        <img
          src="/logo.png"
          alt="Banhall"
          width="308"
          height="138"
          class="logo-fir -ml-2 mb-8 w-32 lg:hidden"
        />

        <h1 class="text-2xl font-semibold tracking-tight text-gray-900">Welcome back</h1>
        <p class="mt-1.5 text-sm text-gray-600">Sign in to your account to continue.</p>

        <form onsubmit={handleSubmit} class="mt-8 flex flex-col gap-4">
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

          <Button type="submit" disabled={submitting} class="mt-2 gap-2">
            {#if submitting}
              <Spinner size="sm" class="h-3.5 w-3.5 border-white" />
            {/if}
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <div class="mt-10 flex items-center gap-2 text-xs text-gray-500 lg:hidden">
          <span>Banhall SR&amp;ED Consulting</span>
          <span aria-hidden="true" class="text-gray-300">·</span>
          <BuildStamp class="text-gray-400" />
        </div>
        <div class="mt-10 hidden lg:block">
          <BuildStamp class="text-gray-300" />
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Entrances: brand elements rise on the fir; the form follows a beat later. */
  .brand-mark {
    animation: rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  .brand-copy {
    animation: rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.12s both;
  }
  .form-col {
    animation: rise 0.55s cubic-bezier(0.22, 1, 0.36, 1) 0.2s both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(14px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  /* Ledger ruling carries into the brand field at whisper contrast — the
     same material, lit dark. */
  .brand-field {
    background-image: repeating-linear-gradient(
      to bottom,
      transparent 0,
      transparent calc(2rem - 1px),
      rgba(255, 255, 255, 0.045) calc(2rem - 1px),
      rgba(255, 255, 255, 0.045) 2rem
    );
  }
  /* Recolor the light wordmark artwork to brand fir for light surfaces:
     flatten to black, then invert toward the fir hue. */
  .logo-fir {
    filter: brightness(0) saturate(100%) invert(17%) sepia(21%) saturate(1900%)
      hue-rotate(140deg) brightness(93%) contrast(101%);
  }
  @media (prefers-reduced-motion: reduce) {
    .brand-mark,
    .brand-copy,
    .form-col {
      animation: none;
    }
  }
</style>
