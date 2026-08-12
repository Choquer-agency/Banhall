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
      "border border-transparent bg-primary text-white hover:bg-primary-dark focus-visible:ring-primary",
    "primary-outline":
      "border border-primary bg-transparent text-primary hover:bg-primary hover:text-white focus-visible:ring-primary",
    secondary:
      "bg-chrome text-navy border border-gray-200 hover:bg-primary-wash focus-visible:ring-primary",
    ghost:
      "border border-transparent text-gray-600 hover:text-ink hover:bg-primary-wash focus-visible:ring-primary",
    // Destructive actions take a red hover (design system rule 9). A class
    // override can't express this: the class string is concatenated, not
    // cn-merged, so a conflicting hover:bg-* would be settled by stylesheet
    // order rather than by the caller.
    "danger-ghost":
      "border border-transparent text-red-600 hover:bg-red-50 hover:text-red-700 focus-visible:ring-red-500",
    link:
      "p-0! text-primary hover:text-primary-dark focus-visible:ring-primary",
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
    HTMLAnchorAttributes & { variant?: Variant; size?: "md" | "sm"; href?: string } = $props();

  // One computed class string shared by both render branches, so anchor-shaped
  // Buttons can never drift from button-shaped ones. (The `disabled:` base
  // utilities are inert on anchors, which never receive the attribute.)
  const classes = $derived(
    `inline-flex items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${size === "sm" ? "py-2" : "py-2.5"} ${variantStyles[variant]} ${className}`
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
