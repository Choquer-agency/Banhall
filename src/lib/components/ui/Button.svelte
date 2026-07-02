<script lang="ts">
  import type { HTMLButtonAttributes } from "svelte/elements";

  type Variant = "primary" | "secondary" | "ghost" | "link";

  const variantStyles: Record<Variant, string> = {
    primary:
      "bg-primary text-white hover:bg-primary-dark focus-visible:ring-primary",
    secondary:
      "bg-chrome text-navy border border-gray-200 hover:bg-primary-wash focus-visible:ring-primary",
    ghost:
      "text-gray-600 hover:text-navy hover:bg-primary-wash focus-visible:ring-primary",
    link:
      "px-0 py-0 text-navy underline-offset-4 hover:text-primary focus-visible:ring-primary",
  };

  let {
    variant = "primary",
    class: className = "",
    children,
    ...rest
  }: HTMLButtonAttributes & { variant?: Variant } = $props();
</script>

<button
  class={`inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${variantStyles[variant]} ${className}`}
  {...rest}
>
  {@render children?.()}
</button>
