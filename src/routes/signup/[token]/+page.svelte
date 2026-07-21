<script lang="ts">
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { useQuery } from "convex-svelte";
  import { page } from "$app/state";
  import { authClient } from "$lib/authClient";
  import { api } from "../../../../convex/_generated/api";
  import Button from "$lib/components/ui/Button.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import Spinner from "$lib/components/ui/Spinner.svelte";

  const auth = useAuth();
  const token = $derived(page.params.token ?? "");

  const inviteQ = useQuery(api.invites.getInviteByToken, () => ({ token }));
  const invite = $derived(inviteQ.data);

  let firstName = $state("");
  let lastName = $state("");
  let password = $state("");
  let submitting = $state(false);
  let redirecting = $state(false);
  let error = $state("");
  let hydrated = $state(false);

  // Prefill names from the invite once.
  $effect(() => {
    if (!hydrated && invite) {
      firstName = invite.firstName;
      lastName = invite.lastName;
      hydrated = true;
    }
  });

  // Already signed in and authenticated → this invite isn't for this session.
  const signedIn = $derived(!auth.isLoading && auth.isAuthenticated);

  async function accept() {
    if (submitting || !invite) return;
    error = "";
    if (!firstName.trim() || !lastName.trim()) {
      error = "First and last name are required.";
      return;
    }
    if (password.length < 8) {
      error = "Password must be at least 8 characters.";
      return;
    }
    submitting = true;
    try {
      const { error: signUpError } = await authClient.signUp.email({
        email: invite.email,
        password,
        name: `${firstName.trim()} ${lastName.trim()}`,
        // Passed through to the invite gate (hooks.before in convex/auth.ts).
        // fetchOptions.body extension keeps types happy for extra fields.
        fetchOptions: {
          body: {
            email: invite.email,
            password,
            name: `${firstName.trim()} ${lastName.trim()}`,
            inviteToken: token,
          },
        },
      });
      if (signUpError) {
        error = signUpError.message ?? "The invite could not be accepted.";
        return;
      }
      // Keep the completion state mounted while the accepted invite drops out
      // of the live query. Replacing history also prevents Back from returning
      // to a link that has now been consumed.
      redirecting = true;
      window.location.replace("/dashboard");
    } catch {
      error = "The invite could not be accepted. Please try again.";
    } finally {
      // A successful navigation unloads this page. Until it does, leave the
      // loader in place so the consumed invite cannot flash as invalid.
      if (!redirecting) submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Join Banhall</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-canvas px-4">
  <div class="card w-full max-w-md p-8">
    {#if inviteQ.isLoading}
      <div class="flex justify-center py-8"><Spinner /></div>
    {:else if submitting}
      <div class="flex flex-col items-center py-8 text-center" role="status" aria-live="polite">
        <Spinner />
        <h1 class="mt-4 text-title">
          {redirecting ? "Account created" : "Creating your account…"}
        </h1>
        <p class="mt-2 text-sm text-gray-500">
          {redirecting ? "Opening your dashboard…" : "This should only take a moment."}
        </p>
      </div>
    {:else if !invite}
      <!-- Dead link: invalid, expired, revoked, or already used -->
      <div class="text-center">
        <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-chrome">
          <svg class="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.181 8.68a4.503 4.503 0 011.903 6.405m-9.768-2.782L3.56 14.06a4.5 4.5 0 006.364 6.365l3.129-3.129m5.614-5.615l1.757-1.757a4.5 4.5 0 00-6.364-6.365l-4.5 4.5c-.258.26-.479.541-.661.84m1.903 6.405a4.495 4.495 0 01-1.242-.88 4.483 4.483 0 01-1.062-1.683m6.587 2.345l5.907 5.907m-5.907-5.907L8.898 8.898M2.991 2.99l5.907 5.907" />
          </svg>
        </div>
        <h1 class="text-lg font-semibold text-gray-900">This invite link isn't valid</h1>
        <p class="mt-2 text-sm leading-relaxed text-gray-500">
          It may have expired, been revoked, or already been used. Ask your
          admin to send a fresh invite.
        </p>
      </div>
    {:else if signedIn}
      <div class="text-center">
        <h1 class="text-lg font-semibold text-gray-900">You're already signed in</h1>
        <p class="mt-2 text-sm text-gray-500">
          Sign out first to accept this invite for {invite.email}.
        </p>
        <Button
          class="mt-4"
          variant="secondary"
          onclick={async () => {
            await authClient.signOut();
            window.location.reload();
          }}
        >
          Sign out
        </Button>
      </div>
    {:else}
      <h1 class="text-xl font-semibold text-gray-900">Join Banhall</h1>
      <p class="mt-1 text-sm text-gray-500">
        You've been invited as <span class="font-medium text-gray-700">{invite.email}</span>.
        Set your name and a password to finish.
      </p>
      <form
        class="mt-6 flex flex-col gap-4"
        onsubmit={(e) => {
          e.preventDefault();
          accept();
        }}
      >
        <div class="grid grid-cols-2 gap-3">
          <Input id="firstName" label="First name" bind:value={firstName} required />
          <Input id="lastName" label="Last name" bind:value={lastName} required />
        </div>
        <Input id="email" label="Email" value={invite.email} disabled />
        <Input
          id="password"
          label="Password"
          type="password"
          bind:value={password}
          placeholder="At least 8 characters"
          required
        />
        {#if error}
          <p role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        {/if}
        <Button type="submit" disabled={submitting} class="mt-1 gap-2">
          {#if submitting}
            <Spinner size="sm" class="h-3.5 w-3.5 border-white" />
          {/if}
          Create account
        </Button>
      </form>
    {/if}
  </div>
</div>
