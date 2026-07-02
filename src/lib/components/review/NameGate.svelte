<script lang="ts">
  import Button from "$lib/components/ui/Button.svelte";
  import Input from "$lib/components/ui/Input.svelte";

  let {
    projectTitle,
    clientName,
    onEnter,
  }: {
    projectTitle: string;
    clientName: string;
    onEnter: (name: string) => void;
  } = $props();

  let name = $state("");

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (name.trim()) {
      onEnter(name.trim());
    }
  }

  // React's autoFocus: focus the name field on mount.
  $effect(() => {
    document.getElementById("name")?.focus();
  });
</script>

<div class="flex flex-1 items-center justify-center px-4">
  <div class="w-full max-w-sm">
    <div class="mb-8 text-center">
      <h1 class="text-2xl font-bold tracking-tight text-navy">
        Banhall
      </h1>
      <p class="mt-1 text-sm text-gray-500">
        Report Review
      </p>
    </div>

    <div class="card p-6 shadow-sm">
      <h2 class="text-title">
        {projectTitle}
      </h2>
      <p class="mt-1 text-sm text-gray-500">
        {clientName} has shared this report for your review.
      </p>

      <form onsubmit={handleSubmit} class="mt-5 flex flex-col gap-4">
        <Input
          id="name"
          label="Your name"
          bind:value={name}
          placeholder="Enter your name to continue"
          required
        />
        <Button type="submit" disabled={!name.trim()}>
          View Report
        </Button>
      </form>

      <p class="mt-3 text-center text-xs text-gray-400">
        Your name will be shown on any comments you leave.
      </p>
    </div>
  </div>
</div>
