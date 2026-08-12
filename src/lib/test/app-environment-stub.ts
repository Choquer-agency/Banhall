/**
 * Component-test stub for SvelteKit's `$app/environment`. `dev` is false so
 * the workspace rollout gate exercises its real production decision path
 * (local `vite dev` forces the preview, which would bypass the gate under
 * test). Tests that need the dev-forced branch can cover it through the pure
 * resolver unit tests instead.
 */
export const dev = false;
export const browser = true;
export const building = false;
export const version = "test";
