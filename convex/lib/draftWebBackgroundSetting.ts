/**
 * The deployment setting for public background in drafting (2026-11-02,
 * proposed), declared in convex.config.ts. Read through a widened view so it
 * compiles both before and after codegen adds the name.
 */
import { env } from "../_generated/server";
import { draftWebBackgroundEnabled } from "../ai/draftWebBackground";
import { openRouterConfiguration } from "./providerConfig";

const settingEnv = env as typeof env & { readonly DRAFT_WEB_BACKGROUND?: string };

/** Whether this deployment looks up public background for drafts. */
export function deploymentDraftWebBackgroundOn(): boolean {
  return draftWebBackgroundEnabled(
    settingEnv.DRAFT_WEB_BACKGROUND,
    openRouterConfiguration().state === "configured"
  );
}
