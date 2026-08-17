/** Component-test auth state. Defaults to an authenticated, settled session. */
let authState = { isLoading: false, isAuthenticated: true };

export function __setAuthState(next: Partial<typeof authState>) {
  authState = { ...authState, ...next };
}

export function __resetAuthState() {
  authState = { isLoading: false, isAuthenticated: true };
}

export function useAuth() {
  return {
    get isLoading() {
      return authState.isLoading;
    },
    get isAuthenticated() {
      return authState.isAuthenticated;
    },
  };
}

export function createSvelteAuthClient(_options?: unknown) {
  return {};
}
