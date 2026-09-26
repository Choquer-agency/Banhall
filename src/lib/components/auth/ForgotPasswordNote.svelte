<script lang="ts">
  // Decision 50 (no email provider): "Forgot password?" explains the way
  // back instead of sending anything. Not designed; proposed copy.
  let { id = "forgot-password-note" }: { id?: string } = $props();
</script>

<p {id} data-forgot-note role="note" class="rounded-[10px] bg-chrome p-3 text-[13px] leading-5 text-ink-secondary">
  Ask an Admin to set a temporary password for you. You can change it in Settings after you sign in.
</p>
