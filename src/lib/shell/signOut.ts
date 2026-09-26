import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import { authClient } from "$lib/authClient";
import { clearAllOutboxes } from "$lib/uploads/attemptOutbox";
import { viewAs } from "./viewAs.svelte";

/**
 * Local sign-out shared by the identity menu, the account avatar menu and
 * Settings "Sign out everywhere". After the session cookie is cleared, the
 * next person on this browser must not inherit queued upload failures or a
 * View as choice, then one client-side navigation to /login.
 */
export async function signOutLocally() {
  await authClient.signOut();
  clearAllOutboxes();
  viewAs.clear();
  await goto(resolve("/login"), { replaceState: true, invalidateAll: true });
}
