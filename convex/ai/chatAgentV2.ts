import { internalAction } from "../_generated/server";
import { components, internal } from "../_generated/api";
import { v } from "convex/values";
import { z } from "zod";
import { Agent, createTool, stepCountIs, saveMessage } from "@convex-dev/agent";
import { anthropic } from "@ai-sdk/anthropic";
import { MODEL } from "./model";
import { CHAT_SYSTEM_PROMPT_V2 } from "./prompts";
import { scrubBannedWords, extractPlainText } from "../lib/reportEdits";
import { searchBrainExemplars, formatBrainExemplars } from "./brain/retrieve";

// ─── Agent-based chat (BNH-10 P2) ────────────────────────────────────────────
// Parallel-run replacement for chatAgent.ts. The @convex-dev/agent component
// owns thread history + streaming deltas; edits/highlights are TOOLS whose
// calls land as chatProposals rows (see convex/chatV2.ts) instead of a JSON
// blob regex-parsed out of the reply.

const proposeEdit = createTool({
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
  execute: async (ctx, input): Promise<string> => {
    if (!ctx.threadId) throw new Error("No thread in tool context");
    await ctx.runMutation(internal.chatV2.saveProposal, {
      agentThreadId: ctx.threadId,
      messageId: ctx.messageId,
      kind: "edit",
      targetText: input.targetText,
      newText: scrubBannedWords(input.newText),
    });
    return "Edit proposed — the writer sees it as a card with Apply/Reject.";
  },
});

const proposeReplacements = createTool({
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
  execute: async (ctx, input): Promise<string> => {
    if (!ctx.threadId) throw new Error("No thread in tool context");
    await ctx.runMutation(internal.chatV2.saveProposal, {
      agentThreadId: ctx.threadId,
      messageId: ctx.messageId,
      kind: "replacements",
      replacements: input.replacements.map((r) => ({
        find: r.find,
        replaceWith: scrubBannedWords(r.replaceWith),
      })),
    });
    return "Replacement set proposed — the writer sees it as a card with Apply/Reject.";
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
  execute: async (ctx, input): Promise<string> => {
    if (!ctx.threadId) throw new Error("No thread in tool context");
    await ctx.runMutation(internal.chatV2.saveProposal, {
      agentThreadId: ctx.threadId,
      messageId: ctx.messageId,
      kind: "references",
      references: input.references,
    });
    return `Highlighted ${input.references.length} passage(s) in the document panel.`;
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
    // Industry narrows the search when set; without it, retrieval spans all
    // industries — a good PD's structure/voice transfers.
    const industry: string | null = await ctx.runQuery(
      internal.chatV2.getThreadIndustry,
      { agentThreadId: ctx.threadId }
    );
    try {
      const { exemplars, degraded } = await searchBrainExemplars(ctx, {
        ...(industry ? { industry } : {}),
        query: input.query,
        k: 3,
        docType: "pd",
      });
      // `degraded` = the search infrastructure failed (searchBrainExemplars
      // never throws) — saying "no knowledge" during a Voyage outage would
      // be a lie the writer can't distinguish from an empty corpus.
      if (degraded) {
        return "The Brain search hit a technical error just now — this is an infrastructure issue, not missing knowledge. Tell the writer to try again shortly.";
      }
      if (exemplars.length === 0) {
        return industry
          ? `The Brain has no approved knowledge matching that in the "${industry}" industry yet.`
          : "The Brain has no approved knowledge matching that yet.";
      }
      return formatBrainExemplars(exemplars);
    } catch (err) {
      console.error("searchBrain tool failed", err);
      return "The Brain search hit a technical error just now — this is an infrastructure issue, not missing knowledge. Tell the writer to try again shortly.";
    }
  },
});

export const reportChatAgent = new Agent(components.agent, {
  name: "report-editor",
  languageModel: anthropic(MODEL),
  instructions: CHAT_SYSTEM_PROMPT_V2,
  tools: { proposeEdit, proposeReplacements, highlightPassages, searchBrain },
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
  },
  handler: async (ctx, args) => {
    // Explicit annotation breaks api-graph type circularity (TS7006 cascade).
    const context: {
      reportContent: string | null;
      agentOutputs: string | null;
      documents: { fileName: string; content: string }[];
      decisions: { state: "pending" | "applied" | "rejected"; summary: string }[];
    } = await ctx.runQuery(internal.chatV2.getChatContextV2, {
      reportId: args.reportId,
      agentThreadId: args.agentThreadId,
    });

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
            (d) => `--- Document: ${d.fileName} ---\n${d.content.slice(0, 20000)}`
          )
          .join("\n\n")
      : "(no documents uploaded)";

    const editDecisions = context.decisions
      .map((d, i) => `[Edit ${i + 1} — ${d.state.toUpperCase()}]\n${d.summary}`)
      .join("\n\n");

    const grounding = `# CURRENT REPORT (the only document you may edit)\n${reportText}\n\n# TRANSCRIPT ANALYSIS (source of truth — do not exceed it)\n${analysisText}\n\n# UPLOADED CONTEXT DOCUMENTS\n${docsText}${
      editDecisions
        ? `\n\n# PRIOR EDIT DECISIONS (the exact text you proposed and whether the writer accepted/rejected it — your memory for iterating. If they liked a rejected version and want a small change, reuse it with only that change. Context only — never repeat this block in your reply.)\n${editDecisions}`
        : ""
    }`;

    try {
      const result = await reportChatAgent.streamText(
        ctx,
        { threadId: args.agentThreadId },
        {
          promptMessageId: args.promptMessageId,
          system: `${CHAT_SYSTEM_PROMPT_V2}\n\n${grounding}`,
        },
        { saveStreamDeltas: true }
      );
      await result.consumeStream();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      // Surface the failure in-thread so the writer isn't left with silence.
      await saveMessage(ctx, components.agent, {
        threadId: args.agentThreadId,
        agentName: "report-editor",
        message: {
          role: "assistant",
          content: `Something went wrong generating a response: ${message}`,
        },
      });
    }
  },
});
