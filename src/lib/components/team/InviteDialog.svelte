<script lang="ts">
  // C3 Invite people. No email provider (decision 50): sending creates the
  // invites and shows each link to copy. Names are not asked for (decision
  // 51) and the board's Note field is not built (no email to carry it).
  import RoleChip from "$lib/components/ui/RoleChip.svelte";
  import TeamDialog from "./TeamDialog.svelte";
  import InviteEmailChips from "./InviteEmailChips.svelte";
  import InviteResults, { type InviteResultRow } from "./InviteResults.svelte";
  import { userErrorMessage } from "$lib/errors";
  import {
    MAX_INVITE_EMAILS,
    inviteLink,
    sendLabel,
    type EmailChip,
  } from "$lib/team/inviteEmails";
  import type { Role } from "../../../../shared/roles";

  type CreateResult =
    | { email: string; status: "created"; token: string }
    | { email: string; status: "invalid" | "already_member" | "already_invited" };

  let {
    open = $bindable(false),
    canInviteAdmin,
    origin = typeof window === "undefined" ? "" : window.location.origin,
    onSend,
  }: {
    open?: boolean;
    canInviteAdmin: boolean;
    origin?: string;
    onSend: (emails: string[], role: Role) => Promise<CreateResult[]>;
  } = $props();

  const ROLE_OPTIONS: Array<{ role: Role; line: string; adminOnly: boolean }> = [
    { role: "writer", line: "Writes PDs, sees every project", adminOnly: false },
    { role: "manager", line: "Also invites Consultants and Managers", adminOnly: false },
    { role: "admin", line: "Also runs Admin and changes roles", adminOnly: true },
  ];

  let chips = $state<EmailChip[]>([]);
  let role = $state<Role>("writer");
  let sending = $state(false);
  let error = $state("");
  let results = $state<InviteResultRow[] | null>(null);
  let chipInput: ReturnType<typeof InviteEmailChips> | undefined = $state();

  const options = $derived(ROLE_OPTIONS.filter((option) => canInviteAdmin || !option.adminOnly));
  const validCount = $derived(chips.filter((chip) => chip.valid).length);
  const tooMany = $derived(chips.length > MAX_INVITE_EMAILS);
  const createdCount = $derived(results?.filter((row) => row.status === "created").length ?? 0);

  // Every open starts clean.
  $effect(() => {
    if (open) {
      chips = [];
      role = "writer";
      sending = false;
      error = "";
      results = null;
    }
  });

  async function send() {
    chipInput?.flush();
    if (sending || validCount === 0 || tooMany) return;
    sending = true;
    error = "";
    try {
      const created = await onSend(chips.map((chip) => chip.value), role);
      results = created.map((row) =>
        row.status === "created"
          ? { email: row.email, status: "created" as const, link: inviteLink(origin, row.token) }
          : { email: row.email, status: row.status },
      );
      const links = results.filter((row) => row.status === "created");
      // One invite: copy its link straight away, as /admin/users did.
      if (links.length === 1 && links[0]?.status === "created") {
        await navigator.clipboard.writeText(links[0].link).catch(() => {});
      }
    } catch (cause) {
      error = userErrorMessage(cause, "The invites could not be sent. Try again.");
    } finally {
      sending = false;
    }
  }
</script>

<TeamDialog
  bind:open
  width={540}
  busy={sending}
  testId="invite-dialog"
  title={results
    ? createdCount === 1
      ? "1 invite ready"
      : `${createdCount} invites ready`
    : "Invite people"}
  description={results
    ? "Copy each link and send it to the person. Each link works for 7 days."
    : "Add work emails and pick a role. Each person gets a link to join Banhall."}
>
  {#if results}
    <div class="px-7 pb-5 pt-[18px]">
      <InviteResults rows={results} {role} />
    </div>
  {:else}
    <div class="flex flex-col gap-1.5 px-7 pt-[18px]">
      <label for="invite-emails" class="text-xs font-medium leading-4 text-ink-secondary">Email addresses</label>
      <InviteEmailChips bind:this={chipInput} bind:chips disabled={sending} />
      {#if tooMany}
        <p class="text-xs text-danger-ink-muted">Invite at most {MAX_INVITE_EMAILS} people at a time.</p>
      {/if}
    </div>
    <fieldset class="flex flex-col gap-2 px-7 pb-[18px] pt-4">
      <legend class="mb-2 text-xs font-medium leading-4 text-ink-secondary">Role</legend>
      {#each options as option (option.role)}
        <label
          data-role-option={option.role}
          class={`flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2.5 transition-colors pointer-coarse:min-h-11 ${role === option.role ? "border-[1.5px] border-primary-selected bg-role-option-selected" : "border border-line bg-surface hover:bg-primary-wash"}`}
        >
          <input type="radio" name="invite-role" value={option.role} bind:group={role} disabled={sending} class="peer sr-only" />
          <span
            aria-hidden="true"
            class={`h-4 w-4 shrink-0 rounded-full bg-surface peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 ${role === option.role ? "border-[5px] border-primary-selected" : "border-[1.5px] border-line"}`}
          ></span>
          <RoleChip role={option.role} radius={4} />
          <span class="truncate text-[13px] leading-[18px] text-ink-muted">{option.line}</span>
        </label>
      {/each}
    </fieldset>
    {#if error}
      <p role="alert" class="mx-7 mb-4 rounded-[10px] border border-danger-line bg-danger-surface px-3 py-2 text-[13px] text-danger-ink-muted">{error}</p>
    {/if}
  {/if}
  {#snippet footer()}
    <div class="flex items-center gap-2 border-t border-line-soft py-4 pl-7 pr-5">
      {#if results}
        <span class="flex-1"></span>
        <button type="button" onclick={() => (open = false)} class="h-9 rounded-lg bg-fir px-4 text-sm leading-5 font-medium text-white hover:bg-navy-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">Done</button>
      {:else}
        <p class="flex-1 text-xs leading-4 text-ink-muted">Each link works for 7 days. You can resend it from Team.</p>
        <button type="button" disabled={sending} onclick={() => (open = false)} class="h-9 shrink-0 rounded-lg bg-destructive-soft px-3.5 text-sm leading-5 font-medium text-destructive-soft-ink hover:bg-destructive-soft-hover hover:text-destructive-soft-ink-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50">Cancel</button>
        <button
          type="button"
          data-send-invites
          disabled={sending || validCount === 0 || tooMany}
          onclick={send}
          class="h-9 shrink-0 rounded-lg bg-fir px-4 text-sm leading-5 font-medium text-white hover:bg-navy-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >{sending ? "Sending..." : sendLabel(validCount)}</button>
      {/if}
    </div>
  {/snippet}
</TeamDialog>
