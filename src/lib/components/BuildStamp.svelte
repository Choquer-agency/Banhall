<script lang="ts">
  import { env } from "$env/dynamic/public";

  /**
   * BNH-28: shows the last published date/time so users can tell whether
   * they're looking at the most recently deployed version. Set
   * PUBLIC_BUILD_TIME at build time (Vercel env). Formatting pinned to a
   * fixed timezone so server and client render the same string.
   */
  const BUILD_TIME = env.PUBLIC_BUILD_TIME;
  const TIME_ZONE = "America/Vancouver";

  function formatBuildTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const date = new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
    const time = new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(d);
    return `${date} at ${time}`;
  }

  let { class: className = "" }: { class?: string } = $props();

  const formatted = BUILD_TIME ? formatBuildTime(BUILD_TIME) : "";
</script>

{#if formatted}
  <span
    title={`Last updated: ${formatted}`}
    class={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${className}`}
  >
    <svg class="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
    <span>Last updated: {formatted}</span>
  </span>
{/if}
