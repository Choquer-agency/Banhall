<script lang="ts">
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { authClient } from "$lib/authClient";
  import Button from "$lib/components/ui/Button.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import BuildStamp from "$lib/components/BuildStamp.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";

  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";

  const auth = useAuth();

  async function signInEmail(email: string, password: string) {
    const { error } = await authClient.signIn.email({ email, password });
    if (error) throw new Error(error.message ?? "Sign-in failed");
  }

  let email = $state("");
  let password = $state("");
  let error = $state("");
  let submitting = $state(false);
  let signInAttempt = 0;
  let hydrated = $state(false);

  // The email/password flow is client-only. Render the real form on the first
  // paint so there is no intermediate session-check screen, but keep its
  // native controls disabled until Svelte has attached handleSubmit. This
  // prevents a password manager or fast Enter/click from submitting a plain
  // GET /login? before Better Auth is ready.
  onMount(() => {
    hydrated = true;
  });

  // Keep the split login shell mounted while the session resolves. Only the
  // form column changes state, so sign-out and background-tab session refreshes
  // cannot remount or flash the large brand panel.
  let entering = $state(false);

  $effect(() => {
    if (!auth.isLoading && auth.isAuthenticated) {
      void goto(resolve("/dashboard"), { replaceState: true });
    }
  });

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!hydrated || submitting) return;

    error = "";
    submitting = true;

    const attempt = ++signInAttempt;
    try {
      await signInEmail(email.trim().toLowerCase(), password);
      // Hold the stable form-column progress state until Convex auth is live;
      // the watcher above then performs one client-side navigation. Recover if
      // token propagation stalls rather than leaving a permanent spinner.
      entering = true;
      window.setTimeout(() => {
        if (attempt === signInAttempt && entering && !auth.isAuthenticated) {
          entering = false;
          submitting = false;
          error = "We couldn't finish signing you in. Check your connection and try again.";
        }
      }, 10_000);
    } catch (err) {
      console.error("Auth error:", err);
      error = navigator.onLine
        ? "Check your @banhall.com email address and password."
        : "You're offline. Reconnect and try signing in again.";
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Sign in — Banhall</title>
</svelte:head>

<!-- Keep this full shell stable across checking, signed-out, and entering states. -->
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

        {#if auth.isAuthenticated || entering}
          <div class="flex min-h-64 flex-col items-center justify-center" aria-live="polite">
            <Spinner />
            <p class="mt-3 text-sm text-gray-500">Signing you in…</p>
          </div>
        {:else}
          <h1 class="text-2xl font-semibold tracking-tight text-gray-900">Welcome back</h1>
          <p class="mt-1.5 text-sm text-gray-600">Sign in to your account to continue.</p>

          <form onsubmit={handleSubmit} class="mt-8 flex flex-col gap-4" aria-busy={!hydrated || submitting}>
            <Input
              id="email"
              label="Email"
              type="email"
              bind:value={email}
              placeholder="you@banhall.com"
              autocomplete="email"
              disabled={!hydrated || submitting}
              required
            />
            <Input
              id="password"
              label="Password"
              type="password"
              bind:value={password}
              placeholder="Enter your password"
              autocomplete="current-password"
              disabled={!hydrated || submitting}
              required
              minlength={8}
            />

            {#if error}
              <p role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            {/if}

            <Button type="submit" disabled={!hydrated || submitting} class="mt-2 gap-2">
              {#if submitting}
                <Spinner size="sm" class="h-3.5 w-3.5 border-white" />
              {/if}
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        {/if}

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

<style>
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
</style>
