<script lang="ts">
  import type { Role } from "../../../../shared/roles";
  import { ROLE_DESCRIPTIONS } from "$lib/roles/roleDescriptions";

  let { role }: { role: Role } = $props();
  const description = $derived(ROLE_DESCRIPTIONS[role]);
  const componentId = $props.id();
</script>

<div>
  <h3 class="text-title">{description.label}</h3>
  <p class="mt-1.5 text-body">{description.summary}</p>

  <section class="mt-6" aria-labelledby={`${componentId}-can`}>
    <h4 id={`${componentId}-can`} class="text-label">Can</h4>
    <ul class="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-secondary">
      {#each description.capabilities as capability (capability)}
        <li>{capability}</li>
      {/each}
    </ul>
  </section>

  <section class="mt-7 border-t border-line-soft pt-6" aria-labelledby={`${componentId}-limitations`}>
    <h4 id={`${componentId}-limitations`} class="text-label">Not permitted</h4>
    <ul class="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-secondary">
      {#each description.limitations as limitation (limitation)}
        <li>{limitation}</li>
      {/each}
    </ul>
  </section>
</div>
