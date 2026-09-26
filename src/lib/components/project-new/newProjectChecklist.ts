/**
 * "Before you start" on New project (boards E1, E4 to E6): one row per thing
 * the writer should know before the start dialog opens. Pure, so every row
 * state and the blocking rule are unit-tested apart from the page.
 */

export type ChecklistState = "done" | "pending" | "reading" | "danger" | "warning";

export type ChecklistRow = {
  id:
    | "client-title"
    | "transcripts"
    | "unreadable"
    | "fiscal-science"
    | "supporting"
    | "duplicate"
    | "previous-year"
    | "no-source"
    | "project-number"
    | "over-cap"
    | "written-pd";
  state: ChecklistState;
  text: string;
  /** A link at the right of the row ("Fix", "Check"). */
  action?: { label: string; target: string };
  /** A blocking row disables the start button. */
  blocking: boolean;
};

export type ChecklistInput = {
  mode: "generate" | "review";
  clientName: string;
  title: string;
  transcripts: { count: number; words: number };
  /** Transcript files that held no text (E5). */
  unreadableTranscripts: number;
  fiscalYearSet: boolean;
  scienceCodeSet: boolean;
  supporting: { count: number; reading: number };
  /** An existing project has this client, title and year (E6), not dismissed. */
  duplicateName: boolean;
  /** Decision 42 message when last year's files are the only sources. */
  previousYearMessage: string | null;
  /** No transcript and no readable file at all. */
  noSource: boolean;
  /** Replaces the no-source text (a duplicate with everything unticked). */
  noSourceMessage?: string;
  projectNumberInvalid: boolean;
  /** The transcript caps message when over them. */
  overCapMessage: string | null;
  /** Review a written PD only. */
  writtenPd: "missing" | "reading" | "ready" | "failed";
};

export const NO_SOURCE_MESSAGE = "Add a transcript or at least one supporting document";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function buildChecklist(input: ChecklistInput): ChecklistRow[] {
  const rows: ChecklistRow[] = [];
  if (input.duplicateName) {
    rows.push({
      id: "duplicate",
      state: "warning",
      text: "Same name as an existing project",
      action: { label: "Check", target: "duplicate" },
      blocking: false,
    });
  }
  const hasClientAndTitle = Boolean(input.clientName.trim() && input.title.trim());
  if (!input.duplicateName || !hasClientAndTitle) {
    rows.push(
      hasClientAndTitle
        ? { id: "client-title", state: "done", text: "Client and title", blocking: false }
        : { id: "client-title", state: "pending", text: "Add a client and a title", blocking: true }
    );
  }
  if (input.mode === "review") {
    rows.push(
      input.writtenPd === "ready"
        ? { id: "written-pd", state: "done", text: "Written PD ready to review", blocking: false }
        : input.writtenPd === "reading"
          ? { id: "written-pd", state: "reading", text: "Reading the written PD", blocking: true }
          : input.writtenPd === "failed"
            ? {
                id: "written-pd",
                state: "danger",
                text: "We could not read the written PD",
                action: { label: "Fix", target: "written-pd" },
                blocking: true,
              }
            : { id: "written-pd", state: "pending", text: "Add the written PD", blocking: true }
    );
  } else if (input.transcripts.count > 0) {
    rows.push({
      id: "transcripts",
      state: "done",
      text: `${plural(input.transcripts.count, "transcript", "transcripts")}, ${input.transcripts.words.toLocaleString("en-US")} words`,
      blocking: false,
    });
  }
  if (input.unreadableTranscripts > 0) {
    rows.push({
      id: "unreadable",
      state: "danger",
      text: `${plural(input.unreadableTranscripts, "transcript", "transcripts")} could not be read`,
      action: { label: "Fix", target: "unreadable" },
      blocking: false,
    });
  }
  rows.push(
    input.fiscalYearSet && input.scienceCodeSet
      ? { id: "fiscal-science", state: "done", text: "Fiscal year and science code", blocking: false }
      : {
          id: "fiscal-science",
          state: "pending",
          text: "Add the fiscal year and science code",
          blocking: false,
        }
  );
  if (input.supporting.count > 0) {
    const docs = plural(input.supporting.count, "supporting document", "supporting documents");
    rows.push(
      input.supporting.reading > 0
        ? {
            id: "supporting",
            state: "reading",
            text: `${docs}, ${input.supporting.reading} still reading`,
            blocking: false,
          }
        : { id: "supporting", state: "done", text: docs, blocking: false }
    );
  }
  if (input.mode === "generate" && input.noSource) {
    rows.push({
      id: "no-source",
      state: "pending",
      text: input.noSourceMessage ?? NO_SOURCE_MESSAGE,
      blocking: true,
    });
  }
  if (input.mode === "generate" && input.previousYearMessage) {
    rows.push({
      id: "previous-year",
      state: "danger",
      text: input.previousYearMessage,
      blocking: true,
    });
  }
  if (input.projectNumberInvalid) {
    rows.push({
      id: "project-number",
      state: "danger",
      text: "Check the project number",
      action: { label: "Fix", target: "project-number" },
      blocking: true,
    });
  }
  if (input.overCapMessage) {
    rows.push({ id: "over-cap", state: "danger", text: input.overCapMessage, blocking: true });
  }
  return rows;
}

export const startBlocked = (rows: readonly ChecklistRow[]) => rows.some((row) => row.blocking);

/** Right-column start button label by mode (Single and Compare are proposed). */
export function startButtonLabel(
  mode: "generate" | "review",
  candidateMode: "iterative" | "single" | "compare"
): string {
  if (mode === "review") return "Start the review";
  switch (candidateMode) {
    case "iterative":
      return "Start step by step";
    case "single":
      return "Start single draft";
    case "compare":
      return "Start two drafts";
  }
}
