import { describe, expect, it } from "vitest";
import {
  SETTINGS_TITLE_PATTERN,
  detectSettingsDocument,
  isSettingsTitle,
  matchesSettingsTitle,
  normalizeSettingsText,
  parseSourceLabel,
  settingsDocumentText,
  settingsSupplyLabel,
  type SettingsSourceRow,
} from "./settingsDocument";
import { MAX_INSTRUCTIONS_CHARS } from "../../shared/writerProfileLimits";

const SETTINGS_BODY = "PD Writing Customized Settings\n\nLine 246: no more than 80 lines.";
const PASTED = "Writer's notes (pasted)";

function row(
  id: string,
  label: string,
  content: string,
  extra: Partial<SettingsSourceRow> = {}
): SettingsSourceRow {
  return {
    _id: id,
    kind: "project_document",
    label,
    content,
    truncated: false,
    uploaderRole: "writer",
    ...extra,
  };
}

describe("settings-title rule (Design Notes examples)", () => {
  it.each([
    "PD Writing Customized Settings",
    "PD_Writing_Customized_Settings_2026-09.docx",
    "Larry's PD Writing Customized Settings",
    "José's PD Writing Customized Settings",
    "Customised settings",
    "Writer’s settings",
    "Writing preferences - Tracy (final)",
    "# Writing preferences",
  ])("matches %j", (title) => {
    expect(matchesSettingsTitle(title, "")).toBe(true);
  });

  it.each([
    "PD Writing Customized Settings",
    "Larry's PD Writing Customized Settings",
    "José's PD Writing Customized Settings",
    "Customised settings",
    "Writer’s settings",
    "Writing preferences - Tracy (final)",
    "# Writing preferences",
  ])("matches %j as the first line of pasted Writer's Notes", (title) => {
    expect(matchesSettingsTitle(PASTED, `${title}\nShort sentences.`)).toBe(true);
  });

  it.each([
    "PD settings.xlsx",
    "PD controller settings",
    "Kp/Kd PD settings for the actuator",
    "Remember the client's writing preferences are formal",
    "Changed the controller style settings",
    "Style settings v3",
    "Test settings log",
  ])("does not match %j as a file name or a first line", (title) => {
    expect(matchesSettingsTitle(title, "")).toBe(false);
    expect(matchesSettingsTitle(PASTED, title)).toBe(false);
  });

  it("pasted Writer's Notes' own file name never matches, so only the first line decides", () => {
    expect(matchesSettingsTitle(PASTED, "")).toBe(false);
    expect(matchesSettingsTitle(PASTED, "Emphasise the prototype failures.")).toBe(false);
  });

  it("condition 1: the pattern's alternatives, case-insensitive", () => {
    for (const title of [
      "customized pd writing settings",
      "PD writing settings",
      "Writing settings",
      "Writers profile",
      "Writer's preferences",
      "Writing style guide",
      "Writing style settings",
    ]) {
      expect(isSettingsTitle(title), title).toBe(true);
    }
    expect(SETTINGS_TITLE_PATTERN.test("WRITER'S SETTINGS")).toBe(true);
    expect(SETTINGS_TITLE_PATTERN.test("pd settings")).toBe(false);
    expect(SETTINGS_TITLE_PATTERN.test("style settings")).toBe(false);
  });

  it("condition 2: at most one token outside the filler set remains", () => {
    // Fillers, versions, digits, dates, months and possessives.
    for (const title of [
      "My SR&ED writing preferences (updated draft v2)",
      "Our PD writing settings — latest rev 3, 11 Sept 2026",
      "The writing preferences document for 2026-09-11",
      "Tracy's writing preferences, final copy",
      "Writing preferences 2nd version",
    ]) {
      expect(isSettingsTitle(title), title).toBe(true);
    }
    // One name is allowed; two non-filler tokens are not.
    expect(isSettingsTitle("Writing preferences Tracy")).toBe(true);
    expect(isSettingsTitle("Writing preferences Tracy Smith")).toBe(false);
    expect(isSettingsTitle("Notes on writing preferences")).toBe(false);
  });

  it("strips leading heading marks, emphasis, bullets and list numbering", () => {
    for (const title of ["## Writing preferences", "**Writing preferences**", "- Writing preferences", "• Writing preferences", "1. Writing preferences", "(a) Writing preferences"]) {
      expect(isSettingsTitle(title), title).toBe(true);
    }
  });

  it("strips the file extension and reads _ and - as spaces in a file name", () => {
    expect(matchesSettingsTitle("PD-Writing-Customised-Settings.pdf", "")).toBe(true);
    expect(matchesSettingsTitle("writing-preferences.md", "")).toBe(true);
    expect(matchesSettingsTitle("Writing_settings.docx", "")).toBe(true);
    expect(matchesSettingsTitle("Style_settings.docx", "")).toBe(false);
  });

  it("reads the typographic apostrophe in a first line", () => {
    expect(matchesSettingsTitle("notes.txt", "Writer’s profile\nShort sentences.")).toBe(true);
  });

  it("reads the first non-empty line only, up to 200 characters", () => {
    expect(matchesSettingsTitle(PASTED, "\n\n  PD Writing Customized Settings\nbody")).toBe(true);
    expect(matchesSettingsTitle(PASTED, "Kickoff call\nPD Writing Customized Settings")).toBe(false);
    expect(matchesSettingsTitle("notes.txt", `${"x".repeat(200)} writing preferences`)).toBe(false);
  });
});

describe("detectSettingsDocument", () => {
  it("detects by file name (with _ and - separators) and by first line", () => {
    expect(
      detectSettingsDocument([row("a", "other:PD_Writing_Customized_Settings.docx", "Short sentences.")])
    ).toMatchObject({ generationSourceId: "a", supplyPath: "attachment", text: "Short sentences." });
    expect(
      detectSettingsDocument([row("a", "other:PD-Writing-Customized-Settings.docx", "Short sentences.")])
    ).toMatchObject({ generationSourceId: "a" });
    expect(
      detectSettingsDocument([row("b", `writer_notes:${PASTED}`, SETTINGS_BODY)])
    ).toMatchObject({ generationSourceId: "b", supplyPath: "writer_notes", fileName: PASTED });
  });

  it("detects a typographic-apostrophe title", () => {
    expect(detectSettingsDocument([row("a", "other:Writer’s settings.docx", "Keep it tight.")])).toMatchObject({
      generationSourceId: "a",
      fileName: "Writer’s settings.docx",
    });
  });

  it("ignores a client-trust document (no uploaderRole)", () => {
    expect(
      detectSettingsDocument([
        row("a", "writer_notes:PD Writing Customized Settings.docx", SETTINGS_BODY, { uploaderRole: undefined }),
      ])
    ).toBeNull();
  });

  it("ignores non-settings documents, controller-gain files, ordinary notes and non-document rows", () => {
    expect(
      detectSettingsDocument([
        row("a", "other:Budget.xlsx", "Q3 numbers"),
        row("b", "other:PD settings.xlsx", "Kp 1.2, Kd 0.4"),
        row("c", `writer_notes:${PASTED}`, "Emphasise the prototype failures."),
        row("d", `writer_notes:${PASTED}`, "Remember the client's writing preferences are formal.\nMore notes."),
        { ...row("e", "Interview transcript", SETTINGS_BODY), kind: "transcript" },
        row("f", "other:PD Writing Customized Settings.docx", "   "),
      ])
    ).toBeNull();
  });

  it("prefers Writer's Notes over other attachments, then frozen row order", () => {
    const detected = detectSettingsDocument([
      row("attach-1", "other:Writing preferences.docx", "Attachment one."),
      row("notes-1", "writer_notes:Writing settings.md", "Notes one."),
      row("notes-2", "writer_notes:Writer's profile.md", "Notes two."),
    ]);
    expect(detected).toMatchObject({ generationSourceId: "notes-1", text: "Notes one." });
    expect(
      detectSettingsDocument([
        row("attach-1", "previous_pd:Writing preferences.docx", "Attachment one."),
        row("attach-2", "other:Writing settings.docx", "Attachment two."),
      ])
    ).toMatchObject({ generationSourceId: "attach-1", supplyPath: "attachment" });
  });

  it("applies the trimmed frozen content sliced to MAX_INSTRUCTIONS_CHARS and records truncation", () => {
    const long = `  ${"y".repeat(MAX_INSTRUCTIONS_CHARS + 10)}  `;
    const detected = detectSettingsDocument([row("a", "other:Writing settings.txt", long)]);
    expect(detected?.text).toHaveLength(MAX_INSTRUCTIONS_CHARS);
    expect(detected?.text).toBe(settingsDocumentText(long));
    expect(detected?.truncated).toBe(true);
    const short = detectSettingsDocument([row("a", "other:Writing settings.txt", "  Keep it tight.  ")]);
    expect(short).toMatchObject({ text: "Keep it tight.", truncated: false });
    // A frozen row the reservation already truncated stays truncated.
    expect(
      detectSettingsDocument([row("a", "other:Writing settings.txt", "Kept.", { truncated: true })])?.truncated
    ).toBe(true);
  });

  it("carries the projectDocumentId when the frozen row has one", () => {
    expect(
      detectSettingsDocument([row("a", "other:Writing settings.txt", "Text.", { projectDocumentId: "doc-1" })])
    ).toMatchObject({ projectDocumentId: "doc-1" });
  });
});

describe("helpers", () => {
  it("splits labels at the first colon", () => {
    expect(parseSourceLabel("writer_notes:a:b.docx")).toEqual({ category: "writer_notes", fileName: "a:b.docx" });
    expect(parseSourceLabel("unlabelled")).toEqual({ category: "other", fileName: "unlabelled" });
  });

  it("normalizes whitespace for the matches-profile comparison", () => {
    expect(normalizeSettingsText("  Short\n\n sentences.\tAlways.  ")).toBe("Short sentences. Always.");
  });

  it("names the supply path with one phrase", () => {
    expect(settingsSupplyLabel("writer_notes")).toBe("in Writer's Notes");
    expect(settingsSupplyLabel("attachment")).toBe("in an attachment");
  });
});
