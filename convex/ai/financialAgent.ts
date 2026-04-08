"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import Anthropic from "@anthropic-ai/sdk";

const TIMESHEET_EXTRACTION_PROMPT = `You are a financial analyst for an SR&ED (Scientific Research & Experimental Development) consulting firm. Your job is to reconstruct timesheets from unstructured data sources.

## Your Task

Given raw data from a communication platform (Slack, WhatsApp, Git commits, etc.), extract timesheet entries for each person mentioned. For each entry, determine:
1. Who did the work
2. When (date or date range)
3. How many hours (estimate if not explicit — use message timestamps and activity patterns)
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
      "description": "string (1 sentence)",
      "sredEligible": boolean,
      "sredReason": "string (why eligible or not)",
      "confidence": "high" | "medium" | "low",
      "source": "string (e.g., 'Slack message at 2024-03-15 10:30')"
    }
  ]
}`;

const FINANCIAL_SUMMARY_PROMPT = `You are a financial analyst for an SR&ED consulting firm. Given a set of timesheet entries, generate a personnel breakdown summary.

Group entries by person and summarize:
- Total hours per person
- SR&ED eligible hours per person
- Primary activities per person

Output format:
{
  "personnelBreakdown": [
    {
      "name": "string",
      "totalHours": number,
      "sredHours": number,
      "primaryActivities": ["string"]
    }
  ]
}`;

export const processFinancialUpload = internalAction({
  args: {
    projectId: v.id("projects"),
    uploadId: v.id("financialUploads"),
  },
  handler: async (ctx, args) => {
    const anthropic = new Anthropic();

    const upload = await ctx.runQuery(internal.financial.getUploadContent, {
      uploadId: args.uploadId,
    });

    if (!upload) throw new Error("Upload not found");

    // Step 1: Extract timesheet entries from the raw data
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: TIMESHEET_EXTRACTION_PROMPT,
      messages: [
        {
          role: "user",
          content: `Extract timesheet entries from this ${upload.fileType} data:\n\n${upload.content.slice(0, 100000)}`,
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Financial agent did not return valid JSON");

    const result = JSON.parse(jsonMatch[0]) as {
      entries: Array<{
        personName: string;
        date: string;
        hours: number;
        description: string;
        sredEligible: boolean;
        sredReason?: string;
        confidence: "high" | "medium" | "low";
        source: string;
      }>;
    };

    // Step 2: Save extracted entries
    await ctx.runMutation(internal.financial.saveTimesheetEntries, {
      projectId: args.projectId,
      uploadId: args.uploadId,
      entries: result.entries,
    });

    // Step 3: Generate summary
    const totalHours = result.entries.reduce((sum, e) => sum + e.hours, 0);
    const sredHours = result.entries.filter((e) => e.sredEligible).reduce((sum, e) => sum + e.hours, 0);

    const summaryResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: FINANCIAL_SUMMARY_PROMPT,
      messages: [
        {
          role: "user",
          content: `Generate a personnel breakdown from these timesheet entries:\n\n${JSON.stringify(result.entries, null, 2)}`,
        },
      ],
    });

    const summaryText = summaryResponse.content[0].type === "text" ? summaryResponse.content[0].text : "";
    const summaryMatch = summaryText.match(/\{[\s\S]*\}/);
    const personnelBreakdown = summaryMatch ? summaryMatch[0] : "{}";

    await ctx.runMutation(internal.financial.saveFinancialSummary, {
      projectId: args.projectId,
      totalHours,
      sredHours,
      nonSredHours: totalHours - sredHours,
      personnelBreakdown,
    });
  },
});
