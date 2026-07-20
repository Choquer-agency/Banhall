import { createSvelteKitHandler } from "@mmailaender/convex-better-auth-svelte/sveltekit";

// Proxies all Better Auth requests (sign-in/up/out, session, convex/token)
// to the Convex deployment's auth routes (convex/http.ts registerRoutes),
// keeping auth cookies first-party on the app origin.
export const { GET, POST } = createSvelteKitHandler();
