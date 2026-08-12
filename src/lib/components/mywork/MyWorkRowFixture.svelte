<script lang="ts">
  import MyWorkRow from "./MyWorkRow.svelte";
  import Button from "$lib/components/ui/Button.svelte";

  let { onComplete }: { onComplete: () => void } = $props();
</script>

<ul role="list">
  <MyWorkRow
    href="/project/project-1"
    title="Review fixture"
    workflowStage="internal_review"
    dueAt={null}
    now={new Date("2026-08-07T12:00:00Z").getTime()}
    context="Internal review · Northline Labs"
    absentDueLabel="No due date"
    assignee={null}
  >
    {#snippet metadata()}
      <span data-fixture-metadata>Review</span>
    {/snippet}
    {#snippet actions()}
      <Button onclick={onComplete}>Complete</Button>
    {/snippet}
  </MyWorkRow>
</ul>
