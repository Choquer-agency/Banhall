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
    // Obvious composer anatomy (2026-08-10): a white bordered box; consumers
    // may switch to a column layout (textarea row + action row) via class.
    "flex items-end gap-2 rounded-2xl border border-line bg-surface px-2 py-1.5",
    "shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-[border-color,box-shadow]",
    "focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10",
    "motion-reduce:transition-none",
    className
  )}
>
  {@render children?.()}
</div>
