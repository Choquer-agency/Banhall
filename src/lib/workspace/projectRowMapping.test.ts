import { describe, expect, it } from "vitest";
import { formatProjectDate, toProjectsTableRow } from "./projectRowMapping";

const base = {
  _id: "p1",
  _creationTime: Date.UTC(2026, 0, 5, 12),
  title: "Quarterly SR&ED synthesis",
  clientName: "Northline Labs",
  workflowStage: "drafting" as const,
  status: "draft",
  ownerId: "u1",
  ownerLabel: "Olivia Owner",
  writer: undefined,
  generationActivity: null,
  createdAt: Date.UTC(2026, 2, 10, 12),
  updatedAt: Date.UTC(2026, 6, 29, 12),
};

describe("toProjectsTableRow", () => {
  it("maps createdAt into the preformatted created date", () => {
    const row = toProjectsTableRow(base);
    expect(row.createdDate).toBe(formatProjectDate(base.createdAt));
    expect(row.updatedDate).toBe(formatProjectDate(base.updatedAt));
    expect(row.createdDate).toMatch(/2026/);
  });

  it("falls back to _creationTime when createdAt is absent (legacy rows)", () => {
    const row = toProjectsTableRow({ ...base, createdAt: undefined });
    expect(row.createdDate).toBe(formatProjectDate(base._creationTime));
  });

  it("omits createdDate entirely when neither stamp exists — never invents a date", () => {
    const row = toProjectsTableRow({ ...base, createdAt: undefined, _creationTime: undefined });
    expect(row.createdDate).toBeUndefined();
  });

  it("keeps the canonical owner resolution and legacy status passthrough", () => {
    const row = toProjectsTableRow(base);
    expect(row.owner).toEqual({ kind: "canonical", label: "Olivia Owner" });
    expect(row.legacyStatus).toBe("draft");
  });
});
