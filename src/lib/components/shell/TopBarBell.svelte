<script lang="ts">
  /**
   * The page bar's bell below 1024px (What's new, with the unseen dot). From
   * 1024px the global bar holds the bell, so this one hides itself there.
   */
  import { resolve } from "$app/paths";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import { whatsNewLabel } from "$lib/shell/navigation";
  import { IconBell } from "$lib/components/icons";

  let { class: className = "" }: { class?: string } = $props();

  const auth = useAuth();
  const unseenQ = useQuery(api.changelog.unseenCount, () => (auth.isAuthenticated ? {} : "skip"));
  const unseen = $derived(unseenQ.data ?? 0);
</script>

<a
  href={resolve("/changelog")}
  data-top-bar-bell
  aria-label={whatsNewLabel(unseen)}
  class={`relative flex size-9 shrink-0 items-center justify-center rounded-[0.4375rem] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:size-11 lg:hidden ${className}`}
>
  <IconBell size={16} strokeWidth={1.5} />
  {#if unseen > 0}
    <span aria-hidden="true" class="absolute right-2.5 top-2 size-1.5 rounded-full bg-primary"></span>
  {/if}
</a>
