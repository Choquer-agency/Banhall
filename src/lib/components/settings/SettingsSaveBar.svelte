<script lang="ts">
  /**
   * Settings save bar (I1, I1b). Clean: "No changes yet" and a disabled
   * "Save changes". Dirty: "Discard" and a fir "Save changes". Top hairline,
   * 20px above the buttons.
   */
  let {
    dirty,
    saving = false,
    disabled = false,
    idleText = "No changes yet",
    saveLabel = "Save changes",
    savingLabel = "Saving...",
    onSave,
    onDiscard,
  }: {
    dirty: boolean;
    saving?: boolean;
    /** Keeps Save off even when dirty (for example, instructions over the limit). */
    disabled?: boolean;
    idleText?: string;
    saveLabel?: string;
    savingLabel?: string;
    onSave: () => void;
    onDiscard: () => void;
  } = $props();
</script>

<div data-settings-save-bar class="mt-1 flex items-center gap-2.5 border-t border-line-soft pt-5">
  {#if dirty}
    <div class="grow"></div>
    <button
      type="button"
      data-settings-discard
      onclick={onDiscard}
      disabled={saving}
      class="inline-flex h-9 items-center rounded-md px-3.5 text-sm font-medium text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:opacity-50 motion-reduce:transition-none pointer-coarse:h-11"
    >Discard</button>
  {:else}
    <p class="grow text-[13px] leading-[18px] text-ink-muted" data-settings-idle>{idleText}</p>
  {/if}
  <button
    type="button"
    data-settings-save
    onclick={onSave}
    disabled={!dirty || saving || disabled}
    class={`inline-flex h-9 shrink-0 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11 ${
      dirty ? "bg-fir text-white hover:bg-navy-light disabled:opacity-70" : "cursor-not-allowed bg-chrome text-ink-faint"
    }`}
  >{saving ? savingLabel : saveLabel}</button>
</div>
