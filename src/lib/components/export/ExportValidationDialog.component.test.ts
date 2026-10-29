import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import ExportValidationDialog from "./ExportValidationDialog.svelte";
import { buildTiptapDocument } from "../../../../convex/lib/tiptapReport";
import { canonicalizeExportPreflight, validateExport } from "$lib/exportValidation";

/**
 * 2026-10-29 (owner): the export dialog lists every gap and unchecked
 * inference still in the report, each with a jump to it. Inferences do not
 * block the export, as gaps do not.
 */
const REASON = "the source asks for stability over time, not single-point checks";

function result() {
  const content = JSON.stringify(
    buildTiptapDocument(
      "Cold room readiness",
      "The company asked how long a cold room takes to settle. [GAP: the room sizes]",
      `Readiness was first judged from single readings. [INFERRED: ${REASON}]`,
      "The work showed how load affects settling."
    )
  );
  return validateExport(
    canonicalizeExportPreflight({
      reportId: "r1",
      reportVersion: 1,
      revisionNumber: 1,
      contentHash: "hash",
      content,
      templateVersion: "v1",
      supportingDocumentCount: 1,
      project: { title: "Cold room readiness", clientName: "Example Co", fiscalYearEnd: Date.UTC(2025, 11, 31), scienceCode: "2.02.09" },
    })
  );
}

describe("ExportValidationDialog notes", () => {
  it("lists each gap and inference with its Line and a jump, and still lets the export proceed", async () => {
    const validation = result();
    expect(validation.errors).toEqual([]);
    const onShowNote = vi.fn();
    const onProceed = vi.fn();
    await render(ExportValidationDialog, {
      errors: validation.errors,
      warnings: validation.warnings,
      notes: validation.notes,
      onCancel: () => {},
      onProceed,
      onShowNote,
    });
    const list = page.getByRole("region", { name: "Notes to check" });
    await expect.element(list).toBeInTheDocument();
    const items = list.getByRole("listitem");
    await expect.poll(() => items.all().length).toBe(2);
    await expect.element(items.nth(0)).toHaveTextContent(/^Gap\s*Line 242: the room sizes\s*Show/);
    await expect.element(items.nth(1)).toHaveTextContent(new RegExp(`^Inferred\\s*Line 244: ${REASON}\\s*Show`));
    // Both kinds are listed as warnings too, so the dialog opens for an inference alone.
    await expect.element(page.getByText("Line 244 has an inference to check (an [INFERRED] marker); it will be exported highlighted.")).toBeInTheDocument();
    await expect.element(page.getByText("Line 242 contains an unresolved [GAP] marker; it will be exported highlighted.")).toBeInTheDocument();

    const showInference = page.getByRole("button", { name: "Show this inference in Line 244" });
    await showInference.click();
    expect(onShowNote).toHaveBeenCalledTimes(1);
    expect(onShowNote.mock.calls[0][0]).toEqual({
      section: "s244",
      kind: "inferred",
      text: `[INFERRED: ${REASON}]`,
      note: REASON,
    });
    await page.getByRole("button", { name: "Show this gap in Line 242" }).click();
    expect(onShowNote.mock.calls[1][0]).toMatchObject({ section: "s242", kind: "gap", text: "[GAP: the room sizes]" });

    await page.getByRole("button", { name: "Proceed anyway" }).click();
    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  it("marks the two kinds with their own tokens", async () => {
    const validation = result();
    await render(ExportValidationDialog, {
      errors: [],
      warnings: validation.warnings,
      notes: validation.notes,
      onCancel: () => {},
    });
    await expect.poll(() => document.querySelectorAll("[data-export-note]").length).toBe(2);
    const chips = [...document.querySelectorAll<HTMLElement>("[data-export-note] > span")];
    expect(chips.map((chip) => chip.textContent?.trim())).toEqual(["Gap", "Inferred"]);
    expect(chips[0].className).toContain("bg-gap-bg");
    expect(chips[1].className).toContain("bg-inferred-bg");
    // Without a jump handler the list shows no Show buttons.
    expect(document.querySelectorAll("[data-export-notes] button")).toHaveLength(0);
  });

  it("shows no notes section when the report has none", async () => {
    await render(ExportValidationDialog, { errors: [], warnings: [], notes: [], onCancel: () => {} });
    await expect.element(page.getByRole("heading", { name: "Review export warnings" })).toBeInTheDocument();
    expect(document.querySelector("[data-export-notes]")).toBeNull();
  });
});
