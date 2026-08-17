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
    // The shell owns the textarea's focus state. Its inset cue never draws an
    // exterior line around the composer.
    "field-control-shell flex items-end gap-2 rounded-2xl px-2 py-1.5",
    "motion-reduce:transition-none",
    className
  )}
>
  {@render children?.()}
</div>
