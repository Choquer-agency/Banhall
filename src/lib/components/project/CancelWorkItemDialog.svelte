<script lang="ts">
  import { Dialog } from "bits-ui";
  import { overlayFade, modalPop } from "$lib/motion";
  let { open = $bindable(false), label, busy = false, errorMessage = null, onSubmit }: {
    open?: boolean; label: string; busy?: boolean; errorMessage?: string | null;
    onSubmit: (reason?: string) => void | Promise<void>;
  } = $props();
  let reason = $state("");
</script>
<Dialog.Root bind:open onOpenChange={(value) => { if (!value) reason = ""; }}>
  <Dialog.Portal><Dialog.Overlay forceMount>{#snippet child({ props, open: isOpen })}{#if isOpen}<div {...props} transition:overlayFade class="fixed inset-0 z-[130] bg-[#052A28]/80"></div>{/if}{/snippet}</Dialog.Overlay>
    <div class="pointer-events-none fixed inset-0 z-[130] flex items-end sm:items-center sm:justify-center sm:p-4"><Dialog.Content forceMount onEscapeKeydown={(event) => { if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }}>{#snippet child({ props, open: isOpen })}{#if isOpen}<form {...props} onsubmit={(event) => { event.preventDefault(); void onSubmit(reason.trim() || undefined); }} transition:modalPop class="pointer-events-auto w-full rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-xl"><Dialog.Title class="text-title">Cancel work item?</Dialog.Title><Dialog.Description class="mt-1 text-sm leading-relaxed text-ink-secondary">{label} will be closed and preserved in the audit history.</Dialog.Description><label class="mt-5 block" for="cancel-work-reason"><span class="text-label">Reason</span><textarea id="cancel-work-reason" bind:value={reason} rows="3" class="mt-1.5 w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-primary" placeholder="Optional context"></textarea></label>{#if errorMessage}<p class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{errorMessage}</p>{/if}<div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Dialog.Close disabled={busy} class="min-h-11 rounded-lg px-4 text-sm font-medium text-ink-secondary hover:bg-primary-wash disabled:opacity-50">Keep item</Dialog.Close><button type="submit" disabled={busy} class="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">{busy ? "Canceling…" : "Cancel work item"}</button></div></form>{/if}{/snippet}</Dialog.Content></div>
  </Dialog.Portal>
</Dialog.Root>
