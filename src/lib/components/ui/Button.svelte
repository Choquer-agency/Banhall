<script lang="ts">
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";

  type Variant =
    | "primary"
    | "primary-outline"
    | "secondary"
    | "ghost"
    | "danger-ghost"
    | "link";

  const variantStyles: Record<Variant, string> = {
    primary:
      "border border-transparent bg-action-primary text-action-primary-foreground hover:bg-action-primary-hover focus-visible:ring-action-primary",
    "primary-outline":
      "border border-action-primary bg-transparent text-action-primary hover:bg-action-primary hover:text-action-primary-foreground focus-visible:ring-action-primary",
    secondary:
      "border border-line bg-chrome text-ink hover:bg-primary-wash focus-visible:ring-primary",
    ghost:
      "border border-transparent text-ink-secondary hover:bg-primary-wash hover:text-ink focus-visible:ring-primary",
    // Destructive actions take a red hover (design system rule 9). A class
    // override can't express this: the class string is concatenated, not
    // cn-merged, so a conflicting hover:bg-* would be settled by stylesheet
    // order rather than by the caller.
    "danger-ghost":
      "border border-transparent text-red-600 hover:bg-red-50 hover:text-red-700 focus-visible:ring-red-500",
    link:
      "p-0! text-action-primary hover:text-action-primary-hover focus-visible:ring-action-primary",
  };

  // "xs" is the toolbar scale: fixed h-8 and 13px text so the button sits
  // level with the h-7 controls inside the 49px workspace header.
  const sizeStyles: Record<"md" | "sm" | "xs", string> = {
    md: "px-4 py-2.5 text-sm",
    sm: "px-4 py-2 text-sm",
    xs: "h-8 px-3 text-[0.8125rem]",
  };

  let {
    variant = "primary",
    size = "md",
    class: className = "",
    href = undefined,
    disabled = undefined,
    children,
    ...rest
  }: HTMLButtonAttributes &
    HTMLAnchorAttributes & { variant?: Variant; size?: "md" | "sm" | "xs"; href?: string } = $props();

  // One computed class string shared by both render branches, so anchor-shaped
  // Buttons can never drift from button-shaped ones. (The `disabled:` base
  // utilities are inert on anchors, which never receive the attribute.)
  const classes = $derived(
    `inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${sizeStyles[size]} ${variantStyles[variant]} ${className}`
  );
</script>

{#if href !== undefined}
  <a {href} class={classes} {...rest}>
    {@render children?.()}
  </a>
{:else}
  <button class={classes} {disabled} {...rest}>
    {@render children?.()}
  </button>
{/if}
