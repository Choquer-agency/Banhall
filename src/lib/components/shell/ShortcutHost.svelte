<script lang="ts">
  /**
   * Global single-key shortcuts for the shell (I4, I5). Mod K stays with the
   * command palette and Mod Enter belongs to the page that approves (WS3,
   * `isModEnter`). None fire while typing, inside the editor or in a dialog.
   */
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { ADMIN_LANDING_PATH } from "$lib/dashboard/adminRoutes";
  import { createSequence, isTypingTarget } from "$lib/shell/shortcuts";

  let {
    onToggleRail,
    canOpenAdmin,
    canViewAs,
    onOpenViewAs,
  }: {
    onToggleRail: () => void;
    /** Effective viewer holds settings.configure (G then A). */
    canOpenAdmin: boolean;
    /** Real developer (Shift V). */
    canViewAs: boolean;
    onOpenViewAs: () => void;
  } = $props();

  const goAdmin = createSequence(["G", "A"]);

  function onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing) return;
    const key = event.key;
    const mod = event.metaKey || event.ctrlKey;

    // Mod \ toggles the rail, except inside fields and the editor.
    if (mod && !event.altKey && !event.shiftKey && key === "\\") {
      if (isTypingTarget(event)) return;
      event.preventDefault();
      onToggleRail();
      return;
    }

    if (mod || event.altKey || isTypingTarget(event)) {
      goAdmin.reset();
      return;
    }

    if (key === "?") {
      event.preventDefault();
      goAdmin.reset();
      void goto(resolve("/settings/shortcuts" as "/"));
      return;
    }
    if (event.shiftKey && (key === "V" || key === "v")) {
      goAdmin.reset();
      if (!canViewAs) return;
      event.preventDefault();
      onOpenViewAs();
      return;
    }
    if (event.shiftKey) {
      goAdmin.reset();
      return;
    }
    if (goAdmin.press(key)) {
      if (!canOpenAdmin) return;
      event.preventDefault();
      void goto(resolve(ADMIN_LANDING_PATH as "/"));
      return;
    }
    if ((key === "c" || key === "C") && !event.repeat) {
      event.preventDefault();
      void goto(resolve("/project/new"));
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />
