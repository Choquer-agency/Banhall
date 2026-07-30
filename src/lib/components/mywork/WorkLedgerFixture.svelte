<script lang="ts">
  import StageBadge from "$lib/components/ui/StageBadge.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  let { mobile = false }: { mobile?: boolean } = $props();
  const row = { project: "Project Aurora", client: "North Shore Labs", stage: "internal_review" as const, work: "Internal review", due: "Jul 29, 2026 · Due today", assignee: "Morgan Manager", assigner: "Alex Lee" };
</script>
{#if mobile}
  <article class="card p-4"><a href="/project/test" class="text-sm font-semibold text-navy">{row.project}</a><p class="text-xs text-ink-muted">{row.client}</p><div class="mt-3"><StageBadge stage={row.stage} /></div><dl class="mt-3 grid grid-cols-[6rem_1fr] gap-2 text-sm"><dt class="text-label">Work</dt><dd>{row.work}</dd><dt class="text-label">Due</dt><dd>{row.due}</dd><dt class="text-label">With</dt><dd>{row.assignee}</dd><dt class="text-label">From</dt><dd>{row.assigner}</dd></dl><div class="mt-3 flex gap-2"><Button size="sm" class="min-h-11">Complete</Button><Button size="sm" variant="secondary" class="min-h-11">Reassign</Button></div></article>
{:else}
  <table class="w-full"><caption class="sr-only">Assigned to me</caption><thead><tr><th scope="col">Project</th><th scope="col">Stage</th><th scope="col">Work</th><th scope="col">Due</th><th scope="col">People</th><th scope="col">Actions</th></tr></thead><tbody><tr><td><a href="/project/test">{row.project}</a><p>{row.client}</p></td><td><StageBadge stage={row.stage} /></td><td>{row.work}</td><td>{row.due}</td><td>With {row.assignee}<br />From {row.assigner}</td><td><Button size="sm" class="min-h-11">Complete</Button><Button size="sm" variant="secondary" class="min-h-11">Reassign</Button></td></tr></tbody></table>
{/if}
