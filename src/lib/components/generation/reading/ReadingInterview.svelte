<script lang="ts">
  /**
   * Reading the interview (boards F2, H3, H4; decision 57): while the
   * Step-by-step Brief is written, the panel shows only the centred pill and
   * the facts found so far, newest first and fading down the list. The pill
   * counts them and its border fills in the AI gradient on a time-based
   * estimate, held below 100% until the Brief lands. Facts come from
   * seeds.getReadingFacts (display-only rows written as the Brief streams).
   *
   * When the seed stage could not start (F6), the reading content becomes the
   * danger box with Try again (retryInitializeSeedStage) and Back to project;
   * people who cannot edit see the text only.
   */
  import { onDestroy } from "svelte";
  import { fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { useMutation, useQuery } from "convex-svelte";
  import { BellIcon } from "phosphor-svelte";
  import { api } from "../../../../../convex/_generated/api";
  import type { Id } from "../../../../../convex/_generated/dataModel";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import StatusCallout from "$lib/components/ui/StatusCallout.svelte";
  import AuroraProgressPill from "../writing/AuroraProgressPill.svelte";
  import { seedTagStyle } from "$lib/components/seeds/seedTags";
  import { userErrorMessage } from "$lib/errors";
  import { compactSource, factCountText, FACT_OPACITIES, readingPercent } from "./readingProgress";

  let {
    generationId,
    failed = false,
    canEdit = false,
    layout = "desktop",
    onCancel,
    onBack,
  }: {
    generationId: Id<"generations">;
    /** The seed stage could not start (seedStageError). */
    failed?: boolean;
    canEdit?: boolean;
    layout?: "desktop" | "tablet" | "phone";
    /** Opens the host's Cancel generation confirm (phone bottom bar). */
    onCancel?: () => void;
    /** "Back to project" from the failure box (decision 58). */
    onBack?: () => void;
  } = $props();

  const factsQ = useQuery(api.seeds.getReadingFacts, () => ({ generationId }));
  const view = $derived(factsQ.data ?? null);
  const phone = $derived(layout === "phone");
  const visible = $derived((view?.latest ?? []).slice(0, phone || layout === "tablet" ? 2 : 3));
  const chip = seedTagStyle("technical");

  // Time-based fill (decision 57), forward only.
  let now = $state(Date.now());
  const timer = setInterval(() => (now = Date.now()), 500);
  onDestroy(() => clearInterval(timer));
  let highest = 0;
  const percent = $derived.by(() => {
    if (!view) return highest;
    highest = Math.max(highest, readingPercent(now, view.startedAt, view.expectedMs, view.done));
    return highest;
  });
  const countText = $derived(factCountText(view?.count ?? 0, phone));

  // Polite announcement of the newest fact, at most every 4 seconds.
  let announcement = $state("");
  let lastSeq = 0;
  let lastAnnounced = 0;
  $effect(() => {
    const newest = view?.latest[0];
    if (!newest || newest.seq <= lastSeq) return;
    lastSeq = newest.seq;
    const at = Date.now();
    if (at - lastAnnounced < 4_000) return;
    lastAnnounced = at;
    announcement = `New fact: ${newest.chip}, ${newest.quote}`;
  });

  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // F6 reading failed: the existing retry, with SeedInitializationRecovery's
  // guarantees (R6-07). Capability is checked again at dispatch, a second
  // click before the pending state renders is refused, and a completion after
  // this screen is gone (the host keys it by generation) changes nothing.
  const retryInitialize = useMutation(api.generations.retryInitializeSeedStage);
  let retrying = $state(false);
  let retryError = $state<string | null>(null);
  let destroyed = false;
  onDestroy(() => (destroyed = true));
  async function retry() {
    if (!canEdit || retrying) return;
    retrying = true;
    retryError = null;
    try {
      await retryInitialize({ generationId });
    } catch (cause) {
      if (!destroyed) retryError = userErrorMessage(cause, "Seed preparation could not be retried.");
    } finally {
      if (!destroyed) retrying = false;
    }
  }
</script>

<div data-reading-interview data-layout={layout} class="flex min-h-full w-full flex-col">
  <div
    class={`flex flex-1 flex-col items-center justify-center gap-5 ${phone ? "px-4 py-8" : "px-6 py-10"}`}
  >
    {#if failed}
      <div class="w-full max-w-[520px]" data-reading-failed>
        <!-- Two instances rather than actions that come and go: a callout
             whose action disappears mid-render would read the old one. -->
        {#if canEdit}
          <StatusCallout
            tone="danger"
            layout="stacked"
            title="We could not read the transcripts"
            role="alert"
            primaryAction={{ label: retrying ? "Trying again..." : "Try again", onclick: retry, disabled: retrying }}
            secondaryAction={onBack ? { label: "Back to project", onclick: () => onBack?.() } : undefined}
          >
            Your files are still here. Try again, or cancel to change them.
          </StatusCallout>
        {:else}
          <StatusCallout tone="danger" layout="stacked" title="We could not read the transcripts" role="alert">
            Your files are still here. Try again, or cancel to change them.
          </StatusCallout>
        {/if}
        {#if retryError}<p role="alert" data-reading-retry-error class="mt-2 text-[13px] text-danger-ink-muted">{retryError}</p>{/if}
      </div>
    {:else}
      <AuroraProgressPill
        data-reading-pill
        {percent}
        progressLabel="Reading the interview"
        valueText={countText}
        shadow="0 6px 24px #8438FF1F"
        innerClass="h-9 gap-2.5 pl-[9px] pr-4"
      >
        <AuroraMark size={22} />
        <span class="text-sm leading-5 font-medium whitespace-nowrap text-ink">Reading the interview</span>
        <span class="text-[13px] leading-[19px] whitespace-nowrap text-ink-muted" data-reading-count>{countText}</span>
      </AuroraProgressPill>

      <ol class="flex w-full flex-col items-center gap-2.5 pt-2" aria-label="Facts found so far">
        {#each visible as fact, index (fact.seq)}
          <li
            data-reading-fact={fact.seq}
            class="flex w-full max-w-[520px] flex-col gap-1.5 rounded-xl border border-line-soft bg-surface px-[18px] py-4 transition-opacity duration-300 motion-reduce:transition-none"
            style={`opacity:${FACT_OPACITIES[index] ?? 0.3}`}
            in:fly={{ y: reducedMotion ? 0 : 4, duration: reducedMotion ? 0 : 300, easing: cubicOut }}
          >
            <div class="flex items-center gap-2">
              <span
                data-reading-chip
                class="flex h-5 items-center rounded-[5px] px-[7px] text-[11px] leading-4 font-medium"
                style={`background:${chip.background};color:${chip.color}`}
              >{fact.chip}</span>
              <span class="grow"></span>
              <span class="truncate text-xs leading-4 text-ink-faint" data-reading-source>{phone ? compactSource(fact.sourceLabel) : fact.sourceLabel}</span>
            </div>
            <p class="font-serif text-base leading-6 text-ink" data-reading-quote>"{fact.quote}"</p>
          </li>
        {/each}
      </ol>
      <p class="sr-only" aria-live="polite" data-reading-announcement>{announcement}</p>

      {#if !phone}
        <p class="flex items-center gap-1.5 pt-2.5 text-[13px] leading-[19px] text-ink-muted" data-reading-note>
          <BellIcon size={14} aria-hidden="true" class="shrink-0" />
          You can leave this page. We will let you know when the first ideas are ready.
        </p>
      {/if}
    {/if}
  </div>

  {#if phone}
    <div data-reading-bottom class="sticky bottom-0 flex flex-col items-center gap-1.5 border-t border-line-soft bg-surface px-4 pt-3.5 pb-[30px]">
      {#if !failed}
        <p class="text-center text-[13px] leading-[18px] text-ink-muted">You can leave. We will notify you when ideas are ready.</p>
      {/if}
      {#if canEdit && onCancel}
        <Button variant="destructive-soft" class="h-11 w-full py-0! text-[15px]!" onclick={onCancel} data-reading-cancel>Cancel generation</Button>
      {/if}
    </div>
  {/if}
</div>
