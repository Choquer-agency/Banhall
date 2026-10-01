import { goto } from "$app/navigation";
import { resolve } from "$app/paths";
import { authClient } from "$lib/authClient";
import { forgetLastAccount } from "$lib/auth/lastAccount";
import { clearAllOutboxes } from "$lib/uploads/attemptOutbox";
import { notificationSession } from "./notificationSession.svelte";
import { viewAs } from "./viewAs.svelte";

/**
 * Local sign-out shared by the identity menu, the account avatar menu and
 * Settings "Sign out everywhere". After the session cookie is cleared, the
 * next person on this browser must not inherit queued upload failures, a
 * View as choice, the notification toaster's reading of what was waiting
 * or the returning-user greeting (decision 58: an explicit
 * sign-out forgets the last account), then one client-side navigation to
 * /login.
 */
export async function signOutLocally() {
  await authClient.signOut();
  clearAllOutboxes();
  viewAs.clear();
  notificationSession.clear();
  forgetLastAccount();
  await goto(resolve("/login"), { replaceState: true, invalidateAll: true });
}
