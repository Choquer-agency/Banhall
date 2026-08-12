<script lang="ts">
  // Test fixture: a canonical host wiring for the shared Disclosure —
  // trigger with aria-expanded/aria-controls + rule-7 chevron, animated body
  // with focusable content.
  import Disclosure from "$lib/components/ui/Disclosure.svelte";
  import DisclosureChevron from "$lib/components/ui/DisclosureChevron.svelte";

  let { initialOpen = false }: { initialOpen?: boolean } = $props();
  // Intentional: the prop only seeds the fixture's local open state.
  // svelte-ignore state_referenced_locally
  let open = $state(initialOpen);
</script>

<button
  type="button"
  data-fixture-trigger
  aria-expanded={open}
  aria-controls="disclosure-fixture-body"
  onclick={() => (open = !open)}
  class="flex min-h-11 items-center gap-2 px-2"
>
  Toggle section
  <DisclosureChevron {open} class="ml-auto" />
</button>

<Disclosure id="disclosure-fixture-body" {open}>
  <div class="p-2">
    <p>Disclosure body content</p>
    <a data-fixture-link href="/somewhere">A tabbable link</a>
  </div>
</Disclosure>
