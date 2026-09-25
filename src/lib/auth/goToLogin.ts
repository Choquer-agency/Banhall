import { untrack } from "svelte";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { loginHref } from "./next";

/**
 * Send a signed-out visitor to /login, remembering the current page as
 * `?next=` so signing in returns them here. Call it from the client-side auth
 * guards (`!auth.isLoading && !auth.isAuthenticated` effects).
 *
 * `page.url` is read untracked: the calling effect must not re-run when the
 * navigation to /login lands, or it would redirect again from /login itself
 * and drop `next`.
 */
export function goToLogin(): Promise<void> {
  const from = untrack(() => page.url);
  return goto(loginHref(from), { replaceState: true });
}
