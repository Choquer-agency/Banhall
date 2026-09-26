<script lang="ts">
  /**
   * In-app notifications (I3, F6 card): unseen notifications from the last
   * 24 hours as cards at the bottom right, newest first, at most three.
   * Clicking a card opens its page and marks it seen; closing marks it seen.
   * A notification about the page the person is already on is marked seen
   * without showing. In-app only: email waits for a provider (decision 54).
   *
   * The card is F6's "If the writer left the page": white, radius 12, a
   * line-soft hairline, 14px padding and 10px gap, the 22px AI mark for AI
   * kinds, a 14px 500 title and a 13px muted line. As a floating card it
   * keeps the menu shadow and a close button, which the board does not draw.
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { IconClose } from "$lib/components/icons";
  import { round2Api } from "../../../../convex/lib/round2Api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { isAiNotificationKind } from "../../../../shared/notifications";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";

  const SHOW_FOR_MS = 24 * 60 * 60 * 1000;
  const MAX_CARDS = 3;

  const auth = useAuth();
  const recentQ = useQuery(round2Api.notifications.listRecent, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const markSeenMutation = useMutation(round2Api.notifications.markSeen);

  // Closed or opened in this tab: hidden at once, before the server echoes seenAt.
  let handled = $state<Record<string, true>>({});
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  const unseen = $derived(
    (recentQ.data ?? []).filter(
      (row) => row.seenAt === undefined && now - row.createdAt < SHOW_FOR_MS && !handled[row._id]
    )
  );

  function pathOf(href: string) {
    return href.split(/[?#]/)[0];
  }

  const onThisPage = $derived(unseen.filter((row) => pathOf(row.href) === page.url.pathname));
  const cards = $derived(
    unseen.filter((row) => pathOf(row.href) !== page.url.pathname).slice(0, MAX_CARDS)
  );

  async function markSeen(ids: Id<"notifications">[]) {
    if (ids.length === 0) return;
    const next = { ...handled };
    for (const id of ids) next[id] = true;
    handled = next;
    try {
      await markSeenMutation({ ids });
    } catch (error) {
      // Seen state is a convenience; the card stays dismissed in this tab.
      console.error("Could not mark notifications seen", error);
    }
  }

  $effect(() => {
    if (onThisPage.length > 0) void markSeen(onThisPage.map((row) => row._id));
  });

  function open(row: (typeof cards)[number]) {
    void markSeen([row._id]);
    void goto(row.href);
  }
</script>

{#if cards.length > 0}
  <section
    aria-label="Notifications"
    data-notification-toaster
    class="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(360px,calc(100vw-2rem))] flex-col-reverse gap-2"
  >
    {#each cards as row (row._id)}
      <div
        data-notification={row.kind}
        role="status"
        class="pointer-events-auto relative flex gap-2.5 rounded-xl border border-line-soft bg-surface p-3.5 shadow-menu"
      >
        {#if isAiNotificationKind(row.kind)}
          <AuroraMark size={22} />
        {/if}
        <button
          type="button"
          data-notification-open
          onclick={() => open(row)}
          class="min-w-0 flex-1 rounded-md pr-6 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir"
        >
          <span class="block text-sm leading-5 font-medium text-ink" data-notification-title>{row.title}</span>
          {#if row.body}
            <span class="mt-0.5 block text-[13px] leading-[18px] text-ink-muted" data-notification-body>{row.body}</span>
          {/if}
        </button>
        <button
          type="button"
          data-notification-close
          aria-label={`Dismiss: ${row.title}`}
          onclick={() => void markSeen([row._id])}
          class="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-chrome hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none pointer-coarse:size-11"
        >
          <IconClose size={14} strokeWidth={1.8} />
        </button>
      </div>
    {/each}
  </section>
{/if}
