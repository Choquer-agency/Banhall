<script lang="ts" module>
  export type StartRunMode = "iterative" | "single" | "compare" | "review";

  export type StartRunSource = {
    id: string;
    kind: "transcript" | "document" | "writtenPd";
    name: string;
    /** The chip at the right: "Transcript" or the document category label. */
    typeLabel: string;
    /** "9,240 words", "3 sections found", "12 pages". */
    meta: string;
    /** True while the browser is still reading the file. */
    reading?: boolean;
    /** Seconds until a file still being read is ready, or null when unknown. */
    readingEtaSeconds?: number | null;
    /** The written PD in a review: always included, shown with a lock. */
    locked?: boolean;
  };

  export type StartRunExcluded = { transcriptIds: string[]; documentIds: string[] };

  /** F1, G1 to G3 copy (ws3 spec section 3). */
  export const START_RUN_COPY: Record<StartRunMode, { title: string; subtitle: string }> = {
    iterative: {
      title: "Choose what the ideas come from",
      subtitle: "Untick anything you do not want used this time. Files lock once you start.",
    },
    single: {
      title: "Choose what the draft comes from",
      subtitle: "Untick anything you do not want used this time. Files lock once you start.",
    },
    compare: {
      title: "Choose what the drafts come from",
      subtitle: "Untick anything you do not want used this time. Files lock once you start.",
    },
    review: {
      title: "Choose what the review checks against",
      subtitle: "Your draft is always reviewed. Untick anything you do not want it checked against.",
    },
  };

  /** "Still reading, ready in about 20 seconds" (rounded to 5), or "Still reading". */
  export function readingMeta(etaSeconds: number | null | undefined): string {
    if (etaSeconds === null || etaSeconds === undefined || !Number.isFinite(etaSeconds)) {
      return "Still reading";
    }
    const rounded = Math.max(5, Math.round(etaSeconds / 5) * 5);
    return `Still reading, ready in about ${rounded} seconds`;
  }

  export function confirmLabel(mode: StartRunMode, tickedCount: number): string {
    switch (mode) {
      case "iterative":
        return `Start with ${tickedCount} ${tickedCount === 1 ? "file" : "files"}`;
      case "single":
        return "Write the draft";
      case "compare":
        return "Write 2 drafts";
      case "review":
        return "Start the review";
    }
  }

  export const NOTHING_TICKED_MESSAGE = "Tick at least one transcript or current file.";

  /** F6: a run already going on this project (user-safe fields only). */
  export type ActiveRun = {
    generationId: string;
    requestedByName: string;
    isYou: boolean;
    candidateMode: "iterative" | "single" | "compare";
    startedAt: number;
  };

  const RUN_LABELS: Record<ActiveRun["candidateMode"], string> = {
    iterative: "Step by step run",
    single: "Single draft",
    compare: "Compare run",
  };

  /** "just now", "12 min ago", "3 hours ago", "yesterday", then a date. */
  export function startedAgo(startedAt: number, now: number): string {
    const minutes = Math.floor(Math.max(0, now - startedAt) / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
    if (hours < 48) return "yesterday";
    return `on ${new Date(startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }

  export function activeRunCopy(run: ActiveRun, now: number): { title: string; text: string } {
    return {
      title: run.isYou ? "You are already running this project" : `${run.requestedByName} is already running this project`,
      text: `A ${RUN_LABELS[run.candidateMode]} started ${startedAgo(run.startedAt, now)}. One run at a time per project.`,
    };
  }

  /**
   * The run a refused start named: GENERATION_ACTIVE carries its user-safe
   * details (reservation.ts). Null for any other error.
   */
  export function activeRunFromError(error: unknown, currentUserName?: string | null): ActiveRun | null {
    const data = (error as { data?: Record<string, unknown> } | null)?.data;
    if (!data || data.code !== "GENERATION_ACTIVE" || typeof data.generationId !== "string") return null;
    const mode = data.candidateMode;
    const name = typeof data.requestedByName === "string" ? data.requestedByName : "Someone";
    return {
      generationId: data.generationId,
      requestedByName: name,
      isYou: Boolean(currentUserName) && name === currentUserName,
      candidateMode: mode === "iterative" || mode === "single" ? mode : "compare",
      startedAt: Number(data.startedAt) || Date.now(),
    };
  }
</script>

<script lang="ts">
  /**
   * The start and confirm dialog (boards F1, G1, G2, G3). Every file is
   * ticked when it opens; unticked files are left out of this run only
   * (decision 56). The footer names the models that will run (decision 52)
   * next to one AI mark, Compare included.
   *
   * Focus: opening lands on the first checkbox (or Cancel with none);
   * closing without confirming returns focus to `returnFocus()`, the start
   * button that opened it.
   */
  import { tick } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { Checkbox, Dialog } from "bits-ui";
  import { overlayFade, modalPop } from "$lib/motion";
  import AuroraMark from "$lib/components/ui/AuroraMark.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import FileIcon from "$lib/components/ui/FileIcon.svelte";
  import StatusCallout from "$lib/components/ui/StatusCallout.svelte";

  let {
    open = $bindable(false),
    mode,
    sources,
    models,
    busy = false,
    blockingMessage = null,
    validate,
    onConfirm,
    onCancel,
    returnFocus,
    activeRun = null,
    onOpenActiveRun,
  }: {
    open?: boolean;
    mode: StartRunMode;
    sources: StartRunSource[];
    /** The AI mark row: model names over what they do. */
    models: { title: string; line: string };
    busy?: boolean;
    /** A problem that blocks confirming, from outside the dialog. */
    blockingMessage?: string | null;
    /** A problem the current selection causes (the previous-year rule). */
    validate?: (excluded: StartRunExcluded) => string | null;
    onConfirm: (excluded: StartRunExcluded) => void;
    onCancel?: () => void;
    returnFocus?: () => HTMLElement | null | undefined;
    /** F6: a run already going on this project; the start waits for it. */
    activeRun?: ActiveRun | null;
    /** "Open it": go to the running project. */
    onOpenActiveRun?: () => void;
  } = $props();

  const unticked = new SvelteSet<string>();
  let confirmedClose = false;
  const cancelId = $props.id();

  const tickable = $derived(sources.filter((source) => !source.locked));
  const excluded = $derived<StartRunExcluded>({
    transcriptIds: tickable.filter((s) => s.kind === "transcript" && unticked.has(s.id)).map((s) => s.id),
    documentIds: tickable.filter((s) => s.kind === "document" && unticked.has(s.id)).map((s) => s.id),
  });
  const tickedCount = $derived(sources.filter((s) => s.locked || !unticked.has(s.id)).length);
  const anyTickedReading = $derived(
    sources.some((s) => s.reading && (s.locked || !unticked.has(s.id)))
  );
  const nothingTicked = $derived(
    mode !== "review" && tickable.length > 0 && tickable.every((s) => unticked.has(s.id))
  );
  const problem = $derived(
    blockingMessage ?? (nothingTicked ? NOTHING_TICKED_MESSAGE : (validate?.(excluded) ?? null))
  );
  const runCopy = $derived(activeRun ? activeRunCopy(activeRun, Date.now()) : null);
  const copy = $derived(START_RUN_COPY[mode]);

  function toggle(id: string, next: boolean) {
    if (next) unticked.delete(id);
    else unticked.add(id);
  }

  function confirm() {
    if (problem || busy || activeRun) return;
    confirmedClose = true;
    onConfirm({ transcriptIds: [...excluded.transcriptIds], documentIds: [...excluded.documentIds] });
  }
</script>

<Dialog.Root
  bind:open
  onOpenChange={(isOpen) => {
    if (isOpen) {
      confirmedClose = false;
      unticked.clear();
    } else if (!confirmedClose) {
      onCancel?.();
    }
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open: isOpen })}
        {#if isOpen}
          <div {...props} transition:overlayFade data-start-run-scrim class="fixed inset-0 z-[110] bg-[#010505]/75"></div>
        {/if}
      {/snippet}
    </Dialog.Overlay>
    <div class="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center p-4">
      <Dialog.Content
        forceMount
        onOpenAutoFocus={(event) => {
          const first =
            document.querySelector<HTMLElement>("[data-start-run-dialog] [data-start-run-check]") ??
            document.getElementById(cancelId);
          if (!first) return;
          event.preventDefault();
          first.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          void tick().then(() => returnFocus?.()?.focus());
        }}
      >
        {#snippet child({ props, open: isOpen })}
          {#if isOpen}
            <div
              {...props}
              transition:modalPop
              data-start-run-dialog
              data-mode={mode}
              class="pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-[580px] flex-col overflow-hidden rounded-[16px] border border-line bg-surface shadow-[0_24px_64px_rgba(5,42,40,0.25)]"
            >
              <div class="flex items-start gap-4 pt-6 pr-5 pl-7">
                <div class="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Dialog.Title class="text-title leading-6">{copy.title}</Dialog.Title>
                  <Dialog.Description class="text-sm leading-5 text-ink-muted">{copy.subtitle}</Dialog.Description>
                </div>
                <Dialog.Close
                  aria-label="Close"
                  class="-mt-1.5 -mr-1.5 flex size-11 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-primary-wash hover:text-ink motion-reduce:transition-none"
                >
                  <svg class="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </Dialog.Close>
              </div>

              <ul class="flex min-h-0 flex-col overflow-y-auto px-7 pt-2.5" aria-label="Files">
                {#each sources as source (source.id)}
                  {@const ticked = source.locked || !unticked.has(source.id)}
                  <li
                    data-start-run-row={source.id}
                    data-kind={source.kind}
                    data-ticked={ticked}
                    class={`flex shrink-0 items-center gap-3 border-b border-line-soft ${source.locked ? "h-14" : "h-12"}`}
                  >
                    {#if source.locked}
                      <span class="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-chrome text-ink-secondary" data-start-run-lock aria-hidden="true">
                        <svg class="size-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                      </span>
                    {:else}
                      <Checkbox.Root
                        checked={ticked}
                        onCheckedChange={(next) => toggle(source.id, next === true)}
                        aria-label={`Use ${source.name}`}
                        data-start-run-check={source.id}
                        class="inline-flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] text-white transition-colors duration-150 ease-out motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fir data-[state=checked]:border-fir data-[state=checked]:bg-fir data-[state=unchecked]:border-gray-300 data-[state=unchecked]:bg-surface data-[state=unchecked]:hover:border-gray-400"
                      >
                        {#snippet children({ checked })}
                          {#if checked}
                            <svg class="size-[11px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                          {/if}
                        {/snippet}
                      </Checkbox.Root>
                    {/if}
                    <div class={`flex min-w-0 flex-1 items-center gap-2.5 transition-opacity motion-reduce:transition-none ${ticked ? "" : "opacity-50"}`} data-start-run-body>
                      <span class="flex size-7 shrink-0 items-center justify-center"><FileIcon name={source.name} size={28} /></span>
                      <div class="flex min-w-0 flex-col">
                        <span class="truncate text-sm leading-[18px] font-medium text-ink">{source.name}</span>
                        <span
                          data-start-run-meta
                          class={`truncate text-xs leading-4 ${source.reading ? "text-ink-faint" : "text-ink-muted"}`}
                        >
                          {source.reading ? readingMeta(source.readingEtaSeconds) : source.meta}
                        </span>
                      </div>
                    </div>
                    {#if source.locked}
                      <span data-start-run-chip class="flex h-[18px] shrink-0 items-center rounded-[4px] bg-primary-wash px-1.5 text-xs leading-[14px] font-medium text-primary-selected">
                        Being reviewed
                      </span>
                    {:else}
                      <span data-start-run-chip class={`flex h-[18px] shrink-0 items-center rounded-[4px] bg-chrome px-1.5 text-xs leading-[14px] font-medium text-ink-secondary ${ticked ? "" : "opacity-50"}`}>
                        {source.typeLabel}
                      </span>
                    {/if}
                  </li>
                {/each}
              </ul>

              {#if anyTickedReading}
                <div class="flex items-start gap-2 px-7 pt-2.5" data-start-run-reading-note>
                  <span class="aurora-spin mt-0.5 size-3.5 shrink-0 rounded-full border-2 border-[var(--aurora-track)] border-t-ink-muted" aria-hidden="true"></span>
                  <p class="text-xs leading-[17px] text-ink-muted">Files still being read are used as soon as they are ready. Untick one to start without it.</p>
                </div>
              {/if}
              {#if problem}
                <p role="alert" data-start-run-problem class="px-7 pt-2.5 text-xs leading-[17px] text-danger-ink-muted">{problem}</p>
              {/if}
              {#if runCopy}
                <!-- F6: one run at a time per project. -->
                <div class="px-7 pt-3" data-start-run-active>
                  <StatusCallout
                    tone="warning"
                    layout="stacked"
                    title={runCopy.title}
                    role="alert"
                    primaryAction={{ label: "Open it", onclick: () => onOpenActiveRun?.() }}
                    secondaryAction={{ label: "Close", onclick: () => (open = false) }}
                  >
                    {runCopy.text}
                  </StatusCallout>
                </div>
              {/if}

              <div class="flex flex-wrap items-center gap-2 pt-[18px] pr-5 pb-5 pl-7">
                <div class="flex min-w-0 flex-1 items-center gap-2" data-start-run-models>
                  <AuroraMark size={18} />
                  <div class="flex min-w-0 flex-col">
                    <span class="truncate text-sm leading-[18px] font-medium text-ink" data-start-run-model-title>{models.title}</span>
                    <span class="truncate text-xs leading-4 text-ink-muted" data-start-run-model-line>{models.line}</span>
                  </div>
                </div>
                <Dialog.Close>
                  {#snippet child({ props: closeProps })}
                    <Button {...closeProps} id={cancelId} variant="destructive-soft" size="sm" class="h-9 px-3.5! py-0!" data-start-run-cancel>Cancel</Button>
                  {/snippet}
                </Dialog.Close>
                <button
                  type="button"
                  data-start-run-confirm
                  disabled={Boolean(problem) || busy || Boolean(activeRun)}
                  onclick={confirm}
                  class="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-fir px-4 text-sm font-medium text-white transition-colors hover:bg-navy-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fir focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
                >
                  {confirmLabel(mode, tickedCount)}
                </button>
              </div>
            </div>
          {/if}
        {/snippet}
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>
