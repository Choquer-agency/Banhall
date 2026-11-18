/**
 * Approve on the Import page (2026-11-17, docs/product-domain.md): the words
 * of "Approve N ready" on a company, Approve in the selection bar, the
 * progress line under the toolbar, the Brain check and what an approved
 * file became on the Approved tab. Pure: no Svelte, no Convex calls. The
 * refusals a row alone tells are the server's own rule
 * (shared/importSheetRules.ts approveRefusalFor).
 */
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";
import {
  approveRefusalFor,
  approveRefusalWords,
  type ApproveRefusal,
} from "../../../../shared/importSheetRules";
import { formatCount, plural, type SheetFileRow } from "./importFormat";

export type ApprovalProgress = FunctionReturnType<typeof api.ingestion.approvalProgress>[number];
export type ApprovalRefusal = FunctionReturnType<typeof api.ingestion.approvalRefusals>["files"][number];
export type BrainState = NonNullable<SheetFileRow["brain"]>;

/** "Approve 77 ready", on a company with files ready on To review. */
export function approveReadyText(ready: number): string {
  return `Approve ${formatCount(ready)} ready`;
}

/** The confirm line: "Approve 6 files", "Approve 1 file". */
export function approveLine(count: number): string {
  return `Approve ${plural(count, "file")}`;
}

/** What Approve does, said in its confirm before anything happens. */
export const APPROVE_NOTES: readonly string[] = [
  "Each file goes on its company's page.",
  "Final PDs then wait in Brain check, where a person reads each Brain copy before it is added.",
  "Files that still need a check stay on To review.",
];

/** The confirm's title on a company: "Approve 77 files of Halden Foods?" */
export function approveCompanyTitle(ready: number, company: string): string {
  return `Approve ${plural(ready, "file")} of ${company}?`;
}

/**
 * A new company's line in the confirm: Approve makes it, with the industry
 * picked on the sheet, or says its final PDs stay until one is picked.
 */
export function newCompanyNote(company: string, industry: string | null, hasFinalPds: boolean): string {
  if (industry) return `${company} is new. Approve adds it with the industry ${industry}.`;
  return hasFinalPds
    ? `${company} is new and has no industry yet. Its final PDs stay on To review until you pick one.`
    : `${company} is new. Approve adds it with no industry.`;
}

/** A company merged into another one: its files are moved there before they can be approved. */
export function mergedNote(company: string, into: string): string {
  return `${company} was merged into ${into}. Move these files to ${into} first, then approve them there.`;
}

type Candidate = { status: SheetFileRow["status"]; needsCheck?: boolean; checkReasons?: readonly string[] };

/** The selected files Approve sends, and those it leaves out by the row's own rule, by reason. */
export function splitForApprove<R extends Candidate>(
  rows: readonly R[]
): { taken: R[]; leftOut: { reason: ApproveRefusal; count: number }[] } {
  const taken: R[] = [];
  const counts = new Map<ApproveRefusal, number>();
  for (const row of rows) {
    const reason = approveRefusalFor(row);
    if (reason === null) taken.push(row);
    else counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return { taken, leftOut: [...counts].map(([reason, count]) => ({ reason, count })) };
}

/** "3 files were left out: they still need a check." One sentence a reason; empty when none. */
export function approveLeftOutText(groups: readonly { reason: ApproveRefusal; count: number }[]): string {
  return groups
    .map(({ reason, count }) => {
      const [one, many] = approveRefusalWords(reason);
      return count === 1 ? `1 file was left out: it ${one}.` : `${formatCount(count)} files were left out: they ${many}.`;
    })
    .join(" ");
}

/** The files an approval left on To review, in words by reason: "2 files still need a check." */
export function refusalSummary(files: readonly Pick<ApprovalRefusal, "reason">[]): string {
  const counts = new Map<ApproveRefusal, number>();
  for (const file of files) counts.set(file.reason, (counts.get(file.reason) ?? 0) + 1);
  return [...counts]
    .map(([reason, count]) => {
      const [one, many] = approveRefusalWords(reason);
      return `${plural(count, "file")} ${count === 1 ? one : many}.`;
    })
    .join(" ");
}

/** One refused file's reason, with the server's detail when there is one. */
export function refusalText(file: { reason: ApproveRefusal; detail?: string }): string {
  const [one] = approveRefusalWords(file.reason);
  const words = `It ${one}.`;
  return file.detail ? `${words} ${file.detail.replace(/\.$/, "")}.` : words;
}

/** Whose files an approval is about: "of Halden Foods", or nothing for files of several companies. */
function ofCompany(progress: Pick<ApprovalProgress, "companyName">): string {
  return progress.companyName ? ` of ${progress.companyName}` : "";
}

/**
 * The progress line: while it runs "Approving files of Halden Foods: 40 of
 * 300 done."; once done "Approved 296 files of Halden Foods. 4 were left on
 * To review."; stopped "This approval stopped after 40 of 300 files.
 * Approve again to go on."
 */
export function progressText(progress: ApprovalProgress): string {
  const { done, total, approved, refused } = progress;
  if (progress.status === "stopped" || progress.stalled) {
    return `This approval stopped after ${formatCount(done)} of ${plural(total, "file")}. Approve again to go on.`;
  }
  if (progress.status === "running") {
    const who = progress.mine || !progress.startedByName ? "Approving" : `${progress.startedByName} is approving`;
    return `${who} files${ofCompany(progress)}: ${formatCount(done)} of ${formatCount(total)} done.`;
  }
  const head = approved > 0 ? `Approved ${plural(approved, "file")}${ofCompany(progress)}.` : "No files were approved.";
  if (refused === 0) return head;
  return `${head} ${formatCount(refused)} ${refused === 1 ? "was" : "were"} left on To review.`;
}

/** What an approved file became in the Brain (the file view, and the tag's tooltip on the Approved tab). */
export const BRAIN_STATE_TEXT: Record<BrainState, string> = {
  in_brain: "In the Brain",
  brain_check: "Waiting for its Brain check",
  kept_out: "Kept out of the Brain",
  removed: "Removed from the Brain",
};


/** An approved file whose company file was removed since, or one approved on the old page. */
export const NOT_ON_COMPANY_PAGE = "Not on a company page";

/** The Brain check tab's empty state. */
export const NOTHING_FOR_BRAIN_CHECK = "No final PDs are waiting for a Brain check.";

/** Said when another Admin's approval of the same company is already running. */
export function alreadyRunningText(by: string): string {
  return `${by} is already approving these files. The line under the toolbar shows how far it is.`;
}

/** Under "Add to the Brain" until the whole copy has been shown. */
export const READ_WHOLE_COPY = "Show the whole copy before you add it.";

/** The Brain check's position: "2 of 12". */
export function brainCheckPosition(index: number, total: number): string {
  return `${formatCount(index + 1)} of ${formatCount(Math.max(total, index + 1))}`;
}

/** The Also remove words a person typed: split on commas and line breaks, trimmed, each once. */
export function alsoRemoveWords(typed: string, existing: readonly string[]): string[] {
  const words = [...existing];
  for (const part of typed.split(/[,\n]/)) {
    const word = part.replace(/\s+/g, " ").trim();
    if (word && !words.some((have) => have.toLowerCase() === word.toLowerCase())) words.push(word);
  }
  return words;
}

/**
 * The scrubbed copy cut into plain text and the redaction marks the scrub
 * left ("[redacted]", "[redacted number]", "[redacted address]"), so the
 * view can show where words were hidden.
 */
export function redactionParts(text: string): { text: string; mark: boolean }[] {
  const parts: { text: string; mark: boolean }[] = [];
  const pattern = /\[redacted(?: number| address)?\]/g;
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > at) parts.push({ text: text.slice(at, start), mark: false });
    parts.push({ text: match[0], mark: true });
    at = start + match[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), mark: false });
  return parts;
}

/** The scrubbed copy a view shows at once, then "Show more" for the rest. */
export const BRAIN_COPY_VIEW_CHARS = 30_000;

/** "Showing 20,000 of 412,000 characters." for a long text. */
export function shownOfText(shown: number, total: number): string {
  return `Showing ${formatCount(shown)} of ${formatCount(total)} characters.`;
}
