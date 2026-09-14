<script lang="ts">
  import { Popover } from "bits-ui";

  /**
   * Story 4 source-chip: a chrome pill naming the cited source; opens the
   * cited passage in a bits-ui Popover (Esc closes; focus returns to the
   * chip). Never navigates away from the report.
   */
  let {
    label,
    sourceLabel,
    excerpt,
  }: {
    /** Chip text, e.g. "Interview transcript · digest". */
    label: string;
    /** Full source name shown in the popover. */
    sourceLabel: string;
    /** The exact cited passage. */
    excerpt: string;
  } = $props();
</script>

<Popover.Root>
  <Popover.Trigger
    data-source-chip
    aria-label={`Source: ${label}. Show passage`}
    class="group inline-flex min-h-11 max-w-full items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy"
  >
    <span
      class="inline-flex h-6 max-w-48 items-center truncate rounded-full bg-chrome px-2 text-xs text-ink-secondary transition-colors group-hover:bg-primary-wash group-data-[state=open]:bg-primary-wash motion-reduce:transition-none"
    >
      {label}
    </span>
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      side="bottom"
      align="start"
      sideOffset={4}
      class="z-[110] w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-3 shadow-md outline-none"
    >
      <p class="text-label">{sourceLabel}</p>
      <blockquote class="mt-2 border-l-2 border-line pl-3 text-body whitespace-pre-line">
        <mark class="bg-primary-wash text-ink">{excerpt}</mark>
      </blockquote>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
