<script lang="ts">
  import type { HTMLButtonAttributes } from "svelte/elements";

  type Variant = "primary" | "primary-outline" | "secondary" | "ghost" | "link";

  const variantStyles: Record<Variant, string> = {
    primary:
      "border border-transparent bg-primary text-white hover:bg-primary-dark focus-visible:ring-primary",
    "primary-outline":
      "border border-primary bg-transparent text-primary hover:bg-primary hover:text-white focus-visible:ring-primary",
    secondary:
      "bg-chrome text-navy border border-gray-200 hover:bg-primary-wash focus-visible:ring-primary",
    ghost:
      "border border-transparent text-gray-600 hover:text-navy hover:bg-primary-wash focus-visible:ring-primary",
    link:
      "p-0! text-primary hover:text-primary-dark focus-visible:ring-primary",
  };

  let {
    variant = "primary",
    size = "md",
    class: className = "",
    children,
    ...rest
  }: HTMLButtonAttributes & { variant?: Variant; size?: "md" | "sm" } = $props();
</script>

<button
  class={`inline-flex items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${size === "sm" ? "py-2" : "py-2.5"} ${variantStyles[variant]} ${className}`}
  {...rest}
>
  {@render children?.()}
</button>
