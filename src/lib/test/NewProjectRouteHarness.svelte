<!--
  The /project/new route as SvelteKit mounts it: the route layout around
  the wizard page, so a same-route navigation (New project from the command
  menu while on the wizard) reaches the page the way it does in the app.
-->
<script lang="ts">
  import Layout from "../../routes/project/new/+layout.svelte";
  import Page from "../../routes/project/new/+page.svelte";
</script>

<Layout><Page /></Layout>
