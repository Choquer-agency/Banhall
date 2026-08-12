/**
 * Component-test stub for `@mmailaender/convex-better-auth-svelte/svelte`:
 * an authenticated, settled session so gated queries run.
 */
export function useAuth() {
  return {
    get isLoading() {
      return false;
    },
    get isAuthenticated() {
      return true;
    },
  };
}

export function createSvelteAuthClient(_options?: unknown) {
  return {};
}
