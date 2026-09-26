<script lang="ts">
  // Test harness: ShortcutHost plus a field, a rich-text area and a dialog.
  import ShortcutHost from "./ShortcutHost.svelte";
  let {
    onToggleRail,
    onOpenViewAs,
    canOpenAdmin = false,
    canViewAs = false,
  }: {
    onToggleRail: () => void;
    onOpenViewAs: () => void;
    canOpenAdmin?: boolean;
    canViewAs?: boolean;
  } = $props();
</script>

<ShortcutHost {onToggleRail} {onOpenViewAs} {canOpenAdmin} {canViewAs} />
<input class="field-control" data-testid="field" />
<div class="ProseMirror" contenteditable="true" data-testid="editor"><p>Text</p></div>
<button type="button" data-testid="plain">Plain</button>
