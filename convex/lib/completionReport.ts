import { v, type Infer } from "convex/values";
import { z } from "zod";
import type { Id } from "../_generated/dataModel";
import { sectionParagraphs } from "./tiptapReport";

/**
 * Story 5 (CAP-13, AD-28): the Completion Report contract.
 *
 * Pure and framework-free: `zod` for the tool's input schema, `convex/values`
 * for the row validator the schema and `saveProposal` share (the same split
 * `convex/lib/complianceNote.ts` uses), and `convex/lib/tiptapReport` for the
 * one paragraph split every anchor is checked against. No agent SDK, no DB, so
 * the prompt, the tool and the persisted rows cannot drift apart and every
 * property below is testable without `convexTest`.
 */

/** The three Locked sections; a finding may anchor nowhere else. */
export const COMPLETION_REPORT_SECTIONS = ["242", "244", "246"] as const;
export type CompletionReportSection = (typeof COMPLETION_REPORT_SECTIONS)[number];

/** Where the item came from. CAP-13 treats all three identically. */
export const COMPLETION_REPORT_KINDS = ["rule", "content", "reference"] as const;
export type CompletionReportKind = (typeof COMPLETION_REPORT_KINDS)[number];

export const COMPLETION_REPORT_STATUSES = [
  "resolved",
  "blocked",
  "conflicting",
] as const;
export type CompletionReportStatus = (typeof COMPLETION_REPORT_STATUSES)[number];

/** The tool's own hard caps, unchanged from PR #8's bulk-edit tool. */
export const MAX_BULK_EDITS = 40;
export const MAX_COMPLETION_REPORT_FINDINGS = 80;

/**
 * The spec's documented bound (CAP-13: "for N <= 30 the reply holds exactly one
 * Proposal and N report lines") inside the tool's own 80 cap. It is the number
 * the prompt quotes to the model, not a schema limit: refusing item 31 of a
 * writer's list would be worse than proposing it.
 */
export const COMPLETION_REPORT_TARGET_ITEMS = 30;

const MAX_TEXT_CHARS = 1000;

function bounded(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_TEXT_CHARS
    ? `${trimmed.slice(0, MAX_TEXT_CHARS - 1)}…`
    : trimmed;
}

// ─── The findings schema (zod; the tool's input) ─────────────────────────────

const findingAnchor = {
  id: z
    .string()
    .min(1)
    .describe(
      "The item id exactly as the Deviation Inventory or the comparison produced it (for example r-242-3-1). Never renumber."
    ),
  section: z.enum(COMPLETION_REPORT_SECTIONS),
  paragraph: z
    .number()
    .int()
    .min(1)
    .describe("1-based paragraph number within that section of the CURRENT report."),
  kind: z.enum(COMPLETION_REPORT_KINDS),
  rule: z
    .string()
    .min(1)
    .optional()
    .describe('Required when kind is "rule": the Writer Profile rule the item names.'),
};

/** The prefix `itemId()` (`convex/lib/deviationInventory.ts`) gives each kind. */
const ID_KIND_PREFIX: Record<CompletionReportKind, string> = {
  rule: "r",
  content: "c",
  reference: "x",
};

/** `<prefix>-<section>-<paragraph>-<n>`. An id in another shape is left alone. */
const ID_SHAPE = /^([a-z]+)-(242|244|246)-\d+-\d+$/;

const completionReportFindingUnion = z.discriminatedUnion("status", [
  z.object({
    ...findingAnchor,
    status: z.literal("resolved"),
    editNumbers: z
      .array(z.number().int().min(1))
      .min(1)
      .describe("The 1-based edit numbers that resolve this item."),
  }),
  z.object({
    ...findingAnchor,
    status: z.literal("blocked"),
    reason: z.string().min(1),
    missingFact: z
      .string()
      .min(1)
      .describe("The specific fact the evidence does not carry."),
    missingFactSource: z
      .string()
      .min(1)
      .describe("Where that fact should have come from (a transcript, a document, the client)."),
  }),
  z.object({
    ...findingAnchor,
    status: z.literal("conflicting"),
    reason: z.string().min(1),
    lockedRule: z
      .string()
      .min(1)
      .describe("The Locked Rule the item would breach (a skeleton rule, a line cap, a word cap)."),
    alternative: z
      .string()
      .min(1)
      .describe("A change that honours the Locked Rule and still moves the item forward."),
  }),
]);

/**
 * The id is trusted verbatim as the Deviation Inventory's own key, but nothing
 * else checked that a model echoing it back also kept `kind`/`section`
 * consistent with it. A finding whose id embeds a different kind or section
 * than its own fields is refused here, before it can be persisted as a
 * self-contradictory `chatProposalItems` row.
 */
export const completionReportFindingSchema = completionReportFindingUnion.superRefine(
  (finding, ctx) => {
    const match = ID_SHAPE.exec(finding.id);
    if (!match) return;
    const [, prefix, idSection] = match;
    if (prefix !== ID_KIND_PREFIX[finding.kind]) {
      ctx.addIssue({
        code: "custom",
        path: ["id"],
        message: `${finding.id} does not match kind "${finding.kind}": an id for this kind starts with "${ID_KIND_PREFIX[finding.kind]}-".`,
      });
    }
    if (idSection !== finding.section) {
      ctx.addIssue({
        code: "custom",
        path: ["id"],
        message: `${finding.id} names Line ${idSection}, but this finding's section is Line ${finding.section}.`,
      });
    }
  }
);

export type CompletionReportFinding = z.infer<typeof completionReportFindingSchema>;

const editSchema = z.object({
  targetText: z.string().min(1),
  newText: z.string().min(1),
});

/**
 * The coverage rule, stated once. PR #8 enforced unique ids and full edge
 * coverage; story 5 adds the `kind`/`rule` pairing so a rule Deviation cannot
 * be reported without naming the rule it departs from.
 */
export const COVERAGE_RULE_MESSAGE =
  "Use unique finding IDs, map every edit to a finding using its one-based edit number, and name the rule on every finding whose kind is rule.";

export function coverageIssue(input: {
  edits: Array<{ targetText: string; newText: string }>;
  findings: CompletionReportFinding[];
}): string | null {
  const ids = new Set(input.findings.map((f) => f.id));
  const covered = new Set(
    input.findings.flatMap((f) => (f.status === "resolved" ? f.editNumbers : []))
  );
  const missingRule = input.findings.some(
    (f) => f.kind === "rule" && !f.rule?.trim()
  );
  if (
    ids.size !== input.findings.length ||
    [...covered].some((n) => n > input.edits.length) ||
    input.edits.some((_, i) => !covered.has(i + 1)) ||
    missingRule
  ) {
    return COVERAGE_RULE_MESSAGE;
  }
  return null;
}

/** `proposeBulkEdits`'s whole input: the coordinated revision plus its report. */
export const bulkEditInputSchema = z
  .object({
    edits: z.array(editSchema).min(1).max(MAX_BULK_EDITS),
    findings: z
      .array(completionReportFindingSchema)
      .min(1)
      .max(MAX_COMPLETION_REPORT_FINDINGS),
  })
  .superRefine((input, ctx) => {
    const message = coverageIssue(input);
    if (message) ctx.addIssue({ code: "custom", message });
  });

export type BulkEditInput = z.infer<typeof bulkEditInputSchema>;

// ─── The persisted row (AD-28 shape, widened per AD-10) ─────────────────────

export const completionReportStatusValidator = v.union(
  v.literal("resolved"),
  v.literal("blocked"),
  v.literal("conflicting")
);

export const completionReportSectionValidator = v.union(
  v.literal("242"),
  v.literal("244"),
  v.literal("246")
);

export const completionReportKindValidator = v.union(
  v.literal("rule"),
  v.literal("content"),
  v.literal("reference")
);

/**
 * One `chatProposalItems` row as `saveProposal` receives it. The first block of
 * fields is AD-28 verbatim; `section`, `paragraphNumber`, `kind` and `rule` are
 * the CAP-12 paragraph anchor, added as optional fields (AD-10 widen), never a
 * rename of an AD-28 field.
 *
 * `paragraphNumber` carries the finding's 1-based `paragraph`, so an item and
 * the checklist line that echoes it always name the same paragraph number the
 * writer sees. It is deliberately NOT called `paragraphIndex`: that name belongs
 * to the 0-based `complianceNotes.paragraphIndex`, and two fields one apart must
 * not share a name. The inventory converts once, where the notes are read.
 */
export const completionReportItemValidator = v.object({
  itemId: v.string(),
  status: completionReportStatusValidator,
  reason: v.string(),
  missingFact: v.optional(v.string()),
  missingFactSource: v.optional(v.string()),
  lockedRule: v.optional(v.string()),
  alternative: v.optional(v.string()),
  section: v.optional(completionReportSectionValidator),
  paragraphNumber: v.optional(v.number()),
  kind: v.optional(completionReportKindValidator),
  rule: v.optional(v.string()),
});
export type CompletionReportItem = Infer<typeof completionReportItemValidator>;

export type CompletionReportItemRow = CompletionReportItem & {
  proposalId: Id<"chatProposals">;
  projectId: Id<"projects">;
  createdAt: number;
};

/**
 * A `resolved` finding carries no `reason` of its own; AD-28 makes `reason`
 * required on the row, so the row states which edits resolve it. That keeps
 * every stored item self-describing without inventing a judgement.
 */
export function resolvedReason(editNumbers: number[]): string {
  return `Proposed in ${editLabel(editNumbers)}.`;
}

function editLabel(editNumbers: number[]): string {
  return editNumbers.length === 1
    ? `edit ${editNumbers[0]}`
    : `edits ${editNumbers.join(", ")}`;
}

/** The AD-28 row for one finding. Pure: the caller supplies the ids and clock. */
export function completionReportItem(
  finding: CompletionReportFinding
): CompletionReportItem {
  const anchor = {
    itemId: finding.id,
    section: finding.section,
    paragraphNumber: finding.paragraph,
    kind: finding.kind,
    ...(finding.rule?.trim() ? { rule: bounded(finding.rule) } : {}),
  };
  if (finding.status === "resolved") {
    return {
      ...anchor,
      status: "resolved",
      reason: resolvedReason(finding.editNumbers),
    };
  }
  if (finding.status === "blocked") {
    return {
      ...anchor,
      status: "blocked",
      reason: bounded(finding.reason),
      missingFact: bounded(finding.missingFact),
      missingFactSource: bounded(finding.missingFactSource),
    };
  }
  return {
    ...anchor,
    status: "conflicting",
    reason: bounded(finding.reason),
    lockedRule: bounded(finding.lockedRule),
    alternative: bounded(finding.alternative),
  };
}

/**
 * Every finding projected onto the AD-28 item shape, 1:1 and in input order.
 * This is what the tool hands `saveProposal`: the mutation receives items, not
 * the zod union, so the persisted shape is validated by Convex at the boundary.
 */
export function completionReportItems(
  findings: CompletionReportFinding[]
): CompletionReportItem[] {
  return findings.map(completionReportItem);
}

/**
 * One `chatProposalItems` row per item, in input order. Pure: the caller owns
 * the ids and the clock, so the mutation stays the only thing that writes.
 */
export function completionReportRows(
  items: CompletionReportItem[],
  owner: {
    proposalId: Id<"chatProposals">;
    projectId: Id<"projects">;
    createdAt: number;
  }
): CompletionReportItemRow[] {
  return items.map((item) => ({
    proposalId: owner.proposalId,
    projectId: owner.projectId,
    createdAt: owner.createdAt,
    ...item,
  }));
}

// ─── The reply's echo ───────────────────────────────────────────────────────

/** `id: status: detail`, one line per item, ids preserved verbatim. */
export function completionReportLine(finding: CompletionReportFinding): string {
  const where = `Line ${finding.section} paragraph ${finding.paragraph}`;
  if (finding.status === "resolved") {
    return `${finding.id}: resolved: ${where}, ${editLabel(finding.editNumbers)}.`;
  }
  // Bounded the same way `completionReportItem` bounds the persisted row, so
  // the reply the writer reads never says more than the audit row will show.
  if (finding.status === "blocked") {
    return `${finding.id}: blocked: ${where}. ${bounded(finding.reason)} Missing fact: ${bounded(finding.missingFact)}. Expected from: ${bounded(finding.missingFactSource)}.`;
  }
  return `${finding.id}: conflicting: ${where}. ${bounded(finding.reason)} Locked Rule: ${bounded(finding.lockedRule)}. Alternative: ${bounded(finding.alternative)}.`;
}

export function completionReportChecklist(
  findings: CompletionReportFinding[]
): string {
  return findings.map(completionReportLine).join("\n");
}

// ─── Anchor validation against the current report ───────────────────────────

export type SectionParagraphCounts = Record<CompletionReportSection, number>;

/** Paragraph counts of the current report, by the one shared paragraph split. */
export function paragraphCounts(sections: {
  s242: string;
  s244: string;
  s246: string;
}): SectionParagraphCounts {
  return {
    "242": sectionParagraphs(sections.s242).length,
    "244": sectionParagraphs(sections.s244).length,
    "246": sectionParagraphs(sections.s246).length,
  };
}

/** The counts sentence a refusal hands back so the model can retry correctly. */
export function paragraphCountsSentence(counts: SectionParagraphCounts): string {
  return COMPLETION_REPORT_SECTIONS.map(
    (section) => `Line ${section} has ${counts[section]} paragraph(s)`
  ).join("; ");
}

/**
 * Anchors that the current report does not have. A non-empty result means no
 * proposal and no item row may be written.
 */
export function completionReportAnchorIssues(
  items: Array<{ itemId: string; section?: string; paragraphNumber?: number }>,
  counts: SectionParagraphCounts
): string[] {
  const issues: string[] = [];
  for (const item of items) {
    if (item.section === undefined || item.paragraphNumber === undefined) continue;
    const section = item.section as CompletionReportSection;
    const available = counts[section];
    if (available === undefined) {
      issues.push(`${item.itemId} names Line ${item.section}, which is not a section of this report.`);
      continue;
    }
    if (
      !Number.isInteger(item.paragraphNumber) ||
      item.paragraphNumber < 1 ||
      item.paragraphNumber > available
    ) {
      issues.push(
        `${item.itemId} names paragraph ${item.paragraphNumber} of Line ${section}, which has ${available} paragraph(s).`
      );
    }
  }
  return issues;
}
