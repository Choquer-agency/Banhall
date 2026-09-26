<script lang="ts">
  // /settings/shortcuts (round 2, I4 and I5): the keys for this computer.
  // The Mac / Windows switch only changes the list shown; nothing is saved.
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { CheckCircleIcon } from "phosphor-svelte";
  import { api } from "../../../../convex/_generated/api";
  import KeyHint from "$lib/components/shell/KeyHint.svelte";
  import { canSeeAdmin } from "$lib/shell/navigation";
  import { SHORTCUTS, detectPlatform, type ShortcutId } from "$lib/shell/shortcuts";
  import { effectiveViewer } from "$lib/shell/viewAs.svelte";

  const auth = useAuth();
  const meQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  const viewer = $derived(effectiveViewer(meQ.data));
  // View as is for real developers, even while viewing as another role.
  const realDeveloper = $derived(meQ.data?.isDeveloper === true);

  const detected = detectPlatform();
  let shown = $state<"mac" | "windows">(detected === "mac" ? "mac" : "windows");

  const detectedCopy =
    detected === "mac"
      ? "We detected macOS, so these are the keys for your computer."
      : detected === "windows"
        ? "We detected Windows, so these are the keys for your computer."
        : "We could not detect your computer, so these are the Windows keys.";

  const rows = $derived.by((): ShortcutId[] => {
    const list: ShortcutId[] = ["search", "newProject", "collapseRail"];
    if (canSeeAdmin(viewer)) list.push("goAdmin");
    list.push("approveContinue");
    if (realDeveloper) list.push("viewAs");
    return list;
  });

  const segment =
    "flex h-7 items-center rounded-[6px] px-3 text-[13px] font-medium leading-[18px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11";
</script>

<svelte:head><title>Keyboard shortcuts - Settings</title></svelte:head>

<div data-settings-shortcuts class="flex flex-col gap-5">
  <div data-shortcuts-detected class="flex min-h-14 flex-wrap items-center gap-3 rounded-[10px] bg-chrome px-4 py-2.5">
    <CheckCircleIcon size={16} class="shrink-0 text-primary-selected" aria-hidden="true" />
    <p class="flex-1 text-[13px] leading-[18px] text-ink">{detectedCopy}</p>
    <div role="group" aria-label="Show keys for" class="flex gap-1 rounded-lg bg-surface p-0.5">
      <button
        type="button"
        aria-pressed={shown === "mac"}
        data-shortcuts-platform="mac"
        onclick={() => (shown = "mac")}
        class={`${segment} ${shown === "mac" ? "bg-primary-selected text-white" : "text-ink-secondary hover:bg-primary-wash hover:text-ink"}`}
      >Mac</button>
      <button
        type="button"
        aria-pressed={shown === "windows"}
        data-shortcuts-platform="windows"
        onclick={() => (shown = "windows")}
        class={`${segment} ${shown === "windows" ? "bg-primary-selected text-white" : "text-ink-secondary hover:bg-primary-wash hover:text-ink"}`}
      >Windows</button>
    </div>
  </div>

  <ul data-shortcuts-list class="flex flex-col">
    {#each rows as id (id)}
      <li data-shortcut-row={id} class="flex min-h-[57px] items-center gap-6 border-b border-line-soft py-3">
        <span class="flex-1 text-sm leading-5 text-ink">{SHORTCUTS[id].label}</span>
        <KeyHint {id} platform={shown} />
      </li>
    {/each}
  </ul>

  <p class="text-[13px] leading-[18px] text-ink-muted">
    Menus and tooltips show the same keys. Press ? anywhere to see this list.
  </p>
</div>
