import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Id } from "../_generated/dataModel";
import {
  COMPLETION_REPORT_TARGET_ITEMS,
  MAX_BULK_EDITS,
  MAX_COMPLETION_REPORT_FINDINGS,
  bulkEditInputSchema,
  completionReportAnchorIssues,
  completionReportChecklist,
  completionReportItem,
  completionReportItems,
  completionReportRows,
  paragraphCounts,
  paragraphCountsSentence,
  type CompletionReportFinding,
} from "./completionReport";

/**
 * Story 5 (CAP-13, AD-28): the Completion Report contract, tested without the
 * agent SDK and without Convex. Everything the prompt promises the writer
 * (three statuses, each carrying its evidence; one row per item; the checklist
 * echoing every id) is a property of this module.
 *
 * The Rev G replay block at the bottom is what
 * `docs/oq7-rev-g-bulk-edit-replay-2026-09-11.md` cites.
 */

const proposalId = "proposal_1" as Id<"chatProposals">;
const projectId = "project_1" as Id<"projects">;

type Section = "242" | "244" | "246";

const resolved = (
  n: number,
  over: Partial<Extract<CompletionReportFinding, { status: "resolved" }>> = {}
): CompletionReportFinding => ({
  id: `r-242-${n}-1`,
  section: "242",
  paragraph: n,
  kind: "rule",
  rule: `Paragraph ${n} rule`,
  status: "resolved",
  editNumbers: [n],
  ...over,
});

const blocked: CompletionReportFinding = {
  id: "c-244-2-1",
  section: "244",
  paragraph: 2,
  kind: "content",
  status: "blocked",
  reason: "The draft cannot state the cycle count.",
  missingFact: "The number of test cycles run in 2025.",
  missingFactSource: "The March interview transcript.",
};

const conflicting: CompletionReportFinding = {
  id: "x-246-1-1",
  section: "246",
  paragraph: 1,
  kind: "reference",
  status: "conflicting",
  reason: "The Reference PD opens Line 246 with three extra paragraphs.",
  lockedRule: "Line 246 line cap of 50.",
  alternative: "Fold the two advancements into one paragraph inside the cap.",
};

/** 16 items: 14 resolved (rule + content), 1 blocked, 1 conflicting. */
function mixedSixteen(): { edits: Array<{ targetText: string; newText: string }>; findings: CompletionReportFinding[] } {
  const findings: CompletionReportFinding[] = [];
  for (let i = 1; i <= 10; i += 1) {
    findings.push(
      resolved(i, { id: `r-242-${i}-1`, editNumbers: [i] }) as CompletionReportFinding
    );
  }
  for (let i = 1; i <= 4; i += 1) {
    findings.push({
      id: `c-244-${i}-1`,
      section: "244",
      paragraph: i,
      kind: "content",
      status: "resolved",
      editNumbers: [10 + i],
    });
  }
  findings.push({ ...blocked, id: "c-244-5-1", paragraph: 5 });
  findings.push(conflicting);
  const edits = Array.from({ length: 14 }, (_, i) => ({
    targetText: `target ${i + 1}`,
    newText: `replacement ${i + 1}`,
  }));
  return { edits, findings };
}

describe("bulkEditInputSchema", () => {
  it("accepts a 16-item mixed list of 14 resolved, 1 blocked and 1 conflicting", () => {
    const input = mixedSixteen();
    const parsed = bulkEditInputSchema.parse(input);
    expect(parsed.findings).toHaveLength(16);
    expect(parsed.findings.filter((f) => f.status === "resolved")).toHaveLength(14);
    expect(parsed.findings.filter((f) => f.status === "blocked")).toHaveLength(1);
    expect(parsed.findings.filter((f) => f.status === "conflicting")).toHaveLength(1);
    // Within the tool's own caps, and inside the spec's documented N bound.
    expect(parsed.findings.length).toBeLessThanOrEqual(COMPLETION_REPORT_TARGET_ITEMS);
    expect(MAX_BULK_EDITS).toBe(40);
    expect(MAX_COMPLETION_REPORT_FINDINGS).toBe(80);
  });

  const rejects: Array<[string, () => unknown]> = [
    [
      "a duplicate id",
      () => {
        const input = mixedSixteen();
        input.findings[1] = { ...input.findings[1]!, id: input.findings[0]!.id };
        return input;
      },
    ],
    [
      "an uncovered edit",
      () => {
        const input = mixedSixteen();
        input.edits.push({ targetText: "orphan", newText: "orphan new" });
        return input;
      },
    ],
    [
      "an out-of-range edit number",
      () => {
        const input = mixedSixteen();
        input.findings[0] = resolved(1, { editNumbers: [99] });
        return input;
      },
    ],
    [
      "blocked without a missing fact",
      () => ({
        edits: [{ targetText: "t", newText: "n" }],
        findings: [
          resolved(1, { editNumbers: [1] }),
          {
            id: "c-244-1-1",
            section: "244" as Section,
            paragraph: 1,
            kind: "content",
            status: "blocked",
            reason: "No evidence.",
          },
        ],
      }),
    ],
    [
      "blocked without a missing-fact source",
      () => ({
        edits: [{ targetText: "t", newText: "n" }],
        findings: [
          resolved(1, { editNumbers: [1] }),
          { ...blocked, missingFactSource: undefined },
        ],
      }),
    ],
    [
      "conflicting without a locked rule",
      () => ({
        edits: [{ targetText: "t", newText: "n" }],
        findings: [resolved(1, { editNumbers: [1] }), { ...conflicting, lockedRule: undefined }],
      }),
    ],
    [
      "conflicting without an alternative",
      () => ({
        edits: [{ targetText: "t", newText: "n" }],
        findings: [resolved(1, { editNumbers: [1] }), { ...conflicting, alternative: undefined }],
      }),
    ],
    [
      'kind "rule" without a rule',
      () => ({
        edits: [{ targetText: "t", newText: "n" }],
        findings: [{ ...resolved(1, { editNumbers: [1] }), rule: undefined }],
      }),
    ],
    [
      "an unknown status",
      () => ({
        edits: [{ targetText: "t", newText: "n" }],
        findings: [{ ...resolved(1, { editNumbers: [1] }), status: "proposed" }],
      }),
    ],
    [
      "paragraph 0",
      () => ({
        edits: [{ targetText: "t", newText: "n" }],
        findings: [resolved(1, { editNumbers: [1], paragraph: 0 })],
      }),
    ],
    [
      "an id whose kind prefix does not match the finding's own kind",
      () => ({
        edits: [{ targetText: "t", newText: "n" }],
        // The id says content ("c-"), but kind still says rule.
        findings: [{ ...resolved(1, { editNumbers: [1] }), id: "c-242-1-1" }],
      }),
    ],
    [
      "an id whose section does not match the finding's own section",
      () => ({
        edits: [{ targetText: "t", newText: "n" }],
        // The id names Line 244, but section still says 242.
        findings: [{ ...resolved(1, { editNumbers: [1] }), id: "r-244-1-1" }],
      }),
    ],
  ];

  for (const [label, build] of rejects) {
    it(`rejects ${label}`, () => {
      const result = bulkEditInputSchema.safeParse(build());
      expect(result.success, label).toBe(false);
    });
  }

  it("names the coverage rule when the mapping is wrong", () => {
    const input = mixedSixteen();
    input.edits.push({ targetText: "orphan", newText: "orphan new" });
    const result = bulkEditInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    const message = (result as z.ZodSafeParseError<unknown>).error.issues
      .map((issue) => issue.message)
      .join(" ");
    expect(message).toContain("map every edit to a finding");
    expect(message).toContain("kind is rule");
  });
});

describe("completionReportRows", () => {
  it("is 1:1 with the findings and order preserving", () => {
    const { findings } = mixedSixteen();
    const rows = completionReportRows(completionReportItems(findings), {
      proposalId,
      projectId,
      createdAt: 1_700_000_000_000,
    });
    expect(rows).toHaveLength(16);
    expect(rows.map((row) => row.itemId)).toEqual(findings.map((f) => f.id));
    expect(rows.every((row) => row.proposalId === proposalId)).toBe(true);
    expect(rows.every((row) => row.projectId === projectId)).toBe(true);
    expect(rows.every((row) => row.createdAt === 1_700_000_000_000)).toBe(true);
  });

  it("carries each status's own evidence and nothing else", () => {
    const rows = completionReportRows(
      completionReportItems([resolved(3, { editNumbers: [1, 2] }), blocked, conflicting]),
      { proposalId, projectId, createdAt: 1 }
    );
    expect(rows[0]).toEqual({
      proposalId,
      projectId,
      createdAt: 1,
      itemId: "r-242-3-1",
      status: "resolved",
      reason: "Proposed in edits 1, 2.",
      section: "242",
      paragraphNumber: 3,
      kind: "rule",
      rule: "Paragraph 3 rule",
    });
    expect(rows[1]).toMatchObject({
      itemId: "c-244-2-1",
      status: "blocked",
      missingFact: "The number of test cycles run in 2025.",
      missingFactSource: "The March interview transcript.",
      section: "244",
      paragraphNumber: 2,
      kind: "content",
    });
    expect(rows[1]?.lockedRule).toBeUndefined();
    expect(rows[1]?.rule).toBeUndefined();
    expect(rows[2]).toMatchObject({
      itemId: "x-246-1-1",
      status: "conflicting",
      lockedRule: "Line 246 line cap of 50.",
      alternative: "Fold the two advancements into one paragraph inside the cap.",
      kind: "reference",
    });
    expect(rows[2]?.missingFact).toBeUndefined();
  });
});

describe("completionReportChecklist", () => {
  it("prints every id exactly once, verbatim, with its status", () => {
    const { findings } = mixedSixteen();
    const checklist = completionReportChecklist(findings);
    const lines = checklist.split("\n");
    expect(lines).toHaveLength(16);
    for (const finding of findings) {
      expect(checklist.split(`${finding.id}:`).length - 1).toBe(1);
    }
    expect(lines[0]).toBe("r-242-1-1: resolved: Line 242 paragraph 1, edit 1.");
    expect(lines[14]).toContain("c-244-5-1: blocked:");
    expect(lines[14]).toContain("Missing fact: The number of test cycles run in 2025.");
    expect(lines[14]).toContain("Expected from: The March interview transcript.");
    expect(lines[15]).toContain("x-246-1-1: conflicting:");
    expect(lines[15]).toContain("Locked Rule: Line 246 line cap of 50.");
    expect(lines[15]).toContain("Alternative: Fold the two advancements");
    // The old status vocabulary is gone from the echo.
    expect(checklist).not.toMatch(/: (proposed|gap|conflict):/);
  });

  it("bounds the echoed text exactly like the persisted row, so the writer never reads more than the audit row stores", () => {
    const longText = "y".repeat(1500);
    const finding = {
      ...blocked,
      reason: longText,
      missingFact: longText,
      missingFactSource: longText,
    };
    const line = completionReportChecklist([finding]);
    const row = completionReportItem(finding);
    expect(row.status).toBe("blocked");
    if (row.status !== "blocked") throw new Error("unreachable");
    expect(line).toContain(row.reason);
    expect(line).toContain(row.missingFact);
    expect(line).toContain(row.missingFactSource);
    expect(line).not.toContain(longText);
  });
});

describe("paragraph anchors", () => {
  const sections = {
    s242: ["a", "b", "c", "d", "e"].map((t) => `${t} body.`).join("\n\n"),
    s244: Array.from({ length: 7 }, (_, i) => `s244 ${i}.`).join("\n\n"),
    s246: Array.from({ length: 6 }, (_, i) => `s246 ${i}.`).join("\n\n"),
  };

  it("counts paragraphs with the shared split and states them", () => {
    expect(paragraphCounts(sections)).toEqual({ "242": 5, "244": 7, "246": 6 });
    expect(paragraphCountsSentence(paragraphCounts(sections))).toBe(
      "Line 242 has 5 paragraph(s); Line 244 has 7 paragraph(s); Line 246 has 6 paragraph(s)"
    );
  });

  it("accepts every in-range anchor and refuses one the report does not have", () => {
    const counts = paragraphCounts(sections);
    expect(
      completionReportAnchorIssues(
        [
          { itemId: "r-242-5-1", section: "242", paragraphNumber: 5 },
          { itemId: "c-244-7-1", section: "244", paragraphNumber: 7 },
        ],
        counts
      )
    ).toEqual([]);
    expect(
      completionReportAnchorIssues(
        [{ itemId: "r-244-9-1", section: "244", paragraphNumber: 9 }],
        counts
      )
    ).toEqual([
      "r-244-9-1 names paragraph 9 of Line 244, which has 7 paragraph(s).",
    ]);
    // 0, a fraction and a section with no paragraphs are all refused.
    expect(
      completionReportAnchorIssues(
        [
          { itemId: "a", section: "242", paragraphNumber: 0 },
          { itemId: "b", section: "242", paragraphNumber: 1.5 },
        ],
        { "242": 0, "244": 0, "246": 0 }
      )
    ).toHaveLength(2);
    // An item with no anchor at all is not an anchor error.
    expect(completionReportAnchorIssues([{ itemId: "c" }], counts)).toEqual([]);
  });
});

/**
 * Rev G replay (Open Question 7). Larry's 2026-09-01 list held 16 deviations
 * and the assistant addressed 4. These two assertions are the honest split
 * recorded in `docs/oq7-rev-g-bulk-edit-replay-2026-09-11.md`: coverage of the
 * items the WRITER listed was never a server guarantee and still is not, while
 * the paragraph anchor now is.
 */
describe("Rev G replay", () => {
  /** 4 of 16: four findings, four edits, twelve items never mentioned. */
  const fourOfSixteen = {
    edits: Array.from({ length: 4 }, (_, i) => ({
      targetText: `target ${i + 1}`,
      newText: `replacement ${i + 1}`,
    })),
    findings: Array.from({ length: 4 }, (_, i) => resolved(i + 1, { editNumbers: [i + 1] })),
  };

  it("still accepts a 4-of-16 call, because listed-item coverage is not a server guarantee", () => {
    // PR #8's contract accepted this shape and story 5's contract still does:
    // the twelve unmentioned items are writer-authored text the server never
    // stored, so nothing here can count them. The 16/16 bar therefore lives in
    // the live-model harness fixture (CAP-13), not in this schema.
    expect(bulkEditInputSchema.safeParse(fourOfSixteen).success).toBe(true);
    expect(completionReportChecklist(fourOfSixteen.findings).split("\n")).toHaveLength(4);
  });

  it("refuses a finding whose paragraph anchor the current report does not have", () => {
    // What story 5 DOES add over PR #8: an item cannot name a paragraph that is
    // not there, so a renumbered or invented item id is caught before any row
    // is written. `saveProposal` runs exactly this check against the report.
    const counts = paragraphCounts({
      s242: "only one paragraph.",
      s244: "one.",
      s246: "one.",
    });
    const items = completionReportItems([resolved(4, { editNumbers: [1] })]);
    expect(completionReportAnchorIssues(items, counts)).toEqual([
      "r-242-4-1 names paragraph 4 of Line 242, which has 1 paragraph(s).",
    ]);
  });
});
