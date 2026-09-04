/**
 * Workspace dashboard preview exposure (dashboard shell + dense projects
 * table). The preview is on for everyone: any authenticated caller holding
 * `project.readInternal` gets it. Exposure is not authorization; every read
 * and write inside the workspace still passes its own capability check.
 */
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireCapability } from "./lib/roleCapabilities";

export const getAccess = query({
  args: {},
  returns: v.object({ available: v.boolean() }),
  handler: async (ctx) => {
    await requireCapability(ctx, "project.readInternal");
    return { available: true };
  },
});
