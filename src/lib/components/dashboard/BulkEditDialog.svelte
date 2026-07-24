<!--
  Bulk-edit dialog for the dashboard selection: set the company name and/or
  set/clear the fiscal year-end across every selected project in one save.
  Both fields default to "leave unchanged" — only touched fields are sent.
-->
<script lang="ts">
  import { Dialog } from "bits-ui";
  import { toast } from "svelte-sonner";
  import { useMutation } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import type { Doc } from "../../../../convex/_generated/dataModel";
  import { overlayFade, modalPop } from "$lib/motion";
  import Button from "$lib/components/ui/Button.svelte";
  import DatePicker from "$lib/components/ui/DatePicker.svelte";
  import SelectInput from "$lib/components/ui/SelectInput.svelte";

  let {
    open = $bindable(false),
    projects,
    companies,
    onSaved,
  }: {
    open?: boolean;
    /** The selected project docs (drives the count and "currently:" summaries). */
    projects: Doc<"projects">[];
    /** Distinct existing company names, offered so spellings converge. */
    companies: string[];
    onSaved?: () => void;
  } = $props();

  const bulkUpdate = useMutation(api.projects.bulkUpdateProjects);

  type FyMode = "unchanged" | "set" | "clear";
  const FY_MODES: { value: FyMode; label: string }[] = [
    { value: "unchanged", label: "Leave unchanged" },
    { value: "set", label: "Set date" },
    { value: "clear", label: "Clear" },
  ];

  // "" = leave the company name unchanged.
  let companyValue = $state("");
  // Names typed via the combobox's "Add …" row, kept as options for this dialog.
  let customCompanies = $state<string[]>([]);
  let fyMode = $state<FyMode>("unchanged");
  let fyDate = $state("");
  let saving = $state(false);

  const companyItems = $derived(
    [...new Set([...companies, ...customCompanies])]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((name) => ({ value: name, label: name }))
  );

  /** Distinct current values across the selection, most common first. */
  function summarize(counts: Map<string, number>): string {
    const parts = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, n]) => (projects.length > 1 ? `${label} (${n})` : label));
    const shown = parts.slice(0, 4).join(", ");
    return parts.length > 4 ? `${shown}, +${parts.length - 4} more` : shown;
  }

  const companySummary = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const p of projects) {
      const key = p.clientName?.trim() || "—";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return summarize(counts);
  });

  const fySummary = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const p of projects) {
      const key = p.fiscalYearEnd
        ? `Fiscal ${new Date(p.fiscalYearEnd).getFullYear()}`
        : "not set";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return summarize(counts);
  });

  const canApply = $derived(
    !saving &&
      projects.length > 0 &&
      (Boolean(companyValue.trim()) || fyMode !== "unchanged") &&
      !(fyMode === "set" && !fyDate)
  );

  function reset() {
    companyValue = "";
    customCompanies = [];
    fyMode = "unchanged";
    fyDate = "";
  }

  async function apply() {
    if (!canApply) return;
    saving = true;
    try {
      const result = await bulkUpdate({
        projectIds: projects.map((p) => p._id),
        ...(companyValue.trim() ? { clientName: companyValue.trim() } : {}),
        ...(fyMode === "set"
          ? { fiscalYearEnd: new Date(`${fyDate}T00:00:00`).getTime() }
          : fyMode === "clear"
            ? { fiscalYearEnd: null }
            : {}),
      });
      toast.success(
        `${result.updated} project${result.updated === 1 ? "" : "s"} updated.`
      );
      open = false;
      reset();
      onSaved?.();
    } catch {
      toast.error("Couldn't update the selected projects.");
    } finally {
      saving = false;
    }
  }
</script>

<Dialog.Root
  bind:open
  onOpenChange={(o) => {
    if (!o) reset();
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open: isOpen })}
        {#if isOpen}
          <div {...props} transition:overlayFade class="fixed inset-0 z-[110] bg-[#052A28]/80"></div>
        {/if}
      {/snippet}
    </Dialog.Overlay>
    <div class="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center p-4">
      <Dialog.Content forceMount>
        {#snippet child({ props, open: isOpen })}
          {#if isOpen}
            <div
              {...props}
              transition:modalPop
              class="card pointer-events-auto w-full max-w-md overflow-hidden p-0 shadow-xl"
            >
              <div class="border-b border-gray-100 px-5 py-4">
                <Dialog.Title class="text-title">
                  Edit {projects.length} project{projects.length === 1 ? "" : "s"}
                </Dialog.Title>
                <p class="mt-0.5 text-xs text-gray-400">Only the fields you change are applied.</p>
              </div>

              <div class="flex flex-col gap-5 px-5 py-4">
                <!-- Company name -->
                <div>
                  <p class="text-label">Company name</p>
                  <div class="mt-1.5">
                    <SelectInput
                      bind:value={companyValue}
                      items={companyItems}
                      openOnFocus={false}
                      placeholder="Leave unchanged"
                      onCreate={(label) => {
                        customCompanies = [...customCompanies, label];
                        companyValue = label;
                      }}
                    />
                  </div>
                  <p class="mt-1.5 text-xs text-gray-400">
                    Currently: {companySummary}
                    {#if companyValue}
                      <button
                        type="button"
                        onclick={() => (companyValue = "")}
                        class="ml-1 font-medium text-primary hover:text-primary-dark hover:underline"
                      >
                        Leave unchanged
                      </button>
                    {/if}
                  </p>
                </div>

                <!-- Fiscal year-end -->
                <div>
                  <p class="text-label">Fiscal year-end</p>
                  <div class="mt-1.5 flex w-fit gap-0.5 rounded-lg bg-chrome p-0.5">
                    {#each FY_MODES as m (m.value)}
                      <button
                        type="button"
                        onclick={() => (fyMode = m.value)}
                        class={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                          fyMode === m.value
                            ? "bg-white text-navy shadow-sm"
                            : "text-gray-500 hover:text-navy"
                        }`}
                      >
                        {m.label}
                      </button>
                    {/each}
                  </div>
                  {#if fyMode === "set"}
                    <div class="mt-2 w-52">
                      <DatePicker bind:value={fyDate} size="sm" placeholder="Fiscal year-end" />
                    </div>
                  {/if}
                  <p class="mt-1.5 text-xs text-gray-400">Currently: {fySummary}</p>
                </div>
              </div>

              <div class="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3.5">
                <Button variant="ghost" size="sm" onclick={() => (open = false)}>Cancel</Button>
                <Button size="sm" disabled={!canApply} onclick={apply}>
                  {saving
                    ? "Applying…"
                    : `Apply to ${projects.length} project${projects.length === 1 ? "" : "s"}`}
                </Button>
              </div>
            </div>
          {/if}
        {/snippet}
      </Dialog.Content>
    </div>
  </Dialog.Portal>
</Dialog.Root>
