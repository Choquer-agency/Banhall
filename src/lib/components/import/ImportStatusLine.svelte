<!--
  The one line under the Import toolbar (2026-11-12, Paper Files 2 and 3):
  what is arriving, in plain words and no progress bar. "52 files added, 12
  were already here. 31 read so far." for the signed-in admin's own drop,
  "Sending 64 files. 20 sent so far." while this tab sends, "Sam Okafor is
  uploading 412 files. 180 here so far." for another admin's, and "The
  uploader is sending files. 180 here so far." for the uploader, which says
  neither who nor how many. Files that could not be sent are counted, with
  "Try again" in the tab that holds them. The line goes a short while after
  its batch is read (importIntake.ts statusLine decides, on this tab's clock).

  A screen reader hears the line from its own copy, a status region that is
  always on the page (empty when there is nothing to say), so the first
  message is heard. That copy takes a new sentence soon and a count that
  changes on its own at most once a minute (spokenDueAt), so it never reads
  out every file. The line on screen is hidden from screen readers, so it is
  not read twice.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { useQuery } from "convex-svelte";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { api } from "../../../../convex/_generated/api";
  import { spokenDueAt, statusLine, type ActivityBatch } from "./importIntake";
  import { importUploads } from "./importUploads.svelte";

  let { onRetry }: { onRetry: () => void } = $props();

  const auth = useAuth();
  const activityQ = useQuery(api.ingestion.importActivity, () => (auth.isAuthenticated ? {} : "skip"));

  // The line's own clock: "running" and "a short while after" move with it.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 15_000);
    return () => clearInterval(timer);
  });

  const line = $derived(statusLine(importUploads.local, (activityQ.data ?? []) as ActivityBatch[], now));

  // ─── The spoken copy ─────────────────────────────────────────────────────
  let spoken = $state("");
  let spokenAt = 0;
  let latest = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dueAt = 0;

  function cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function speak() {
    timer = null;
    if (latest === spoken) return;
    spoken = latest;
    spokenAt = Date.now();
  }

  $effect(() => {
    latest = line?.text ?? "";
    const at = Date.now();
    const due = spokenDueAt(untrack(() => spoken), spokenAt, latest, at);
    if (due === null) return cancel();
    // A sooner time already set stays: it speaks the latest words then.
    if (timer !== null && dueAt <= due) return;
    cancel();
    dueAt = due;
    timer = setTimeout(speak, due - at);
  });
  $effect(() => cancel);
</script>

<p role="status" aria-live="polite" data-import-status-spoken class="sr-only">{spoken}</p>
{#if line}
  <div data-import-status class="-mt-1 flex min-h-5 flex-wrap items-center gap-x-1.5 gap-y-1">
    <p aria-hidden="true" data-import-status-text class="text-[0.8125rem] leading-[calc(18/13)] text-ink-secondary">{line.text}</p>
    {#if line.retry}
      <button
        type="button"
        data-import-status-retry
        disabled={importUploads.busy}
        onclick={onRetry}
        class="rounded-sm text-[0.8125rem] leading-[calc(18/13)] font-medium text-primary-selected transition-colors hover:text-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir disabled:text-ink-muted motion-reduce:transition-none pointer-coarse:min-h-11"
      >Try again</button>
    {/if}
  </div>
{/if}
