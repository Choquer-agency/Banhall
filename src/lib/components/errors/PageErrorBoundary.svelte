<script module lang="ts">
  /** Event ErrorMonitor listens for so it can surface render-time crashes. */
  export const APP_ERROR_EVENT = "banhall:apperror";

  export type AppErrorDetail = {
    message: string;
    stack?: string;
    source?: string;
  };
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { pushBreadcrumb } from "./breadcrumbs";

  let { children }: { children: Snippet } = $props();

  /**
   * Catches render-time crashes in the page tree so they don't blank the app.
   * On catch it shows a small recovery card AND dispatches an event that the
   * (still-mounted, sibling) ErrorMonitor picks up to show the "Send error"
   * banner — so a page crash flows into the same reporting path as everything
   * else.
   */
  function handleError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    pushBreadcrumb({ type: "error", label: message });
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent<AppErrorDetail>(APP_ERROR_EVENT, {
          detail: { message, stack },
        })
      );
    }
  }
</script>

<svelte:boundary onerror={(error) => handleError(error)}>
  {@render children()}

  {#snippet failed()}
    <div class="flex flex-1 flex-col items-center justify-center bg-canvas px-6 py-20 text-center">
      <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
        <svg
          class="h-6 w-6 text-red-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>
      </div>
      <p class="font-medium text-navy">Something broke on this page.</p>
      <p class="mt-1 max-w-sm text-sm text-gray-500">
        Use the red “Send error” bar at the top to report it — we&apos;ll get
        everything we need to fix it.
      </p>
      <button
        onclick={() => window.location.reload()}
        class="mt-5 rounded-lg bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-light"
      >
        Reload page
      </button>
    </div>
  {/snippet}
</svelte:boundary>
