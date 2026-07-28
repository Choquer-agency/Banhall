<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import type { Role } from "../../../../shared/roles";
  import {
    ASSIGNABLE_ROLES,
    ROLE_DESCRIPTION_NOTE,
    ROLE_DESCRIPTIONS,
  } from "$lib/roles/roleDescriptions";

  let {
    roles = ASSIGNABLE_ROLES,
    heading = "Role reference",
  }: {
    roles?: readonly Role[];
    heading?: string;
  } = $props();

  const componentId = $props.id();
  const openRoles = new SvelteSet<Role>();

  function toggle(role: Role) {
    if (openRoles.has(role)) openRoles.delete(role);
    else openRoles.add(role);
  }
</script>

<section aria-label={heading}>
  <h3 class="text-label">{heading}</h3>
  <div class="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
    {#each roles as role (role)}
      {@const description = ROLE_DESCRIPTIONS[role]}
      {@const triggerId = `${componentId}-${role}-trigger`}
      {@const panelId = `${componentId}-${role}-panel`}
      {@const isOpen = openRoles.has(role)}
      <div>
        <button
          type="button"
          id={triggerId}
          aria-expanded={isOpen}
          aria-controls={panelId}
          onclick={() => toggle(role)}
          class="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm font-semibold text-ink transition-colors hover:bg-primary-wash"
        >
          <span>What can a {description.label} do?</span>
          <svg
            aria-hidden="true"
            class={`h-4 w-4 flex-none transition-transform ${isOpen ? "rotate-180 text-primary" : "text-ink-faint"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div
          id={panelId}
          role="region"
          aria-labelledby={triggerId}
          hidden={!isOpen}
          class="border-t border-line-soft bg-gray-50 px-3 py-4 sm:px-4"
        >
          <p class="text-body">{description.summary}</p>
          <div class="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p class="text-label">Can</p>
              <ul class="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-secondary">
                {#each description.capabilities as capability (capability)}
                  <li>{capability}</li>
                {/each}
              </ul>
            </div>
            <div>
              <p class="text-label">Not permitted</p>
              <ul class="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-secondary">
                {#each description.limitations as limitation (limitation)}
                  <li>{limitation}</li>
                {/each}
              </ul>
            </div>
          </div>
        </div>
      </div>
    {/each}
  </div>
  <p class="mt-2 text-xs leading-relaxed text-ink-muted">{ROLE_DESCRIPTION_NOTE}</p>
</section>
