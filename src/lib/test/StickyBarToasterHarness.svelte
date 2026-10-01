<!--
  A page with a sticky action bar and the notification toaster, as the
  workspace shell mounts them: the page fills the window and scrolls inside
  it, so its bottom bar sits on the window's bottom edge.
-->
<script lang="ts">
  import type { Component } from "svelte";
  import NotificationToaster from "$lib/components/shell/NotificationToaster.svelte";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { content: Content, contentProps = {} }: { content: Component<any>; contentProps?: Record<string, unknown> } = $props();
</script>

<div class="flex h-dvh flex-col overflow-auto">
  <Content {...contentProps} />
</div>
<NotificationToaster />
