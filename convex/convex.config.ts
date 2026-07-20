import { defineApp } from "convex/server";
import { v } from "convex/values";
import rag from "@convex-dev/rag/convex.config";
import agent from "@convex-dev/agent/convex.config";
import workpool from "@convex-dev/workpool/convex.config";
import betterAuth from "@convex-dev/better-auth/convex.config";

// ─── The Brain (BNH-10) ──────────────────────────────────────────────────────
// First Convex component installed in this project. `@convex-dev/rag` owns the
// vector index + chunk storage for the cross-project knowledge base. Everything
// governance-related (approval, weighting, unlearn, audit) stays in our own
// reactive tables — see convex/brain.ts and the brain* tables in schema.ts.
//
// After editing this file you MUST run `npx convex dev` (or `convex codegen`)
// so `components.rag` is generated into convex/_generated/api.
const app = defineApp({
  env: {
    ANTHROPIC_API_KEY: v.optional(v.string()),
    VOYAGE_API_KEY: v.optional(v.string()),
    // OpenRouter gateway for OpenAI + Google generation models.
    OPENROUTER_API_KEY: v.optional(v.string()),
  },
});
app.use(rag);
// Chat assistant threads/messages/streams (BNH-10 P2) — see convex/ai/chatAgentV2.ts.
app.use(agent);
// Serializes Brain embedding jobs — Voyage rate-limits burst ingests (10
// parallel embedSource jobs 429'd on the seed import). See brain.ts.
app.use(workpool, { name: "embedPool" });
// Better Auth component: owns auth users/sessions/accounts; our app users
// table stays authoritative for role/profile and is synced via triggers in
// convex/auth.ts.
app.use(betterAuth);

export default app;
