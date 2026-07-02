"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "./model";
import { CHAT_SYSTEM_PROMPT } from "./prompts";

// Banned-word safety net for chat edits (mirrors the pipeline's scrubber).
const BANNED_REPLACEMENTS: [RegExp, string][] = [
  [/\bnovel\b/gi, "new"],
  [/\bpioneering\b/gi, "new"],
  [/\brevolutionary\b/gi, "new"],
  [/\bpivotal\b/gi, "critical"],
  [/\bseamless\b/gi, "smooth"],
  [/\bsubstantially?\b/gi, "considerably"],
  [/\bsignificantly?\b/gi, "markedly"],
  [/\bunique\b/gi, "distinct"],
  [/\bgroundbreaking\b/gi, "new"],
  [/\bcutting-edge\b/gi, "advanced"],
  [/\bstate-of-the-art\b/gi, "current"],
  [/\bcomprehensive\b/gi, "thorough"],
  [/\brobust\b/gi, "reliable"],
  [/\bholistic\b/gi, "complete"],
  [/\bsynergy\b/gi, "coordination"],
  [/\bleverage[ds]?\b/gi, "use"],
  [/\bleveraging\b/gi, "using"],
  [/\bharness(?:ed|ing)?\b/gi, "use"],
  [/\brevolutioniz(?:e[ds]?|ing)\b/gi, "change"],
  [/\btransformative\b/gi, "important"],
  [/\bgame-changing\b/gi, "important"],
  [/\bfundamentally\b/gi, ""],
  [/\bparadigm\b/gi, "approach"],
  [/\becosystem\b/gi, "environment"],
  [/\bfurthermore,?\s*/gi, ""],
  [/\bmoreover,?\s*/gi, ""],
  [/\badditionally,?\s*/gi, ""],
  [/\binnovative\b/gi, "new"],
  [/\bspearheading\b/gi, "leading"],
  [/\bdelving into\b/gi, "examining"],
];

function scrubBannedWords(text: string): string {
  let result = text;
  for (const [pattern, replacement] of BANNED_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result.replace(/ {2,}/g, " ").trim();
}

/**
 * Remove leaked edit-memory meta-notes (e.g. '[You proposed replacing report
 * text with: "…"] — the writer accepted this edit.') that earlier buggy turns
 * baked into stored replies. Cleans both history sent to the model and output.
 */
function stripMetaNotes(text: string): string {
  return text
    .replace(/\n*\[You proposed replacing report text with:[\s\S]*$/i, "")
    .trim();
}

/** Flatten a Tiptap JSON doc into readable plain text for model context. */
function extractPlainText(contentJson: string): string {
  try {
    const doc = JSON.parse(contentJson);
    const lines: string[] = [];
    const walk = (node: Record<string, unknown>) => {
      const type = node.type as string | undefined;
      const children = node.content as Array<Record<string, unknown>> | undefined;
      if (type === "text") {
        lines.push((node.text as string) ?? "");
        return;
      }
      if (children) {
        const before = lines.length;
        children.forEach(walk);
        // join inline children of a block into one line
        if (type === "paragraph" || type === "heading") {
          const joined = lines.splice(before).join("");
          lines.push(joined);
        }
      }
      if (type === "horizontalRule") lines.push("———");
    };
    const top = doc.content as Array<Record<string, unknown>> | undefined;
    top?.forEach(walk);
    return lines.filter((l) => l.length > 0).join("\n\n");
  } catch {
    return "";
  }
}

interface ChatReply {
  reply: string;
  proposedEdit?: {
    targetText?: string;
    newText?: string;
    replacements?: { find: string; replaceWith: string }[];
  };
  // BNH-25: passages to locate & highlight for a pure find/show request (no edit).
  references?: string[];
}

export const processChatMessage = internalAction({
  args: {
    threadId: v.id("chatThreads"),
    assistantMessageId: v.id("chatMessages"),
  },
  handler: async (ctx, args) => {
    try {
      const anthropic = new Anthropic();

      // Explicit annotation breaks api-graph type circularity (TS7006 cascade).
      const context: {
        projectId: string;
        reportContent: string | null;
        agentOutputs: string | null;
        documents: { fileName: string; content: string }[];
        messages: {
          role: "writer" | "assistant";
          content: string;
          status: "pending" | "complete" | "error";
          highlight: { text: string; from: number; to: number } | null;
          proposedEdit: {
            newText?: string;
            state: "pending" | "applied" | "rejected";
          } | null;
        }[];
      } = await ctx.runQuery(internal.chat.getChatContext, {
        threadId: args.threadId,
      });

      const reportText = context.reportContent
        ? extractPlainText(context.reportContent)
        : "(no report content available)";

      // Pull the structured transcript analysis if it exists.
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

      // Build the conversation. The placeholder assistant message is the last
      // entry — drop it; turn prior turns into Anthropic messages.
      const priorMessages = context.messages.filter(
        (m) => !(m.role === "assistant" && m.status === "pending")
      );

      const conversation: Anthropic.MessageParam[] = priorMessages.map((m) => {
        if (m.role === "writer") {
          const excerpt = m.highlight
            ? `\n\n[Writer highlighted this excerpt from the report]:\n"""${m.highlight.text}"""`
            : "";
          return { role: "user" as const, content: `${m.content}${excerpt}` };
        }
        // Assistant turns stay clean — strip any meta-notes that earlier buggy
        // turns baked into stored replies, so the model stops mimicking them.
        return {
          role: "assistant" as const,
          content: stripMetaNotes(m.content) || "(…)",
        };
      });

      // Memory of past edit decisions lives in the CONTEXT block (not in the
      // assistant turns) so the model can learn from rejections — and iterate
      // on a version the writer liked — without echoing notes into its reply.
      // Keep the FULL proposed text (not truncated) for the most recent few,
      // so it can reproduce a liked/rejected version with a small tweak.
      const decisions = priorMessages.filter(
        (m) => m.role === "assistant" && m.proposedEdit
      );
      const recent = decisions.slice(-6);
      const editDecisions = recent
        .map((m, i) => {
          const pe = m.proposedEdit!;
          const n = decisions.length - recent.length + i + 1;
          return `[Edit ${n} — ${pe.state.toUpperCase()}]\n${pe.newText}`;
        })
        .join("\n\n");

      // Prepend the grounding context to the first user turn.
      const groundingBlock = `# CURRENT REPORT (the only document you may edit)\n${reportText}\n\n# TRANSCRIPT ANALYSIS (source of truth — do not exceed it)\n${analysisText}\n\n# UPLOADED CONTEXT DOCUMENTS\n${docsText}${
        editDecisions
          ? `\n\n# PRIOR EDIT DECISIONS (the exact text you proposed and whether the writer accepted/rejected it — your memory for iterating. If they liked a rejected version and want a small change, reuse it with only that change. Context only — never repeat this block in your reply.)\n${editDecisions}`
          : ""
      }\n\n---\nThe writer's messages follow.`;

      const messages: Anthropic.MessageParam[] =
        conversation.length > 0
          ? [
              {
                role: "user",
                content: `${groundingBlock}\n\n${
                  typeof conversation[0].content === "string"
                    ? conversation[0].content
                    : ""
                }`,
              },
              ...conversation.slice(1),
            ]
          : [{ role: "user", content: groundingBlock }];

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: CHAT_SYSTEM_PROMPT,
        messages,
      });

      const text =
        response.content[0]?.type === "text" ? response.content[0].text : "";

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        // No structured output — treat the whole thing as a plain reply.
        await ctx.runMutation(internal.chat.completeAssistantMessage, {
          messageId: args.assistantMessageId,
          content:
            stripMetaNotes(text) || "Sorry, I couldn't generate a response.",
          status: "complete",
        });
        return;
      }

      const parsed = JSON.parse(jsonMatch[0]) as ChatReply;

      let proposedEdit:
        | {
            targetText?: string;
            newText?: string;
            replacements?: { find: string; replaceWith: string }[];
            state: "pending";
          }
        | undefined;

      const pe = parsed.proposedEdit;
      // Multi-instance find/replace (BNH-27) — used for edits like pronoun
      // normalization where the same phrase recurs throughout the report.
      const replacements = Array.isArray(pe?.replacements)
        ? pe!.replacements
            .filter((r) => r && typeof r.find === "string" && r.find.length > 0)
            .map((r) => ({
              find: r.find,
              replaceWith: scrubBannedWords(r.replaceWith ?? ""),
            }))
        : undefined;

      if (replacements && replacements.length > 0) {
        proposedEdit = { replacements, state: "pending" };
      } else if (pe && pe.targetText && pe.newText) {
        proposedEdit = {
          targetText: pe.targetText,
          newText: scrubBannedWords(pe.newText),
          state: "pending",
        };
      }

      // Locate/highlight-only request (no edit): pass through the verbatim
      // passages so the document panel can scroll to + highlight them (BNH-25).
      const references = Array.isArray(parsed.references)
        ? parsed.references.filter((r) => typeof r === "string" && r.trim())
        : undefined;

      await ctx.runMutation(internal.chat.completeAssistantMessage, {
        messageId: args.assistantMessageId,
        content: stripMetaNotes(parsed.reply ?? "") || "Done.",
        status: "complete",
        ...(proposedEdit ? { proposedEdit } : {}),
        ...(references && references.length && !proposedEdit
          ? { references }
          : {}),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      await ctx.runMutation(internal.chat.completeAssistantMessage, {
        messageId: args.assistantMessageId,
        content: `Something went wrong generating a response: ${message}`,
        status: "error",
      });
    }
  },
});
