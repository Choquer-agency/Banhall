<script lang="ts">
  // Password field with a show and hide button, and an optional "Forgot
  // password?" on the label line (J1-J4).
  import { EyeIcon, EyeSlashIcon } from "phosphor-svelte";
  import type { HTMLInputAttributes } from "svelte/elements";
  import AuthField from "./AuthField.svelte";

  let {
    id,
    label = "Password",
    value = $bindable(""),
    invalid = false,
    element = $bindable(),
    onForgot = undefined,
    forgotOpen = false,
    ...rest
  }: Omit<HTMLInputAttributes, "type"> & {
    id: string;
    label?: string;
    value?: string;
    invalid?: boolean;
    element?: HTMLInputElement;
    onForgot?: () => void;
    forgotOpen?: boolean;
  } = $props();

  let visible = $state(false);
</script>

<AuthField {id} {label} bind:value bind:element {invalid} type={visible ? "text" : "password"} {...rest}>
  {#snippet labelAction()}
    {#if onForgot}
      <button
        type="button"
        data-forgot-password
        aria-expanded={forgotOpen}
        onclick={onForgot}
        class="text-[13px] leading-[18px] font-medium text-primary-selected hover:text-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
      >Forgot password?</button>
    {/if}
  {/snippet}
  {#snippet trailing()}
    <button
      type="button"
      aria-label={visible ? "Hide password" : "Show password"}
      aria-controls={id}
      onclick={() => (visible = !visible)}
      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {#if visible}<EyeSlashIcon size={16} aria-hidden="true" />{:else}<EyeIcon size={16} aria-hidden="true" />{/if}
    </button>
  {/snippet}
</AuthField>
