<script lang="ts">
  // J3 returning-user card: avatar 36px, name 14px 500, email 12px muted and
  // "Use another account" at the right.
  import Avatar from "$lib/components/ui/Avatar.svelte";

  let {
    name,
    email,
    initials,
    onUseAnother,
  }: { name: string | null; email: string; initials: string; onUseAnother: () => void } = $props();
</script>

<div data-account-card class="flex min-h-14 items-center gap-3 rounded-xl border border-line-soft bg-surface px-3 py-2.5">
  <Avatar name={name ?? email} {initials} size={36} />
  <div class="flex min-w-0 flex-1 flex-col">
    {#if name}<span class="truncate text-sm leading-5 font-medium text-ink">{name}</span>{/if}
    <span class={`truncate ${name ? "text-xs leading-4 text-ink-muted" : "text-sm leading-5 font-medium text-ink"}`}>{email}</span>
  </div>
  <button
    type="button"
    data-use-another-account
    onclick={onUseAnother}
    class="shrink-0 rounded text-[13px] leading-[18px] font-medium text-primary-selected hover:text-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
  >Use another account</button>
</div>
