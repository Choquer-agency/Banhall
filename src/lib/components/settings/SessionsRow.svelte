<script lang="ts">
  /**
   * Settings "Signed in" row (I1): how many devices hold a session as the
   * row's muted line under the label, and Sign out
   * everywhere behind a confirm (not designed, proposed copy). Reads Better
   * Auth sessions through the same-origin /api/auth proxy. Other devices keep
   * working until their current Convex token expires (about 15 minutes):
   * revoking the Better Auth sessions does not revoke an issued Convex token.
   */
  import { onMount } from "svelte";
  import { Dialog } from "bits-ui";
  import { toast } from "svelte-sonner";
  import { authClient } from "$lib/authClient";
  import { modalPop, overlayFade } from "$lib/motion";
  import { deviceLabel, sessionsLine } from "$lib/shell/deviceLabel";
  import { signOutLocally } from "$lib/shell/signOut";
  import SettingsRow from "./SettingsRow.svelte";

  const device = deviceLabel();
  let otherSessions = $state<number | null>(null);
  let confirmOpen = $state(false);
  let working = $state(false);

  onMount(async () => {
    try {
      const [sessions, current] = await Promise.all([
        authClient.listSessions(),
        authClient.getSession(),
      ]);
      const list = sessions.data ?? [];
      const currentToken = current.data?.session?.token;
      const currentId = current.data?.session?.id;
      const others = list.filter(
        (session) => session.token !== currentToken && session.id !== currentId
      ).length;
      otherSessions = others;
    } catch (error) {
      console.error("Could not list sessions", error);
      otherSessions = 0;
    }
  });

  const line = $derived(otherSessions === null ? `This ${device}.` : sessionsLine(device, otherSessions));

  async function signOutEverywhere() {
    if (working) return;
    working = true;
    try {
      const result = await authClient.revokeSessions();
      if (result?.error) throw result.error;
      confirmOpen = false;
      await signOutLocally();
    } catch (error) {
      console.error("Sign out everywhere failed", error);
      toast.error("Could not sign out everywhere. Check your connection and try again.");
    } finally {
      working = false;
    }
  }

  const confirmBody = $derived(
    otherSessions && otherSessions > 0
      ? `You will be signed out on this ${device} and ${otherSessions === 1 ? "1 other device" : `${otherSessions} other devices`}.`
      : `You will be signed out on this ${device}.`
  );
</script>

{#snippet sessionsHint()}<span data-sessions-line>{line}</span>{/snippet}

<SettingsRow label="Signed in" hint={sessionsHint}>
  <div data-sessions-row class="flex items-center gap-2">
    <button
      type="button"
      data-sign-out-everywhere
      onclick={() => (confirmOpen = true)}
      class="inline-flex h-8 items-center rounded-lg bg-destructive-soft px-3.5 text-sm font-medium text-destructive-soft-ink transition-colors hover:bg-destructive-soft-hover hover:text-destructive-soft-ink-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger motion-reduce:transition-none pointer-coarse:h-11"
    >Sign out everywhere</button>
  </div>
</SettingsRow>

<Dialog.Root bind:open={confirmOpen}>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open })}
        {#if open}<div {...props} transition:overlayFade class="fixed inset-0 z-[120] bg-navy/35"></div>{/if}
      {/snippet}
    </Dialog.Overlay>
    <div class="pointer-events-none fixed inset-0 z-[120] flex items-end justify-center sm:items-center sm:p-4">
      <Dialog.Content
        forceMount
        onEscapeKeydown={(event) => {
          if (working) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (working) event.preventDefault();
        }}
      >
        {#snippet child({ props, open })}
          {#if open}
            <div
              {...props}
              transition:modalPop
              class="pointer-events-auto w-full rounded-t-xl border border-line bg-surface p-5 shadow-dialog sm:max-w-sm sm:rounded-xl"
            >
              <Dialog.Title class="text-title">Sign out everywhere?</Dialog.Title>
              <Dialog.Description class="mt-1.5 text-sm leading-relaxed text-ink-secondary">{confirmBody}</Dialog.Description>
              <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Dialog.Close
                  disabled={working}
                  class="inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:opacity-50 pointer-coarse:h-11"
                >Cancel</Dialog.Close>
                <button
                  type="button"
                  data-confirm-sign-out-everywhere
                  disabled={working}
                  onclick={signOutEverywhere}
                  class="inline-flex h-9 items-center justify-center rounded-md bg-danger-action px-4 text-sm font-medium text-white transition-colors hover:bg-danger-action-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-50 pointer-coarse:h-11"
                >{working ? "Signing out..." : "Sign out everywhere"}</button>
              </div>
            </div>
          {/if}
        {/snippet}
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>
