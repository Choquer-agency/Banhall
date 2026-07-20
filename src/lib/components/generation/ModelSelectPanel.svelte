<!--
  Model list panel (OpenRouter-style command palette, simplified): search
  header with option count, then logo + name rows with a check on the
  selected one. Rendered inside the slot popover in ComparePairPicker /
  SingleModelPicker.
-->
<script lang="ts">
  import ModelLogo from "./ModelLogo.svelte";
  import { CANDIDATE_MODELS } from "../../../../shared/generationModels";
  import { useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";

  let {
    value = "",
    excludeId = "",
    onSelect,
  }: {
    value?: string;
    /** Model id already taken by the other compare slot — hidden here. */
    excludeId?: string;
    onSelect: (id: string) => void;
  } = $props();

  let search = $state("");

  // Grey out models whose gateway key isn't configured (e.g. OpenAI/Google
  // without OPENROUTER_API_KEY). While loading, assume everything available.
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
</script>

<div class="flex w-72 flex-col overflow-hidden">
  <!-- Search -->
  <div class="border-b border-gray-100 px-2 py-2">
    <div class="flex items-center gap-2 rounded-md border border-gray-200 px-2.5">
      <svg class="h-3.5 w-3.5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
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
      <span class="whitespace-nowrap text-xs tabular-nums text-gray-400">{filtered.length}</span>
    </div>
  </div>
  <!-- Rows -->
  <div class="max-h-64 overflow-y-auto" role="listbox" aria-label="Models">
    {#each filtered as row (row.id)}
      <button
        type="button"
        role="option"
        aria-selected={value === row.id}
        disabled={row.disabled}
        onclick={() => onSelect(row.id)}
        title={row.disabled
          ? `${row.label} needs the OpenRouter API key configured`
          : row.description}
        class={`flex h-10 w-full items-center gap-2 px-2.5 text-left transition-colors ${
          row.disabled
            ? "cursor-not-allowed opacity-40"
            : value === row.id
              ? "bg-primary-wash text-navy"
              : "text-gray-700 hover:bg-gray-50"
        }`}
      >
        <ModelLogo size="sm" provider={row.provider} />
        <span class="min-w-0 truncate text-xs font-medium">{row.label}</span>
        <span class="ml-1 shrink-0 text-[10px] uppercase tracking-wide text-gray-300">{row.provider}</span>
        <svg
          class={`ml-auto h-4 w-4 shrink-0 text-primary ${value === row.id ? "opacity-100" : "opacity-0"}`}
          fill="currentColor" viewBox="0 0 24 24"
        >
          <path fill-rule="evenodd" d="M19.916 4.626a.75.75 0 01.208 1.04l-9 13.5a.75.75 0 01-1.154.114l-6-6a.75.75 0 011.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 011.04-.207z" clip-rule="evenodd" />
        </svg>
      </button>
    {:else}
      <p class="px-3 py-5 text-center text-sm text-gray-400">No models match.</p>
    {/each}
  </div>
</div>
