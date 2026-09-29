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
   * On tablet and phone the stack sits above any sticky action bar (H1, H2
   * start bar, H4 cancel bar) so it never covers the page's primary action.
   *
   * Owner, 2026-09-28 (eighth): only notifications that arrive while this
   * tab is open (or just before it opened) show as cards. Older unseen ones
   * wait behind one small "N updates while you were away" pill that opens
   * them as cards, so hours-old news never covers the page on arrival.
   */
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { useMutation, useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { IconClose } from "$lib/components/icons";
  import { api } from "../../../../convex/_generated/api";
  import type { Id } from "../../../../convex/_generated/dataModel";
  import { isAiNotificationKind } from "../../../../shared/notifications";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import { stickyActionBarHeight } from "$lib/shell/stickyActionBars.svelte";

  const SHOW_FOR_MS = 24 * 60 * 60 * 1000;
  const MAX_CARDS = 3;
  // A notification written up to this long before the tab opened (a reload
  // right after it arrived) still counts as new.
  const NEW_GRACE_MS = 2 * 60 * 1000;
  const openedAt = Date.now();

  const auth = useAuth();
  const recentQ = useQuery(api.notifications.listRecent, () =>
    auth.isAuthenticated ? {} : "skip"
  );
  const markSeenMutation = useMutation(api.notifications.markSeen);

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
  const elsewhere = $derived(unseen.filter((row) => pathOf(row.href) !== page.url.pathname));
  const arrivedNow = $derived(elsewhere.filter((row) => row.createdAt >= openedAt - NEW_GRACE_MS));
  const waiting = $derived(elsewhere.filter((row) => row.createdAt < openedAt - NEW_GRACE_MS));
  let showWaiting = $state(false);
  const cards = $derived([...arrivedNow, ...(showWaiting ? waiting : [])].slice(0, MAX_CARDS));

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

{#if cards.length > 0 || waiting.length > 0}
  <section
    aria-label="Notifications"
    data-notification-toaster
    style:bottom={`calc(1rem + ${stickyActionBarHeight()}px)`}
    class="pointer-events-none fixed right-4 z-[100] flex w-[min(22.5rem,calc(100vw-2rem))] flex-col-reverse gap-2"
  >
    {#if waiting.length > 0 && !showWaiting}
      <button
        type="button"
        data-notification-waiting
        onclick={() => (showWaiting = true)}
        class="pointer-events-auto self-end rounded-xl border border-line-soft bg-surface px-3.5 py-2 text-sm leading-5 font-medium text-ink shadow-menu transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir motion-reduce:transition-none"
      >{waiting.length === 1 ? "1 update while you were away" : `${waiting.length} updates while you were away`}</button>
    {:else if showWaiting && waiting.length > 1}
      <button
        type="button"
        data-notification-dismiss-waiting
        onclick={() => void markSeen(waiting.map((row) => row._id))}
        class="pointer-events-auto self-end rounded-xl border border-line-soft bg-surface px-3 py-1.5 text-[0.8125rem] leading-[1.125rem] text-ink-muted shadow-menu transition-colors hover:bg-chrome hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-fir motion-reduce:transition-none"
      >Dismiss all {waiting.length} earlier updates</button>
    {/if}
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
            <span class="mt-0.5 block text-[0.8125rem] leading-[1.125rem] text-ink-muted" data-notification-body>{row.body}</span>
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
