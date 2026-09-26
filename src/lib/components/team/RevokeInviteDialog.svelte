<script lang="ts">
  // C5: confirm before a pending invite's link stops working. Keep invite
  // (chrome) and the filled red Revoke invite, both 36px with radius 8.
  import TeamDialog from "./TeamDialog.svelte";

  let {
    open = $bindable(false),
    email,
    busy = false,
    errorMessage = null,
    onConfirm,
  }: {
    open?: boolean;
    email: string;
    busy?: boolean;
    errorMessage?: string | null;
    onConfirm: () => void | Promise<void>;
  } = $props();
</script>

<TeamDialog
  bind:open
  width={460}
  {busy}
  testId="revoke-invite-dialog"
  title={`Revoke the invite for ${email}?`}
  description="The link stops working right away. You can invite them again later."
>
  {#if errorMessage}
    <p role="alert" class="mx-7 mt-4 rounded-lg border border-danger-line bg-danger-surface px-3 py-2 text-[13px] text-danger-ink-muted">{errorMessage}</p>
  {/if}
  {#snippet footer()}
    <div class="flex items-center justify-end gap-2 pb-[18px] pl-7 pr-5 pt-5">
      <button
        type="button"
        disabled={busy}
        onclick={() => (open = false)}
        class="h-9 rounded-lg bg-chrome px-3.5 text-sm leading-5 font-medium text-ink hover:bg-primary-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      >Keep invite</button>
      <button
        type="button"
        disabled={busy}
        onclick={() => void onConfirm()}
        class="h-9 rounded-lg bg-danger-action px-4 text-sm leading-5 font-medium text-white hover:bg-danger-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 disabled:opacity-50"
      >{busy ? "Revoking..." : "Revoke invite"}</button>
    </div>
  {/snippet}
</TeamDialog>
