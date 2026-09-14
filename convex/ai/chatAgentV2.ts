import { internalAction, type ActionCtx } from "../_generated/server";
import { components, internal } from "../_generated/api";
import { v } from "convex/values";
import { z } from "zod";
import {
  Agent,
  createTool,
  stepCountIs,
  saveMessage,
  type ContextOptions,
  type ToolCtx,
} from "@convex-dev/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { MODEL } from "./model";
import { buildChatSystemPromptV2 } from "./prompts";
import {
  bulkEditInputSchema,
  completionReportChecklist,
  completionReportItems,
  type BulkEditInput,
} from "../lib/completionReport";
import {
  InventoryAnchorError,
  assembleDeviationInventory,
  renderInventory,
  type InventoryNote,
  type InventorySections,
  type RulesStatus,
} from "../lib/deviationInventory";
import {
  NO_STYLE_OVERRIDES,
  normalizeStyleOverrides,
  type StyleOverrides,
} from "../../shared/styleOverrides";
import { scrubBannedWordsUnlessWaived } from "../lib/reportEdits";
import { buildChatTurnRequest, type ChatTurnContext } from "./chatEvidence";
import { MAX_PROJECT_DOCUMENT_SCAN } from "../chatV2";
import { describeContextCuts } from "./trustedContext";
import { preserveReasoningSignature } from "./reasoningSignature";
import { searchBrainExemplars, formatBrainExemplars } from "./brain/retrieve";
import { safeErrorDetails } from "../lib/safeErrorDetails";

// ─── Agent-based chat (BNH-10 P2) ────────────────────────────────────────────
// Parallel-run replacement for chatAgent.ts. The @convex-dev/agent component
// owns thread history + streaming deltas; edits/highlights are TOOLS whose
// calls land as chatProposals rows (see convex/chatV2.ts) instead of a JSON
// blob regex-parsed out of the reply.

// PSOS-49: the edit tools scrub banned words unless the writer's profile
// waives that category, so factories close over the waiver flag. The agent's
// statically registered tools use the default (scrub on); streamChatReply
// passes per-call tools built with the requesting writer's actual waivers.
const makeProposeEdit = (bannedWordsWaived: boolean) =>
  createTool({
    description:
      "Propose replacing ONE specific passage of the report. targetText must be an exact verbatim substring of the current report.",
    inputSchema: z.object({
      targetText: z
        .string()
        .min(1)
        .describe(
          "The exact substring of the current report to replace — copied character-for-character."
        ),
      newText: z
        .string()
        .min(1)
        .describe("The replacement text, fully compliant with the writing rules."),
    }),
    execute: async (ctx, input, options): Promise<string> => {
      if (!ctx.threadId) throw new Error("No thread in tool context");
      const runtimeCtx = ctx as ToolCtx & { promptMessageId?: string };
      const result = await ctx.runMutation(internal.chatV2.saveProposal, {
        agentThreadId: ctx.threadId,
        toolCallId: options.toolCallId,
        promptMessageId: runtimeCtx.promptMessageId ?? ctx.messageId,
        kind: "edit",
        targetText: input.targetText,
        newText: scrubBannedWordsUnlessWaived(input.newText, bannedWordsWaived),
      });
      if (result.ok) return "Edit proposed. The writer now sees it as a suggestion card.";
      // A stopped turn is not a recoverable tool error: telling the model to
      // retry would have it work against the writer's explicit stop.
      if (result.stopped) return `Stop requested: ${result.reason} Do not retry.`;
      return `Proposal NOT created: ${result.reason} Re-read the CURRENT REPORT and retry the edit tool with an exact canonical target.`;
    },
  });

const makeProposeReplacements = (bannedWordsWaived: boolean) =>
  createTool({
    description:
      "Propose a multi-instance find/replace across the whole report (e.g. pronoun normalization, terminology swaps). Every occurrence of each find is replaced automatically.",
    inputSchema: z.object({
      replacements: z
        .array(
          z.object({
            find: z
              .string()
              .min(1)
              .describe("Exact verbatim substring that recurs in the report."),
            replaceWith: z.string().describe("Its replacement."),
          })
        )
        .min(1),
    }),
    execute: async (ctx, input, options): Promise<string> => {
      if (!ctx.threadId) throw new Error("No thread in tool context");
      const runtimeCtx = ctx as ToolCtx & { promptMessageId?: string };
      const result = await ctx.runMutation(internal.chatV2.saveProposal, {
        agentThreadId: ctx.threadId,
        toolCallId: options.toolCallId,
        promptMessageId: runtimeCtx.promptMessageId ?? ctx.messageId,
        kind: "replacements",
        replacements: input.replacements.map((r) => ({
          find: r.find,
          replaceWith: scrubBannedWordsUnlessWaived(
            r.replaceWith,
            bannedWordsWaived
          ),
        })),
      });
      if (result.ok) {
        return "Replacement set proposed. The writer now sees it as a suggestion card.";
      }
      if (result.stopped) return `Stop requested: ${result.reason} Do not retry.`;
      return `Proposal NOT created: ${result.reason} Re-read the CURRENT REPORT and retry with exact canonical find text.`;
    },
  });

// CAP-13 / AD-28: the coordinated revision and its Completion Report. The input
// schema, the row projection and the checklist text all live in
// `convex/lib/completionReport.ts`, so the prompt, the tool and the persisted
// rows cannot drift. The tool still creates ONE proposal a human applies. The
// body is `runProposeBulkEdits` below, so the gate can drive it.
const makeProposeBulkEdits = (bannedWordsWaived: boolean) => createTool({
  description: "Propose a coordinated revision of different report passages in one reviewable card, plus a Completion Report accounting for EVERY item on the writer's list. Each target must be unique and passages must not overlap. Reuse the item ids the Deviation Inventory or the Reference PD comparison produced, anchor each finding to the section and 1-based paragraph it belongs to, and mark it resolved, blocked or conflicting. The writer applies the proposal.",
  inputSchema: bulkEditInputSchema,
  execute: async (ctx, input, options): Promise<string> =>
    await runProposeBulkEdits(ctx, input, {
      toolCallId: options.toolCallId,
      bannedWordsWaived,
    }),
});

/**
 * Story 5 (CAP-12 to CAP-15): the tool BODIES, exported and independent of the
 * agent SDK.
 *
 * `createTool`'s `execute` closures are unreachable from any test in the gate:
 * `convexTest` can call `saveProposal` directly and the live harness replaces
 * every `execute` with its own stub, so the hand-offs that make these tools work
 * (`items` on the bulk proposal, `referenceSections` on the comparison, the
 * writer's `contentDeviations` on both) would be deletable with the whole suite
 * still green. Each `execute` below is a one-line delegation to one of these
 * functions, and `convex/chatToolBodies.test.ts` drives them against a real
 * database.
 */
export interface ChatToolCtx {
  threadId?: string | undefined;
  messageId?: string | undefined;
  runQuery: ActionCtx["runQuery"];
  runMutation: ActionCtx["runMutation"];
}

export interface InventoryContext {
  found: boolean;
  sections: InventorySections;
  notes: InventoryNote[];
  rulesStatus: RulesStatus;
  rulesAvailable: boolean;
  reference: { fileName: string; sections: InventorySections } | null;
  referenceStatus:
    | "none"
    | "resolved"
    | "unknown_name"
    | "unreadable"
    | "unparsed"
    | "ambiguous";
  referenceFileNames: string[];
  unreadableReferenceFileNames: string[];
  selectedReferenceFileName: string | null;
  /** DW-138: the project's document walk hit its bound; a PD past it was not seen. */
  documentScanTruncated: boolean;
}

export type ChatContentDeviation = {
  section: "242" | "244" | "246";
  paragraph: number;
  instruction: string;
};

const contentDeviationsSchema = z
  .array(
    z.object({
      section: z.enum(["242", "244", "246"]),
      paragraph: z
        .number()
        .int()
        .min(1)
        .describe("1-based paragraph within that section of the CURRENT report."),
      instruction: z
        .string()
        .min(1)
        .describe("The writer's own correction for that paragraph, verbatim."),
    })
  )
  .max(40)
  .optional()
  .describe(
    "Content Deviations the writer named. They join the same list with c- ids."
  );

async function inventoryContext(
  ctx: ChatToolCtx,
  referenceFileName?: string
): Promise<InventoryContext> {
  if (!ctx.threadId) throw new Error("No thread in tool context");
  return await ctx.runQuery(internal.chatV2.getDeviationInventoryContext, {
    agentThreadId: ctx.threadId,
    ...(referenceFileName ? { referenceFileName } : {}),
  });
}

function renderOrExplain(args: {
  context: InventoryContext;
  contentDeviations?: ChatContentDeviation[];
  referenceSections?: InventorySections | null;
}): string {
  try {
    return renderInventory(
      assembleDeviationInventory({
        sections: args.context.sections,
        notes: args.context.notes,
        ...(args.contentDeviations ? { contentDeviations: args.contentDeviations } : {}),
        ...(args.referenceSections ? { referenceSections: args.referenceSections } : {}),
        rulesStatus: args.context.rulesStatus,
      })
    );
  } catch (error) {
    // A writer-named paragraph outside the report: hand back the valid range so
    // the model can re-anchor rather than guess. Never throw out of a tool: an
    // `output-error` part tells the writer a step failed and tells the model
    // nothing it can act on.
    if (error instanceof InventoryAnchorError) {
      return `Inventory NOT built: ${error.message}`;
    }
    throw error;
  }
}

/** CAP-12's tool body. Read only: it creates no proposal. */
export async function runDeviationInventory(
  ctx: ChatToolCtx,
  input: { contentDeviations?: ChatContentDeviation[] }
): Promise<string> {
  const context = await inventoryContext(ctx);
  if (!context.found) {
    return "The current report could not be loaded, so there is no paragraph list to build.";
  }
  return renderOrExplain({
    context,
    ...(input.contentDeviations ? { contentDeviations: input.contentDeviations } : {}),
  });
}

/** CAP-15's tool body. Read only: it creates no proposal. */
export async function runCompareReferencePd(
  ctx: ChatToolCtx,
  input: { fileName?: string; contentDeviations?: ChatContentDeviation[] }
): Promise<string> {
  const context = await inventoryContext(ctx, input.fileName);
  if (!context.found) {
    return "The current report could not be loaded, so there is nothing to compare.";
  }
  const quoted = (names: string[]) => names.map((name) => `"${name}"`).join(", ");
  const named = context.selectedReferenceFileName;
  // DW-138: a bounded walk that stopped short is a limit to STATE on every
  // outcome, not an absence to report. "None attached" and "the only one"
  // are claims an incomplete walk cannot make.
  const truncated = context.documentScanTruncated;
  const scanNote = truncated
    ? ` Note: this project's documents were only partly scanned (the walk stops at ${MAX_PROJECT_DOCUMENT_SCAN} documents or at its read budget), so a previous-year report beyond that point was not seen; tell the writer this limit applies.`
    : "";
  const scanned = truncated ? "the documents scanned" : "this project's documents";
  switch (context.referenceStatus) {
    case "none":
      return truncated
        ? `No Reference PD was found among the documents scanned.${scanNote} Tell the writer that a comparison needs last year's PD uploaded to this project as a previous-year report document, and propose nothing.`
        : "This project has no Reference PD attached. Tell the writer that a comparison needs last year's PD uploaded to this project as a previous-year report document, and propose nothing.";
    case "unreadable":
      // Attached, but intake extracted no text from it (an image-only PDF, a
      // reference-only file, an empty body). Saying "not attached" would be
      // wrong and saying nothing would invite a fabricated comparison.
      return `${named ? `"${named}"` : "The attached previous-year report"} is attached to this project, but no text could be read from it, so there is nothing to compare. Tell the writer the file is attached and unreadable, suggest re-uploading a text-bearing copy, and propose nothing.${
        context.referenceFileNames.length
          ? ` Readable Reference PD file names: ${quoted(context.referenceFileNames)}.`
          : ""
      }${scanNote}`;
    case "unparsed":
      // Readable, but its text carries no Line 242/244/246 skeleton, so nothing
      // in it can be anchored to a paragraph of this draft.
      return `${named ? `"${named}"` : "The attached previous-year report"} could not be read into Line 242, Line 244 and Line 246 sections, so NO comparison was made. Tell the writer the file is attached but its text carries no recognizable section structure, and propose nothing from it.${scanNote}`;
    case "unknown_name":
      return `No readable previous-year report named ${named ? `"${named}"` : "that"} was found among ${scanned}. The available Reference PD file names are: ${quoted(context.referenceFileNames)}.${scanNote} Ask the writer which one, or call the tool again with one of those names.`;
    case "ambiguous":
      return truncated
        ? `The document scan was incomplete, so the comparison cannot establish which previous-year report to use. Readable Reference PD file names among the documents scanned: ${quoted(context.referenceFileNames)}.${scanNote} Ask the writer which one to compare against, then call the tool again with that name.`
        : `This project has more than one previous-year report. The available Reference PD file names are: ${quoted(context.referenceFileNames)}. Ask the writer which one to compare against.`;
    case "resolved":
      break;
  }
  if (!context.reference) {
    return `The Reference PD could not be resolved, so no comparison was made. Tell the writer and propose nothing.${scanNote}`;
  }
  const rendered = renderOrExplain({
    context,
    ...(input.contentDeviations ? { contentDeviations: input.contentDeviations } : {}),
    referenceSections: context.reference.sections,
  });
  return truncated ? `${rendered}\n\n${scanNote.trim()}` : rendered;
}

/** CAP-13's tool body: one proposal, one Completion Report, human apply. */
export async function runProposeBulkEdits(
  ctx: ChatToolCtx,
  input: BulkEditInput,
  options: { toolCallId: string; bannedWordsWaived: boolean }
): Promise<string> {
  if (!ctx.threadId) throw new Error("No thread in tool context");
  const result = await ctx.runMutation(internal.chatV2.saveProposal, {
    agentThreadId: ctx.threadId,
    toolCallId: options.toolCallId,
    ...(ctx.messageId ? { promptMessageId: ctx.messageId } : {}),
    kind: "replacements",
    requireUniqueTargets: true,
    replacements: input.edits.map((edit) => ({
      find: edit.targetText,
      replaceWith: scrubBannedWordsUnlessWaived(
        edit.newText,
        options.bannedWordsWaived
      ),
    })),
    items: completionReportItems(input.findings),
  });
  if (!result.ok) {
    return result.stopped
      ? `Stop requested: ${result.reason} Do not retry.`
      : `Proposal NOT created: ${result.reason} Re-read the current report and retry.`;
  }
  return `Coordinated revision proposed for writer review, not applied. Report this Completion Report checklist, retaining the item IDs:\n${completionReportChecklist(input.findings)}`;
}

const deviationInventory = createTool({
  description:
    "List every paragraph of the current report exactly once, in build order 242, 244, 246, with its rule Deviations from the stored Compliance Notes and any content Deviations the writer named. READ ONLY: it changes nothing and creates no proposal. Use it when the writer asks for the deviation list or inventory, or before a coordinated revision over a list of items, so every item has a stable id.",
  inputSchema: z.object({ contentDeviations: contentDeviationsSchema }),
  execute: async (ctx, input): Promise<string> =>
    await runDeviationInventory(ctx, input),
});

const compareReferencePd = createTool({
  description:
    "Compare the current report against a Reference PD attached to THIS project as a previous-year report, paragraph by paragraph. READ ONLY: it changes nothing and creates no proposal. Returns every paragraph once with its Reference PD counterpart, so differences can be reported per paragraph as x- items and offered as one coordinated revision. Never answer such a request with a similarity score.",
  inputSchema: z.object({
    fileName: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The Reference PD's file name, exactly as the project lists it. Omit when the project has only one."
      ),
    contentDeviations: contentDeviationsSchema,
  }),
  execute: async (ctx, input): Promise<string> =>
    await runCompareReferencePd(ctx, input),
});

const highlightPassages = createTool({
  description:
    "Locate passages for the writer WITHOUT changing them — the document panel scrolls to and highlights each one. Use for find/show/point-to requests only.",
  inputSchema: z.object({
    references: z
      .array(
        z
          .string()
          .min(1)
          .describe("Exact verbatim substring of the report to highlight.")
      )
      .min(1),
  }),
  execute: async (ctx, input, options): Promise<string> => {
    if (!ctx.threadId) throw new Error("No thread in tool context");
    const runtimeCtx = ctx as ToolCtx & { promptMessageId?: string };
    const result = await ctx.runMutation(internal.chatV2.saveProposal, {
      agentThreadId: ctx.threadId,
      toolCallId: options.toolCallId,
      promptMessageId: runtimeCtx.promptMessageId ?? ctx.messageId,
      kind: "references",
      references: input.references,
    });
    return result.ok
      ? `Highlighted ${input.references.length} passage(s) in the document panel.`
      : `Highlights NOT created: ${result.reason}`;
  },
});

const searchBrain = createTool({
  description:
    "Search The Brain (approved past SR&ED reports in this project's industry) for reference patterns. ONLY when the writer explicitly asks to draw on past projects/reports. Returns structure/voice/phrasing exemplars — never facts for this report.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe("What to look for, e.g. 'how uncertainty is framed for firmware projects'."),
  }),
  execute: async (ctx, input): Promise<string> => {
    if (!ctx.threadId) throw new Error("No thread in tool context");
    // The project code is normalized by getThreadBrainContext. Retrieval uses
    // it as structured metadata routing, with cross-code/legacy fallback.
    const brainContext: { industry: string | null; scienceCode: string | null } =
      await ctx.runQuery(internal.chatV2.getThreadBrainContext, {
        agentThreadId: ctx.threadId,
      });
    try {
      const { exemplars, degraded } = await searchBrainExemplars(ctx, {
        ...(brainContext.industry ? { industry: brainContext.industry } : {}),
        ...(brainContext.scienceCode ? { scienceCode: brainContext.scienceCode } : {}),
        query: input.query,
        k: 3,
        docType: "pd",
        agentThreadId: ctx.threadId,
        usageLabel: "chat",
      });
      // `degraded` = the search infrastructure failed (searchBrainExemplars
      // never throws) — saying "no knowledge" during a Voyage outage would
      // be a lie the writer can't distinguish from an empty corpus.
      if (degraded) {
        return "The Brain search hit a technical error just now — this is an infrastructure issue, not missing knowledge. Tell the writer to try again shortly.";
      }
      if (exemplars.length === 0) {
        return brainContext.industry
          ? `The Brain has no approved knowledge matching that in the “${brainContext.industry}” industry yet.`
          : "The Brain has no approved knowledge matching that yet.";
      }
      return formatBrainExemplars(exemplars);
    } catch (err) {
      console.error("searchBrain tool failed", safeErrorDetails(err));
      return "The Brain search hit a technical error just now — this is an infrastructure issue, not missing knowledge. Tell the writer to try again shortly.";
    }
  },
});

/**
 * Reasoning is on by default so the assistant analyses a request as carefully
 * here as the same model would on claude.ai — a writer shouldn't get shallower
 * answers because they asked inside Banhall.
 *
 * Adaptive thinking stays enabled, but its text is private. The browser gets
 * the answer and proposal cards, not a reasoning transcript.
 */
export const CHAT_THINKING = {
  thinking: { type: "adaptive" as const, display: "omitted" as const },
};

/**
 * Per-step ceiling shared by thinking, tool-call JSON, and answer text. Without
 * it the request inherits the model's 128K output ceiling, which is not a sane
 * worst case for one turn in a chat rail. Sonnet 5 defaults to high effort and
 * adaptive thinking can eat a tight budget, truncating the reply with
 * finishReason "length" — so this leaves real headroom for a dense report edit
 * rather than trimming to the smallest plausible number.
 */
const CHAT_MAX_OUTPUT_TOKENS = 16384;

/**
 * Model-history bound for report chat (audit finding 22): the newest 30
 * non-tool message rows up to and including the prompt. Rows, not turns, so
 * roughly fifteen exchanges. Applied only at the streamText call so the Agent
 * constructor keeps library defaults; frozen so nothing widens it at runtime.
 */
export const CHAT_CONTEXT_OPTIONS = Object.freeze(
  {
    recentMessages: 30,
    excludeToolMessages: true,
  } satisfies ContextOptions
);

export const buildChatTools = (bannedWordsWaived: boolean, allowBrain = false) => ({
  proposeEdit: makeProposeEdit(bannedWordsWaived),
  proposeReplacements: makeProposeReplacements(bannedWordsWaived),
  proposeBulkEdits: makeProposeBulkEdits(bannedWordsWaived),
  deviationInventory,
  compareReferencePd,
  highlightPassages,
  ...(allowBrain ? { searchBrain } : {}),
});

const CHAT_TOOLS = buildChatTools(false);

export const reportChatAgent = new Agent(components.agent, {
  name: "report-editor",
  languageModel: anthropic(MODEL),
  instructions: buildChatSystemPromptV2(),
  tools: CHAT_TOOLS,
  // BNH-16: durably log billed usage for every model step without turning a
  // successful streamed response into a chat failure.
  usageHandler: async (ctx, { threadId, userId, model, usage }) => {
    const cacheCreationInputTokens =
      usage.inputTokenDetails.cacheWriteTokens ?? 0;
    const cacheReadInputTokens =
      usage.inputTokenDetails.cacheReadTokens ?? 0;
    const totalInputTokens = usage.inputTokens ?? 0;
    const inputTokens =
      usage.inputTokenDetails.noCacheTokens ??
      Math.max(
        0,
        totalInputTokens -
          cacheCreationInputTokens -
          cacheReadInputTokens
      );
    try {
      await ctx.runMutation(internal.aiUsage.queueUsage, {
        ...(threadId ? { agentThreadId: threadId } : {}),
        ...(userId ? { userId } : {}),
        callSite: "chat_v2",
        model,
        inputTokens,
        outputTokens: usage.outputTokens ?? 0,
        ...(cacheCreationInputTokens
          ? { cacheCreationInputTokens }
          : {}),
        ...(cacheReadInputTokens ? { cacheReadInputTokens } : {}),
        createdAt: Date.now(),
      });
    } catch (error) {
      console.error("chat usage could not be queued", safeErrorDetails(error));
    }
  },
  // Reply → tool call → short lead-in; searchBrain adds a hop. 5 is headroom.
  stopWhen: stepCountIs(5),
});

/**
 * Stream the assistant's reply to a saved writer message. Scheduled by
 * chatV2.sendMessage; deltas persist via the component and reach the client
 * through chatV2.listMessages + useUIMessages.
 */
export const streamChatReply = internalAction({
  args: {
    agentThreadId: v.string(),
    promptMessageId: v.string(),
    reportId: v.id("reports"),
    // PSOS-49: the sender of the prompt turn. Their house-style waivers govern
    // this reply. Optional for scheduler calls queued before this field
    // existed — absent means default (full) enforcement.
    userId: v.optional(v.id("users")),
    // Only the authenticated send mutation can authorize this turn's retrieval.
    allowBrain: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const startedAt = Date.now();
    const start: {
      shouldRun: boolean;
      status: "queued" | "running" | "completed" | "failed" | "aborted";
    } = await ctx.runMutation(internal.chatV2.markTurnStarted, {
      agentThreadId: args.agentThreadId,
      promptMessageId: args.promptMessageId,
      startedAt,
    });
    if (!start.shouldRun) return;

    const toolCallIds = new Set<string>();

    try {
      // Explicit annotations break api-graph type circularity (TS7006 cascade).
      // The sender's profile loads in parallel with the evidence context so
      // the waiver lookup adds no serial round-trip to time-to-first-token.
      // `ChatTurnContext` is a plain interface with no api-graph reference, so
      // naming it here keeps the action and the builder from drifting without
      // reintroducing the circularity.
      const contextPromise: Promise<ChatTurnContext> = ctx.runQuery(
        internal.chatV2.getChatContextV2,
        {
          reportId: args.reportId,
          agentThreadId: args.agentThreadId,
        }
      );
      // PSOS-49/50: the sender's EFFECTIVE house-style waivers + preferences
      // (org-wide modes apply even for legacy turns with no userId). A failed
      // lookup must stop the turn instead of silently ignoring saved settings.
      const profilePromise: Promise<{
        customInstructions: string | null;
        styleOverrides: StyleOverrides;
      } | null> = ctx
        .runQuery(
          internal.writerProfiles.getProfileForGeneration,
          args.userId ? { userId: args.userId } : {}
        )
        .catch((err: unknown) => {
          console.error("writer profile fetch failed for chat turn", safeErrorDetails(err));
          throw new Error("CHAT_PROFILE_UNAVAILABLE");
        });
      const [context, writerStyle] = await Promise.all([
        contextPromise,
        profilePromise,
      ]);
      const styleOverrides = writerStyle
        ? normalizeStyleOverrides(writerStyle.styleOverrides)
        : NO_STYLE_OVERRIDES;

      // CAP-4: the action assembles nothing. `buildChatTurnRequest` owns the
      // whole request shape, so the system string carries only policy plus the
      // writer's own style (byte-stable across turns) and every piece of
      // evidence travels in one ephemeral user-role message, delimited,
      // neutralized and budgeted.
      const turn = buildChatTurnRequest({
        context,
        styleOverrides,
        customInstructions: writerStyle?.customInstructions ?? null,
      });
      // Operator telemetry only: this story logs, it does not surface anything
      // in the UI. Without the line, material the budget dropped is invisible
      // when a reply later reads as if the interview had a gap.
      const cuts = describeContextCuts(turn.report);
      if (cuts) {
        console.info(
          `chat evidence ${args.agentThreadId} (report ${args.reportId}): ${cuts}`
        );
      }

      // Second cancellation fence: context loading above is slow enough that
      // the writer can press stop during it. Without this, an aborted turn
      // would still generate text and create proposal cards.
      const stillActive: boolean = await ctx.runQuery(internal.chatV2.isTurnActive, {
        agentThreadId: args.agentThreadId,
        promptMessageId: args.promptMessageId,
      });
      if (!stillActive) return;

      const result = await reportChatAgent.streamText(
        ctx,
        { threadId: args.agentThreadId },
        {
          promptMessageId: args.promptMessageId,
          system: turn.system,
          // Ephemeral: with `promptMessageId` set the agent library saves no
          // input messages, so the evidence never enters thread history.
          messages: turn.messages,
          tools: buildChatTools(styleOverrides.bannedWords, args.allowBrain === true),
          providerOptions: { anthropic: CHAT_THINKING },
          maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
          // Must run upstream of the agent's smoothStream — see the module
          // comment. Without it, multi-step tool turns lose the thinking
          // signature and the model's reasoning is dropped between steps.
          experimental_transform: preserveReasoningSignature<typeof CHAT_TOOLS>(),
          onStepFinish: (step) => {
            for (const toolCall of step.toolCalls) {
              if (toolCall) toolCallIds.add(toolCall.toolCallId);
            }
          },
        },
        {
          saveStreamDeltas: true,
          contextOptions: CHAT_CONTEXT_OPTIONS,
        }
      );
      await result.consumeStream();
      const finishReason = await result.finishReason;
      if (finishReason === "content-filter" || finishReason === "length") {
        throw new Error("CHAT_INCOMPLETE_RESPONSE");
      }
      await ctx.runMutation(internal.chatV2.finishTurn, {
        agentThreadId: args.agentThreadId,
        promptMessageId: args.promptMessageId,
        requestedStatus: "completed",
        endedAt: Date.now(),
        stepCount: toolCallIds.size,
      });
    } catch (error) {
      const finish: {
        status: "queued" | "running" | "completed" | "failed" | "aborted";
      } = await ctx.runMutation(internal.chatV2.finishTurn, {
        agentThreadId: args.agentThreadId,
        promptMessageId: args.promptMessageId,
        requestedStatus: "failed",
        endedAt: Date.now(),
        stepCount: toolCallIds.size,
      });
      console.error("report chat response failed", { threadId: args.agentThreadId, ...safeErrorDetails(error) });
      if (finish.status !== "failed") return;

      await saveMessage(ctx, components.agent, {
        threadId: args.agentThreadId,
        agentName: "report-editor",
        // Shares the prompt's order so the failed turn's trace attaches to it.
        promptMessageId: args.promptMessageId,
        message: {
          role: "assistant",
          content: error instanceof Error && error.message === "CHAT_PROFILE_UNAVAILABLE"
            ? "I couldn't load your saved writing settings, so I haven't proposed changes. Please retry. You don't need to rewrite your instructions."
            : "I couldn’t finish that response. Try again.",
        },
      });
    }
  },
});
