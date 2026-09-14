import type Anthropic from "@anthropic-ai/sdk";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  STYLE_OVERRIDE_KEYS,
  hasAnyStyleOverride,
  normalizeStyleOverrides,
  type StyleOverrideKey,
  type StyleOverrides,
} from "../../shared/styleOverrides";
import { MAX_INSTRUCTIONS_CHARS } from "../../shared/writerProfileLimits";
import {
  pickOrderedProfileContext,
  type OrderedProfileContext,
  type WaiverAnalysis,
  type WriterSettingsRecord,
} from "../lib/orderedChain";
import { settingsSupplyLabel } from "../lib/settingsDocument";
import { MODEL } from "./model";
import type { GenerationClient } from "./openrouterCore";
import { normalizeProviderError } from "./providers";
import {
  ANALYSIS_TOOL_SCHEMA,
  STYLE_ANALYSIS_REQUEST,
  STYLE_ANALYSIS_SYSTEM_PROMPT,
  buildStyleAnalysisPrompt,
  styleAnalysisSchema,
  type StyleAnalysis,
} from "./styleAnalysis";
import { generateStructured } from "./structured";
import {
  APPLYING_WRITER_STYLE_LOG,
  fetchWriterStyle,
  readOrderedProfileContext,
  waivingHouseRulesLog,
} from "./writerStyle";

/**
 * Story 3 (CAP-6/8, AD-26/27): the ONE generation-entry resolver of a
 * requesting writer's settings, shared by the one-shot pipeline and the
 * iterative flow so a settings document means the same thing in every mode.
 *
 * 1. Candidate query: the settings document the frozen sources hold (trust
 *    floor, title pattern, Writer's Notes first), whether it equals the
 *    enabled saved profile, and its cached waiver analysis at the current
 *    classifier version.
 * 2. On a cache miss, one single-attempt `generation:settings` call to the
 *    PSOS-50 style classifier, recorded per (projectId, contentHash,
 *    classifierVersion). A failure is not cached.
 * 3. The effective-style query (`getEffectiveWriterStyle`, the only place a
 *    tier is computed) with the document applied as the Writer Profile.
 * 4. `generations.writerSettings` records state, source and the save offer.
 *
 * A resolver failure never fails generation: it degrades to today's
 * saved-profile read and logs the reason to the generation progress log.
 * Helper module only — no Convex functions are registered here.
 */

export const SETTINGS_CALL_SITE = "generation:settings";

/** A small deterministic string hash (cyrb53-style, 64 bits as hex). */
export function stableStringHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0")
  );
}

/** Every input that decides the settings classifier's answer. */
export type SettingsClassifierInputs = {
  systemText: string;
  /** The user template with an empty document: the House Rule and Locked catalogs. */
  userTemplate: string;
  toolSchema: unknown;
  toolName: string;
  toolDescription: string;
  maxTokens: number;
  /** How much of the document the classifier reads. */
  inputCharLimit: number;
  model: string;
};

/**
 * The classifier's identity for the waiver cache: a stable hash of every
 * input that decides its answer. Any of them changing moves it, so a cached
 * analysis from an older classifier is never served. Pure.
 */
export function settingsClassifierVersion(inputs: SettingsClassifierInputs): string {
  return `style-classifier-${stableStringHash(
    JSON.stringify([
      inputs.systemText,
      inputs.userTemplate,
      inputs.toolSchema,
      inputs.toolName,
      inputs.toolDescription,
      inputs.maxTokens,
      inputs.inputCharLimit,
      inputs.model,
    ])
  )}`;
}

/**
 * settingsClassifierVersion applied to the real inputs. Passed to the
 * candidate query and to recordSettingsAnalysis, and nowhere else.
 */
export const SETTINGS_CLASSIFIER_VERSION = settingsClassifierVersion({
  systemText: STYLE_ANALYSIS_SYSTEM_PROMPT,
  userTemplate: buildStyleAnalysisPrompt("").user,
  toolSchema: ANALYSIS_TOOL_SCHEMA,
  toolName: STYLE_ANALYSIS_REQUEST.toolName,
  toolDescription: STYLE_ANALYSIS_REQUEST.description,
  maxTokens: STYLE_ANALYSIS_REQUEST.maxTokens,
  inputCharLimit: STYLE_ANALYSIS_REQUEST.inputCharLimit,
  model: MODEL,
});

export type ResolvedWriterSettings = {
  writerFlavor?: string;
  styleOverrides?: StyleOverrides;
  orderedContext: OrderedProfileContext;
};

type ResolverCtx = Pick<ActionCtx, "runQuery" | "runMutation">;

type ResolverArgs = {
  generationId: Id<"generations">;
  projectId: Id<"projects">;
  requestedBy: Id<"users"> | undefined;
  /** Builds the instrumented client for a generation-owned call slot. */
  clientFor: (callSite: string) => GenerationClient | Anthropic;
  log: (line: string) => Promise<unknown>;
};

function reasonOf(error: unknown): string {
  return normalizeProviderError(error).code;
}

async function safeLog(log: ResolverArgs["log"], line: string): Promise<void> {
  try {
    await log(line);
  } catch (error) {
    console.error("generation progress log write failed", reasonOf(error), error);
  }
}

/** The categories a settings document legislates, per the PSOS-50 classifier. */
export async function classifySettingsDocument(
  client: GenerationClient | Anthropic,
  text: string
): Promise<StyleOverrideKey[]> {
  const { system, user } = buildStyleAnalysisPrompt(text);
  const analysis = await generateStructured<StyleAnalysis>(client, {
    system,
    user,
    toolName: STYLE_ANALYSIS_REQUEST.toolName,
    description: STYLE_ANALYSIS_REQUEST.description,
    schema: ANALYSIS_TOOL_SCHEMA,
    maxTokens: STYLE_ANALYSIS_REQUEST.maxTokens,
    model: MODEL,
    validate: styleAnalysisSchema,
    // One attempt: generateReport waits on this call inside its 600 s action.
    attempts: 1,
  });
  return STYLE_OVERRIDE_KEYS.filter((key) => analysis.categories[key].addressed);
}

async function logAppliedStyle(
  log: ResolverArgs["log"],
  writerFlavor: string | undefined,
  styleOverrides: StyleOverrides | undefined
): Promise<void> {
  // The same two lines the saved-profile read writes (shared constants).
  if (writerFlavor) await safeLog(log, APPLYING_WRITER_STYLE_LOG);
  if (styleOverrides) await safeLog(log, waivingHouseRulesLog(styleOverrides));
}

async function resolve(ctx: ResolverCtx, args: ResolverArgs): Promise<ResolvedWriterSettings> {
  const userArgs = args.requestedBy ? { userId: args.requestedBy } : {};
  const candidate = await ctx.runQuery(
    internal.writerProfiles.getSettingsDocumentCandidate,
    {
      generationId: args.generationId,
      classifierVersion: SETTINGS_CLASSIFIER_VERSION,
      ...userArgs,
    }
  );
  const detected = candidate.document;

  let waiverAnalysis: WaiverAnalysis | undefined;
  let settingsDocument:
    | {
        text: string;
        supplyPath: "writer_notes" | "attachment";
        addressedCategories: StyleOverrideKey[] | null;
        fileName: string;
      }
    | undefined;
  if (detected && !candidate.matchesProfile) {
    let addressed: StyleOverrideKey[] | null;
    if (candidate.cachedAddressed !== null) {
      addressed = candidate.cachedAddressed;
      waiverAnalysis = "cached";
    } else {
      try {
        addressed = await classifySettingsDocument(
          args.clientFor(SETTINGS_CALL_SITE),
          detected.text
        );
        waiverAnalysis = "analyzed";
        try {
          await ctx.runMutation(internal.writerProfiles.recordSettingsAnalysis, {
            projectId: args.projectId,
            contentHash: detected.contentHash,
            classifierVersion: SETTINGS_CLASSIFIER_VERSION,
            addressedCategories: addressed,
          });
        } catch (error) {
          // The analysis still applies to this generation; only the cache
          // is lost, so the next generation classifies again.
          console.error("settings analysis cache write failed", reasonOf(error), error);
        }
      } catch (error) {
        addressed = null;
        waiverAnalysis = "failed";
        console.error("settings document classification failed", reasonOf(error), error);
        // Never "every House Rule is in force": a category an org set to
        // `off` stays waived. The document itself waives nothing.
        await safeLog(
          args.log,
          `The settings document ${detected.fileName} could not be analysed for House Rule waivers (${reasonOf(error)}); its instructions apply with no Writer Profile waivers.`
        );
      }
    }
    settingsDocument = {
      text: detected.text,
      supplyPath: detected.supplyPath,
      addressedCategories: addressed,
      fileName: detected.fileName,
    };
  }

  const style = await ctx.runQuery(internal.writerProfiles.getGenerationWriterStyle, {
    ...userArgs,
    ...(settingsDocument ? { settingsDocument } : {}),
  });
  const documentApplied =
    style.settingsSource === "writer_notes" || style.settingsSource === "attachment";
  const matchesProfile = detected !== null && (candidate.matchesProfile || style.matchesProfile);

  if (detected && documentApplied) {
    await safeLog(
      args.log,
      `Applying the settings document ${detected.fileName} ${settingsSupplyLabel(detected.supplyPath)} as the Writer Profile for this generation${style.savedProfileSuperseded ? "; it supersedes the saved Writer Profile" : ""}${detected.truncated ? `; only its first ${MAX_INSTRUCTIONS_CHARS.toLocaleString("en-US")} characters apply` : ""}.`
    );
  } else if (detected && matchesProfile) {
    await safeLog(
      args.log,
      `The settings document ${detected.fileName} matches the saved Writer Profile, which applies unchanged.`
    );
  }

  const record: WriterSettingsRecord = {
    profileState: style.profileState,
    source: style.settingsSource,
    ...(detected
      ? {
          generationSourceId: detected.generationSourceId,
          ...(detected.projectDocumentId
            ? { projectDocumentId: detected.projectDocumentId }
            : {}),
          fileName: detected.fileName,
        }
      : {}),
    matchesProfile,
    savedProfileSuperseded: style.savedProfileSuperseded,
    waiverAnalysis: documentApplied
      ? (waiverAnalysis ?? "failed")
      : style.settingsSource === "profile"
        ? "profile"
        : "none",
    truncated: documentApplied && detected !== null && detected.truncated,
    // The waivers the applied document legislates, as this generation
    // resolved them: the save offer's only source (never re-read from the
    // cache, so a failed cache write or a later classifier version cannot
    // drop them).
    ...(documentApplied && settingsDocument?.addressedCategories
      ? { addressedCategories: [...settingsDocument.addressedCategories] }
      : {}),
  };
  try {
    await ctx.runMutation(internal.generations.recordWriterSettings, {
      generationId: args.generationId,
      writerSettings: record,
    });
  } catch (error) {
    // The record is for display; the resolved style still governs drafting.
    console.error("writer settings record failed", reasonOf(error), error);
  }

  const overrides = normalizeStyleOverrides(style.styleOverrides);
  const writerFlavor = style.customInstructions ?? undefined;
  const styleOverrides = hasAnyStyleOverride(overrides) ? overrides : undefined;
  await logAppliedStyle(args.log, writerFlavor, styleOverrides);
  return {
    ...(writerFlavor ? { writerFlavor } : {}),
    ...(styleOverrides ? { styleOverrides } : {}),
    orderedContext: pickOrderedProfileContext(style),
  };
}

/** Today's saved-profile read, used when the resolver itself failed. */
async function degrade(
  ctx: ResolverCtx,
  args: ResolverArgs,
  error: unknown
): Promise<ResolvedWriterSettings> {
  const reason = reasonOf(error);
  // Server logs keep the raw error (message and stack) beside the reason
  // code; the writer-facing progress log carries only the normalized reason.
  console.error("writer settings resolution failed; using the saved Writer Profile", reason, error);
  await safeLog(
    args.log,
    `Writer settings could not be resolved (${reason}); the saved Writer Profile applies and no settings document is read.`
  );
  const style = await fetchWriterStyle(ctx, args.requestedBy, args.log);
  const orderedContext = await readOrderedProfileContext(ctx, args.requestedBy);
  try {
    const applied = orderedContext.profileState === "applied";
    await ctx.runMutation(internal.generations.recordWriterSettings, {
      generationId: args.generationId,
      writerSettings: {
        profileState: orderedContext.profileState,
        source: applied ? "profile" : "none",
        matchesProfile: false,
        savedProfileSuperseded: false,
        waiverAnalysis: applied ? "profile" : "none",
        truncated: false,
      },
    });
  } catch (recordError) {
    console.error("writer settings record failed", reasonOf(recordError), recordError);
  }
  return { ...style, orderedContext };
}

export async function resolveGenerationWriterSettings(
  ctx: ResolverCtx,
  args: ResolverArgs
): Promise<ResolvedWriterSettings> {
  try {
    return await resolve(ctx, args);
  } catch (error) {
    return await degrade(ctx, args, error);
  }
}
