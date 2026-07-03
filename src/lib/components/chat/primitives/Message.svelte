<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";
  import { setMessageRoleContext, type MessageRole } from "./context";

  /**
   * Role-based message row. `user` right-aligns its bubble; `assistant` is a
   * plain left column (content + proposal cards stack with gap-1). Children
   * (<MessageContent>) inherit the role via context.
   */
  interface Props {
    role?: MessageRole;
    class?: string;
    children?: Snippet;
  }

  let { role = "assistant", class: className, children }: Props = $props();

  setMessageRoleContext({
    get role() {
      return role;
    },
  });
</script>

<div
  class={cn(
    role === "user" ? "flex justify-end" : "flex max-w-[95%] flex-col gap-1",
    className
  )}
>
  {@render children?.()}
</div>
