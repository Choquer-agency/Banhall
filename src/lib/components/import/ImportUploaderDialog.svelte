<!--
  "Get the uploader" (2026-11-12, Paper Files 1): what the client uploader
  is for and how to get it. The app does not serve the uploader: the team
  builds the kit (scripts/client-uploader/setup.sh --zip, a zip with a
  Windows and a Mac launcher and its README) and sends it to the firm, so
  this dialog says to ask for it rather than offer a download that does not
  exist. What it says matches the kit's README.txt.
-->
<script lang="ts">
  import FormDialog from "$lib/components/ui/FormDialog.svelte";
  import { formPrimary } from "$lib/components/ui/formDialog";

  let {
    open = $bindable(false),
    returnFocus = undefined,
  }: {
    open?: boolean;
    returnFocus?: () => HTMLElement | null | undefined;
  } = $props();

  const STEPS = [
    "Ask the Banhall team for the uploader kit. It comes as a zip file.",
    "Unzip it on the computer that has your client folders, usually the Applications folder in OneDrive.",
    "On Windows, double-click Run-Uploader.bat. On a Mac, double-click Run-Uploader.command.",
    "Check the company and fiscal year it shows for your files, then type y to send them.",
  ];
</script>

<FormDialog
  bind:open
  title="Get the uploader"
  description="The uploader sends many files at once from your computer into Import."
  width={480}
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
      <p class="font-medium text-ink">How to get it</p>
      <ol data-import-uploader-steps class="flex list-decimal flex-col gap-1.5 pl-5">
        {#each STEPS as step (step)}
          <li>{step}</li>
        {/each}
      </ol>
    </div>
    <p class="text-ink-muted">
      For a few files or one folder, you can also drop them on this page or use Add files.
    </p>
  </div>
  {#snippet footer()}
    <button type="button" data-import-uploader-done class={formPrimary} onclick={() => (open = false)}>Done</button>
  {/snippet}
</FormDialog>
