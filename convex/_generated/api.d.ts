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
import type * as ai_chatAgent from "../ai/chatAgent.js";
import type * as ai_chronologyAgent from "../ai/chronologyAgent.js";
import type * as ai_financialAgent from "../ai/financialAgent.js";
import type * as ai_model from "../ai/model.js";
import type * as ai_pipeline from "../ai/pipeline.js";
import type * as ai_prompts from "../ai/prompts.js";
import type * as ai_qaAgent from "../ai/qaAgent.js";
import type * as ai_qaChecks from "../ai/qaChecks.js";
import type * as ai_section242Agent from "../ai/section242Agent.js";
import type * as ai_section244Agent from "../ai/section244Agent.js";
import type * as ai_section246Agent from "../ai/section246Agent.js";
import type * as ai_structured from "../ai/structured.js";
import type * as auth from "../auth.js";
import type * as chat from "../chat.js";
import type * as comments from "../comments.js";
import type * as documents from "../documents.js";
import type * as errorReports from "../errorReports.js";
import type * as financial from "../financial.js";
import type * as generations from "../generations.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_snapshots from "../lib/snapshots.js";
import type * as projects from "../projects.js";
import type * as reportViews from "../reportViews.js";
import type * as reports from "../reports.js";
import type * as seed from "../seed.js";
import type * as snapshots from "../snapshots.js";
import type * as transcripts from "../transcripts.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "ai/analyzerAgent": typeof ai_analyzerAgent;
  "ai/chatAgent": typeof ai_chatAgent;
  "ai/chronologyAgent": typeof ai_chronologyAgent;
  "ai/financialAgent": typeof ai_financialAgent;
  "ai/model": typeof ai_model;
  "ai/pipeline": typeof ai_pipeline;
  "ai/prompts": typeof ai_prompts;
  "ai/qaAgent": typeof ai_qaAgent;
  "ai/qaChecks": typeof ai_qaChecks;
  "ai/section242Agent": typeof ai_section242Agent;
  "ai/section244Agent": typeof ai_section244Agent;
  "ai/section246Agent": typeof ai_section246Agent;
  "ai/structured": typeof ai_structured;
  auth: typeof auth;
  chat: typeof chat;
  comments: typeof comments;
  documents: typeof documents;
  errorReports: typeof errorReports;
  financial: typeof financial;
  generations: typeof generations;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/snapshots": typeof lib_snapshots;
  projects: typeof projects;
  reportViews: typeof reportViews;
  reports: typeof reports;
  seed: typeof seed;
  snapshots: typeof snapshots;
  transcripts: typeof transcripts;
  users: typeof users;
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

export declare const components: {};
