<script lang="ts">
  // C3 result state (not designed, proposed): no email provider (decision
  // 50), so each created invite shows its link to copy; failures say why.
  import { CheckIcon } from "phosphor-svelte";
  import RoleChip from "$lib/components/ui/RoleChip.svelte";
  import type { Role } from "../../../../shared/roles";

  export type InviteResultRow =
    | { email: string; status: "created"; link: string }
    | { email: string; status: "invalid" | "already_member" | "already_invited" };

  let { rows, role }: { rows: InviteResultRow[]; role: Role } = $props();

  const FAILURES = {
    invalid: "Not a valid email",
    already_member: "Already has an account",
    already_invited: "Already invited. Use Resend on the Team page.",
  } as const;

  let copied = $state<Record<string, boolean>>({});

  async function copy(row: InviteResultRow) {
    if (row.status !== "created") return;
    try {
      await navigator.clipboard.writeText(row.link);
      copied = { ...copied, [row.email]: true };
    } catch {
      /* clipboard unavailable: the link stays visible to select */
    }
  }
</script>

<ul data-invite-results class="flex flex-col divide-y divide-line-soft rounded-[10px] border border-line-soft">
  {#each rows as row (row.email)}
    <li data-invite-result={row.status} class="flex min-h-12 items-center gap-3 px-3.5 py-2">
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-[13px] font-medium text-ink">{row.email}</span>
        {#if row.status === "created"}
          <span class="truncate font-mono text-xs text-ink-muted">{row.link}</span>
        {:else}
          <span class="text-xs text-danger-ink-muted">{FAILURES[row.status]}</span>
        {/if}
      </div>
      {#if row.status === "created"}
        <RoleChip {role} />
        <button
          type="button"
          onclick={() => copy(row)}
          class="flex h-8 shrink-0 items-center gap-1 rounded-md bg-chrome px-2.5 text-[13px] font-medium text-ink hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {#if copied[row.email]}<CheckIcon size={13} weight="bold" class="text-success-ink-muted" aria-hidden="true" />Copied{:else}Copy link{/if}
        </button>
      {/if}
    </li>
  {/each}
</ul>
