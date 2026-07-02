/**
 * Deep-path imports from @convex-dev/agent's published dist (Apache-2.0).
 *
 * The package's exports map only exposes these helpers through its React
 * entrypoint; the underlying modules are framework-free, so we import the
 * files directly for the Svelte port of useUIMessages. File imports bypass
 * the exports map legitimately — but they ARE coupled to the dist layout,
 * so @convex-dev/agent is version-pinned in package.json. Re-verify these
 * paths on any agent upgrade (see docs/svelte-migration.md).
 */
export {
  deriveUIMessagesFromDeltas,
  getParts,
  blankUIMessage,
  statusFromStreamStatus,
} from "../../../node_modules/@convex-dev/agent/dist/deltas.js";
export { combineUIMessages } from "../../../node_modules/@convex-dev/agent/dist/UIMessages.js";
export { sorted } from "../../../node_modules/@convex-dev/agent/dist/shared.js";
export type { UIMessage } from "@convex-dev/agent";
