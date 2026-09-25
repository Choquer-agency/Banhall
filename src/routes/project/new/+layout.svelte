<!--
  The New project wizard reads its query (`from`, `drafts`, `client`, `fye`)
  once, when it mounts. SvelteKit keeps the page component on a same-route
  navigation, so New project from the command menu while on a duplicate's
  wizard kept the duplicate's prefill, and submitting it started a paid
  generation on the original's material. A different query now mounts a
  fresh wizard.
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  import { page } from "$app/state";

  let { children }: { children: Snippet } = $props();
</script>

{#key page.url.search}
  {@render children()}
{/key}
