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
   * F6 danger box with Back to project and Try again
   * (retryInitializeSeedStage); people who cannot edit see the text only.
   */
  import { onDestroy } from "svelte";
  import { fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { useMutation, useQuery } from "convex-svelte";
  import { api } from "../../../../../convex/_generated/api";
  import type { Id } from "../../../../../convex/_generated/dataModel";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import { IconAlertCircle, IconBell } from "$lib/components/icons";
  import AuroraProgressPill from "../writing/AuroraProgressPill.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { compactSource, factCountText, factOpacities, readingPercent } from "./readingProgress";

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
  const opacities = $derived(factOpacities(layout));
  const visible = $derived((view?.latest ?? []).slice(0, opacities.length));

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

  // F6 box buttons: 28px, radius 6, 13px 500 (44px on coarse pointers).
  const failedButton =
    "inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-[13px] leading-[18px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none pointer-coarse:min-h-11";

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

<!-- F2 (desktop): pill, cards and note centred in the panel, 20px apart.
     H3 (tablet): the same, 12px apart, two cards. H4 (phone): from the top
     with 40px above and 16px margins, three cards, and the bottom bar. -->
<div data-reading-interview data-layout={layout} class="flex min-h-full w-full flex-col">
  <div
    class={`flex flex-1 flex-col items-center ${
      phone ? "gap-3 px-4 pt-10 pb-8" : layout === "tablet" ? "justify-center gap-3 px-6 py-10" : "justify-center gap-5 px-6 py-10"
    }`}
  >
    {#if failed}
      <!-- F6 "Reading the transcripts failed": the box, its paragraph and
           its buttons in the red family; Back to project, then Try again. -->
      <div class="w-full max-w-[520px]" data-reading-failed>
        <div
          role="alert"
          data-reading-failed-box
          class="flex gap-2.5 rounded-xl border border-reading-failed-line bg-danger-surface p-3.5"
        >
          <IconAlertCircle size={18} strokeWidth={1.8} stroke-linejoin="miter" class="shrink-0 text-danger-ink-muted" />
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <p class="text-sm leading-5 font-medium text-danger-ink">We could not read the transcripts</p>
            <p class="text-[13px] leading-[18px] text-reading-failed-body" data-reading-failed-body>
              Your files are still here. Try again, or cancel to change them.
            </p>
            {#if canEdit}
              <div class="flex flex-wrap gap-2 pt-2.5">
                {#if onBack}
                  <button
                    type="button"
                    data-reading-back
                    onclick={() => onBack?.()}
                    class={`${failedButton} bg-danger-soft text-danger-ink hover:bg-destructive-soft-hover`}
                  >Back to project</button>
                {/if}
                <button
                  type="button"
                  data-reading-retry
                  onclick={retry}
                  disabled={retrying}
                  class={`${failedButton} bg-danger text-surface hover:bg-danger-action-hover`}
                >{retrying ? "Trying again..." : "Try again"}</button>
              </div>
            {/if}
          </div>
        </div>
        {#if retryError}<p role="alert" data-reading-retry-error class="mt-2 text-[13px] text-danger-ink-muted">{retryError}</p>{/if}
      </div>
    {:else}
      <AuroraProgressPill
        data-reading-pill
        {percent}
        progressLabel="Reading the interview"
        valueText={countText}
        shadow="var(--shadow-reading-pill)"
        innerClass="h-10 gap-2.5 pl-[9px] pr-4"
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
            style={`opacity:${opacities[index] ?? opacities[opacities.length - 1]}`}
            in:fly={{ y: reducedMotion ? 0 : 4, duration: reducedMotion ? 0 : 300, easing: cubicOut }}
          >
            <div class="flex items-center gap-2">
              <span
                data-reading-chip
                class="flex h-5 items-center rounded-[5px] bg-seed-tag-technical px-[7px] text-[11px] leading-4 font-medium text-primary-selected"
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
        <p class={`flex items-center gap-1.5 text-[13px] leading-[19px] text-ink-muted ${layout === "tablet" ? "pt-2" : "pt-2.5"}`} data-reading-note>
          <IconBell size={14} strokeWidth={1.6} class="shrink-0" />
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
        <Button variant="destructive-soft" class="h-11 w-full px-3.5! py-0! text-[15px]! leading-5!" onclick={onCancel} data-reading-cancel>Cancel generation</Button>
      {/if}
    </div>
  {/if}
</div>
