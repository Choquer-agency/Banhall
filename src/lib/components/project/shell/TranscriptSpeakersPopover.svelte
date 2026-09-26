<!--
  The Speakers chip on a transcript row (2026-09-24, the transcript method).
  Opens a popover with one row per speaker label: a verbatim sample line and
  a role select (Interviewer, Client, Other). "Needs a check" stays until a
  consultant confirms; it warns and never blocks generation (owner decision
  24). Only the client's words are cited as evidence (decision 25).
  Presentational: the page loads the rows when the popover opens.
-->
<script module lang="ts">
  export type SpeakerRole = "interviewer" | "client" | "other" | "unknown";
  export type SpeakerRow = {
    label: string;
    role: SpeakerRole;
    roleSource: "heuristic" | "model" | "consultant";
    turnCount: number;
    sample?: string;
  };
</script>

<script lang="ts">
  import { Popover, Select } from "bits-ui";
  import { CaretDownIcon, CheckIcon } from "phosphor-svelte";
  import { popIn, popOut } from "$lib/motion/panelMotion";

  let {
    transcriptId,
    transcriptLabel,
    status,
    speakers,
    busy = false,
    onOpenChange,
    onSetRole,
    onConfirm,
  }: {
    transcriptId: string;
    transcriptLabel: string;
    status?: "unchecked" | "needs_check" | "confirmed";
    /** Undefined while loading. */
    speakers?: SpeakerRow[];
    busy?: boolean;
    onOpenChange?: (open: boolean) => void;
    onSetRole?: (label: string, role: Exclude<SpeakerRole, "unknown">) => void | Promise<void>;
    onConfirm?: () => void | Promise<void>;
  } = $props();

  let open = $state(false);

  const ROLE_ITEMS = [
    { value: "interviewer", label: "Interviewer" },
    { value: "client", label: "Client" },
    { value: "other", label: "Other" },
  ] as const;

  function roleLabel(role: SpeakerRole) {
    return ROLE_ITEMS.find((item) => item.value === role)?.label ?? "Choose a role";
  }
</script>

{#if status === "needs_check" || status === "confirmed"}
  <Popover.Root
    bind:open
    onOpenChange={(next) => onOpenChange?.(next)}
  >
    <Popover.Trigger
      data-speakers-chip={transcriptId}
      aria-label={`Speakers in ${transcriptLabel}${status === "needs_check" ? ", needs a check" : ""}`}
      class="inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transition-none"
    >
      <span>Speakers</span>
      {#if status === "needs_check"}
        <span class="text-ink-muted" data-speakers-needs-check>Needs a check</span>
      {/if}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content forceMount side="bottom" align="end" sideOffset={6}>
        {#snippet child({ props, wrapperProps, open: contentOpen })}
          <div {...wrapperProps}>
            {#if contentOpen}
              <div
                {...props}
                in:popIn
                out:popOut
                data-speakers-popover={transcriptId}
                class="z-[100] w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-md outline-none"
              >
                <div class="border-b border-line-soft px-4 py-3">
                  <p class="text-sm text-ink">Speakers</p>
                  <p class="mt-0.5 text-xs text-ink-muted">Only the client's words are cited as evidence.</p>
                </div>
                {#if speakers === undefined}
                  <p class="px-4 py-3 text-xs text-ink-muted" role="status">Loading speakers</p>
                {:else if speakers.length === 0}
                  <p class="px-4 py-3 text-xs text-ink-muted">This transcript names no speakers.</p>
                {:else}
                  <ul class="max-h-80 divide-y divide-line-soft overflow-y-auto">
                    {#each speakers as speaker (speaker.label)}
                      <li class="flex items-start gap-3 px-4 py-2.5" data-speaker-row={speaker.label}>
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-[13px] text-ink">{speaker.label}</span>
                          {#if speaker.sample}
                            <span class="mt-0.5 line-clamp-2 block text-xs text-ink-muted">{speaker.sample}</span>
                          {/if}
                        </span>
                        <Select.Root
                          type="single"
                          value={speaker.role === "unknown" ? "" : speaker.role}
                          items={[...ROLE_ITEMS]}
                          disabled={busy}
                          onValueChange={(value) => {
                            if (value === "interviewer" || value === "client" || value === "other") {
                              void onSetRole?.(speaker.label, value);
                            }
                          }}
                        >
                          <Select.Trigger
                            aria-label={`Role of ${speaker.label}`}
                            data-speaker-role={speaker.label}
                            class="inline-flex h-8 w-32 shrink-0 cursor-pointer items-center justify-between gap-1 rounded-lg bg-chrome px-2.5 text-xs text-ink transition-colors hover:bg-primary-wash focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none"
                          >
                            <span class={speaker.role === "unknown" ? "text-ink-muted" : ""}>{roleLabel(speaker.role)}</span>
                            <CaretDownIcon size={12} aria-hidden="true" class="text-ink-muted" />
                          </Select.Trigger>
                          <Select.Portal>
                            <Select.Content
                              sideOffset={4}
                              class="z-[120] w-32 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg outline-none"
                            >
                              {#each ROLE_ITEMS as item (item.value)}
                                <Select.Item
                                  value={item.value}
                                  label={item.label}
                                  data-speaker-role-option={item.value}
                                  class="flex min-h-9 cursor-pointer items-center justify-between px-2.5 text-xs text-ink-secondary outline-none data-[highlighted]:bg-primary-wash data-[highlighted]:text-ink"
                                >
                                  {#snippet children({ selected })}
                                    {item.label}
                                    {#if selected}<CheckIcon size={12} aria-hidden="true" />{/if}
                                  {/snippet}
                                </Select.Item>
                              {/each}
                            </Select.Content>
                          </Select.Portal>
                        </Select.Root>
                      </li>
                    {/each}
                  </ul>
                {/if}
                {#if status === "needs_check" && speakers && speakers.length > 0}
                  <div class="flex justify-end border-t border-line-soft px-3 py-2">
                    <button
                      type="button"
                      data-speakers-confirm
                      disabled={busy}
                      class="min-h-9 rounded-lg px-3 text-[13px] text-ink-secondary transition-colors hover:bg-primary-wash hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:opacity-50 motion-reduce:transition-none"
                      onclick={async () => {
                        await onConfirm?.();
                        open = false;
                      }}
                    >
                      Looks right
                    </button>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/snippet}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}
