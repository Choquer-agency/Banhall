<!--
  Centered model-select dialog (OpenRouter-style): search header, logo+name
  rows, detail rail describing the highlighted model. Opened from an EMPTY
  compare slot ("Random"); a filled slot reopens as an anchored popover
  (ModelSelectPanel) instead.
-->
<script lang="ts">
  import { Dialog } from "bits-ui";
  import { overlayFade, modalPop } from "$lib/motion";
  import ModelLogo from "./ModelLogo.svelte";
  import { CANDIDATE_MODELS } from "../../../../shared/generationModels";
  import { useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";

  let {
    open = $bindable(false),
    value = "",
    title = "Select a model",
    excludeId = "",
    onSelect,
  }: {
    open?: boolean;
    value?: string;
    title?: string;
    /** Model id already taken by the other compare slot — hidden here. */
    excludeId?: string;
    onSelect: (id: string) => void;
  } = $props();

  let search = $state("");
  let highlighted = $state("");

  // Grey out models whose gateway key isn't configured.
  const capabilitiesQ = useQuery(api.providerReadiness.getCapabilities, () => ({}));
  const available = $derived(
    new Set(
      capabilitiesQ.data?.availableCandidateModels ??
        CANDIDATE_MODELS.map((m) => m.id as string)
    )
  );

  const rows = $derived(
    CANDIDATE_MODELS.filter((m) => m.id !== excludeId).map((m) => ({
      id: m.id as string,
      label: m.label,
      provider: m.provider,
      description: m.description,
      disabled: !available.has(m.id),
    }))
  );
  const filtered = $derived(
    search.trim()
      ? rows.filter((r) => r.label.toLowerCase().includes(search.trim().toLowerCase()))
      : rows
  );
  const detail = $derived(
    filtered.find((r) => r.id === highlighted) ??
      filtered.find((r) => r.id === value) ??
      filtered[0]
  );

  function pick(id: string) {
    onSelect(id);
    open = false;
    search = "";
  }
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (!o) search = ""; }}>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open: isOpen })}
        {#if isOpen}
          <!-- Backdrop: deepened fir (darker than --color-navy) -->
          <div {...props} transition:overlayFade class="fixed inset-0 z-[110] bg-[#052A28]/80"></div>
        {/if}
      {/snippet}
    </Dialog.Overlay>
    <div class="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center p-4">
      <Dialog.Content forceMount>
        {#snippet child({ props, open: isOpen })}
          {#if isOpen}
            <div
              {...props}
              transition:modalPop
              class="card pointer-events-auto flex h-[min(380px,calc(100dvh-2rem))] w-full max-w-xl flex-col overflow-hidden p-0 shadow-xl"
            >
              <Dialog.Title class="sr-only">{title}</Dialog.Title>
              <!-- Search -->
              <div class="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
                <svg class="h-4 w-4 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
                </svg>
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  type="text"
                  bind:value={search}
                  placeholder="Search models"
                  autofocus
                  class="h-8 w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none"
                />
                <span class="whitespace-nowrap text-xs tabular-nums text-gray-400">
                  {filtered.length} model{filtered.length === 1 ? "" : "s"}
                </span>
              </div>
              <div class="flex min-h-0 flex-1">
                <!-- Model list -->
                <div class="min-w-0 flex-1 overflow-y-auto" role="listbox" aria-label={title}>
                  {#each filtered as row (row.id)}
                    <button
                      type="button"
                      role="option"
                      aria-selected={value === row.id}
                      disabled={row.disabled}
                      onclick={() => pick(row.id)}
                      onmouseenter={() => (highlighted = row.id)}
                      onfocus={() => (highlighted = row.id)}
                      title={row.disabled ? `${row.label} needs the OpenRouter API key configured` : undefined}
                      class={`flex h-10 w-full items-center gap-2.5 border-b border-gray-50 px-4 text-left text-sm transition-colors ${
                        row.disabled
                          ? "cursor-not-allowed opacity-40"
                          : value === row.id
                            ? "bg-primary-wash text-navy"
                            : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <ModelLogo size="sm" provider={row.provider} />
                      <span class="min-w-0 flex-1 truncate text-xs font-medium">{row.label}</span>
                      <span class="shrink-0 text-[10px] uppercase tracking-wide text-gray-300">{row.provider}</span>
                      {#if value === row.id}
                        <svg class="h-4 w-4 shrink-0 text-primary" fill="currentColor" viewBox="0 0 24 24">
                          <path fill-rule="evenodd" d="M19.916 4.626a.75.75 0 01.208 1.04l-9 13.5a.75.75 0 01-1.154.114l-6-6a.75.75 0 011.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 011.04-.207z" clip-rule="evenodd" />
                        </svg>
                      {/if}
                    </button>
                  {:else}
                    <p class="px-4 py-6 text-center text-sm text-gray-400">No models match.</p>
                  {/each}
                </div>
                <!-- Detail rail -->
                {#if detail}
                  <div class="hidden w-52 flex-col gap-2 border-l border-gray-100 bg-gray-50/50 p-4 sm:flex">
                    <span class="flex items-center gap-2">
                      <ModelLogo size="sm" provider={detail.provider} />
                      <span class="text-sm font-medium text-gray-800">{detail.label}</span>
                    </span>
                    <p class="text-xs leading-relaxed text-gray-500">{detail.description}</p>
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        {/snippet}
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>
