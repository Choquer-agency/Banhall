<script lang="ts">
  // TEMPORARY STUB (WS2 branch): WS1 owns SettingsSaveBar and replaces it on
  // rebase. Same prop contract: dirty, saving, idleText, saveLabel, onSave,
  // onDiscard.
  let {
    dirty,
    saving = false,
    idleText = "No changes yet",
    saveLabel = "Save changes",
    disabled = false,
    onSave,
    onDiscard,
  }: {
    dirty: boolean;
    saving?: boolean;
    idleText?: string;
    saveLabel?: string;
    disabled?: boolean;
    onSave: () => void;
    onDiscard: () => void;
  } = $props();
</script>

<div data-settings-save-bar class="flex items-center gap-3 border-t border-line-soft py-5">
  <p class="min-w-0 flex-1 text-[13px] text-ink-muted">{dirty ? "" : idleText}</p>
  {#if dirty}
    <button type="button" onclick={onDiscard} disabled={saving} class="h-9 rounded-lg px-3 text-[13px] font-medium text-ink-secondary hover:bg-primary-wash disabled:opacity-50">Discard</button>
  {/if}
  <button
    type="button"
    onclick={onSave}
    disabled={!dirty || saving || disabled}
    class="h-9 rounded-lg px-4 text-[13px] font-medium transition-colors enabled:bg-fir enabled:text-white disabled:bg-chrome disabled:text-ink-faint"
  >{saving ? "Saving..." : saveLabel}</button>
</div>
