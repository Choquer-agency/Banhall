<script lang="ts">
  // J5 accept invite, J6 expired invite, J9 phone. The invitee confirms their
  // names (decision 51) right before the account is created, so the names
  // typed here are the ones the account gets.
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { useMutation, useQuery } from "convex-svelte";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { toast } from "svelte-sonner";
  import { authClient } from "$lib/authClient";
  import { clearAllOutboxes } from "$lib/uploads/attemptOutbox";
  import { api } from "../../../../convex/_generated/api";
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import Avatar from "$lib/components/ui/Avatar.svelte";
  import StatusCallout from "$lib/components/ui/StatusCallout.svelte";
  import AuthLayout from "$lib/components/auth/AuthLayout.svelte";
  import AuthHeading from "$lib/components/auth/AuthHeading.svelte";
  import AuthField from "$lib/components/auth/AuthField.svelte";
  import PasswordField from "$lib/components/auth/PasswordField.svelte";
  import PasswordRule from "$lib/components/auth/PasswordRule.svelte";
  import InviteBanner from "$lib/components/auth/InviteBanner.svelte";
  import { forgetLastAccount, rememberAccount } from "$lib/auth/lastAccount";
  import { replaceLocation } from "$lib/auth/replaceLocation";
  import { firmShortDate } from "$lib/team/teamFormat";
  import { userErrorMessage } from "$lib/errors";
  import { personInitials } from "../../../../shared/personInitials";

  const MIN_PASSWORD = 8;

  const auth = useAuth();
  const token = $derived(page.params.token ?? "");

  const inviteQ = useQuery(api.invites.getInviteByToken, () => ({ token }));
  const confirmInviteNames = useMutation(api.invites.confirmInviteNames);
  const lookup = $derived(inviteQ.data);
  const invite = $derived(lookup?.state === "pending" ? lookup : null);
  const expired = $derived(lookup?.state === "expired" ? lookup : null);

  let firstName = $state("");
  let lastName = $state("");
  let password = $state("");
  let submitting = $state(false);
  let redirecting = $state(false);
  let error = $state("");
  let hydrated = $state(false);

  // Prefill names from the invite once (they may be absent, decision 51).
  $effect(() => {
    if (!hydrated && invite) {
      firstName = invite.firstName ?? "";
      lastName = invite.lastName ?? "";
      hydrated = true;
    }
  });

  // Already signed in and authenticated: this invite isn't for this session.
  const signedIn = $derived(!auth.isLoading && auth.isAuthenticated);
  const ruleMet = $derived(password.length >= MIN_PASSWORD);
  const ready = $derived(Boolean(firstName.trim() && lastName.trim() && ruleMet));
  const heading = $derived(invite?.firstName ? `Welcome to Banhall, ${invite.firstName}` : "Welcome to Banhall");

  const inviterFirst = $derived(
    expired?.inviter ? (expired.inviter.firstName ?? expired.inviter.name.split(/\s+/)[0] ?? "") : null,
  );
  const mailto = $derived.by(() => {
    if (!expired?.inviter?.email || !inviterFirst) return null;
    const subject = encodeURIComponent("New Banhall invite");
    const body = encodeURIComponent(
      `Hi ${inviterFirst}, my Banhall invite has expired. Could you send me a new link?`,
    );
    return `mailto:${expired.inviter.email}?subject=${subject}&body=${body}`;
  });

  async function accept() {
    if (submitting || !invite || !ready) return;
    error = "";
    const first = firstName.trim();
    const last = lastName.trim();
    const name = `${first} ${last}`;
    submitting = true;
    try {
      await confirmInviteNames({ token, firstName: first, lastName: last });
      const { error: signUpError } = await authClient.signUp.email({
        email: invite.email,
        password,
        name,
        // Passed through to the invite gate (hooks.before in convex/auth.ts).
        // fetchOptions.body extension keeps types happy for extra fields.
        fetchOptions: {
          body: { email: invite.email, password, name, inviteToken: token },
        },
      });
      if (signUpError) {
        error = signUpError.message ?? "The invite could not be accepted. Try again.";
        return;
      }
      rememberAccount({ email: invite.email, firstName: first, lastName: last });
      // Keep the completion state mounted while the accepted invite drops out
      // of the live query. Replacing history also prevents Back from returning
      // to a link that has now been consumed.
      redirecting = true;
      replaceLocation("/my-work");
    } catch (cause) {
      error = userErrorMessage(cause, "The invite could not be accepted. Try again.");
    } finally {
      // A successful navigation unloads this page. Until it does, leave the
      // loader in place so the consumed invite cannot flash as invalid.
      if (!redirecting) submitting = false;
    }
  }

  async function signOut() {
    try {
      await authClient.signOut();
      // An explicit sign-out forgets the remembered account (decision 58),
      // and handing the browser to a different person is exactly the case
      // the per-user outbox scoping exists for.
      forgetLastAccount();
      clearAllOutboxes();
      await goto(resolve("/signup/[token]", { token }), { replaceState: true, invalidateAll: true });
    } catch (cause) {
      console.error("Sign-out failed", cause);
      toast.error("Sign-out failed. Check your connection and try again.");
    }
  }
</script>

<svelte:head>
  <title>Join Banhall</title>
</svelte:head>

{#if inviteQ.isLoading}
  <AuthLayout width={380} footer={false}>
    <div class="flex justify-center py-8"><Spinner /></div>
  </AuthLayout>
{:else if submitting}
  <AuthLayout width={380} footer={false}>
    <div class="flex flex-col items-center py-8 text-center" role="status" aria-live="polite">
      <Spinner />
      <h1 class="mt-4 text-title">{redirecting ? "Account created" : "Creating your account..."}</h1>
      <p class="mt-2 text-sm text-ink-secondary">
        {redirecting ? "Opening Banhall..." : "This should only take a moment."}
      </p>
    </div>
  </AuthLayout>
{:else if expired}
  <AuthLayout width={440} footer={false}>
    <div data-invite-expired class="flex flex-col gap-5">
      <AuthHeading
        title="Your invite has expired"
        subtitle={inviterFirst && mailto
          ? `Invites last 7 days. Ask ${inviterFirst} to send you a new one.`
          : "Invites last 7 days. Ask an Admin to send you a new one."}
      />
      {#if expired.inviter}
        <div class="flex items-center gap-3 rounded-xl border border-line-soft bg-surface p-3.5">
          <Avatar
            name={expired.inviter.name}
            initials={personInitials({ name: expired.inviter.name })}
            size={36}
            tone="faded"
            weight="medium"
          />
          <div class="flex min-w-0 flex-1 flex-col gap-px">
            <span class="truncate text-[13px] leading-[18px] font-medium text-ink-secondary">{expired.inviter.name} invited you</span>
            <span class="text-xs leading-4 text-ink-muted">
              Sent {firmShortDate(expired.sentAt)}. Expired {firmShortDate(expired.expiresAt)}.
            </span>
          </div>
          <span class="flex h-5 shrink-0 items-center rounded-[5px] bg-gap-bg px-[7px] text-xs leading-4 font-medium text-warning-ink">Expired</span>
        </div>
      {/if}
      <div class="flex flex-col gap-3">
        {#if mailto}
          <a
            href={mailto}
            data-email-inviter
            class="flex h-[46px] items-center justify-center rounded-[10px] bg-fir text-[15px] leading-5 font-medium text-white hover:bg-navy-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >Email {inviterFirst} for a new invite</a>
        {/if}
        <p class="flex justify-center gap-1 text-[13px] leading-[18px] text-ink-muted">
          Already joined?
          <a href={resolve("/login")} class="font-medium text-primary-selected hover:text-primary-dark">Sign in</a>
        </p>
      </div>
    </div>
  </AuthLayout>
{:else if !invite}
  <!-- Revoked, replaced by a resend, already used or unknown. -->
  <AuthLayout width={380} footer={false}>
    <div data-invite-unavailable class="flex flex-col gap-5">
      <AuthHeading
        title="This invite link isn't valid"
        subtitle="It may have been revoked, replaced by a newer link, or already used. Ask your team for a new invite."
      />
      <p class="flex justify-center gap-1 text-[13px] leading-[18px] text-ink-muted">
        Already joined?
        <a href={resolve("/login")} class="font-medium text-primary-selected hover:text-primary-dark">Sign in</a>
      </p>
    </div>
  </AuthLayout>
{:else if signedIn}
  <AuthLayout width={380} footer={false}>
    <div data-invite-signed-in class="flex flex-col items-center gap-5">
      <AuthHeading title="You're already signed in" subtitle={`Sign out first to accept this invite for ${invite.email}.`} />
      <button
        type="button"
        onclick={signOut}
        class="flex h-[46px] w-full items-center justify-center rounded-[10px] bg-chrome text-[15px] leading-5 font-medium text-ink hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >Sign out</button>
    </div>
  </AuthLayout>
{:else}
  <AuthLayout width={380} footer={false}>
    {#snippet banner()}
      <InviteBanner inviter={invite.inviter} role={invite.role} expiresAt={invite.expiresAt} />
    {/snippet}
    <AuthHeading title={heading} subtitle={`You will sign in with ${invite.email}.`} />
    <form
      class="flex flex-col gap-5"
      onsubmit={(event) => {
        event.preventDefault();
        void accept();
      }}
    >
      <div class="flex flex-col gap-3.5">
        <div class="grid grid-cols-2 gap-3">
          <AuthField id="firstName" label="First name" bind:value={firstName} autocomplete="given-name" maxlength={100} required />
          <AuthField id="lastName" label="Last name" bind:value={lastName} autocomplete="family-name" maxlength={100} required />
        </div>
        <!-- Password managers file the new password under this address. -->
        <input type="email" name="username" autocomplete="username" value={invite.email} readonly tabindex="-1" aria-hidden="true" class="input-chromeless sr-only" />
        <PasswordField
          id="password"
          label="Create a password"
          bind:value={password}
          autocomplete="new-password"
          aria-describedby="password-rule"
          required
        />
        <div id="password-rule"><PasswordRule met={ruleMet} /></div>
      </div>
      {#if error}
        <StatusCallout tone="danger" role="alert">{error}</StatusCallout>
      {/if}
      <button
        type="submit"
        data-create-account
        disabled={!ready}
        class="flex h-[46px] items-center justify-center rounded-[10px] bg-fir text-[15px] leading-5 font-medium text-white transition-colors hover:bg-navy-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >Create account and join</button>
    </form>
  </AuthLayout>
{/if}
