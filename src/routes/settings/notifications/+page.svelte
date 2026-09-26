<script lang="ts">
  // /settings/notifications (round 2, I3): which in-app notifications you
  // get. Each switch saves at once, so this tab has no save bar. The board's
  // Email column is not built: there is no email provider yet (decision 54).
  import Spinner from "$lib/components/ui/Spinner.svelte";
  import Switch from "$lib/components/ui/Switch.svelte";
  import SettingsRow from "$lib/components/settings/SettingsRow.svelte";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { toast } from "svelte-sonner";
  import { api } from "../../../../convex/_generated/api";
  import { round2Api } from "../../../../convex/lib/round2Api";
  import { userErrorMessage } from "$lib/errors";
  import { canViewTeam } from "$lib/shell/navigation";
  import type { NotificationSettingKey } from "../../../../shared/notifications";

  const auth = useAuth();
  const meQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  const settingsQ = useQuery(round2Api.notifications.getSettings, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const setSetting = useMutation(round2Api.notifications.setSetting);

  // Invite accepted is for people who can invite: Managers and Admins
  // (decision 47). WS2 lands `invites.manage`; until then this mirrors it.
  const canInvite = $derived(canViewTeam(meQ.data?.role ?? null));

  const ROWS: { key: NotificationSettingKey; label: string; hint: string; invitersOnly?: boolean }[] = [
    { key: "ideasReady", label: "Ideas are ready", hint: "When step by step finishes reading." },
    { key: "draftReady", label: "Draft is ready", hint: "When the PD is written." },
    { key: "qaFinished", label: "QA finished", hint: "With the score." },
    { key: "handoff", label: "Handed off to you", hint: "When a project lands with you." },
    { key: "inviteAccepted", label: "Invite accepted", hint: "Anyone who can invite.", invitersOnly: true },
  ];
  const rows = $derived(ROWS.filter((row) => !row.invitersOnly || canInvite));

  // Optimistic per switch until the subscription echoes the saved value;
  // a failed save drops back to the stored value.
  let pending = $state<Partial<Record<NotificationSettingKey, boolean>>>({});

  function settle(key: NotificationSettingKey) {
    const next = { ...pending };
    delete next[key];
    pending = next;
  }

  $effect(() => {
    const stored = settingsQ.data;
    if (!stored) return;
    for (const key of Object.keys(pending) as NotificationSettingKey[]) {
      if (stored[key] === pending[key]) settle(key);
    }
  });

  async function change(key: NotificationSettingKey, value: boolean) {
    pending = { ...pending, [key]: value };
    try {
      await setSetting({ key, value });
    } catch (cause) {
      settle(key);
      toast.error(userErrorMessage(cause, "Could not save that setting."));
    }
  }
</script>

<svelte:head><title>Notifications - Settings</title></svelte:head>

{#if settingsQ.data === undefined}
  <div class="flex min-h-[40vh] items-center justify-center"><Spinner /></div>
{:else}
  {@const settings = settingsQ.data}
  <div data-settings-notifications class="flex flex-col">
    <div class="flex items-center gap-6 border-b border-line-soft pb-2">
      <div class="hidden w-[280px] shrink-0 md:block"></div>
      <p class="w-20 shrink-0 text-xs leading-4 text-ink-muted">In the app</p>
    </div>
    {#each rows as row, index (row.key)}
      <SettingsRow label={row.label} hint={row.hint} labelFor={`notify-${row.key}`} last={index === rows.length - 1}>
        <Switch
          id={`notify-${row.key}`}
          label={row.label}
          checked={pending[row.key] ?? settings[row.key]}
          onCheckedChange={(value) => void change(row.key, value)}
        />
      </SettingsRow>
    {/each}
  </div>
{/if}
