# Deployment verification boundary

Read-only inspection of current repository configuration: package.json build is `vite build`; vercel.json builds the frontend with PUBLIC_BUILD_TIME and npm run build. Neither configured GitHub CI job deploys Convex. The changelog workflow invokes its dedicated publisher with a secret supplied by GitHub; it is not a backend schema/functions deployment.

Therefore a successful GitHub Vercel status proves that frontend deployment's reported outcome, not deployment of this pass's Convex schema/functions. Historical docs name a development Convex deployment, but those names are not treated as current live-state verification. This pass targets audited implementation and normal merge to main; it does not silently run a separate backend deployment or claim live storage/provider behavior. Final release evidence must retain this boundary.
