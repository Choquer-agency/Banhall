<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLTextareaAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";
  import { getPromptInputContext } from "./context";

  /**
   * Autogrowing textarea for the composer. Must live inside <PromptInput>
   * (value/submit/maxHeight come from its context). Enter submits,
   * Shift+Enter inserts a newline; height tracks content up to maxHeight
   * (and shrinks back when the value is cleared after a send).
   *
   * `pill` overlays a floating chip on the first line (highlight excerpt);
   * pair it with `textIndent` so typed text starts beside the chip.
   */
  interface Props extends Omit<HTMLTextareaAttributes, "value" | "style"> {
    class?: string;
    /** Classes for the relative wrapper around pill + textarea. */
    wrapperClass?: string;
    /** Floating chip overlaid on the textarea's first line. */
    pill?: Snippet;
    /** Indent (px) applied to the first line so text starts beside the pill. */
    textIndent?: number;
    /** The underlying textarea element — bindable for focus management. */
    ref?: HTMLTextAreaElement | null;
  }

  let {
    class: className,
    wrapperClass,
    pill,
    textIndent,
    ref = $bindable(null),
    onkeydown,
    disabled,
    ...rest
  }: Props = $props();

  const maybeCtx = getPromptInputContext();
  if (!maybeCtx) {
    throw new Error("<PromptInputTextarea> must be used inside <PromptInput>");
  }
  // Non-optional alias so closures ($effect, keydown) keep the narrowed type.
  const ctx = maybeCtx;

  // Autogrow to content, capped at the PromptInput maxHeight.
  $effect(() => {
    void ctx.value;
    const el = ref;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, ctx.maxHeight) + "px";
  });

  function handleKeydown(
    e: KeyboardEvent & { currentTarget: EventTarget & HTMLTextAreaElement }
  ) {
    onkeydown?.(e);
    if (e.defaultPrevented) return;
    if (e.key !== "Enter" || e.isComposing) return;
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const shortcut = e.metaKey || e.ctrlKey;
    if ((!coarsePointer && !e.shiftKey) || shortcut) {
      e.preventDefault();
      ctx.submit();
    }
  }
</script>

<div class={cn("relative flex-1 py-1", wrapperClass)}>
  {@render pill?.()}
  <textarea
    {...rest}
    bind:this={ref}
    bind:value={ctx.value}
    onkeydown={handleKeydown}
    rows={1}
    disabled={disabled || ctx.disabled}
    style={textIndent ? `text-indent: ${textIndent}px` : undefined}
    class={cn(
      // `input-chromeless` is load-bearing: the composer shell owns the single
      // inset focus affordance, so the textarea must not paint another well.
      "input-chromeless min-h-6 w-full resize-none bg-transparent px-1 py-0 text-base leading-snug text-gray-800 placeholder:text-ink-muted outline-none disabled:opacity-50 md:text-sm",
      className
    )}
  ></textarea>
</div>
