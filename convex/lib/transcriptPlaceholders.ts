/**
 * The placeholder map for a project's transcripts (owner decision 26). Names
 * come from the project record (client, interviewer, writer, interviewees)
 * and from the speaker labels of the given transcripts, in that order, so the
 * same inputs always give the same map.
 */
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isCueRender, transcriptSpeakerNames } from "../../shared/transcriptParse";
import { avoidTokenCollisions, buildPlaceholderMap, type PlaceholderMap } from "./deidentify";
import { frozenSlice, listSpeakerRows } from "./transcriptStructure";

type Ctx = QueryCtx | MutationCtx;

/** Code-point order, the same for the same strings on every runtime. */
function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The names one transcript's speakers go by. The text is parsed here with
 * the parser and the slice the turn build uses, every time, so the names are
 * hidden whether or not that scheduled build has written the speaker rows
 * yet (a draft started right after a transcript was added, review
 * 2026-09-25). The rows' labels are added too: rows an older parser version
 * built, or a label a consultant's rows still hold, stay hidden until the
 * rebuild. Sorted, so the map is the same before and after the build.
 */
export function transcriptNamesToHide(
  transcript: Pick<Doc<"transcripts">, "content" | "sourceFormat">,
  rowLabels: readonly string[]
): { people: string[]; organizations: string[] } {
  const text = frozenSlice(transcript.content);
  const parsed = transcriptSpeakerNames(text, { cues: isCueRender(transcript.sourceFormat, text) });
  const people = new Set([...rowLabels, ...parsed.labels, ...parsed.otherNames]);
  return {
    people: [...people].sort(byCodePoint),
    organizations: [...new Set(parsed.organizations)].sort(byCodePoint),
  };
}

/**
 * `texts` are what the calls using this map will send (transcripts,
 * documents, sample lines): a text that already holds placeholder-style
 * tokens gets a renumbered map, so restoring never turns them into names
 * (`avoidTokenCollisions`).
 */
export async function projectPlaceholderMap(
  ctx: Ctx,
  project: Doc<"projects">,
  transcripts: readonly Doc<"transcripts">[],
  texts: readonly string[] = []
): Promise<PlaceholderMap> {
  const labels: string[] = [];
  const organizations: string[] = [];
  for (const transcript of transcripts) {
    const rows = await listSpeakerRows(ctx, transcript._id);
    const names = transcriptNamesToHide(
      transcript,
      rows.map((row) => row.label)
    );
    labels.push(...names.people);
    organizations.push(...names.organizations);
  }
  const map = buildPlaceholderMap({
    clientName: project.clientName,
    companies: organizations,
    people: [project.interviewer, project.writer, ...(project.interviewees ?? []), ...labels],
  });
  return avoidTokenCollisions(map, [...texts, ...labels, ...organizations]);
}
