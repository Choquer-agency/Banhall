/**
 * View as with its toasts (D3, D5). The store changes the view; these add
 * the dark confirmation toasts the boards show.
 */
import { toast } from "svelte-sonner";
import { CheckIcon, EyeIcon } from "phosphor-svelte";
import { VIEW_AS_LABELS, viewAs, type ViewAsRole } from "./viewAs.svelte";

export function enterViewAsWithToast(role: ViewAsRole) {
  viewAs.enter(role);
  viewAs.dialogOpen = false;
  toast(`Now viewing as ${VIEW_AS_LABELS[role]}. Your own access is unchanged.`, {
    icon: EyeIcon,
    action: {
      label: "Undo",
      onClick: () => viewAs.undo(),
    },
  });
}

export function exitViewAsWithToast() {
  viewAs.exit();
  toast("Back to Developer view", { icon: CheckIcon });
}
