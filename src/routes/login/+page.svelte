<script lang="ts">
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { useQuery } from "convex-svelte";
  import { WarningCircleIcon } from "phosphor-svelte";
  import { authClient } from "$lib/authClient";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import AuthLayout from "$lib/components/auth/AuthLayout.svelte";
  import AuthHeading from "$lib/components/auth/AuthHeading.svelte";
  import AuthField from "$lib/components/auth/AuthField.svelte";
  import PasswordField from "$lib/components/auth/PasswordField.svelte";
  import AccountCard from "$lib/components/auth/AccountCard.svelte";
  import ForgotPasswordNote from "$lib/components/auth/ForgotPasswordNote.svelte";
  import { api } from "../../../convex/_generated/api";

  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { onMount, tick, untrack } from "svelte";
  import { afterLoginPath } from "$lib/auth/next";
  import {
    SignInError,
    signInErrorKind,
    signInErrorMessage,
    type SignInErrorKind,
  } from "$lib/auth/signInError";
  import {
    forgetLastAccount,
    readLastAccount,
    rememberAccount,
    type LastAccount,
  } from "$lib/auth/lastAccount";

  const auth = useAuth();

  async function signInEmail(email: string, password: string) {
    const { error } = await authClient.signIn.email({ email, password });
    if (error) throw new SignInError(error);
  }

  let email = $state("");
  let password = $state("");
  let error = $state("");
  let errorKind = $state<SignInErrorKind | "stalled" | null>(null);
  let submitting = $state(false);
  let signInAttempt = 0;
  let hydrated = $state(false);
  let forgotOpen = $state(false);
  // J3, J4: the account this browser last signed in with (lastAccount.ts).
  let known = $state<LastAccount | null>(null);
  let emailInput: HTMLInputElement | undefined = $state();
  let passwordInput: HTMLInputElement | undefined = $state();

  // The email/password flow is client-only. Render the real form on the first
  // paint so there is no intermediate session-check screen, but keep its
  // native controls disabled until Svelte has attached handleSubmit. This
  // prevents a password manager or fast Enter/click from submitting a plain
  // GET /login? before Better Auth is ready.
  onMount(() => {
    known = readLastAccount();
    if (known) email = known.email;
    hydrated = true;
    void tick().then(() => (known ? passwordInput : emailInput)?.focus());
  });

  // Keep the layout mounted while the session resolves. Only the column
  // changes state, so sign-out and background-tab session refreshes cannot
  // remount the page.
  let entering = $state(false);

  // Signed in: return to the page that sent the visitor here (`?next=`, same
  // origin only), else the dashboard. The URL is read untracked so the
  // navigation itself cannot re-run this effect.
  $effect(() => {
    if (!auth.isLoading && auth.isAuthenticated) {
      const search = untrack(() => page.url.searchParams);
      void goto(afterLoginPath(search), { replaceState: true });
    }
  });

  // During the "Signing you in..." hold, keep the remembered name current
  // once the profile loads (the email was saved as soon as sign-in passed).
  const userQ = useQuery(api.users.getCurrentUser, () =>
    entering && auth.isAuthenticated ? {} : "skip",
  );
  $effect(() => {
    const user = userQ.data;
    if (entering && user?.email) rememberAccount(user);
  });

  const credentialsError = $derived(errorKind === "credentials");
  const errorId = "sign-in-error";

  function useAnotherAccount() {
    forgetLastAccount();
    known = null;
    email = "";
    password = "";
    error = "";
    errorKind = null;
    void tick().then(() => emailInput?.focus());
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!hydrated || submitting) return;

    error = "";
    errorKind = null;
    submitting = true;

    const attempt = ++signInAttempt;
    const address = email.trim().toLowerCase();
    try {
      await signInEmail(address, password);
      rememberAccount({ email: address });
      // Hold the stable progress state until Convex auth is live; the
      // watcher above then performs one client-side navigation. Recover if
      // token propagation stalls rather than leaving a permanent spinner.
      entering = true;
      window.setTimeout(() => {
        if (attempt === signInAttempt && entering && !auth.isAuthenticated) {
          entering = false;
          submitting = false;
          errorKind = "stalled";
          error = "We couldn't finish signing you in. Check your connection and try again.";
        }
      }, 10_000);
    } catch (err) {
      console.error("Auth error:", err);
      // Only credential failures blame the email or password; an origin
      // rejection (127.0.0.1 or a LAN address) says to use the usual address.
      const failure = err instanceof SignInError ? err : null;
      const online = navigator.onLine;
      errorKind = signInErrorKind(failure, { online });
      error = signInErrorMessage(failure, { online, knownAccount: known !== null });
      submitting = false;
      void tick().then(() => passwordInput?.focus());
    }
  }
</script>

<svelte:head>
  <title>Sign in - Banhall</title>
</svelte:head>

<AuthLayout width={360}>
  {#if auth.isAuthenticated || entering}
    <div class="flex min-h-64 flex-col items-center justify-center" aria-live="polite">
      <Spinner />
      <p class="mt-3 text-sm text-ink-secondary">Signing you in...</p>
    </div>
  {:else}
    {#if known}
      <AuthHeading
        title={known.firstName ? `Welcome back, ${known.firstName}` : "Welcome back"}
        subtitle="You were signed out. Sign back in to keep going."
      />
    {:else}
      <AuthHeading title="Sign in" subtitle="Use your @banhall.com email." />
    {/if}

    <form onsubmit={handleSubmit} class="flex flex-col gap-5" aria-busy={!hydrated || submitting}>
      <div class="flex flex-col gap-3.5">
        {#if known}
          <AccountCard
            name={known.name}
            email={known.email}
            initials={known.initials}
            onUseAnother={useAnotherAccount}
          />
          <!-- Password managers match the saved entry by this username. -->
          <input
            type="email"
            name="username"
            autocomplete="username"
            value={known.email}
            readonly
            tabindex="-1"
            aria-hidden="true"
            data-hidden-username
            class="input-chromeless sr-only"
          />
        {:else}
          <AuthField
            id="email"
            label="Email"
            type="email"
            name="username"
            bind:value={email}
            bind:element={emailInput}
            placeholder="you@banhall.com"
            autocomplete="email"
            disabled={!hydrated || submitting}
            invalid={credentialsError}
            aria-describedby={credentialsError ? errorId : undefined}
            required
          />
        {/if}
        <div class="flex flex-col gap-2">
          <PasswordField
            id="password"
            bind:value={password}
            bind:element={passwordInput}
            placeholder="Enter your password"
            autocomplete="current-password"
            disabled={!hydrated || submitting}
            invalid={credentialsError}
            aria-describedby={[error ? errorId : null, forgotOpen ? "forgot-password-note" : null].filter(Boolean).join(" ") || undefined}
            required
            minlength={8}
            {forgotOpen}
            onForgot={() => (forgotOpen = !forgotOpen)}
          />
          {#if error}
            <p id={errorId} role="alert" class="flex items-start gap-1.5 text-[13px] leading-[18px] text-danger-ink-muted">
              <WarningCircleIcon size={14} aria-hidden="true" class="mt-0.5 shrink-0" />
              {error}
            </p>
          {/if}
          {#if forgotOpen}
            <ForgotPasswordNote />
          {/if}
        </div>
      </div>

      <button
        type="submit"
        disabled={!hydrated || submitting}
        class="flex h-[46px] items-center justify-center gap-2 rounded-[10px] bg-fir text-[15px] leading-5 font-medium text-white transition-colors hover:bg-navy-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {#if submitting}
          <Spinner size="sm" class="h-3.5 w-3.5 border-white" />
        {/if}
        {submitting ? "Signing in..." : "Sign in"}
      </button>
    </form>
  {/if}
</AuthLayout>
