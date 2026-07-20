/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai_analyzerAgent from "../ai/analyzerAgent.js";
import type * as ai_brain_embeddings from "../ai/brain/embeddings.js";
import type * as ai_brain_ingest from "../ai/brain/ingest.js";
import type * as ai_brain_query from "../ai/brain/query.js";
import type * as ai_brain_rag from "../ai/brain/rag.js";
import type * as ai_brain_retrieve from "../ai/brain/retrieve.js";
import type * as ai_brain_scienceRouting from "../ai/brain/scienceRouting.js";
import type * as ai_brainRetrieval from "../ai/brainRetrieval.js";
import type * as ai_chatAgent from "../ai/chatAgent.js";
import type * as ai_chatAgentV2 from "../ai/chatAgentV2.js";
import type * as ai_chronologyAgent from "../ai/chronologyAgent.js";
import type * as ai_financialAgent from "../ai/financialAgent.js";
import type * as ai_instrument from "../ai/instrument.js";
import type * as ai_iterative from "../ai/iterative.js";
import type * as ai_learning from "../ai/learning.js";
import type * as ai_model from "../ai/model.js";
import type * as ai_modelFeedback from "../ai/modelFeedback.js";
import type * as ai_openrouter from "../ai/openrouter.js";
import type * as ai_openrouterCore from "../ai/openrouterCore.js";
import type * as ai_pipeline from "../ai/pipeline.js";
import type * as ai_postQa from "../ai/postQa.js";
import type * as ai_prompts from "../ai/prompts.js";
import type * as ai_providers from "../ai/providers.js";
import type * as ai_qaAgent from "../ai/qaAgent.js";
import type * as ai_qaChecks from "../ai/qaChecks.js";
import type * as ai_reviewAgent from "../ai/reviewAgent.js";
import type * as ai_section242Agent from "../ai/section242Agent.js";
import type * as ai_section244Agent from "../ai/section244Agent.js";
import type * as ai_section246Agent from "../ai/section246Agent.js";
import type * as ai_structured from "../ai/structured.js";
import type * as aiUsage from "../aiUsage.js";
import type * as appSettings from "../appSettings.js";
import type * as auth from "../auth.js";
import type * as brain from "../brain.js";
import type * as changelog from "../changelog.js";
import type * as chat from "../chat.js";
import type * as chatV2 from "../chatV2.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as debugTools from "../debugTools.js";
import type * as documents from "../documents.js";
import type * as errorReports from "../errorReports.js";
import type * as financial from "../financial.js";
import type * as generations from "../generations.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as learning from "../learning.js";
import type * as lib_activeGeneration from "../lib/activeGeneration.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_contracts from "../lib/contracts.js";
import type * as lib_lineLimits from "../lib/lineLimits.js";
import type * as lib_providerConfig from "../lib/providerConfig.js";
import type * as lib_reportEdits from "../lib/reportEdits.js";
import type * as lib_snapshots from "../lib/snapshots.js";
import type * as lib_teamRoster from "../lib/teamRoster.js";
import type * as lib_tiptapReport from "../lib/tiptapReport.js";
import type * as pdReviews from "../pdReviews.js";
import type * as projectEvidence from "../projectEvidence.js";
import type * as projects from "../projects.js";
import type * as providerReadiness from "../providerReadiness.js";
import type * as reportViews from "../reportViews.js";
import type * as reports from "../reports.js";
import type * as reviews from "../reviews.js";
import type * as scienceCodeSuggestions from "../scienceCodeSuggestions.js";
import type * as seed from "../seed.js";
import type * as snapshots from "../snapshots.js";
import type * as tags from "../tags.js";
import type * as transcripts from "../transcripts.js";
import type * as users from "../users.js";
import type * as writerProfiles from "../writerProfiles.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "ai/analyzerAgent": typeof ai_analyzerAgent;
  "ai/brain/embeddings": typeof ai_brain_embeddings;
  "ai/brain/ingest": typeof ai_brain_ingest;
  "ai/brain/query": typeof ai_brain_query;
  "ai/brain/rag": typeof ai_brain_rag;
  "ai/brain/retrieve": typeof ai_brain_retrieve;
  "ai/brain/scienceRouting": typeof ai_brain_scienceRouting;
  "ai/brainRetrieval": typeof ai_brainRetrieval;
  "ai/chatAgent": typeof ai_chatAgent;
  "ai/chatAgentV2": typeof ai_chatAgentV2;
  "ai/chronologyAgent": typeof ai_chronologyAgent;
  "ai/financialAgent": typeof ai_financialAgent;
  "ai/instrument": typeof ai_instrument;
  "ai/iterative": typeof ai_iterative;
  "ai/learning": typeof ai_learning;
  "ai/model": typeof ai_model;
  "ai/modelFeedback": typeof ai_modelFeedback;
  "ai/openrouter": typeof ai_openrouter;
  "ai/openrouterCore": typeof ai_openrouterCore;
  "ai/pipeline": typeof ai_pipeline;
  "ai/postQa": typeof ai_postQa;
  "ai/prompts": typeof ai_prompts;
  "ai/providers": typeof ai_providers;
  "ai/qaAgent": typeof ai_qaAgent;
  "ai/qaChecks": typeof ai_qaChecks;
  "ai/reviewAgent": typeof ai_reviewAgent;
  "ai/section242Agent": typeof ai_section242Agent;
  "ai/section244Agent": typeof ai_section244Agent;
  "ai/section246Agent": typeof ai_section246Agent;
  "ai/structured": typeof ai_structured;
  aiUsage: typeof aiUsage;
  appSettings: typeof appSettings;
  auth: typeof auth;
  brain: typeof brain;
  changelog: typeof changelog;
  chat: typeof chat;
  chatV2: typeof chatV2;
  comments: typeof comments;
  crons: typeof crons;
  debugTools: typeof debugTools;
  documents: typeof documents;
  errorReports: typeof errorReports;
  financial: typeof financial;
  generations: typeof generations;
  http: typeof http;
  invites: typeof invites;
  learning: typeof learning;
  "lib/activeGeneration": typeof lib_activeGeneration;
  "lib/auth": typeof lib_auth;
  "lib/contracts": typeof lib_contracts;
  "lib/lineLimits": typeof lib_lineLimits;
  "lib/providerConfig": typeof lib_providerConfig;
  "lib/reportEdits": typeof lib_reportEdits;
  "lib/snapshots": typeof lib_snapshots;
  "lib/teamRoster": typeof lib_teamRoster;
  "lib/tiptapReport": typeof lib_tiptapReport;
  pdReviews: typeof pdReviews;
  projectEvidence: typeof projectEvidence;
  projects: typeof projects;
  providerReadiness: typeof providerReadiness;
  reportViews: typeof reportViews;
  reports: typeof reports;
  reviews: typeof reviews;
  scienceCodeSuggestions: typeof scienceCodeSuggestions;
  seed: typeof seed;
  snapshots: typeof snapshots;
  tags: typeof tags;
  transcripts: typeof transcripts;
  users: typeof users;
  writerProfiles: typeof writerProfiles;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rag: import("@convex-dev/rag/_generated/component.js").ComponentApi<"rag">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  embedPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"embedPool">;
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
