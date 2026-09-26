<script lang="ts" module>
  export type StatusCalloutTone = "danger" | "warning" | "success";

  export interface StatusCalloutAction {
    label: string;
    onclick?: (event: MouseEvent) => void;
    href?: string;
    disabled?: boolean;
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import { CheckCircleIcon, WarningCircleIcon, XIcon } from "phosphor-svelte";
  import Tooltip from "./Tooltip.svelte";

  /**
   * Round 2 error, warning and success box (HANDOFF "Error and warning
   * boxes", boards E5 and E6). The box, its paragraph and its buttons all use
   * the box's own colour family: a red box has red buttons, an amber box
   * amber ones. The paragraph is the muted ink of the same family.
   *
   * "stacked" (E6) puts the actions under the text; "inline" (E5, a file row)
   * keeps everything on one line with the primary action and dismiss at the
   * right. Pass `icon` to replace the tone icon, for example with a FileIcon.
   */
  let {
    tone,
    title = undefined,
    layout = "stacked",
    icon = undefined,
    children = undefined,
    primaryAction = undefined,
    secondaryAction = undefined,
    onDismiss = undefined,
    dismissLabel = "Dismiss",
    role = undefined,
    class: className = "",
  }: {
    tone: StatusCalloutTone;
    title?: string;
    layout?: "stacked" | "inline";
    icon?: Snippet;
    children?: Snippet;
    primaryAction?: StatusCalloutAction;
    secondaryAction?: StatusCalloutAction;
    onDismiss?: () => void;
    dismissLabel?: string;
    /** Set "alert" for an error that appears after a user action. */
    role?: "alert" | "status";
    class?: string;
  } = $props();

  // Full class strings per tone so Tailwind sees every utility.
  const toneStyles: Record<
    StatusCalloutTone,
    { box: string; icon: string; title: string; body: string; primary: string; secondary: string; dismiss: string }
  > = {
    danger: {
      box: "border-danger-line bg-danger-surface",
      icon: "text-danger",
      title: "text-danger-ink",
      body: "text-danger-ink-muted",
      primary: "bg-danger-action hover:bg-danger-action-hover focus-visible:outline-danger",
      secondary: "text-danger-ink focus-visible:outline-danger",
      dismiss: "text-danger hover:bg-danger-soft focus-visible:outline-danger",
    },
    warning: {
      box: "border-warning-line bg-warning-surface",
      icon: "text-warning",
      title: "text-warning-ink",
      body: "text-warning-ink-muted",
      primary: "bg-warning-action hover:bg-warning-action-hover focus-visible:outline-warning",
      secondary: "text-warning-ink focus-visible:outline-warning",
      dismiss: "text-warning hover:bg-warning-soft focus-visible:outline-warning",
    },
    success: {
      box: "border-success-line bg-success-surface",
      icon: "text-success",
      title: "text-success-ink",
      body: "text-success-ink-muted",
      primary: "bg-success-action hover:bg-success-action-hover focus-visible:outline-success",
      secondary: "text-success-ink focus-visible:outline-success",
      dismiss: "text-success hover:bg-success-soft focus-visible:outline-success",
    },
  };

  const styles = $derived(toneStyles[tone]);
  const inline = $derived(layout === "inline");
  const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";
  const primaryClass = $derived(
    `inline-flex h-8 shrink-0 items-center justify-center rounded-md px-3.5 text-sm font-medium text-white transition-colors motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-50 ${focusRing} ${styles.primary}`
  );
  const secondaryClass = $derived(
    `inline-flex h-8 shrink-0 items-center rounded-md px-1.5 text-[13px] font-medium underline decoration-1 underline-offset-2 transition-colors hover:decoration-2 motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-50 ${focusRing} ${styles.secondary}`
  );
</script>

{#snippet action(item: StatusCalloutAction, cls: string)}
  {#if item.href !== undefined}
    <a href={item.href} onclick={item.onclick} class={cls}>{item.label}</a>
  {:else}
    <button type="button" onclick={item.onclick} disabled={item.disabled} class={cls}>{item.label}</button>
  {/if}
{/snippet}

<div
  data-status-callout={tone}
  {role}
  class={`flex rounded-xl border ${inline ? "min-h-[52px] items-center gap-2.5 px-2.5 py-2" : "gap-3 p-3.5"} ${styles.box} ${className}`}
>
  <span class={`flex shrink-0 items-center justify-center ${inline ? "size-7" : "mt-px size-[18px]"} ${styles.icon}`}>
    {#if icon}
      {@render icon()}
    {:else if tone === "success"}
      <CheckCircleIcon size={18} weight="bold" aria-hidden="true" />
    {:else}
      <WarningCircleIcon size={18} weight="bold" aria-hidden="true" />
    {/if}
  </span>

  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
    {#if title}
      <p class={`font-medium ${inline ? "text-[13px] leading-[18px]" : "text-sm leading-5"} ${styles.title}`}>{title}</p>
    {/if}
    {#if children}
      <div class={`${inline ? "text-xs leading-4" : "text-[13px] leading-[18px]"} ${styles.body}`}>
        {@render children()}
      </div>
    {/if}
    {#if !inline && (primaryAction || secondaryAction)}
      <div class="flex flex-wrap items-center gap-2 pt-2.5">
        {#if primaryAction}{@render action(primaryAction, primaryClass)}{/if}
        {#if secondaryAction}{@render action(secondaryAction, secondaryClass)}{/if}
      </div>
    {/if}
  </div>

  {#if inline}
    {#if secondaryAction}{@render action(secondaryAction, secondaryClass)}{/if}
    {#if primaryAction}{@render action(primaryAction, primaryClass)}{/if}
  {/if}

  {#if onDismiss}
    <Tooltip text={dismissLabel}>
      {#snippet children({ props })}
        <button
          {...props}
          type="button"
          aria-label={dismissLabel}
          onclick={onDismiss}
          class={`flex size-8 shrink-0 items-center justify-center rounded-md transition-colors motion-reduce:transition-none ${focusRing} ${styles.dismiss} ${inline ? "self-center" : "-my-1.5 -mr-1.5 self-start"}`}
        >
          <XIcon size={14} weight="bold" aria-hidden="true" />
        </button>
      {/snippet}
    </Tooltip>
  {/if}
</div>
