<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import Badge from "$lib/components/ui/Badge.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import type { Doc } from "../../../../convex/_generated/dataModel";
  import { useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";

  const STATUS_LINE_COLORS: Record<string, string> = {
    draft: "bg-gray-200",
    generating: "bg-blue-400 animate-pulse",
    review: "bg-amber-400",
    client_review: "bg-purple-400",
    final: "bg-primary",
  };

  let { project }: { project: Doc<"projects"> } = $props();

  let menuOpen = $state(false);
  let confirming = $state(false);
  const deleteProject = useMutation(api.projects.deleteProject);

  const updatedDate = $derived(
    new Date(project.updatedAt).toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  );
  const createdDate = $derived(
    new Date(project.createdAt).toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
    })
  );

  // First select arms the confirm state, second select deletes. preventDefault
  // keeps the menu open (bits-ui closes on select by default).
  async function handleDelete(e: Event) {
    e.preventDefault();
    if (!confirming) {
      confirming = true;
      return;
    }
    await deleteProject({ projectId: project._id });
    menuOpen = false;
    confirming = false;
  }
</script>

<div class="group relative">
  <a
    href={`/project/${project._id}`}
    class="card relative block p-5 transition-all duration-300 hover:border-primary/30 hover:shadow-md"
  >
    <!-- Status indicator line -->
    <div
      class={`absolute bottom-4 left-0 top-4 w-0.5 rounded-full ${STATUS_LINE_COLORS[project.status] ?? "bg-gray-200"}`}
    ></div>

    <div class="flex items-start justify-between gap-3 pl-2">
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm font-semibold text-gray-900 transition-colors group-hover:text-navy">
          {project.title}
        </h3>
        <p class="mt-0.5 text-sm text-gray-500">{project.clientName}</p>
      </div>
      <Badge status={project.status} />
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 pl-2 text-xs text-gray-400">
      {#if project.writer}
        <span class="inline-flex items-center gap-1 text-gray-500">
          <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          {project.writer}
        </span>
        <span class="h-0.5 w-0.5 rounded-full bg-gray-300"></span>
      {/if}
      <span>Created {createdDate}</span>
      <span class="h-0.5 w-0.5 rounded-full bg-gray-300"></span>
      <span>Updated {updatedDate}</span>
    </div>
  </a>

  <!-- Three-dot menu — appears on hover -->
  <div class="absolute bottom-3 right-3">
    <DropdownMenu.Root
      bind:open={menuOpen}
      onOpenChange={(o) => {
        if (!o) confirming = false;
      }}
    >
      <Tooltip text="Project actions">
        {#snippet children({ props: tooltipProps })}
          <DropdownMenu.Trigger
            {...tooltipProps}
            aria-label="Project actions"
            class={`flex h-7 w-7 items-center justify-center rounded-md transition-all ${
              menuOpen
                ? "bg-gray-100 text-gray-600"
                : "text-gray-300 opacity-0 hover:bg-primary-wash hover:text-gray-600 group-hover:opacity-100"
            }`}
          >
            <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
            </svg>
          </DropdownMenu.Trigger>
        {/snippet}
      </Tooltip>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="end"
          sideOffset={4}
          preventScroll={false}
          class={`z-20 w-40 overflow-hidden rounded-lg border shadow-lg ${
            confirming ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"
          }`}
        >
          <DropdownMenu.Item
            onSelect={handleDelete}
            class={`flex w-full items-center gap-2 whitespace-nowrap px-3 py-2.5 text-left text-sm transition-colors ${
              confirming ? "font-medium text-red-600" : "text-red-500 hover:bg-red-50"
            }`}
          >
            <svg class="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {confirming ? "Confirm delete?" : "Delete"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  </div>
</div>
