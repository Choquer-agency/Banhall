import { MAX_INSTRUCTIONS_CHARS } from "../../shared/writerProfileLimits";

/**
 * Story 3 (CAP-8, AD-26): detection of a writer's customized-settings
 * document among a generation's frozen sources. Pure and framework-free
 * (imports `shared` only), so the settings page can reuse its wording.
 *
 * A document qualifies only when it is a frozen `project_document` row, its
 * `uploaderRole` is present (the column holds internal roles only, so absent
 * means client trust and never qualifies), and its file name or first
 * non-empty line matches the settings-title pattern. At most one is applied:
 * Writer's Notes before other attachments, then frozen row order.
 */

/**
 * Case-insensitive. Candidates are normalized first (`normalizeTitleCandidate`):
 * a bare "PD settings" (a proportional-derivative controller's gains) never
 * matches, and neither do "PD controller settings" or "PID settings".
 */
export const SETTINGS_TITLE_PATTERN =
  /\b(customi[sz]ed (pd )?(writing )?settings|pd writing (customi[sz]ed )?settings|writing (settings|preferences)|writer'?s? (settings|profile|preferences)|style settings)\b/i;

/** How far into the first non-empty line the pattern may look. */
export const SETTINGS_FIRST_LINE_CHARS = 200;

export type SettingsSupplyPath = "writer_notes" | "attachment";

/**
 * The one phrase naming where a settings document came from, shared by the
 * generation progress log, the Writer Profile row's reason and the settings
 * page's prefill notice.
 */
export function settingsSupplyLabel(supplyPath: SettingsSupplyPath): string {
  return supplyPath === "writer_notes" ? "in Writer's Notes" : "in an attachment";
}

/** The fields of a frozen `generationSources` row detection reads. */
export type SettingsSourceRow<SourceId = string, DocumentId = string> = {
  _id: SourceId;
  kind: string;
  label: string;
  content: string;
  truncated: boolean;
  uploaderRole?: string;
  projectDocumentId?: DocumentId;
};

export type DetectedSettingsDocument<SourceId = string, DocumentId = string> = {
  generationSourceId: SourceId;
  projectDocumentId?: DocumentId;
  fileName: string;
  supplyPath: SettingsSupplyPath;
  /** Frozen content, trimmed and sliced to MAX_INSTRUCTIONS_CHARS. */
  text: string;
  truncated: boolean;
};

/** Split a frozen document label `${category}:${fileName}`. */
export function parseSourceLabel(label: string): { category: string; fileName: string } {
  const separator = label.indexOf(":");
  return separator >= 0
    ? { category: label.slice(0, separator), fileName: label.slice(separator + 1) }
    : { category: "other", fileName: label };
}

/** Trimmed, whitespace-normalized text: the equality used for "matches". */
export function normalizeSettingsText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * The instruction text a settings document applies: its frozen content,
 * trimmed and sliced to MAX_INSTRUCTIONS_CHARS. Detection and the save offer
 * both use this, so the classifier cache key (its sha256) agrees.
 */
export function settingsDocumentText(content: string): string {
  return content.trim().slice(0, MAX_INSTRUCTIONS_CHARS);
}

/** Typographic apostrophes read as straight ones. */
function normalizeTitleCandidate(text: string): string {
  return text.replace(/[‘’ʼ]/g, "'");
}

/** The file name without its extension, `_` and `-` read as spaces. */
function fileNameCandidate(fileName: string): string {
  return normalizeTitleCandidate(
    fileName
      .trim()
      .replace(/\.[A-Za-z0-9]{1,8}$/, "")
      .replace(/[_-]+/g, " ")
  );
}

function firstLineCandidate(content: string): string {
  const line = content.split(/\r?\n/).find((candidate) => candidate.trim() !== "");
  return normalizeTitleCandidate((line ?? "").trim().slice(0, SETTINGS_FIRST_LINE_CHARS));
}

/** True when the file name or the first non-empty line names settings. */
export function matchesSettingsTitle(fileName: string, content: string): boolean {
  return (
    SETTINGS_TITLE_PATTERN.test(fileNameCandidate(fileName)) ||
    SETTINGS_TITLE_PATTERN.test(firstLineCandidate(content))
  );
}

/** The settings document a generation applies, or null. */
export function detectSettingsDocument<SourceId, DocumentId>(
  sources: ReadonlyArray<SettingsSourceRow<SourceId, DocumentId>>
): DetectedSettingsDocument<SourceId, DocumentId> | null {
  const qualifying = sources.flatMap((source) => {
    if (source.kind !== "project_document") return [];
    // Trust floor: only an internal uploader's document can become
    // instructions. Absent role = client trust.
    if (!source.uploaderRole) return [];
    const trimmed = source.content.trim();
    if (!trimmed) return [];
    const { category, fileName } = parseSourceLabel(source.label);
    if (!matchesSettingsTitle(fileName, trimmed)) return [];
    return [{ source, category, fileName, trimmed }];
  });
  // Stable: frozen row order decides within each group.
  const ordered = [
    ...qualifying.filter((item) => item.category === "writer_notes"),
    ...qualifying.filter((item) => item.category !== "writer_notes"),
  ];
  const chosen = ordered[0];
  if (!chosen) return null;
  return {
    generationSourceId: chosen.source._id,
    ...(chosen.source.projectDocumentId !== undefined
      ? { projectDocumentId: chosen.source.projectDocumentId }
      : {}),
    fileName: chosen.fileName,
    supplyPath: chosen.category === "writer_notes" ? "writer_notes" : "attachment",
    text: settingsDocumentText(chosen.trimmed),
    truncated: chosen.source.truncated || chosen.trimmed.length > MAX_INSTRUCTIONS_CHARS,
  };
}
