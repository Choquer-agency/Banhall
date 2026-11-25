<script lang="ts">
  // Team, "Edit initials" (writers from initials, 2026-11-16): one field for
  // the initials Import matches imported file names against ("T1.DW.PN").
  // 1 to 4 letters, saved upper case; empty means none (the person never
  // matches a file). When another member has the same initials the dialog
  // says so and still saves: files with them that have no writer yet then
  // show "Choose writer" (a file that has a writer keeps it). A member with
  // no real name (only an email) is shown on files by these initials.
  import TeamDialog from "./TeamDialog.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import { userErrorMessage } from "$lib/errors";
  import { INITIALS_RULE, savedInitials } from "../../../../shared/importSheetRules";

  let {
    open = $bindable(false),
    name,
    initials,
    others,
    hasRealName = true,
    onSubmit,
  }: {
    open?: boolean;
    name: string;
    /** The saved initials now, or null for none. */
    initials: string | null;
    /** The other members and their saved initials, to say who shares them. */
    others: readonly { name: string; initials: string | null }[];
    /** False when the member has no real name, only an email: files then show the initials. */
    hasRealName?: boolean;
    onSubmit: (initials: string) => Promise<unknown>;
  } = $props();

  let value = $state("");
  let saving = $state(false);
  let error = $state("");
  let input: HTMLInputElement | null = $state(null);

  $effect(() => {
    if (open) {
      value = initials ?? "";
      error = "";
    }
  });

  const cleaned = $derived(savedInitials(value));
  const shared = $derived(
    cleaned ? others.filter((other) => other.initials === cleaned).map((other) => other.name) : []
  );

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;
    if (cleaned === null) {
      error = INITIALS_RULE;
      return;
    }
    saving = true;
    error = "";
    try {
      await onSubmit(cleaned);
      open = false;
    } catch (cause) {
      error = userErrorMessage(cause, "The initials could not be saved. Try again.");
    } finally {
      saving = false;
    }
  }
</script>

<TeamDialog
  bind:open
  width={440}
  busy={saving}
  testId="initials-dialog"
  initialFocus={() => input}
  title={`Initials for ${name}`}
  description="New imported files whose name has these initials get this person as their writer. Files that already have a writer keep it."
>
  <form id="initials-form" class="flex flex-col gap-1.5 px-7 pt-5" onsubmit={submit} novalidate>
    <label for="member-initials" class="text-xs leading-[calc(4/3)] font-medium text-ink-secondary">Initials</label>
    <Input
      bind:ref={input}
      id="member-initials"
      data-initials-input
      type="text"
      autocomplete="off"
      spellcheck="false"
      maxlength={8}
      bind:value
      aria-invalid={error ? "true" : undefined}
      aria-describedby="member-initials-help"
      class="w-32 uppercase"
    />
    <p id="member-initials-help" class="text-xs leading-[calc(4/3)] text-ink-muted">1 to 4 letters. Leave it empty for none.</p>
    {#if shared.length > 0}
      <p data-initials-shared role="status" class="mt-1 rounded-[0.625rem] border border-warning-line bg-warning-surface px-3 py-2 text-[0.8125rem] leading-[calc(18/13)] text-warning-ink">
        {shared.join(" and ")} {shared.length === 1 ? "has" : "have"} these initials too. New files with them will show "Choose writer"; files that already have a writer keep it.
      </p>
    {/if}
    {#if !hasRealName}
      <p data-initials-no-name class="mt-1 text-xs leading-[calc(4/3)] text-ink-muted">This person has no name yet, so their files show these initials, never their email.</p>
    {/if}
    {#if error}
      <p role="alert" class="mt-1 rounded-[0.625rem] border border-danger-line bg-danger-surface px-3 py-2 text-[0.8125rem] leading-[calc(18/13)] text-danger-ink-muted">{error}</p>
    {/if}
  </form>
  {#snippet footer()}
    <div class="mt-5 flex items-center justify-end gap-2 border-t border-line-soft py-4 pl-7 pr-5">
      <button type="button" disabled={saving} onclick={() => (open = false)} class="h-9 rounded-lg bg-chrome px-3.5 text-sm leading-[calc(10/7)] font-medium text-ink hover:bg-primary-wash disabled:opacity-50">Cancel</button>
      <button type="submit" form="initials-form" data-initials-save disabled={saving} class="h-9 rounded-lg bg-fir px-4 text-sm leading-[calc(10/7)] font-medium text-white disabled:opacity-50">{saving ? "Saving..." : "Save"}</button>
    </div>
  {/snippet}
</TeamDialog>
