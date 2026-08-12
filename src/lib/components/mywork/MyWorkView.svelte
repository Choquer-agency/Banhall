<script lang="ts">
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { useQuery } from "convex-svelte";
  import { api } from "../../../../convex/_generated/api";
  import HomeStartProject from "$lib/components/mywork/HomeStartProject.svelte";
  import RecentProjectsRail from "$lib/components/workspace/RecentProjectsRail.svelte";
  import { greetingForHour, greetingName } from "$lib/mywork/homeGreeting";
  import type { RecentProject } from "$lib/workspace/recentProjects";

  let { recentProjects = [] }: { recentProjects?: RecentProject[] } = $props();

  const auth = useAuth();
  let now = $state(Date.now());
  const userQ = useQuery(api.users.getCurrentUser, () => (auth.isAuthenticated ? {} : "skip"));
  const greeting = $derived.by(() => {
    const name = greetingName(userQ.data);
    return `${greetingForHour(new Date(now).getHours())}${name ? `, ${name}` : ""}`;
  });
</script>

<svelte:window
  onfocus={() => {
    now = Date.now();
  }}
/>

<section aria-label="Home">
  <HomeStartProject {greeting} />
  <RecentProjectsRail recents={recentProjects} />
</section>
