<!--
  Compare-mode model pair picker, OpenRouter-style: two slot cards joined by
  "vs". Empty slot = dashed "+ Random" card — clicking it opens the CENTERED
  model-select dialog. Filled slot = provider logo + model name with an X to
  clear back to Random — clicking it reopens as an anchored popover with the
  searchable list.
-->
<script lang="ts">
  import { Popover } from "bits-ui";
  import ModelLogo from "./ModelLogo.svelte";
  import ModelSelectDialog from "./ModelSelectDialog.svelte";
  import ModelSelectPanel from "./ModelSelectPanel.svelte";
  import { CANDIDATE_MODELS } from "../../../../shared/generationModels";

  let {
    slotA = $bindable(""),
    slotB = $bindable(""),
  }: {
    /** Model id, or "" for Random. */
    slotA?: string;
    slotB?: string;
  } = $props();

  // Centered dialog for empty slots; anchored popovers for filled ones.
  let dialogOpen = $state(false);
  let dialogSlot = $state<"a" | "b">("a");
  let openA = $state(false);
  let openB = $state(false);

  function assign(which: "a" | "b", id: string) {
    if (which === "a") slotA = id;
    else slotB = id;
  }

  const labelFor = (id: string) =>
    CANDIDATE_MODELS.find((m) => m.id === id)?.label ?? "";
</script>

{#snippet slotCard(id: string, which: "a" | "b")}
  {#if id}
    <!-- Filled: logo + name, X to clear; click card → anchored popover -->
    <div class="group/card relative h-11 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white text-sm transition-colors hover:border-gray-300 hover:bg-gray-50/60">
      <Popover.Root
        open={which === "a" ? openA : openB}
        onOpenChange={(o) => (which === "a" ? (openA = o) : (openB = o))}
      >
        <Popover.Trigger
          aria-label={`Change model: ${labelFor(id)}`}
          class="flex h-full w-full min-w-0 cursor-pointer items-center gap-2 px-2.5 pr-9 text-left"
        >
          <ModelLogo />
          <span class="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight" title={labelFor(id)}>
            {labelFor(id)}
          </span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            align="start"
            sideOffset={6}
            class="z-[120] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
          >
            <ModelSelectPanel
              value={id}
              excludeId={which === "a" ? slotB : slotA}
              onSelect={(next) => {
                assign(which, next);
                openA = false;
                openB = false;
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <button
        type="button"
        aria-label="Remove model"
        onclick={() => assign(which, "")}
        class="absolute right-1.5 top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
      >
        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  {:else}
    <!-- Empty (Random): dashed card; click → centered dialog -->
    <button
      type="button"
      aria-label="Select a model to compare"
      onclick={() => {
        dialogSlot = which;
        dialogOpen = true;
      }}
      class="group/slot flex h-11 w-44 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 bg-chrome/40 text-sm font-medium text-gray-500 transition-colors hover:border-primary hover:bg-primary-wash hover:text-navy"
    >
      <span class="flex size-5 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-gray-200 transition-colors group-hover/slot:ring-primary/40">
        <svg class="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
          <path fill-rule="evenodd" d="M12 3.75a.75.75 0 01.75.75v6.75h6.75a.75.75 0 010 1.5h-6.75v6.75a.75.75 0 01-1.5 0v-6.75H4.5a.75.75 0 010-1.5h6.75V4.5a.75.75 0 01.75-.75z" clip-rule="evenodd" />
        </svg>
      </span>
      Random
    </button>
  {/if}
{/snippet}

<div class="flex items-center gap-2" role="group" aria-label="Models to compare">
  {@render slotCard(slotA, "a")}
  <span class="text-label select-none text-gray-400">vs</span>
  {@render slotCard(slotB, "b")}
</div>

<ModelSelectDialog
  bind:open={dialogOpen}
  value={dialogSlot === "a" ? slotA : slotB}
  title={dialogSlot === "a" ? "Select the first model" : "Select the second model"}
  excludeId={dialogSlot === "a" ? slotB : slotA}
  onSelect={(id) => assign(dialogSlot, id)}
/>
