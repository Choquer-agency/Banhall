<script lang="ts">
  import { DropdownMenu } from "bits-ui";
  import { goto } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import Badge from "$lib/components/ui/Badge.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import type { Doc } from "../../../../convex/_generated/dataModel";
  import { useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import { scienceCodeLabel } from "../../../../shared/craScienceCodes";

  // Card surfaces tint to the project status: border, footer wash,
  // footer text, and the hover shadow all draw from one palette.
  const STATUS_THEME: Record<
    string,
    { border: string; hoverBorder: string; footerBg: string; footerText: string; hoverShadow: string }
  > = {
    draft: {
      border: "border-gray-200",
      hoverBorder: "hover:border-gray-300",
      footerBg: "bg-gray-50",
      footerText: "text-gray-500",
      hoverShadow: "hover:shadow-md hover:shadow-gray-200/70",
    },
    generating: {
      border: "border-blue-200",
      hoverBorder: "hover:border-blue-300",
      footerBg: "bg-blue-50/70",
      footerText: "text-blue-600",
      hoverShadow: "hover:shadow-md hover:shadow-blue-100",
    },
    awaiting: {
      border: "border-purple-200",
      hoverBorder: "hover:border-purple-300",
      footerBg: "bg-purple-50/70",
      footerText: "text-purple-600",
      hoverShadow: "hover:shadow-md hover:shadow-purple-100",
    },
    awaiting_input: {
      border: "border-purple-200",
      hoverBorder: "hover:border-purple-300",
      footerBg: "bg-purple-50/70",
      footerText: "text-purple-600",
      hoverShadow: "hover:shadow-md hover:shadow-purple-100",
    },
    review: {
      border: "border-amber-200",
      hoverBorder: "hover:border-amber-300",
      footerBg: "bg-amber-50/70",
      footerText: "text-amber-700",
      hoverShadow: "hover:shadow-md hover:shadow-amber-100",
    },
    client_review: {
      border: "border-red-200",
      hoverBorder: "hover:border-red-300",
      footerBg: "bg-red-50/70",
      footerText: "text-red-600",
      hoverShadow: "hover:shadow-md hover:shadow-red-100",
    },
    final: {
      border: "border-primary/30",
      hoverBorder: "hover:border-primary/50",
      footerBg: "bg-primary-wash",
      footerText: "text-primary-dark",
      hoverShadow: "hover:shadow-md hover:shadow-primary/10",
    },
  };

  type ProjectTag = { id: string; label: string };

  // Tag IDs remain the chip identity because display labels are not unique.
  let {
    project,
    tags = [],
  }: {
    project: Doc<"projects"> & { awaitingSelection?: boolean; awaitingInput?: boolean };
    tags?: ProjectTag[];
  } = $props();

  let menuOpen = $state(false);
  let confirming = $state(false);
  const deleteProject = useMutation(api.projects.deleteProject);

  // Drafts are ready and waiting on the writer's pick (or, in iterative mode,
  // a section review) — surface that over the underlying "generating" status.
  const displayStatus = $derived(
    project.awaitingSelection
      ? "awaiting"
      : project.awaitingInput
        ? "awaiting_input"
        : project.status
  );
  const theme = $derived(STATUS_THEME[displayStatus] ?? STATUS_THEME.draft);

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
    try {
      await deleteProject({ projectId: project._id });
      toast.success(`Deleted “${project.title}”.`);
    } catch {
      toast.error("Couldn't delete this project — only its creator or an admin can.");
    }
    menuOpen = false;
    confirming = false;
  }

  // Opens the new-project wizard prefilled from this project (setup,
  // transcript, and documents come along on commit).
  function handleDuplicate() {
    menuOpen = false;
    goto(`/project/new?from=${project._id}`);
  }
</script>

<div class="group relative h-full">
  <a
    href={`/project/${project._id}`}
    class={`card flex h-full flex-col overflow-hidden transition-[border-color,box-shadow] duration-300 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas motion-reduce:transition-none ${theme.border} ${theme.hoverBorder} ${theme.hoverShadow}`}
  >
    <!-- Header zone -->
    <div class="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
      <div class="min-w-0 flex-1">
        <p class="mb-1 text-xs text-ink-faint">Created {createdDate}</p>
        <h3 class="line-clamp-2 text-sm font-semibold leading-5 text-ink transition-colors duration-300 group-hover:text-navy motion-reduce:transition-none">
          {project.title}
        </h3>
        <p class="mt-1 truncate text-xs text-ink-muted">{project.clientName}</p>
      </div>

      <Badge status={displayStatus} dot />
    </div>

    <!-- Chip zone -->
    {#if tags.length || project.scienceCode}
      <div class="border-t border-line-soft px-4 py-3">
        <div class="flex flex-wrap items-center gap-1.5">
          {#each tags as tag (tag.id)}
            <span class="inline-flex min-w-0 max-w-full rounded-full bg-chrome px-2 py-0.5 text-xs text-ink-muted">
              <span class="truncate">{tag.label}</span>
            </span>
          {/each}

          {#if project.scienceCode}
            <span class="inline-flex min-w-0 max-w-full rounded-full bg-primary-wash px-2 py-0.5 text-xs text-primary-dark">
              <span class="truncate">{scienceCodeLabel(project.scienceCode)}</span>
            </span>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Metadata footer zone — tinted to the status -->
    <div
      class={`mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line-soft px-4 py-2.5 pr-12 text-xs ${theme.footerBg} ${theme.footerText}`}
    >
      {#if project.writer}
        <span class="inline-flex min-w-0 max-w-full items-center gap-1.5">
          <svg class="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <span class="truncate">{project.writer}</span>
        </span>
      {/if}

      <span class="whitespace-nowrap">Updated {updatedDate}</span>
    </div>
  </a>

  <!-- Three-dot menu — remains outside the link and appears on hover/focus -->
  <!-- Vertically centered against the single-line footer (36px row, 28px button) -->
  <div class="absolute bottom-1 right-3">
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
            class={`flex h-7 w-7 items-center justify-center rounded-md transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none ${
              menuOpen
                ? "bg-white text-ink-secondary shadow-sm"
                : "text-ink-faint opacity-0 hover:bg-white hover:text-ink-secondary group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
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
            onSelect={handleDuplicate}
            class="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2.5 text-left text-sm text-ink-secondary transition-colors hover:bg-primary-wash hover:text-navy"
          >
            <svg class="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Duplicate
          </DropdownMenu.Item>
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
