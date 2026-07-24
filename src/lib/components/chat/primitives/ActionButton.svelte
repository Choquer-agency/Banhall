<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import { cn } from "$lib/utils";

  type Variant = "primary" | "secondary" | "ghost" | "danger" | "icon";

  interface Props extends HTMLButtonAttributes {
    variant?: Variant;
    tooltip?: string;
    loading?: boolean;
    loadingLabel?: string;
    children?: Snippet;
  }

  let {
    variant = "ghost",
    tooltip,
    loading = false,
    loadingLabel,
    disabled,
    class: className,
    children,
    ...rest
  }: Props = $props();

  const variants: Record<Variant, string> = {
    primary:
      "min-h-9 bg-primary-selected px-3 text-white hover:bg-primary-dark focus-visible:ring-primary",
    secondary:
      "min-h-9 border border-primary/20 bg-primary-wash px-3 text-navy hover:bg-primary-soft focus-visible:ring-primary",
    ghost:
      "min-h-9 px-3 text-ink-secondary hover:bg-primary-wash hover:text-navy focus-visible:ring-primary",
    danger:
      "min-h-9 px-3 text-red-600 hover:bg-red-50 focus-visible:ring-red-500",
    icon:
      "h-9 w-9 text-ink-muted hover:bg-primary-wash hover:text-navy focus-visible:ring-primary",
  };

  const buttonClass = $derived(
    cn(
      "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
      "disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none",
      variants[variant],
      className
    )
  );
</script>

{#snippet button(triggerProps: Record<string, unknown> = {})}
  <button
    {...triggerProps}
    {...rest}
    type={rest.type ?? "button"}
    disabled={disabled || loading}
    aria-busy={loading}
    class={buttonClass}
  >
    {#if loading}
      <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" aria-hidden="true"></span>
      {loadingLabel ?? "Working…"}
    {:else}
      {@render children?.()}
    {/if}
  </button>
{/snippet}

{#if tooltip}
  <Tooltip text={tooltip} side="bottom" delayDuration={300}>
    {#snippet children({ props })}
      {@render button(props)}
    {/snippet}
  </Tooltip>
{:else}
  {@render button()}
{/if}
