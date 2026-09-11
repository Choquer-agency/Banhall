import { describe, expect, it } from "vitest";
import {
  SETTINGS_TITLE_PATTERN,
  detectSettingsDocument,
  matchesSettingsTitle,
  normalizeSettingsText,
  parseSourceLabel,
  settingsDocumentText,
  settingsSupplyLabel,
  type SettingsSourceRow,
} from "./settingsDocument";
import { MAX_INSTRUCTIONS_CHARS } from "../../shared/writerProfileLimits";

const SETTINGS_BODY = "PD Writing Customized Settings\n\nLine 246: no more than 80 lines.";

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

describe("settings-title pattern (Design Notes examples)", () => {
  it.each([
    "PD Writing Customized Settings",
    "Customised settings",
    "Writer’s settings",
    "Writing preferences",
    "Style settings v3",
    // Further alternatives of the same pattern.
    "customized pd writing settings",
    "Writers profile",
    "Writer's preferences",
  ])("matches %j as a file name or a first line", (title) => {
    expect(matchesSettingsTitle(title, "")).toBe(true);
    expect(matchesSettingsTitle("Writer's notes (pasted)", title)).toBe(true);
  });

  it.each(["PD_Writing_Customized_Settings.docx", "PD-Writing-Customised-Settings.pdf"])(
    "matches %j as a file name (separators normalized for file names only)",
    (fileName) => {
      expect(matchesSettingsTitle(fileName, "")).toBe(true);
    }
  );

  it.each([
    "PD settings.xlsx",
    "PD controller settings",
    "Kp/Kd PD settings for the actuator",
    "Test settings log",
    "PID settings",
    "Writer's notes (pasted)",
    "Interview notes",
  ])("does not match %j", (title) => {
    expect(matchesSettingsTitle(title, "")).toBe(false);
    expect(matchesSettingsTitle("Writer's notes (pasted)", title)).toBe(false);
  });

  it("is case-insensitive and reads raw text with a straight apostrophe", () => {
    expect(SETTINGS_TITLE_PATTERN.test("WRITER'S SETTINGS")).toBe(true);
    expect(SETTINGS_TITLE_PATTERN.test("pd settings")).toBe(false);
  });

  it("strips the file extension and reads _ and - as spaces", () => {
    expect(matchesSettingsTitle("Style_settings.docx", "")).toBe(true);
    expect(matchesSettingsTitle("writing-preferences.md", "")).toBe(true);
    expect(matchesSettingsTitle("Style_settingsXdocx", "")).toBe(false);
  });

  it("reads the typographic apostrophe in a first line", () => {
    expect(matchesSettingsTitle("notes.txt", "Writer’s profile\nShort sentences.")).toBe(true);
  });

  it("reads the first non-empty line only, up to 200 characters", () => {
    expect(matchesSettingsTitle("Writer's notes (pasted)", "\n\n  PD Writing Customized Settings\nbody")).toBe(true);
    expect(matchesSettingsTitle("Writer's notes (pasted)", "Kickoff call\nPD Writing Customized Settings")).toBe(false);
    expect(matchesSettingsTitle("notes.txt", `${"x".repeat(200)} writing preferences`)).toBe(false);
  });
});

describe("detectSettingsDocument", () => {
  it("detects by file name (with _ separators) and by first line", () => {
    expect(
      detectSettingsDocument([row("a", "other:PD_Writing_Customized_Settings.docx", "Short sentences.")])
    ).toMatchObject({ generationSourceId: "a", supplyPath: "attachment", text: "Short sentences." });
    expect(
      detectSettingsDocument([row("b", "writer_notes:Writer's notes (pasted)", SETTINGS_BODY)])
    ).toMatchObject({ generationSourceId: "b", supplyPath: "writer_notes", fileName: "Writer's notes (pasted)" });
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

  it("ignores non-settings documents, controller-gain files and non-document rows", () => {
    expect(
      detectSettingsDocument([
        row("a", "other:Budget.xlsx", "Q3 numbers"),
        row("b", "other:PD settings.xlsx", "Kp 1.2, Kd 0.4"),
        row("c", "writer_notes:Writer's notes (pasted)", "Emphasise the prototype failures."),
        { ...row("d", "Interview transcript", SETTINGS_BODY), kind: "transcript" },
        row("e", "other:PD Writing Customized Settings.docx", "   "),
      ])
    ).toBeNull();
  });

  it("prefers Writer's Notes over other attachments, then frozen row order", () => {
    const detected = detectSettingsDocument([
      row("attach-1", "other:Writing preferences.docx", "Attachment one."),
      row("notes-1", "writer_notes:Style settings.md", "Notes one."),
      row("notes-2", "writer_notes:Writing settings.md", "Notes two."),
    ]);
    expect(detected).toMatchObject({ generationSourceId: "notes-1", text: "Notes one." });
    expect(
      detectSettingsDocument([
        row("attach-1", "previous_pd:Writing preferences.docx", "Attachment one."),
        row("attach-2", "other:Style settings.docx", "Attachment two."),
      ])
    ).toMatchObject({ generationSourceId: "attach-1", supplyPath: "attachment" });
  });

  it("applies the trimmed frozen content sliced to MAX_INSTRUCTIONS_CHARS and records truncation", () => {
    const long = `  ${"y".repeat(MAX_INSTRUCTIONS_CHARS + 10)}  `;
    const detected = detectSettingsDocument([row("a", "other:Style settings.txt", long)]);
    expect(detected?.text).toHaveLength(MAX_INSTRUCTIONS_CHARS);
    expect(detected?.text).toBe(settingsDocumentText(long));
    expect(detected?.truncated).toBe(true);
    const short = detectSettingsDocument([row("a", "other:Style settings.txt", "  Keep it tight.  ")]);
    expect(short).toMatchObject({ text: "Keep it tight.", truncated: false });
    // A frozen row the reservation already truncated stays truncated.
    expect(
      detectSettingsDocument([row("a", "other:Style settings.txt", "Kept.", { truncated: true })])?.truncated
    ).toBe(true);
  });

  it("carries the projectDocumentId when the frozen row has one", () => {
    expect(
      detectSettingsDocument([row("a", "other:Style settings.txt", "Text.", { projectDocumentId: "doc-1" })])
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
