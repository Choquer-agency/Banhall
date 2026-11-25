<!--
  "Get the uploader" (Paper Files 1, updated for in-app download): explains
  what the client uploader is for and lets an admin download the latest
  ready-to-run banhall-uploader.zip directly. Clicking Download uploader
  fetches the deployment's upload address and ingest key through the
  admin-only ingestion.getUploaderConfig action, then lazy-loads uploaderKit
  and jszip to assemble the zip with the latest scripts from
  scripts/client-uploader/ and Unix exec bits preserved for Mac.
-->
<script lang="ts">
  import { useAction } from "convex-svelte";
  import { toast } from "svelte-sonner";
  import { api } from "../../../../convex/_generated/api";
  import FormDialog from "$lib/components/ui/FormDialog.svelte";
  import { formCancel, formError, formPrimary } from "$lib/components/ui/formDialog";
  import { userErrorMessage } from "$lib/errors";

  let {
    open = $bindable(false),
    returnFocus = undefined,
  }: {
    open?: boolean;
    returnFocus?: () => HTMLElement | null | undefined;
  } = $props();

  const STEPS = [
    "Download the uploader zip below. It is already set up for this workspace.",
    "Unzip it on the computer that has your client folders, usually the Applications folder in OneDrive.",
    "On Windows, double-click Run-Uploader.bat. On a Mac, double-click Run-Uploader.command (if macOS blocks it, right-click it and choose Open).",
    "Check the company and fiscal year it shows for your files, then type y to send them.",
  ];

  const getUploaderConfig = useAction(api.ingestion.getUploaderConfig);
  let downloading = $state(false);
  let errorMessage = $state<string | null>(null);

  $effect(() => {
    if (!open) errorMessage = null;
  });

  async function download() {
    if (downloading) return;
    downloading = true;
    errorMessage = null;
    try {
      const config = await getUploaderConfig({});
      const { downloadUploaderKit } = await import("./uploaderKit");
      await downloadUploaderKit(config);
      toast.success("Uploader downloaded");
    } catch (error) {
      errorMessage = userErrorMessage(error, "Could not download the uploader. Please try again.");
    } finally {
      downloading = false;
    }
  }
</script>

<FormDialog
  bind:open
  title="Get the uploader"
  description="The uploader sends many files at once from your computer into Import."
  width={480}
  busy={downloading}
  {returnFocus}
  testId="import-uploader-dialog"
>
  <div class="flex flex-col gap-4 text-sm leading-[calc(10/7)] text-ink-secondary">
    <p>
      It reads the client folders on your computer and sends past PDs, drafts and transcripts here, sorted by
      company, category and fiscal year from the folder names. It never changes anything on your computer, and it
      skips files that are already here. Files it sends wait on To review; nothing reaches the AI until it is approved.
    </p>
    <div class="flex flex-col gap-2">
      <p class="font-medium text-ink">How to use it</p>
      <ol data-import-uploader-steps class="flex list-decimal flex-col gap-1.5 pl-5">
        {#each STEPS as step (step)}
          <li>{step}</li>
        {/each}
      </ol>
    </div>
    <p class="text-ink-muted">
      For a few files or one folder, you can also drop them on this page or use Add files.
    </p>
    {#if errorMessage}
      <p role="alert" data-import-uploader-error class={formError}>{errorMessage}</p>
    {/if}
  </div>
  {#snippet footer()}
    <button
      type="button"
      data-import-uploader-done
      disabled={downloading}
      class={formCancel}
      onclick={() => (open = false)}
    >
      Done
    </button>
    <button
      type="button"
      data-import-uploader-download
      disabled={downloading}
      class={`${formPrimary} gap-1.5`}
      onclick={() => void download()}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        class="shrink-0"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" />
      </svg>
      {downloading ? "Downloading..." : "Download uploader"}
    </button>
  {/snippet}
</FormDialog>
