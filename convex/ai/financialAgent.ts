"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { z } from "zod";
import { instrumentedAnthropic } from "./instrument";
import { MODEL } from "./model";
import { normalizeProviderError } from "./providers";

const TIMESHEET_EXTRACTION_PROMPT = `You are a financial analyst for an SR&ED (Scientific Research & Experimental Development) consulting firm. Your job is to reconstruct timesheets from unstructured data sources.

## Your Task

Given raw data from a communication platform (Slack, WhatsApp, Git commits, etc.), extract timesheet entries for each person mentioned. For each entry, determine:
1. Who did the work
2. When (date or date range)
3. How many hours, and whether the number is explicit in the source or estimated. Never present an estimate as recorded time.
4. What they did (brief description)
5. Whether the work is SR&ED eligible
6. Confidence level in the extraction

## SR&ED Eligibility Rules
- **Eligible**: Direct experimental work, testing hypotheses, analyzing results, developing prototypes, documenting experiments
- **Eligible**: Support work directly tied to SR&ED (setting up test environments, preparing test data, calibrating instruments)
- **NOT Eligible**: Routine development, production work, marketing, sales, general administration, project management (unless directly planning experiments)
- **NOT Eligible**: Commercial production, quality control of production (not experimental), data collection for non-experimental purposes

## Output Format
Respond with ONLY valid JSON:
{
  "entries": [
    {
      "personName": "string",
      "date": "YYYY-MM-DD",
      "hours": number,
      "hoursBasis": "explicit" | "estimated",
      "description": "string (1 sentence)",
      "sredEligible": boolean,
      "sredReason": "string (why eligible or not)",
      "confidence": "high" | "medium" | "low",
      "source": "string (e.g., 'Slack message at 2024-03-15 10:30')"
    }
  ]
}`;


const extractionSchema = z.object({
  entries: z
    .array(
      z.object({
        personName: z.string().trim().min(1).max(200),
        date: z.string().trim().min(1).max(100),
        hours: z.number().finite().min(0).max(24),
        hoursBasis: z.enum(["explicit", "estimated"]),
        description: z.string().trim().min(1).max(2_000),
        sredEligible: z.boolean(),
        sredReason: z.string().trim().max(2_000).optional(),
        confidence: z.enum(["high", "medium", "low"]),
        source: z.string().trim().min(1).max(1_000),
      })
    )
    .max(500),
});

export const processFinancialUpload = internalAction({
  args: {
    projectId: v.id("projects"),
    uploadId: v.id("financialUploads"),
  },
  handler: async (ctx, args) => {
    const claimed = await ctx.runMutation(internal.financial.markUploadRunning, {
      projectId: args.projectId,
      uploadId: args.uploadId,
    });
    if (!claimed) return;

    try {
      const upload = await ctx.runQuery(internal.financial.getUploadContent, {
        projectId: args.projectId,
        uploadId: args.uploadId,
      });
      if (!upload) throw new Error("Financial upload project mismatch");

      const anthropic = instrumentedAnthropic(ctx, {
        callSite: "financial",
        capability: "financial",
        projectId: args.projectId,
      });
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8192,
        system: TIMESHEET_EXTRACTION_PROMPT,
        messages: [
          {
            role: "user",
            content: `Extract timesheet entries from this ${upload.fileType} data:\n\n${upload.content}`,
          },
        ],
      });
      const text =
        response.content[0]?.type === "text" ? response.content[0].text : "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Financial agent did not return valid JSON");
      }
      const result = extractionSchema.parse(JSON.parse(jsonMatch[0]));
      await ctx.runMutation(internal.financial.replaceTimesheetEntries, {
        projectId: args.projectId,
        uploadId: args.uploadId,
        entries: result.entries,
      });
    } catch (error) {
      const normalized = normalizeProviderError(error);
      await ctx.runMutation(internal.financial.markUploadFailed, {
        projectId: args.projectId,
        uploadId: args.uploadId,
        error: `${normalized.code}: ${normalized.message}`,
      });
    }
  },
});
