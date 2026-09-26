<script lang="ts">
  // The app's global Toaster, as `src/routes/+layout.svelte` mounts it, for
  // suites that assert or capture the round 2 toast style.
  import { Toaster } from "svelte-sonner";
</script>

<Toaster richColors closeButton position="bottom-center" toastOptions={{ class: "font-sans" }} />
