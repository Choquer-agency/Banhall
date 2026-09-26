/**
 * View as with its toasts (D3, D5). The store changes the view; these add
 * the dark confirmation toasts the boards show.
 */
import { toast } from "svelte-sonner";
import ToastCheckIcon from "$lib/components/shell/ToastCheckIcon.svelte";
import ToastEyeIcon from "$lib/components/shell/ToastEyeIcon.svelte";
import { VIEW_AS_LABELS, viewAs, type ViewAsRole } from "./viewAs.svelte";

export function enterViewAsWithToast(role: ViewAsRole) {
  viewAs.enter(role);
  viewAs.dialogOpen = false;
  toast(`Now viewing as ${VIEW_AS_LABELS[role]}. Your own access is unchanged.`, {
    icon: ToastEyeIcon,
    action: {
      label: "Undo",
      onClick: () => viewAs.undo(),
    },
  });
}

export function exitViewAsWithToast() {
  viewAs.exit();
  toast("Back to Developer view", { icon: ToastCheckIcon });
}
