<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";
  import { setPromptInputContext } from "./context";

  /**
   * The composer shell (prompt-kit PromptInput shape): a rounded well laying
   * out actions + textarea in an items-end row. Owns the value / submit /
   * loading state and shares it with PromptInputTextarea via context.
   *
   * Submission is delegated: Enter in the textarea calls `onSubmit(value)` —
   * the consumer keeps its own guards (empty input, in-flight sends) and
   * clears `value` itself on success.
   */
  interface Props {
    value?: string;
    isLoading?: boolean;
    disabled?: boolean;
    /** Autogrow cap for the textarea, px. */
    maxHeight?: number;
    onSubmit?: (value: string) => void;
    class?: string;
    children?: Snippet;
  }

  let {
    value = $bindable(""),
    isLoading = false,
    disabled = false,
    maxHeight = 140,
    onSubmit,
    class: className,
    children,
  }: Props = $props();

  setPromptInputContext({
    get value() {
      return value;
    },
    set value(v: string) {
      value = v;
    },
    get isLoading() {
      return isLoading;
    },
    get disabled() {
      return disabled;
    },
    get maxHeight() {
      return maxHeight;
    },
    submit() {
      onSubmit?.(value);
    },
  });
</script>

<div
  class={cn(
    // Recessed well with a soft inner shadow; the border + halo warm to
    // lagoon while the writer is composing (focus-within).
    "flex items-end gap-2 rounded-2xl border border-chrome bg-canvas px-2 py-1.5",
    "inset-shadow-[0_1px_3px_rgba(10,58,56,0.05)] transition-[border-color,box-shadow]",
    "focus-within:border-primary/50 focus-within:ring-[3px] focus-within:ring-primary/10",
    "motion-reduce:transition-none",
    className
  )}
>
  {@render children?.()}
</div>
