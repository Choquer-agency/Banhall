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
} from "@convex-dev/agent";
import type { ModelMessage } from "ai";
// The report chat assistant calls Anthropic directly with ANTHROPIC_API_KEY,
// whatever ANTHROPIC_TRANSPORT says (owner decision 30, 2026-09-25: chat
// moves to OpenRouter in a later change). Its helper calls (clientForRole)
// do follow the transport. Owner decision 64 (2026-09-26): when the direct
// account is out of credit, a turn goes through the Anthropic-pinned
// OpenRouter transport instead (creditFallbackFetch).
import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import type { UsageHandler } from "@convex-dev/agent";
import { MODEL } from "./model";
import { buildChatSystemPromptV2 } from "./prompts";
import {
  BULK_EDIT_NEW_WORDS_PER_CALL,
  BULK_EDIT_REFINE_RULE,
  BULK_EDIT_SIZE_RULE,
  bulkEditInputSchema,
  completionReportCounts,
  completionReportItems,
  nothingToApply,
  type BulkEditInput,
} from "../lib/completionReport";
import {
  InventoryAnchorError,
  assembleDeviationInventory,
  renderInventory,
  type InventoryNote,
  type InventorySection,
  type InventorySections,
  type RulesStatus,
} from "../lib/deviationInventory";
import {
  NO_STYLE_OVERRIDES,
  normalizeStyleOverrides,
  type StyleOverrides,
} from "../../shared/styleOverrides";
import { scrubBannedWordsUnlessWaived } from "../lib/reportEdits";
import {
  CHAT_CACHE_CONTROL,
  arrangeChatContext,
  buildChatTurnRequest,
  type ChatTurnContext,
} from "./chatEvidence";
import { MAX_PROJECT_DOCUMENT_SCAN } from "../chatV2";
import { describeContextCuts } from "./trustedContext";
import { preserveReasoningSignature } from "./reasoningSignature";
import { searchBrainExemplars, formatBrainExemplars } from "./brain/retrieve";
import { makeSearchWebTool, newWebSearchTurn, type WebSearchTurn } from "./chatWebSearch";
import type { ChatTurnContinuationReason, ChatTurnProgress } from "../lib/chatTurnState";
import { handledItemsNote, type ItemCoverage } from "../lib/chatItemCoverage";
import { safeErrorDetails } from "../lib/safeErrorDetails";
import { anthropicCacheWrite1hTokens } from "./instrument";
import { ACTION_REQUEST_WINDOW_MS } from "./actionDeadline";
import { roleModelEntryRef } from "../lib/modelCatalogRefs";
import { creditFallbackFetch, type ChatServedState } from "./anthropicCredit";
import { openRouterCreditFallbackKey } from "../lib/providerConfig";
import { openRouterAnthropicCharge, openRouterAnthropicRequestId } from "../../shared/anthropicTransport";

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
          "The exact substring of the current report to replace, copied character-for-character."
        ),
      newText: z
        .string()
        .min(1)
        .describe("The replacement text, fully compliant with the writing rules."),
    }),
    execute: async (ctx, input, options): Promise<string> => {
      if (!ctx.threadId) throw new Error("No thread in tool context");
      const result = await ctx.runMutation(internal.chatV2.saveProposal, {
        agentThreadId: ctx.threadId,
        toolCallId: options.toolCallId,
        promptMessageId: proposalPromptMessageId(ctx),
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
      const result = await ctx.runMutation(internal.chatV2.saveProposal, {
        agentThreadId: ctx.threadId,
        toolCallId: options.toolCallId,
        promptMessageId: proposalPromptMessageId(ctx),
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
  description: `Propose a coordinated revision of different report passages in one reviewable card, plus a Completion Report for the items it covers. Each target must be unique and passages must not overlap. Reuse the item ids the Deviation Inventory or the Reference PD comparison produced, anchor each finding to the section and 1-based paragraph it belongs to, and mark it resolved, blocked or conflicting. The writer applies the proposal. ${BULK_EDIT_SIZE_RULE} ${BULK_EDIT_REFINE_RULE} If every item is blocked or conflicting, call it with an empty edits list and every finding: the report is recorded for the writer and there is nothing to apply. Never invent a dummy edit.`,
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
  /**
   * The prompt this turn answers. `@convex-dev/agent` sets it on the tool ctx
   * at run time (`client/start.js`), although its `ToolCtx` type declares only
   * `messageId`, which it never sets.
   */
  promptMessageId?: string | undefined;
  messageId?: string | undefined;
  runQuery: ActionCtx["runQuery"];
  runMutation: ActionCtx["runMutation"];
}

/**
 * The prompt a proposal belongs to, for every proposal tool.
 * `chatV2.listProposals` finds a card only through this id, so a tool that
 * drops it makes its cards invisible. Alerts triage 2026-10-01 (first):
 * proposeBulkEdits read only `messageId`, which the agent never sets, so every
 * bulk card was saved without its prompt and never shown. One helper for all
 * four tools, so they cannot drift again.
 */
export function proposalPromptMessageId(
  ctx: { promptMessageId?: string | undefined; messageId?: string | undefined }
): string | undefined {
  return ctx.promptMessageId ?? ctx.messageId;
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

/**
 * 2026-10-19: one Line of the inventory. A fix request over a long list ran out
 * of output thinking about every item at once (a writer's PD08 and PD13 c turns),
 * so the prompt has a long list revised one Line per reply.
 */
const inventorySectionSchema = z
  .enum(["242", "244", "246"])
  .optional()
  .describe(
    "List one Line only. Use it when fixing a long list: one Line per reply, in build order 242, 244, 246. Omit it to list the whole report."
  );

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

/**
 * Phase A review P2-2: what this conversation already did with each item,
 * keyed by item id, so the inventory marks it. An empty map when the read
 * fails: the list is still right, only unmarked.
 */
async function threadCoverage(ctx: ChatToolCtx): Promise<Map<string, ItemCoverage>> {
  if (!ctx.threadId) return new Map();
  try {
    const coverage: ItemCoverage[] = await ctx.runQuery(internal.chatV2.getThreadItemCoverage, {
      agentThreadId: ctx.threadId,
    });
    return new Map(coverage.map((item) => [item.itemId, item]));
  } catch (error) {
    console.error("chat item coverage could not be read", safeErrorDetails(error));
    return new Map();
  }
}

function renderOrExplain(args: {
  context: InventoryContext;
  contentDeviations?: ChatContentDeviation[];
  referenceSections?: InventorySections | null;
  section?: InventorySection;
  coverage?: ReadonlyMap<string, ItemCoverage>;
}): string {
  try {
    return renderInventory(
      assembleDeviationInventory({
        sections: args.context.sections,
        notes: args.context.notes,
        ...(args.contentDeviations ? { contentDeviations: args.contentDeviations } : {}),
        ...(args.referenceSections ? { referenceSections: args.referenceSections } : {}),
        rulesStatus: args.context.rulesStatus,
      }),
      {
        ...(args.section ? { section: args.section } : {}),
        ...(args.coverage && args.coverage.size > 0 ? { coverage: args.coverage } : {}),
      }
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
  input: { contentDeviations?: ChatContentDeviation[]; section?: InventorySection }
): Promise<string> {
  const [context, coverage] = await Promise.all([inventoryContext(ctx), threadCoverage(ctx)]);
  if (!context.found) {
    return "The current report could not be loaded, so there is no paragraph list to build.";
  }
  return renderOrExplain({
    context,
    ...(input.contentDeviations ? { contentDeviations: input.contentDeviations } : {}),
    ...(input.section ? { section: input.section } : {}),
    coverage,
  });
}

/** CAP-15's tool body. Read only: it creates no proposal. */
export async function runCompareReferencePd(
  ctx: ChatToolCtx,
  input: {
    fileName?: string;
    contentDeviations?: ChatContentDeviation[];
    section?: InventorySection;
  }
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
    ...(input.section ? { section: input.section } : {}),
    coverage: await threadCoverage(ctx),
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
    promptMessageId: proposalPromptMessageId(ctx),
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
  // DW-135: every item blocked or conflicting. The findings are recorded; the
  // report is unchanged and there is no card to apply, so the reply must not
  // open with "Proposed".
  // Phase A (2026-10-19, CAP-13 change): the card shows the checklist, so the
  // model gets counts and the ids that need the writer, not a list to retype.
  if (nothingToApply(input)) {
    return `Nothing to apply: every item is blocked or conflicting, so no revision was proposed and the report is unchanged. The findings were recorded for the writer's decision, and the card shows them as a Completion Report checklist: ${completionReportCounts(input.findings)}. Do not repeat the checklist; name the decisions or missing facts the writer needs.`;
  }
  return `Coordinated revision proposed for writer review, not applied. The card shows the writer its Completion Report checklist with every item's id, status and reason: ${completionReportCounts(input.findings)}. Do not repeat the checklist in your reply; say in a sentence or two what the proposal covers and which items need the writer's decision.`;
}

const deviationInventory = createTool({
  description:
    "List every paragraph of the current report (or of one Line) exactly once, in build order 242, 244, 246, with its rule Deviations from the stored Compliance Notes and any content Deviations the writer named. READ ONLY: it changes nothing and creates no proposal. Use it when the writer asks for the deviation list or inventory, or before a coordinated revision over a list of items, so every item has a stable id.",
  inputSchema: z.object({
    contentDeviations: contentDeviationsSchema,
    section: inventorySectionSchema,
  }),
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
    section: inventorySectionSchema,
  }),
  execute: async (ctx, input): Promise<string> =>
    await runCompareReferencePd(ctx, input),
});

const highlightPassages = createTool({
  description:
    "Locate passages for the writer WITHOUT changing them; the document panel scrolls to and highlights each one. Use for find/show/point-to requests only.",
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
    const result = await ctx.runMutation(internal.chatV2.saveProposal, {
      agentThreadId: ctx.threadId,
      toolCallId: options.toolCallId,
      promptMessageId: proposalPromptMessageId(ctx),
      kind: "references",
      references: input.references,
    });
    return result.ok
      ? `Highlighted ${input.references.length} passage(s) in the document panel.`
      : `Highlights NOT created: ${result.reason}`;
  },
});

/**
 * Phase A (2026-10-19): searchBrain is offered on every turn so the tool
 * list, and the prompt cache with it, stays the same whatever the writer
 * picks. Without "Use Brain examples for this message" the tool searches
 * nothing and returns this (the September 8 rule, enforced in the body).
 */
export const CHAT_BRAIN_OFF =
  'Nothing was searched. Brain examples are off for this message. Answer without past examples. If the writer wants them, tell them they can turn on "Use Brain examples for this message" in Message options and send again.';

/** The search could not be recorded on the turn, so it did not run. */
export const CHAT_BRAIN_NOT_STARTED =
  "Nothing was searched. The Brain search could not start for this reply. Answer without past examples.";

const BRAIN_SEARCH_FAILED =
  "The Brain search hit a technical error just now. This is an infrastructure issue, not missing knowledge. Tell the writer to try again shortly.";

const makeSearchBrain = (allowBrain: boolean) => createTool({
  description:
    "Search The Brain (approved past SR&ED reports in this project's industry) for reference patterns. ONLY when the writer explicitly asks to draw on past projects/reports. It searches only when the writer turned on Brain examples for this message; otherwise it searches nothing and says so. Returns structure/voice/phrasing exemplars, never facts for this report.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe("What to look for, e.g. 'how uncertainty is framed for firmware projects'."),
  }),
  execute: async (ctx, input): Promise<string> => {
    // The permission comes first: an off turn reads nothing.
    if (!allowBrain) return CHAT_BRAIN_OFF;
    if (!ctx.threadId) throw new Error("No thread in tool context");
    // Recorded before the search, so the browser never receives a reasoning
    // summary written after Brain material reached the model.
    const promptMessageId = proposalPromptMessageId(ctx);
    const marked: boolean = promptMessageId
      ? await ctx.runMutation(internal.chatV2.markTurnBrainSearched, {
          agentThreadId: ctx.threadId,
          promptMessageId,
        })
      : false;
    if (!marked) return CHAT_BRAIN_NOT_STARTED;
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
      if (degraded) return BRAIN_SEARCH_FAILED;
      if (exemplars.length === 0) {
        return brainContext.industry
          ? `The Brain has no approved knowledge matching that in the “${brainContext.industry}” industry yet.`
          : "The Brain has no approved knowledge matching that yet.";
      }
      return formatBrainExemplars(exemplars);
    } catch (err) {
      console.error("searchBrain tool failed", safeErrorDetails(err));
      return BRAIN_SEARCH_FAILED;
    }
  },
});

/**
 * Reasoning is on by default so the assistant analyses a request as carefully
 * here as the same model would on claude.ai — a writer shouldn't get shallower
 * answers because they asked inside Banhall.
 *
 * Owner decision 2026-10-19 (chat parity Phase A): Anthropic returns a
 * summary of the thinking (`display: "summarized"`), and the browser may read
 * that summary, capped, and never after a searchBrain call in the same turn
 * (convex/lib/chatPublicOutput.ts). The full thinking stays with Anthropic.
 * The summary block carries the same signature, so `preserveReasoningSignature`
 * and the thinking-only rules work as before.
 */
export const CHAT_THINKING = {
  thinking: { type: "adaptive" as const, display: "summarized" as const },
};

/**
 * Anthropic options for every chat step: thinking as above, plus automatic
 * prompt caching (a top-level cache_control) that follows the end of the
 * request, so step two of a tool turn reads step one's prefix. It is the
 * fourth breakpoint beside the three `arrangeChatContext` places.
 */
export const CHAT_PROVIDER_OPTIONS = {
  anthropic: { ...CHAT_THINKING, cacheControl: CHAT_CACHE_CONTROL.toolSteps },
};

/**
 * Per-step ceiling shared by thinking, tool-call JSON, and answer text. Without
 * it the request inherits the model's 128K output ceiling, which is not a sane
 * worst case for one turn in a chat rail. Sonnet 5 defaults to high effort and
 * adaptive thinking can eat a tight budget, truncating the reply with
 * finishReason "length" — so this leaves real headroom for a dense report edit
 * rather than trimming to the smallest plausible number.
 */
export const CHAT_MAX_OUTPUT_TOKENS = 16384;

/** Reply, tool call, short lead-in; searchBrain adds a hop. 5 is headroom. */
export const CHAT_MAX_STEPS = 5;

/**
 * 2026-10-01 (first), alerts triage. A step cut off at the output limit while
 * it was writing a tool call leaves an invalid call (its JSON never closed),
 * and the AI SDK answers it with the parse error, which echoes the whole cut
 * input and tells the model nothing it can act on. A fixed text per tool
 * replaces that error, so the model makes the call smaller and goes on within
 * the turn's step and time limits.
 */
export const CHAT_CUT_OFF_INSTRUCTIONS: Readonly<Record<string, string>> = Object.freeze({
  proposeBulkEdits: `Your proposeBulkEdits call was cut off at the output limit before it finished, so nothing was proposed. Split the revision into smaller proposeBulkEdits calls made one at a time: at most about ${BULK_EDIT_NEW_WORDS_PER_CALL} words of new text each, about four paragraphs, one per Line or per few paragraphs. Make the first call now.`,
  proposeEdit:
    "Your proposeEdit call was cut off at the output limit before it finished, so nothing was proposed. Call it again for one passage only, with targetText and newText kept to that passage. For changes across several passages, use proposeBulkEdits calls made one at a time.",
  proposeReplacements:
    "Your proposeReplacements call was cut off at the output limit before it finished, so nothing was proposed. Call it again with fewer find and replace pairs, each only as long as it needs to be to stay specific.",
  highlightPassages:
    "Your highlightPassages call was cut off at the output limit before it finished, so nothing was highlighted. Call it again with fewer passages, a short distinctive clause for each.",
});

/** The fixed text for a tool with none of its own. */
export const CHAT_CUT_OFF_INSTRUCTION_OTHER =
  "Your last tool call was cut off at the output limit before it finished, so it did not run. Call it again with a shorter input.";

export function cutOffInstruction(toolName: string): string {
  return CHAT_CUT_OFF_INSTRUCTIONS[toolName] ?? CHAT_CUT_OFF_INSTRUCTION_OTHER;
}

/** What the writer reads when a cut-off tool call ends the turn. */
export const CHAT_CUT_OFF_REPLY =
  "That revision was too long to write in one reply. Ask for it a few paragraphs at a time.";

/**
 * What the writer reads when a turn ends on the step limit (its last step was
 * a tool call, so the model never wrote its closing text) after it saved an
 * edit proposal: a split revision has parts left.
 */
export const CHAT_STEP_LIMIT_REPLY =
  "I stopped at the step limit for one reply, so this revision is not finished. Review the cards above, then ask me to continue with the rest.";

/** The same, for a turn that saved no edit proposal (PR #24 review P3). */
export const CHAT_STEP_LIMIT_REPLY_OTHER =
  "I stopped at the step limit for one reply. Ask me to continue.";

/**
 * 2026-10-19 (the 2026-10-07 deviation chat failure). In all four failed "address
 * each deviation" turns (PD08 on 09-29, PD13 c on 10-07) the step after a long
 * deviationInventory result spent the whole output limit thinking: no tool
 * call and no text, so the 10-01 cut-off rules above (which need a cut tool
 * call) never fired and the writer read a generic "Try again". A step that
 * follows a list result now thinks at medium effort, and a step that still
 * thinks to the limit gets one recovery pass (see `streamChatReply`).
 */
export const CHAT_LIST_STEP_EFFORT = "medium" as const;

/** The read-only tools whose long result the next step has to plan over. */
const LIST_TOOLS: ReadonlySet<string> = new Set(["deviationInventory", "compareReferencePd"]);

export function followsListResult(
  steps: ReadonlyArray<{ toolCalls: ReadonlyArray<{ toolName: string } | undefined> }>
): boolean {
  return steps.some((step) => step.toolCalls.some((call) => call !== undefined && LIST_TOOLS.has(call.toolName)));
}

/** Merged into a step's provider options (AI SDK `prepareStep`). */
export const CHAT_LIST_STEP_PROVIDER_OPTIONS = {
  anthropic: { effort: CHAT_LIST_STEP_EFFORT },
};

/**
 * The recovery pass thinks at low effort, with the same cache breakpoints. A
 * change of effort between requests rewrites the cached message prefix (the
 * tools and system prompt stay cached), so a recovered turn pays one more
 * cache write; so does the medium-effort step after a list result.
 */
export const CHAT_RECOVERY_PROVIDER_OPTIONS = {
  anthropic: { ...CHAT_PROVIDER_OPTIONS.anthropic, effort: "low" as const },
};

/**
 * Time the recovery pass needs left in the action's window. A failed pass
 * took 140 to 168 seconds to think to the limit; a pass that plans briefly and
 * proposes one Line takes well under this.
 */
export const CHAT_RECOVERY_MIN_REMAINING_MS = 150_000;

/** The instruction the recovery pass gets after the writer's message. */
export const CHAT_THINKING_RECOVERY_INSTRUCTION =
  "Your previous attempt at this request spent its whole output allowance planning and wrote nothing, so nothing was proposed. Plan briefly this time, then act. If the request covers more than one Line or a long list, do only the first Line it concerns, in build order 242, 244, 246: for deviations, call deviationInventory with that section, then propose that Line's revision. Close by naming what is left, so the writer can ask you to continue.";

/** What the writer reads when a step thought to the limit and nothing was saved. */
export const CHAT_THINKING_CUT_OFF_REPLY =
  "That request was too big to finish in one reply, so I proposed nothing. Ask for one part at a time, for example: Fix the deviations in Line 244.";

/** The same, when the turn saved an edit proposal before the step that ran out. */
export const CHAT_THINKING_CUT_OFF_PARTIAL_REPLY =
  "I proposed part of this above, then ran out of room before the rest. Review the cards, then ask me to continue.";

/** What the writer reads when the closing text itself hit the limit. */
export const CHAT_REPLY_CUT_OFF_REPLY =
  "My reply hit the length limit before it finished. Ask me to continue, or ask for one part at a time.";

/** The parts of a finished step `thinkingOnlyCutOff` reads. */
type ThinkingCutStep = {
  finishReason: string;
  toolCalls: ReadonlyArray<unknown>;
  text: string;
};

/**
 * True for a step cut off at the output limit that wrote no tool call and no
 * text: it spent the limit thinking. `sawToolInput` covers a call whose block
 * never closed, which the step does not record as a call.
 */
export function thinkingOnlyCutOff(step: ThinkingCutStep, sawToolInput: boolean): boolean {
  return (
    step.finishReason === "length" &&
    !sawToolInput &&
    step.toolCalls.length === 0 &&
    step.text.trim().length === 0
  );
}


/** The parts of an AI SDK step result the cut-off rules read. */
type CutOffStep = { finishReason: string; content: ReadonlyArray<unknown> };

type CutOffCall = { toolCallId: string; toolName: string; input: unknown };

function isInvalidToolCall(part: unknown): part is CutOffCall & { type: "tool-call"; invalid: true } {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    part.type === "tool-call" &&
    "invalid" in part &&
    part.invalid === true &&
    "toolCallId" in part &&
    typeof part.toolCallId === "string" &&
    "toolName" in part &&
    typeof part.toolName === "string"
  );
}

/**
 * The tool calls a step was writing when the output limit cut it off: the
 * invalid calls of a step that finished with "length". Anthropic closes the
 * cut tool_use block before its max_tokens stop, so the SDK records the call
 * with input it cannot parse (the raw text it received).
 */
export function cutOffToolCalls(step: CutOffStep): CutOffCall[] {
  if (step.finishReason !== "length") return [];
  return step.content.flatMap((part) =>
    isInvalidToolCall(part)
      ? [{ toolCallId: part.toolCallId, toolName: part.toolName, input: part.input }]
      : []
  );
}

export function cutOffToolCallIds(step: CutOffStep): string[] {
  return cutOffToolCalls(step).map((call) => call.toolCallId);
}

/**
 * The step's request with every cut-off call's error result replaced by its
 * tool's fixed text (`cutOffInstruction`). Applied to every later step, not
 * only the next one, so the history each request sends stays the same from
 * step to step. Returns the messages unchanged (the same array) when nothing
 * was cut off.
 */
export function withCutOffInstruction(
  messages: ModelMessage[],
  steps: ReadonlyArray<CutOffStep>
): ModelMessage[] {
  const cut = new Set(steps.flatMap(cutOffToolCallIds));
  if (cut.size === 0) return messages;
  return messages.map((message) => {
    if (message.role !== "tool") return message;
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === "tool-result" && cut.has(part.toolCallId)
          ? { ...part, output: { type: "error-text" as const, value: cutOffInstruction(part.toolName) } }
          : part
      ),
    };
  });
}

/**
 * The model gets the instruction once. A second cut-off tool call in the same
 * turn stops the turn there, rather than spend another full step of output on
 * the same mistake; the writer then reads CHAT_CUT_OFF_REPLY.
 */
export function stopAfterSecondCutOff({ steps }: { steps: ReadonlyArray<CutOffStep> }): boolean {
  return steps.filter((step) => cutOffToolCallIds(step).length > 0).length >= 2;
}

/** The turn's stop conditions: the step limit, and a second cut-off. */
export function chatTurnStops(steps: ReadonlyArray<CutOffStep>): boolean {
  return steps.length >= CHAT_MAX_STEPS || stopAfterSecondCutOff({ steps });
}

type UsageStep = CutOffStep & {
  toolCalls: ReadonlyArray<unknown>;
  usage: Parameters<UsageHandler>[1]["usage"];
  providerMetadata: Parameters<UsageHandler>[1]["providerMetadata"];
};

/**
 * Review P2-1: `@convex-dev/agent` 0.6.4 saves a step, and so logs its usage,
 * only when the step finished with "tool-calls" or ended the turn. A step that
 * finished otherwise (a cut-off call) but that the AI SDK still continues from
 * (every call answered, no stop condition met) is held back as the turn's last
 * step; the agent also stops streaming deltas for the turn, so it no longer
 * sees a Stop. True for exactly that step. If a later step finishes, the agent
 * has replaced it and never logs it, so the app does; if the turn ends first
 * (a stop, an error, the time limit), the agent saves the held step and logs
 * it.
 */
export function stepHeldBackByAgent(step: UsageStep, steps: ReadonlyArray<CutOffStep>): boolean {
  if (step.finishReason === "tool-calls" || step.toolCalls.length === 0) return false;
  const answered = step.content.filter((part) =>
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    (part.type === "tool-result" || part.type === "tool-error")
  ).length;
  return answered >= step.toolCalls.length && !chatTurnStops(steps);
}

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

/**
 * How many whole turns the history window drops at once when it outgrows
 * CHAT_CONTEXT_OPTIONS.recentMessages (cost phase 1). A window that slid by
 * one row per turn would change the first history byte on every turn once a
 * thread passed 30 rows, so the cached history could never be read again;
 * this one starts on a fixed turn boundary and moves only every few turns.
 * The model still sees at most 30 rows; right after a move it sees about
 * CHAT_HISTORY_CHUNK_TURNS turns fewer, and the window then refills.
 */
export const CHAT_HISTORY_CHUNK_TURNS = 4;
/** Rows read to place the window; comfortably above the 30-row bound. */
const CHAT_HISTORY_PROBE_ROWS = 60;

/**
 * The row count for this turn's history fetch. `rows` are the thread's
 * non-tool rows newest first, up to and including the prompt, read with the
 * same filters the agent library uses; `complete` says the read reached the
 * start of the thread. The window is every row whose turn (`order`) is at or
 * after the earliest multiple of `chunkTurns` that keeps it within
 * `maxRows`. Returns `maxRows` itself (the plain newest-rows window) when
 * the whole thread fits, or when no boundary does.
 */
export function chatHistoryWindowRows(
  rows: ReadonlyArray<{ order: number }>,
  options: { maxRows: number; chunkTurns: number; complete: boolean }
): number {
  if (rows.length === 0) return options.maxRows;
  const orders = rows.map((row) => row.order);
  const newest = Math.max(...orders);
  const oldest = Math.min(...orders);
  const countFrom = (anchor: number) =>
    orders.filter((order) => order >= anchor).length;
  const first = Math.floor(oldest / options.chunkTurns) * options.chunkTurns;
  for (let anchor = first; anchor <= newest; anchor += options.chunkTurns) {
    // A partial read cannot count the oldest turn it reached.
    if (!options.complete && anchor <= oldest) continue;
    const count = countFrom(anchor);
    // The whole thread fits: the plain bound fetches exactly these rows.
    if (options.complete && count === rows.length && count <= options.maxRows) {
      return options.maxRows;
    }
    if (count <= options.maxRows) return count;
  }
  return options.maxRows;
}

/**
 * Phase A (2026-10-19): the oldest message `order` the model reads when the
 * window of `recentMessages` rows (newest first, up to and including the
 * prompt) leaves older rows out, or undefined when it reads the whole thread.
 */
export function chatHistoryStartOrder(
  rows: ReadonlyArray<{ order: number }>,
  options: { recentMessages: number; complete: boolean }
): number | undefined {
  if (options.complete && rows.length <= options.recentMessages) return undefined;
  const read = rows.slice(0, options.recentMessages);
  if (read.length === 0) return undefined;
  return Math.min(...read.map((row) => row.order));
}

/** What the model is told when older turns were left out of its history. */
export const CHAT_CONTEXT_LOSS_NOTE =
  "Earlier turns of this conversation are not shown to you; if the writer refers to them, say so and ask them to restate what matters.";

/**
 * The per-turn note after the evidence tail (never in the cached head): which
 * message options the writer turned on, and, when older turns were left out,
 * CHAT_CONTEXT_LOSS_NOTE.
 */
export function chatTurnNote(args: {
  allowBrain: boolean;
  allowWeb: boolean;
  historyCut: boolean;
  /** Review P2-2: the handled Deviations per Line (`handledItemsNote`). */
  handled?: string | null;
}): string {
  const options = `Message options for this message: Brain examples are ${args.allowBrain ? "on" : "off"}, web search is ${args.allowWeb ? "on" : "off"}.`;
  return [options, args.handled ?? null, args.historyCut ? CHAT_CONTEXT_LOSS_NOTE : null]
    .filter((line): line is string => line !== null)
    .join("\n");
}

async function chatContextWindow(
  ctx: ActionCtx,
  args: { agentThreadId: string; promptMessageId: string }
): Promise<{ options: ContextOptions; historyStartOrder?: number }> {
  try {
    const probe = await ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
      threadId: args.agentThreadId,
      excludeToolMessages: CHAT_CONTEXT_OPTIONS.excludeToolMessages,
      paginationOpts: { numItems: CHAT_HISTORY_PROBE_ROWS, cursor: null },
      upToAndIncludingMessageId: args.promptMessageId,
      order: "desc",
      statuses: ["success"],
    });
    const recentMessages = chatHistoryWindowRows(probe.page, {
      maxRows: CHAT_CONTEXT_OPTIONS.recentMessages,
      chunkTurns: CHAT_HISTORY_CHUNK_TURNS,
      complete: probe.isDone,
    });
    const historyStartOrder = chatHistoryStartOrder(probe.page, {
      recentMessages,
      complete: probe.isDone,
    });
    const options =
      recentMessages === CHAT_CONTEXT_OPTIONS.recentMessages
        ? CHAT_CONTEXT_OPTIONS
        : { ...CHAT_CONTEXT_OPTIONS, recentMessages };
    return historyStartOrder === undefined ? { options } : { options, historyStartOrder };
  } catch (error) {
    // The window only affects caching; the plain bound is always safe. Where
    // it starts is then unknown, so nothing is recorded.
    console.error("chat history window probe failed", safeErrorDetails(error));
    return { options: CHAT_CONTEXT_OPTIONS };
  }
}

/**
 * The tools for one model pass. Phase A (2026-10-19): every tool is offered on
 * every turn, in the same order with the same descriptions, so turning Brain
 * examples or web search on for one message no longer changes the tool list
 * and rewrites the prompt cache. The per-message permission is enforced
 * inside each tool body (`CHAT_BRAIN_OFF`, `CHAT_WEB_SEARCH_OFF`). `webSearch`
 * is the turn's web search state, its count shared by every pass; without
 * one, searchWeb searches nothing.
 */
export const buildChatTools = (
  bannedWordsWaived: boolean,
  allowBrain = false,
  webSearch: WebSearchTurn | null = null
) => ({
  proposeEdit: makeProposeEdit(bannedWordsWaived),
  proposeReplacements: makeProposeReplacements(bannedWordsWaived),
  proposeBulkEdits: makeProposeBulkEdits(bannedWordsWaived),
  deviationInventory,
  compareReferencePd,
  highlightPassages,
  searchBrain: makeSearchBrain(allowBrain),
  searchWeb: makeSearchWebTool(webSearch ?? newWebSearchTurn({ allowed: false })),
});

const CHAT_TOOLS = buildChatTools(false);

/** Every chat tool name: progress labels never carry a name the model made up. */
export const CHAT_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(CHAT_TOOLS));

export const reportChatAgent = new Agent(components.agent, {
  name: "report-editor",
  languageModel: anthropic(MODEL),
  instructions: buildChatSystemPromptV2(),
  tools: CHAT_TOOLS,
  // BNH-16: durably log billed usage for every model step without turning a
  // successful streamed response into a chat failure.
  usageHandler: chatUsageHandler({ transport: "direct" }),
  stopWhen: stepCountIs(CHAT_MAX_STEPS),
});

// ─── Measurement and progress (chat parity Phase A, 2026-10-19) ─────────────

/** Anthropic's `message_start` usage, as the raw stream event carries it. */
type AnthropicStartUsage = {
  input_tokens?: unknown;
  output_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cache_creation?: unknown;
};

/**
 * One model request of a chat turn, measured from the provider's raw stream
 * events (`includeRawChunks`): numbers and fixed provider fields only, never
 * text.
 */
export type ChatStepMetrics = {
  /** 1-based model request of the turn. */
  step: number;
  /** The effort the step was sent with; "default" when none was set. */
  effort: string;
  startedAt: number;
  /** When the first output block (thinking, text or tool call) began. */
  firstTokenAt?: number;
  /** When the provider ended the message. */
  endedAt?: number;
  /** Anthropic's `stop_reason`. */
  stopReason?: string;
  /** Characters of thinking summary, text and tool input received. */
  receivedChars: number;
  startUsage?: AnthropicStartUsage;
  /** The output token count of the provider's last `message_delta`. */
  outputTokens?: number;
  /** The AI SDK finished the step, so its usage is logged with it. */
  stepFinished: boolean;
  /** A stopped request's partial usage row was queued. */
  partialLogged: boolean;
};

type ChatSection = "242" | "244" | "246";

function isChatSection(value: unknown): value is ChatSection {
  return value === "242" || value === "244" || value === "246";
}

/**
 * The Line a tool call names, from its fixed input fields only: `section`
 * (deviationInventory, compareReferencePd), or the one section every finding
 * of a proposeBulkEdits call shares.
 */
export function toolCallSection(input: unknown): ChatSection | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  if (isChatSection(record.section)) return record.section;
  if (!Array.isArray(record.findings)) return undefined;
  const sections = new Set<ChatSection>();
  for (const finding of record.findings) {
    if (finding && typeof finding === "object" && isChatSection((finding as Record<string, unknown>).section)) {
      sections.add((finding as { section: ChatSection }).section);
    }
  }
  return sections.size === 1 ? [...sections][0] : undefined;
}

type ProgressUpdate = Omit<ChatTurnProgress, "since">;

/**
 * Writes `chatTurns.progress` without holding up the stream. The AI SDK
 * awaits `onChunk`, so a phase change only records the latest wanted state
 * and one write runs at a time; a change that arrives while a write is in
 * flight replaces any older one still waiting. `flush` waits for the queue.
 */
export class TurnProgressWriter {
  private lastKey: string | undefined;
  private pending: ChatTurnProgress | undefined;
  private running: Promise<void> | undefined;

  constructor(
    private readonly write: (progress: ChatTurnProgress) => Promise<unknown>,
    private readonly now: () => number = Date.now
  ) {}

  set(update: ProgressUpdate): void {
    const key = JSON.stringify([update.phase, update.tool ?? null, update.section ?? null, update.step]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.pending = {
      phase: update.phase,
      ...(update.tool !== undefined ? { tool: update.tool } : {}),
      ...(update.section !== undefined ? { section: update.section } : {}),
      step: update.step,
      since: this.now(),
    };
    if (!this.running) this.running = this.drain();
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const next = this.pending;
      this.pending = undefined;
      try {
        await this.write(next);
      } catch (error) {
        console.error("chat progress could not be written", safeErrorDetails(error));
      }
    }
    this.running = undefined;
  }

  async flush(): Promise<void> {
    while (this.running) await this.running;
  }
}

/** Raw Anthropic stream event fields the meter reads. */
type RawStreamEvent = {
  type?: unknown;
  message?: { usage?: AnthropicStartUsage };
  content_block?: { type?: unknown; name?: unknown };
  delta?: { type?: unknown; text?: unknown; thinking?: unknown; partial_json?: unknown; stop_reason?: unknown };
  usage?: { output_tokens?: unknown };
};

/**
 * Measures each model request of one turn and derives its progress phases
 * from the raw stream events: a thinking block means "thinking", a text
 * block "writing", a tool call block "tool" with the tool's name.
 */
export class ChatTurnMeter {
  /** Model requests begun in this turn, across passes. */
  step = 0;
  current: ChatStepMetrics | undefined;
  /** The chat tools the model called in this turn. */
  readonly toolNames = new Set<string>();
  /** The turn's deviationInventory and compareReferencePd calls, for Continue. */
  readonly listCalls: Array<{ toolName: string; input: unknown }> = [];

  constructor(
    private readonly progress: (update: ProgressUpdate) => void = () => {},
    private readonly now: () => number = Date.now
  ) {}

  beginStep(effort: string): void {
    this.step += 1;
    this.current = {
      step: this.step,
      effort,
      startedAt: this.now(),
      receivedChars: 0,
      stepFinished: false,
      partialLogged: false,
    };
  }

  onRaw(raw: unknown): void {
    const step = this.current;
    if (!step || !raw || typeof raw !== "object") return;
    const event = raw as RawStreamEvent;
    switch (event.type) {
      case "message_start":
        if (event.message?.usage && typeof event.message.usage === "object") {
          step.startUsage = event.message.usage;
        }
        return;
      case "content_block_start": {
        step.firstTokenAt ??= this.now();
        const block = event.content_block?.type;
        if (block === "thinking" || block === "redacted_thinking") {
          this.progress({ phase: "thinking", step: step.step });
        } else if (block === "text") {
          this.progress({ phase: "writing", step: step.step });
        } else if (block === "tool_use") {
          const name = event.content_block?.name;
          if (typeof name === "string" && CHAT_TOOL_NAMES.has(name)) {
            this.toolNames.add(name);
            this.progress({ phase: "tool", tool: name, step: step.step });
          }
        }
        return;
      }
      case "content_block_delta": {
        const delta = event.delta;
        for (const value of [delta?.text, delta?.thinking, delta?.partial_json]) {
          if (typeof value === "string") step.receivedChars += value.length;
        }
        return;
      }
      case "message_delta":
        if (typeof event.delta?.stop_reason === "string") step.stopReason = event.delta.stop_reason;
        if (typeof event.usage?.output_tokens === "number") step.outputTokens = event.usage.output_tokens;
        return;
      case "message_stop":
        step.endedAt = this.now();
        return;
      default:
        return;
    }
  }

  /** A whole tool call arrived: name the Line it concerns, when it names one. */
  onToolCall(toolName: string, input: unknown): void {
    if (!this.current || !CHAT_TOOL_NAMES.has(toolName)) return;
    this.toolNames.add(toolName);
    if (LIST_TOOLS.has(toolName)) this.listCalls.push({ toolName, input });
    const section = toolCallSection(input);
    this.progress({ phase: "tool", tool: toolName, ...(section ? { section } : {}), step: this.current.step });
  }

  /** Review P3-4: each finished step's numbers, by its usage object. */
  private readonly byUsage = new WeakMap<object, ChatStepMetrics>();

  finishStep(usage?: object): ChatStepMetrics | undefined {
    if (this.current) {
      this.current.stepFinished = true;
      if (usage) this.byUsage.set(usage, this.current);
    }
    return this.current;
  }

  /** The numbers of the finished step a usage object belongs to. */
  metricsFor(usage: object): ChatStepMetrics | undefined {
    return this.byUsage.get(usage);
  }
}

/** The numbers a usage row carries for one measured step. */
function stepUsageFields(metrics: ChatStepMetrics | undefined, now: number) {
  if (!metrics) return {};
  return {
    durationMs: Math.max(0, (metrics.endedAt ?? now) - metrics.startedAt),
    effort: metrics.effort,
    ...(metrics.firstTokenAt !== undefined ? { firstTokenMs: Math.max(0, metrics.firstTokenAt - metrics.startedAt) } : {}),
    ...(metrics.stopReason ? { stopReason: metrics.stopReason } : {}),
  };
}

/**
 * The chat usage row for one model step. `served` says where the step's
 * request went (decision 64): a step answered through OpenRouter records
 * the transport, the provider OpenRouter reports and OpenRouter's exact
 * charge when its usage carries one (the AI SDK passes Anthropic's raw
 * usage through, unknown fields included), otherwise the price-table
 * estimate. `metrics` (Phase A) adds the step's duration, stop reason,
 * effort and time to first token.
 */
async function logChatUsage(
  ctx: Pick<ActionCtx, "runMutation">,
  served: Readonly<ChatServedState>,
  { threadId, userId, model, usage, providerMetadata }: Parameters<UsageHandler>[1],
  metrics: ChatStepMetrics | undefined
): Promise<void> {
  const cacheCreationInputTokens =
    usage.inputTokenDetails.cacheWriteTokens ?? 0;
  // The AI SDK passes Anthropic's raw usage through; its cache_creation
  // breakdown says how much of the write used the 1-hour TTL (2x input).
  const cacheCreation1hInputTokens = Math.min(
    anthropicCacheWrite1hTokens(providerMetadata?.anthropic?.usage) ?? 0,
    cacheCreationInputTokens
  );
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
  const viaOpenRouter = served.transport === "openrouter";
  const charge = viaOpenRouter ? openRouterAnthropicCharge({ usage: providerMetadata?.anthropic?.usage }) : {};
  try {
    await ctx.runMutation(internal.aiUsage.queueUsage, {
      ...(threadId ? { agentThreadId: threadId } : {}),
      ...(userId ? { userId } : {}),
      callSite: "chat_v2",
      model,
      inputTokens,
      outputTokens: usage.outputTokens ?? 0,
      // Always recorded, zero included, so a row with no cache activity
      // is distinguishable from a row written before caching was tracked.
      cacheCreationInputTokens,
      cacheReadInputTokens,
      ...(cacheCreation1hInputTokens
        ? { cacheCreation1hInputTokens }
        : {}),
      ...(viaOpenRouter ? { transport: "openrouter" as const } : {}),
      ...(charge.costUsd !== undefined ? { costUsd: charge.costUsd } : {}),
      ...(viaOpenRouter && served.servedProvider ? { servedProvider: served.servedProvider } : {}),
      ...stepUsageFields(metrics, Date.now()),
      createdAt: Date.now(),
    });
  } catch (error) {
    console.error("chat usage could not be queued", safeErrorDetails(error));
  }
}

function tokenNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Phase A: a request stopped part way (Stop or the time limit) never reaches
 * the AI SDK's step end, so neither the agent nor the app logged it, although
 * Anthropic bills it. One row, marked partial with stop reason "aborted": its
 * input as `message_start` reported it, its output the larger of the last
 * reported count and an estimate from the characters received (as
 * convex/ai/instrument.ts estimates a stopped call). A request stopped before
 * `message_start` has no usage to record.
 */
async function logStoppedRequestUsage(
  ctx: Pick<ActionCtx, "runMutation">,
  served: Readonly<ChatServedState>,
  args: { threadId: string; userId?: string; model: string },
  metrics: ChatStepMetrics
): Promise<boolean> {
  const start = metrics.startUsage;
  if (!start || metrics.stepFinished || metrics.partialLogged) return false;
  metrics.partialLogged = true;
  const cacheCreationInputTokens = tokenNumber(start.cache_creation_input_tokens);
  const cacheCreation1hInputTokens = Math.min(
    anthropicCacheWrite1hTokens(start) ?? 0,
    cacheCreationInputTokens
  );
  const outputTokens = Math.max(
    tokenNumber(metrics.outputTokens ?? start.output_tokens),
    Math.ceil(metrics.receivedChars / 3)
  );
  try {
    await ctx.runMutation(internal.aiUsage.queueUsage, {
      agentThreadId: args.threadId,
      ...(args.userId ? { userId: args.userId } : {}),
      callSite: "chat_v2",
      model: args.model,
      inputTokens: tokenNumber(start.input_tokens),
      outputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens: tokenNumber(start.cache_read_input_tokens),
      ...(cacheCreation1hInputTokens ? { cacheCreation1hInputTokens } : {}),
      ...(served.transport === "openrouter" ? { transport: "openrouter" as const } : {}),
      ...(served.transport === "openrouter" && served.servedProvider ? { servedProvider: served.servedProvider } : {}),
      ...stepUsageFields(metrics, Date.now()),
      stopReason: "aborted",
      partial: true,
      createdAt: Date.now(),
    });
  } catch (error) {
    console.error("chat usage could not be queued", safeErrorDetails(error));
  }
  return true;
}

function chatUsageHandler(
  served: Readonly<ChatServedState>,
  meter?: ChatTurnMeter
): UsageHandler {
  // Review P3-4: a step the app saw finish is matched by its usage object
  // (the agent logs `step.usage` itself). The agent logs a normal step from
  // inside its step end, before the app's own step end and before the next
  // request, so the meter's current step is that step.
  return async (ctx, payload) =>
    await logChatUsage(ctx, served, payload, meter?.metricsFor(payload.usage) ?? meter?.current);
}

/**
 * The chat model for one turn, its usage handler and where its requests
 * went. With an OpenRouter key and a model OpenRouter lists, the model's
 * HTTP transport carries the billing fallback (decision 64). Otherwise it
 * is exactly the provider chat always used. `meter` adds each step's
 * measurements to its usage row.
 */
export function chatTurnModel(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation">,
  modelId: string,
  meter?: ChatTurnMeter
): { model: ReturnType<typeof anthropic>; usageHandler: UsageHandler; served: Readonly<ChatServedState> } {
  const served: ChatServedState = { transport: "direct" };
  const authToken = openRouterCreditFallbackKey();
  if (!authToken || !openRouterAnthropicRequestId(modelId)) {
    return { model: anthropic(modelId), usageHandler: chatUsageHandler(served, meter), served };
  }
  const provider = createAnthropic({ fetch: creditFallbackFetch(ctx, authToken, served) });
  return { model: provider(modelId), usageHandler: chatUsageHandler(served, meter), served };
}

/**
 * Phase A: how often a running reply checks for Stop. The agent notices Stop
 * only when it writes its next stream delta, and a step that thinks writes
 * none for minutes, so the action polls the turn and aborts the request.
 */
export const CHAT_STOP_POLL_MS = 2_000;

/**
 * Polls `isActive` every `intervalMs` (one check at a time) and calls
 * `onStop` once when it answers false. A failed check is logged and tried
 * again at the next tick. Returns the function that ends the watch.
 */
export function watchForStop(options: {
  intervalMs: number;
  isActive: () => Promise<boolean>;
  onStop: () => void;
}): () => void {
  let ended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (!ended) timer = setTimeout(tick, options.intervalMs);
  };
  const tick = async () => {
    timer = undefined;
    if (ended) return;
    let active = true;
    try {
      active = await options.isActive();
    } catch (error) {
      console.error("chat stop check failed", safeErrorDetails(error));
    }
    if (ended) return;
    if (!active) {
      ended = true;
      options.onStop();
      return;
    }
    schedule();
  };
  schedule();
  return () => {
    ended = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
}

/**
 * The stored Deviation Inventory's items, by Line, for the Continue offer:
 * the rule Deviations the report's notes record now. Empty when the report
 * or the notes cannot be read.
 */
async function outstandingDeviations(
  ctx: ChatToolCtx,
  listCalls: ReadonlyArray<{ toolName: string; input: unknown }>
): Promise<Array<{ section: ChatSection; itemId: string }>> {
  try {
    // Review P3-1: every item kind the turn's own list calls produced (rule,
    // content and reference), rebuilt from their inputs; the stored rule
    // Deviations when the turn made no list call.
    const calls = listCalls.length > 0 ? listCalls : [{ toolName: "deviationInventory", input: {} }];
    const items = new Map<string, ChatSection>();
    const seen = new Set<string>();
    for (const call of calls) {
      const key = JSON.stringify([call.toolName, call.input]);
      if (seen.has(key)) continue;
      seen.add(key);
      const input = (call.input && typeof call.input === "object" ? call.input : {}) as Record<string, unknown>;
      const content = contentDeviationsSchema.safeParse(input.contentDeviations);
      const contentDeviations = content.success ? content.data : undefined;
      const compare = call.toolName === "compareReferencePd";
      const fileName = compare && typeof input.fileName === "string" ? input.fileName : undefined;
      const context = await inventoryContext(ctx, fileName);
      if (!context.found) continue;
      if (listCalls.length === 0 && !context.rulesAvailable) continue;
      const referenceSections =
        compare && context.referenceStatus === "resolved" && context.reference ? context.reference.sections : null;
      try {
        const inventory = assembleDeviationInventory({
          sections: context.sections,
          notes: context.notes,
          ...(contentDeviations ? { contentDeviations } : {}),
          ...(referenceSections ? { referenceSections } : {}),
          rulesStatus: context.rulesStatus,
        });
        for (const item of inventory.items) items.set(item.id, item.section);
      } catch (error) {
        if (!(error instanceof InventoryAnchorError)) throw error;
      }
    }
    return [...items].map(([itemId, section]) => ({ section, itemId }));
  } catch (error) {
    console.error("chat continuation inventory failed", safeErrorDetails(error));
    return [];
  }
}

/** The read-only and bulk tools of a deviation list request. */
const DEVIATION_TOOLS: ReadonlySet<string> = new Set(["deviationInventory", "compareReferencePd", "proposeBulkEdits"]);

/** Which turn failures offer Continue (each tells the writer to continue or go smaller). */
const CUT_OFF_FAILURES: ReadonlySet<string> = new Set([
  "CHAT_CUT_OFF_TOOL_CALL",
  "CHAT_THINKING_CUT_OFF",
  "CHAT_THINKING_CUT_OFF_PARTIAL",
  "CHAT_REPLY_CUT_OFF",
]);

export function continuationReasonForFailure(error: unknown): ChatTurnContinuationReason | null {
  return error instanceof Error && CUT_OFF_FAILURES.has(error.message) ? "cut_off" : null;
}

/**
 * Stream the assistant's reply to a saved writer message. Scheduled by
 * chatV2.sendMessage; deltas persist via the component and reach the client
 * through chatV2.listMessages + useUIMessages.
 */
/**
 * Time the chat stream may still run: what is left of the action's request
 * window (actionDeadline.ts) after the context loading, at least 1 ms.
 */
export function chatStreamTimeoutMs(startedAt: number, now: number): number {
  return Math.max(1, startedAt + ACTION_REQUEST_WINDOW_MS - now);
}

/**
 * The thread's owner, as the agent library resolves the user it passes to the
 * usage handler. Read only when the app logs a step's usage itself.
 */
async function threadUserId(ctx: ActionCtx, threadId: string): Promise<string | undefined> {
  try {
    const thread = await ctx.runQuery(components.agent.threads.getThread, { threadId });
    return thread?.userId ?? undefined;
  } catch (error) {
    console.error("chat thread owner lookup failed", safeErrorDetails(error));
    return undefined;
  }
}

async function threadUserIdField(ctx: ActionCtx, threadId: string): Promise<{ userId?: string }> {
  const userId = await threadUserId(ctx, threadId);
  return userId ? { userId } : {};
}

/** The assistant message a failed turn leaves in the thread. */
export function chatFailureReply(error: unknown): string {
  switch (error instanceof Error ? error.message : "") {
    case "CHAT_PROFILE_UNAVAILABLE":
      return "I couldn't load your saved writing settings, so I haven't proposed changes. Please retry. You don't need to rewrite your instructions.";
    case "CHAT_TIMED_OUT":
      return "That response took too long, so I stopped it before it finished. Try again.";
    case "CHAT_CUT_OFF_TOOL_CALL":
      return CHAT_CUT_OFF_REPLY;
    case "CHAT_THINKING_CUT_OFF":
      return CHAT_THINKING_CUT_OFF_REPLY;
    case "CHAT_THINKING_CUT_OFF_PARTIAL":
      return CHAT_THINKING_CUT_OFF_PARTIAL_REPLY;
    case "CHAT_REPLY_CUT_OFF":
      return CHAT_REPLY_CUT_OFF_REPLY;
    default:
      return "I couldn’t finish that response. Try again.";
  }
}

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
    // 2026-10-19: web search for this message, authorized the same way.
    allowWeb: v.optional(v.boolean()),
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

    const turnKey = { agentThreadId: args.agentThreadId, promptMessageId: args.promptMessageId };
    const toolCallIds = new Set<string>();
    // 2026-10-01 (first): whether the turn's last step was cut off at the
    // output limit while it was writing a tool call. `sawToolInput` covers a
    // call whose block never closed, so the step recorded no call at all.
    let sawToolInput = false;
    let lastStepCutToolCall = false;
    // 2026-10-19: whether the last step thought to the output limit and wrote
    // no tool call and no text (`thinkingOnlyCutOff`).
    let lastStepThinkingOnly = false;
    const finishedSteps: CutOffStep[] = [];
    // Review P2-1: a step the agent held back, logged once a later step
    // finishes (see stepHeldBackByAgent), with the measurements it finished
    // with.
    let heldBackStep: UsageStep | undefined;
    let heldBackMetrics: ChatStepMetrics | undefined;
    // After a held-back step the agent no longer sees a Stop (review P3).
    let agentStreamBlind = false;
    // Where the turn's latest model request went, for the failure log.
    let served: Readonly<ChatServedState> | undefined;

    // Phase A (2026-10-19): the turn's phases for the writer, each step's
    // measurements for its usage row, and a Stop that works while the model
    // thinks. The model request is aborted through `turnAbort`, chained by
    // hand to the time limit (`AbortSignal.any` is not in every runtime).
    const progress = new TurnProgressWriter((next) =>
      ctx.runMutation(internal.chatV2.markTurnProgress, { ...turnKey, progress: next })
    );
    const meter = new ChatTurnMeter((update) => progress.set(update));
    const turnAbort = new AbortController();
    let stoppedByWriter = false;
    let endStopWatch: (() => void) | undefined;
    let timeoutSignal: AbortSignal | undefined;
    const onTimeout = () => {
      if (!turnAbort.signal.aborted) turnAbort.abort(timeoutSignal?.reason);
    };

    /**
     * The structured Continue offer, set while the turn still runs. The
     * stored inventory is read only when the turn worked on a deviation list.
     */
    const offerContinuation = async (reason: ChatTurnContinuationReason) => {
      try {
        const workedOnList = [...meter.toolNames].some((name) => DEVIATION_TOOLS.has(name));
        const outstanding = workedOnList
          ? await outstandingDeviations(
              { threadId: args.agentThreadId, runQuery: ctx.runQuery, runMutation: ctx.runMutation },
              meter.listCalls
            )
          : [];
        await ctx.runMutation(internal.chatV2.setTurnContinuation, { ...turnKey, reason, outstanding });
      } catch (error) {
        console.error("chat continuation could not be saved", safeErrorDetails(error));
      }
    };

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
      // evidence travels in ephemeral user-role messages, delimited,
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
      const stillActive: boolean = await ctx.runQuery(internal.chatV2.isTurnActive, turnKey);
      if (!stillActive) return;
      // Phase A: from here on, Stop is checked every CHAT_STOP_POLL_MS.
      endStopWatch = watchForStop({
        intervalMs: CHAT_STOP_POLL_MS,
        isActive: () => ctx.runQuery(internal.chatV2.isTurnActive, turnKey),
        onStop: () => {
          stoppedByWriter = true;
          if (!turnAbort.signal.aborted) turnAbort.abort("Writer pressed stop");
        },
      });
      const history = await chatContextWindow(ctx, args);
      const contextOptions = history.options;
      // Phase A: the browser draws its divider from this, and the model is
      // told that older turns are out of its view (in the per-turn note after
      // the evidence tail, never in the cached head).
      if (history.historyStartOrder !== undefined) {
        await ctx.runMutation(internal.chatV2.setTurnHistoryStart, {
          ...turnKey,
          historyStartOrder: history.historyStartOrder,
        });
      }
      // Review P2-2: the replies no longer carry item ids and statuses (the
      // card shows them) and the history leaves tool rows out, so the model
      // is told how many Deviations each Line already had handled.
      const coverage = await threadCoverage({
        threadId: args.agentThreadId,
        runQuery: ctx.runQuery,
        runMutation: ctx.runMutation,
      });
      const turnMessages: ModelMessage[] = [
        ...turn.messages,
        {
          role: "user",
          content: chatTurnNote({
            allowBrain: args.allowBrain === true,
            allowWeb: args.allowWeb === true,
            historyCut: history.historyStartOrder !== undefined,
            handled: handledItemsNote([...coverage.values()]),
          }),
        },
      ];
      // Model catalog: the chat role's current model (direct Anthropic only;
      // the role never resolves to another gateway). A turn keeps the model
      // it started with; the next turn picks up a switch.
      const { entry: chatModel } = await ctx.runQuery(roleModelEntryRef, { role: "chat" });
      // Ends the reply inside the Convex action limit, so a stalled stream
      // fails its turn here instead of waiting for the reaper.
      timeoutSignal = AbortSignal.timeout(chatStreamTimeoutMs(startedAt, Date.now()));
      if (timeoutSignal.aborted) onTimeout();
      else timeoutSignal.addEventListener("abort", onTimeout, { once: true });
      const abortSignal = turnAbort.signal;
      const turnModel = chatTurnModel(ctx, chatModel.gateway === "anthropic" ? chatModel.id : MODEL, meter);
      served = turnModel.served;

      // One model pass over this turn. The turn makes a second pass only to
      // recover a step that thought to the output limit (2026-10-19), so the
      // per-pass state below starts fresh each time; `toolCallIds` counts the
      // whole turn.
      // Created once, so the recovery pass shares the turn's search count.
      // Phase A: created for every turn; its tool searches only when the
      // authenticated send turned web search on.
      const webSearch = newWebSearchTurn({
        allowed: args.allowWeb === true,
        ...(args.userId ? { userId: args.userId } : {}),
        deadline: startedAt + ACTION_REQUEST_WINDOW_MS,
      });

      const runPass = async (pass: {
        messages: ModelMessage[];
        providerOptions: typeof CHAT_PROVIDER_OPTIONS;
        listStepProviderOptions: typeof CHAT_LIST_STEP_PROVIDER_OPTIONS | undefined;
        /** The effort the pass's steps are sent with, for the usage rows. */
        effort: string;
        contextOptions?: ContextOptions;
      }) => {
        sawToolInput = false;
        lastStepCutToolCall = false;
        lastStepThinkingOnly = false;
        finishedSteps.length = 0;
        heldBackStep = undefined;
        heldBackMetrics = undefined;
        agentStreamBlind = false;
        let passAborted = false;
        // Review P2-1: the agent links its own abort to ours with a listener,
        // which never fires for a signal already aborted, so a Stop caught
        // before this pass starts must end it here.
        if (turnAbort.signal.aborted) throw new Error(stoppedByWriter ? "CHAT_STOPPED" : "CHAT_TIMED_OUT");
        try {
          const result = await reportChatAgent.streamText(
            ctx,
            { threadId: args.agentThreadId },
            {
              promptMessageId: args.promptMessageId,
              model: turnModel.model,
              system: turn.system,
              // Ephemeral: with `promptMessageId` set the agent library saves no
              // input messages, so the evidence never enters thread history.
              // The context handler below places them around the history.
              messages: pass.messages,
              tools: buildChatTools(styleOverrides.bannedWords, args.allowBrain === true, webSearch),
              providerOptions: pass.providerOptions,
              maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
              abortSignal,
              // Phase A: the provider's raw stream events reach `onChunk` only
              // (the browser stream drops them), for the step's measurements
              // and progress phases.
              includeRawChunks: true,
              onAbort: () => {
                passAborted = true;
              },
              // Must run upstream of the agent's smoothStream; see the module
              // comment. Without it, multi-step tool turns lose the thinking
              // signature and the model's reasoning is dropped between steps.
              experimental_transform: preserveReasoningSignature<typeof CHAT_TOOLS>(),
              // 2026-10-01 (first): a call cut off at the output limit gets its
              // tool's fixed instruction instead of its parse error, and a second
              // cut-off ends the turn. A turn that is never cut off sends exactly
              // the requests it sent before (the same messages array).
              stopWhen: [stepCountIs(CHAT_MAX_STEPS), stopAfterSecondCutOff],
              prepareStep: async ({ steps, messages }) => {
                // PR #24 review P3: once the agent stopped streaming, check the
                // writer did not press Stop before paying for another step.
                if (agentStreamBlind) {
                  const active: boolean = await ctx.runQuery(internal.chatV2.isTurnActive, turnKey);
                  if (!active) throw new Error("CHAT_STOPPED_AFTER_CUT_OFF");
                }
                // Review P2-1: runs after the agent attached its listener, so a
                // Stop or time limit that fell between the pass start and the
                // agent's stream setup still ends the pass before any request.
                if (turnAbort.signal.aborted) {
                  throw new Error(stoppedByWriter ? "CHAT_STOPPED" : "CHAT_TIMED_OUT");
                }
                const next = withCutOffInstruction(messages, steps);
                // 2026-10-19: a step that plans over a list result thinks at
                // medium effort.
                const listStep =
                  pass.listStepProviderOptions !== undefined && followsListResult(steps);
                meter.beginStep(listStep ? CHAT_LIST_STEP_EFFORT : pass.effort);
                if (next === messages && !listStep) return undefined;
                return {
                  ...(next === messages ? {} : { messages: next }),
                  ...(listStep ? { providerOptions: pass.listStepProviderOptions } : {}),
                };
              },
              onChunk: ({ chunk }) => {
                if (chunk.type === "raw") {
                  meter.onRaw(chunk.rawValue);
                  return;
                }
                if (chunk.type === "tool-input-start") sawToolInput = true;
                if (chunk.type === "tool-call") meter.onToolCall(chunk.toolName, chunk.input);
              },
              onStepFinish: async (step) => {
                const metrics = meter.finishStep(step.usage);
                for (const toolCall of step.toolCalls) {
                  if (toolCall) toolCallIds.add(toolCall.toolCallId);
                }
                finishedSteps.push(step);
                lastStepCutToolCall =
                  step.finishReason === "length" &&
                  (sawToolInput || step.toolCalls.length > 0);
                lastStepThinkingOnly = thinkingOnlyCutOff(step, sawToolInput);
                sawToolInput = false;
                // Phase A: numbers only, never text.
                if (metrics) {
                  console.info("chat step timing", {
                    threadId: args.agentThreadId,
                    step: metrics.step,
                    durationMs: Math.max(0, (metrics.endedAt ?? Date.now()) - metrics.startedAt),
                    firstTokenMs:
                      metrics.firstTokenAt === undefined ? null : Math.max(0, metrics.firstTokenAt - metrics.startedAt),
                    inputTokens: step.usage.inputTokens ?? null,
                    outputTokens: step.usage.outputTokens ?? null,
                    reasoningTokens: step.usage.outputTokenDetails?.reasoningTokens ?? null,
                  });
                }
                // Sizes only, never report text: to tune the per-call bound.
                for (const call of cutOffToolCalls(step)) {
                  console.warn("chat tool call cut off at the output limit", {
                    threadId: args.agentThreadId,
                    toolName: call.toolName,
                    inputChars:
                      typeof call.input === "string"
                        ? call.input.length
                        : JSON.stringify(call.input ?? null).length,
                    outputTokens: step.usage.outputTokens ?? null,
                  });
                }
                if (lastStepThinkingOnly) {
                  console.warn("chat step thought to the output limit", {
                    threadId: args.agentThreadId,
                    stepNumber: finishedSteps.length,
                    outputTokens: step.usage.outputTokens ?? null,
                  });
                }
                // Review P2-1: a later step finished, so the agent replaced the
                // step it held back and will never log that step's usage.
                const replaced = heldBackStep;
                const replacedMetrics = heldBackMetrics;
                heldBackStep = undefined;
                heldBackMetrics = undefined;
                if (replaced) {
                  await logChatUsage(
                    ctx,
                    turnModel.served,
                    {
                      userId: await threadUserId(ctx, args.agentThreadId),
                      threadId: args.agentThreadId,
                      agentName: "report-editor",
                      model: turnModel.model.modelId,
                      provider: turnModel.model.provider,
                      usage: replaced.usage,
                      providerMetadata: replaced.providerMetadata,
                    },
                    replacedMetrics
                  );
                }
                if (stepHeldBackByAgent(step, finishedSteps)) {
                  heldBackStep = step;
                  heldBackMetrics = metrics;
                  agentStreamBlind = true;
                }
              },
            },
            {
              saveStreamDeltas: true,
              contextOptions: pass.contextOptions ?? contextOptions,
              usageHandler: turnModel.usageHandler,
              // Evidence head before the history, per-turn tail after the
              // prompt: see arrangeChatContext for the cache layout.
              contextHandler: async (_ctx, parts) =>
                arrangeChatContext(turn.headCount, parts),
            }
          );
          await result.consumeStream();
          return await result.finishReason;
        } finally {
          // Phase A: a request stopped part way (Stop, the time limit, or the
          // agent's own stream abort) is still billed; log it once.
          const current = meter.current;
          if (
            (passAborted || abortSignal.aborted) &&
            current?.startUsage &&
            !current.stepFinished &&
            !current.partialLogged
          ) {
            await logStoppedRequestUsage(
              ctx,
              turnModel.served,
              {
                threadId: args.agentThreadId,
                model: turnModel.model.modelId,
                ...(await threadUserIdField(ctx, args.agentThreadId)),
              },
              current
            );
          }
        }
      };

      let finishReason = await runPass({
        messages: turnMessages,
        providerOptions: CHAT_PROVIDER_OPTIONS,
        listStepProviderOptions: CHAT_LIST_STEP_PROVIDER_OPTIONS,
        effort: "default",
      });
      // A timer that fires after a tool step leaves the last step's finish
      // reason in place, so the reply would read as complete (review r2 P3).
      if (abortSignal.aborted) throw new Error(stoppedByWriter ? "CHAT_STOPPED" : "CHAT_TIMED_OUT");
      // 2026-10-19: the last step thought to the output limit and wrote
      // nothing. One recovery pass, at low effort and told to do the first
      // part only, when this turn saved no edit yet (the pass would not see
      // it: tool rows stay out of the history), enough of the window is left,
      // and the writer has not pressed Stop.
      if (finishReason === "length" && lastStepThinkingOnly) {
        // Review P3-4: any card, a record-only revision or a highlight too.
        const savedCard: boolean = await ctx.runQuery(internal.chatV2.turnSavedAnyProposal, turnKey);
        if (savedCard) throw new Error("CHAT_THINKING_CUT_OFF_PARTIAL");
        const timeLeft = startedAt + ACTION_REQUEST_WINDOW_MS - Date.now();
        const active: boolean =
          timeLeft >= CHAT_RECOVERY_MIN_REMAINING_MS &&
          (await ctx.runQuery(internal.chatV2.isTurnActive, turnKey));
        if (!active) throw new Error("CHAT_THINKING_CUT_OFF");
        console.info("chat recovery pass after a step thought to the limit", {
          threadId: args.agentThreadId,
          timeLeftMs: timeLeft,
        });
        progress.set({ phase: "retrying", step: meter.step });
        finishReason = await runPass({
          messages: [
            ...turnMessages,
            { role: "user", content: CHAT_THINKING_RECOVERY_INSTRUCTION },
          ],
          providerOptions: CHAT_RECOVERY_PROVIDER_OPTIONS,
          listStepProviderOptions: undefined,
          effort: CHAT_RECOVERY_PROVIDER_OPTIONS.anthropic.effort,
          // Review P3-3: the first pass stored one thinking-only row on the
          // prompt's order. It fills a history slot before
          // `withoutThinkingOnlyReplies` drops it, so the window gets one
          // more row and keeps its oldest one.
          contextOptions: {
            ...contextOptions,
            recentMessages:
              (contextOptions.recentMessages ?? CHAT_CONTEXT_OPTIONS.recentMessages) + 1,
          },
        });
        if (abortSignal.aborted) throw new Error(stoppedByWriter ? "CHAT_STOPPED" : "CHAT_TIMED_OUT");
      }
      // A turn whose last step was cut off while writing a tool call could
      // not go on (the second cut-off, or the step limit): say what to do.
      if (finishReason === "length" && lastStepCutToolCall) {
        throw new Error("CHAT_CUT_OFF_TOOL_CALL");
      }
      if (finishReason === "length" && lastStepThinkingOnly) {
        const savedCard: boolean = await ctx.runQuery(internal.chatV2.turnSavedAnyProposal, turnKey);
        throw new Error(savedCard ? "CHAT_THINKING_CUT_OFF_PARTIAL" : "CHAT_THINKING_CUT_OFF");
      }
      if (finishReason === "length") throw new Error("CHAT_REPLY_CUT_OFF");
      if (finishReason === "content-filter") {
        throw new Error("CHAT_INCOMPLETE_RESPONSE");
      }
      // Review P2-2: the step limit ended the turn on a tool call, so the
      // model never wrote its closing text.
      const endedOnStepLimit =
        finishReason === "tool-calls" && finishedSteps.length >= CHAT_MAX_STEPS;
      // Phase A: the Continue offer, while the turn still runs. A reply that
      // finished its Line offers the next one only when it saved a
      // Completion Report (setTurnContinuation checks).
      if (endedOnStepLimit) await offerContinuation("step_limit");
      else if ([...meter.toolNames].some((name) => DEVIATION_TOOLS.has(name))) {
        await offerContinuation("lines_left");
      }
      endStopWatch?.();
      await progress.flush();
      const finished: {
        status: "queued" | "running" | "completed" | "failed" | "aborted";
      } = await ctx.runMutation(internal.chatV2.finishTurn, {
        ...turnKey,
        requestedStatus: "completed",
        endedAt: Date.now(),
        stepCount: toolCallIds.size,
      });
      // Say what is left.
      if (endedOnStepLimit && finished.status === "completed") {
        // PR #24 round 2: only a saved proposal means there are cards to
        // review; a failed edit call saves nothing.
        const savedEdit: boolean = await ctx.runQuery(internal.chatV2.turnSavedEditProposal, turnKey);
        await saveMessage(ctx, components.agent, {
          threadId: args.agentThreadId,
          agentName: "report-editor",
          promptMessageId: args.promptMessageId,
          message: {
            role: "assistant",
            content: savedEdit ? CHAT_STEP_LIMIT_REPLY : CHAT_STEP_LIMIT_REPLY_OTHER,
          },
        });
      }
    } catch (caught) {
      // Review P3-5: no later check may turn a real failure into a Stop. The
      // turn's own finishTurn("failed") makes it inactive, which a late tick
      // would read as the writer's Stop.
      endStopWatch?.();
      const stopped = stoppedByWriter;
      // The time limit can surface as the SDK's own abort error when it fell
      // in the first step; the writer still reads "took too long".
      const error =
        !stopped &&
        turnAbort.signal.aborted &&
        !(caught instanceof Error && caught.message.startsWith("CHAT_"))
          ? new Error("CHAT_TIMED_OUT")
          : caught;
      // Phase A: a reply cut off offers Continue; a stopped one offers nothing.
      const continuation = stopped ? null : continuationReasonForFailure(error);
      if (continuation) await offerContinuation(continuation);
      await progress.flush();
      const finish: {
        status: "queued" | "running" | "completed" | "failed" | "aborted";
      } = await ctx.runMutation(internal.chatV2.finishTurn, {
        ...turnKey,
        requestedStatus: "failed",
        endedAt: Date.now(),
        stepCount: toolCallIds.size,
      });
      // A Stop is the writer's choice, not a failure: no error log and no
      // failure message.
      if (stopped || finish.status === "aborted") {
        console.info("chat turn stopped by the writer", {
          threadId: args.agentThreadId,
          step: meter.step,
        });
        return;
      }
      console.error("report chat response failed", {
        threadId: args.agentThreadId,
        // Decision 64: a turn the billing fallback sent to OpenRouter says so.
        ...(served?.transport === "openrouter" ? { transport: "openrouter" as const } : {}),
        ...safeErrorDetails(error),
      });
      if (finish.status !== "failed") return;

      await saveMessage(ctx, components.agent, {
        threadId: args.agentThreadId,
        agentName: "report-editor",
        // Shares the prompt's order so the failed turn's trace attaches to it.
        promptMessageId: args.promptMessageId,
        message: { role: "assistant", content: chatFailureReply(error) },
      });
    } finally {
      endStopWatch?.();
      timeoutSignal?.removeEventListener("abort", onTimeout);
      await progress.flush();
    }
  },
});
