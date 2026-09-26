<script lang="ts">
  // /settings/shortcuts (round 2, I4 and I5): the keys for this computer.
  // The Mac / Windows switch only changes the list shown; nothing is saved.
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import KeyHint from "$lib/components/shell/KeyHint.svelte";
  import { IconCheck } from "$lib/components/icons";
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
    "flex h-7 items-center rounded-[6px] px-2.5 text-[13px] font-medium leading-[18px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:h-11";
  const segmentOn = "bg-surface text-ink shadow-settings-segment";
  const segmentOff = "text-ink-secondary hover:bg-primary-wash hover:text-ink";
</script>

<svelte:head><title>Keyboard shortcuts - Settings</title></svelte:head>

<div data-settings-shortcuts class="flex flex-col gap-6">
  <div data-shortcuts-detected class="flex flex-wrap items-center gap-3 rounded-xl bg-canvas px-3.5 py-3">
    <IconCheck size={15} strokeWidth={2} class="shrink-0 text-primary-selected" />
    <p class="flex-1 text-[13px] leading-[18px] text-ink-secondary">{detectedCopy}</p>
    <div role="group" aria-label="Show keys for" data-shortcuts-platforms class="flex gap-1 rounded-[9px] bg-chrome p-[3px]">
      <button
        type="button"
        aria-pressed={shown === "mac"}
        data-shortcuts-platform="mac"
        onclick={() => (shown = "mac")}
        class={`${segment} ${shown === "mac" ? segmentOn : segmentOff}`}
      >Mac</button>
      <button
        type="button"
        aria-pressed={shown === "windows"}
        data-shortcuts-platform="windows"
        onclick={() => (shown = "windows")}
        class={`${segment} ${shown === "windows" ? segmentOn : segmentOff}`}
      >Windows</button>
    </div>
  </div>

  <ul data-shortcuts-list class="flex flex-col">
    {#each rows as id, index (id)}
      <li
        data-shortcut-row={id}
        class={`flex items-center gap-6 py-4 ${index === rows.length - 1 ? "" : "border-b border-line-soft"}`}
      >
        <span class="min-w-0 flex-1 text-sm font-medium leading-5 text-ink md:w-[280px] md:flex-none">{SHORTCUTS[id].label}</span>
        <KeyHint {id} platform={shown} />
      </li>
    {/each}
  </ul>

  <p class="text-[13px] leading-[18px] text-ink-muted">
    Menus and tooltips show the same keys. Press ? anywhere to see this list.
  </p>
</div>
