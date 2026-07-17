<!--
  Single-draft model picker: one slot card, same interaction as the compare
  slots (anchored popover with ModelSelectPanel). Always shows a selected
  model — "" resolves to the default (registry first), so the card renders
  in its active state from the start.
-->
<script lang="ts">
  import { Popover } from "bits-ui";
  import ModelLogo from "./ModelLogo.svelte";
  import ModelSelectPanel from "./ModelSelectPanel.svelte";
  import { CANDIDATE_MODELS } from "../../../../shared/generationModels";

  let {
    value = $bindable(""),
  }: {
    /** Model id, or "" for the default model. */
    value?: string;
  } = $props();

  let open = $state(false);
  const effectiveId = $derived(value || CANDIDATE_MODELS[0].id);
  const label = $derived(
    CANDIDATE_MODELS.find((m) => m.id === effectiveId)?.label ?? CANDIDATE_MODELS[0].label
  );
</script>

<div
  class="group/card relative h-11 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white text-sm transition-colors hover:border-gray-300 hover:bg-gray-50/60"
>
  <Popover.Root bind:open>
    <Popover.Trigger
      aria-label={`Change model: ${label}`}
      class="flex h-full w-full min-w-0 cursor-pointer items-center gap-2 px-2.5 text-left"
    >
      <ModelLogo />
      <span class="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight" title={label}>{label}</span>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        side="bottom"
        align="start"
        sideOffset={6}
        class="z-[120] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
      >
        <ModelSelectPanel
          value={effectiveId}
          onSelect={(next) => {
            value = next;
            open = false;
          }}
        />
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
</div>
