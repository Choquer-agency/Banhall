import { internalAction } from "../_generated/server";
import { components, internal } from "../_generated/api";
import { v } from "convex/values";
import { MAX_INSTRUCTIONS_CHARS } from "../../shared/writerProfileLimits";
import { z } from "zod";
import {
  Agent,
  createTool,
  stepCountIs,
  saveMessage,
  type ToolCtx,
} from "@convex-dev/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { MODEL } from "./model";
import { buildChatSystemPromptV2 } from "./prompts";
import {
  NO_STYLE_OVERRIDES,
  hasAnyStyleOverride,
  normalizeStyleOverrides,
  type StyleOverrides,
} from "../../shared/styleOverrides";
import {
  scrubBannedWordsUnlessWaived,
  extractPlainText,
} from "../lib/reportEdits";
import { preserveReasoningSignature } from "./reasoningSignature";
import { searchBrainExemplars, formatBrainExemplars } from "./brain/retrieve";

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
      console.error("searchBrain tool failed", err);
      return "The Brain search hit a technical error just now — this is an infrastructure issue, not missing knowledge. Tell the writer to try again shortly.";
    }
  },
});

/**
 * Reasoning is on by default so the assistant analyses a request as carefully
 * here as the same model would on claude.ai — a writer shouldn't get shallower
 * answers because they asked inside Banhall.
 *
 * `adaptive` (Sonnet 4.6/Opus 4.6+) lets the model scale its own thinking to
 * the task instead of us paying a fixed budget on every "tighten this
 * sentence". `display: "summarized"` is required for the thinking text to come
 * back at all — without it the blocks arrive empty and the trace's reasoning
 * disclosure would render nothing.
 */
const CHAT_THINKING = {
  thinking: { type: "adaptive" as const, display: "summarized" as const },
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

const buildChatTools = (bannedWordsWaived: boolean) => ({
  proposeEdit: makeProposeEdit(bannedWordsWaived),
  proposeReplacements: makeProposeReplacements(bannedWordsWaived),
  highlightPassages,
  searchBrain,
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
      console.error("chat usage could not be queued", error);
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
      // The sender's profile loads in parallel with the grounding context so
      // the waiver lookup adds no serial round-trip to time-to-first-token.
      const contextPromise: Promise<{
        reportContent: string | null;
        agentOutputs: string | null;
        documents: { fileName: string; content: string }[];
        decisions: {
          state: "pending" | "applied" | "rejected" | "stale";
          target: string;
          candidate: string;
        }[];
      }> = ctx.runQuery(internal.chatV2.getChatContextV2, {
        reportId: args.reportId,
        agentThreadId: args.agentThreadId,
      });
      // PSOS-49/50: the sender's EFFECTIVE house-style waivers + preferences
      // (org-wide modes apply even for legacy turns with no userId). Never
      // blocks the reply; a failed lookup means default enforcement.
      const profilePromise: Promise<{
        customInstructions: string | null;
        styleOverrides: StyleOverrides;
      } | null> = ctx
        .runQuery(
          internal.writerProfiles.getProfileForGeneration,
          args.userId ? { userId: args.userId } : {}
        )
        .catch((err: unknown) => {
          console.error("writer profile fetch failed for chat turn", err);
          return null;
        });
      const [context, writerStyle] = await Promise.all([
        contextPromise,
        profilePromise,
      ]);
      const styleOverrides = writerStyle
        ? normalizeStyleOverrides(writerStyle.styleOverrides)
        : NO_STYLE_OVERRIDES;

      const reportText = context.reportContent
        ? extractPlainText(context.reportContent)
        : "(no report content available)";

      let analysisText = "(no transcript analysis available)";
      if (context.agentOutputs) {
        try {
          const parsed = JSON.parse(context.agentOutputs);
          if (parsed.analyzer) {
            analysisText = JSON.stringify(parsed.analyzer, null, 2);
          }
        } catch {
          /* ignore */
        }
      }

      const docsText = context.documents.length
        ? context.documents
            .map(
              (d) =>
                `--- Document: ${d.fileName} ---\n${d.content.slice(0, 20000)}`
            )
            .join("\n\n")
        : "(no documents uploaded)";

      const editDecisions = context.decisions
        .map(
          (d, i) =>
            `[Edit ${i + 1} — ${d.state.toUpperCase()}]\nCanonical target from report: ${d.target}\nCandidate replacement (context only — never use as target unless it is present in CURRENT REPORT): ${d.candidate}`
        )
        .join("\n\n");

      // The waiver footer in the system prompt points at the writer's own
      // preferences — inject them so the reference is never dangling. Bounded
      // like the context documents.
      const writerPreferencesBlock =
        hasAnyStyleOverride(styleOverrides) && writerStyle?.customInstructions
          ? `\n\n# WRITER'S PERSONAL STYLE PREFERENCES (authoritative for the waived house-style areas named in your instructions)\n${writerStyle.customInstructions.slice(0, MAX_INSTRUCTIONS_CHARS)}`
          : "";

      const grounding = `# CURRENT REPORT (the only document you may edit)\n${reportText}\n\n# TRANSCRIPT ANALYSIS (source of truth — do not exceed it)\n${analysisText}\n\n# UPLOADED CONTEXT DOCUMENTS\n${docsText}${writerPreferencesBlock}${
        editDecisions
          ? `\n\n# PRIOR EDIT DECISIONS (the exact text you proposed and whether the writer accepted/rejected it — your memory for iterating. If they liked a rejected version and want a small change, reuse it with only that change. Context only — never repeat this block in your reply.)\n${editDecisions}`
          : ""
      }`;

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
          system: `${buildChatSystemPromptV2(styleOverrides)}\n\n${grounding}`,
          tools: buildChatTools(styleOverrides.bannedWords),
          providerOptions: { anthropic: CHAT_THINKING },
          maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
          // Must run upstream of the agent's smoothStream — see the module
          // comment. Without it, multi-step tool turns lose the thinking
          // signature and the model's reasoning is dropped between steps.
          experimental_transform: preserveReasoningSignature<typeof CHAT_TOOLS>(),
          onStepFinish: (step) => {
            for (const toolCall of step.toolCalls) {
              toolCallIds.add(toolCall.toolCallId);
            }
          },
        },
        { saveStreamDeltas: true }
      );
      await result.consumeStream();
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
      console.error("report chat response failed", error);
      if (finish.status !== "failed") return;

      await saveMessage(ctx, components.agent, {
        threadId: args.agentThreadId,
        agentName: "report-editor",
        // Shares the prompt's order so the failed turn's trace attaches to it.
        promptMessageId: args.promptMessageId,
        message: {
          role: "assistant",
          content: "I couldn’t finish that response. Try again.",
        },
      });
    }
  },
});
