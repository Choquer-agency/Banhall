/**
 * The placeholder map for a project's transcripts (owner decision 26). Names
 * come from the project record (client, interviewer, writer, interviewees)
 * and from the speaker labels of the given transcripts, in that order, so the
 * same inputs always give the same map.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { avoidTokenCollisions, buildPlaceholderMap, type PlaceholderMap } from "./deidentify";
import { listSpeakerRows } from "./transcriptStructure";

type Ctx = QueryCtx | MutationCtx;

/**
 * `texts` are what the calls using this map will send (transcripts,
 * documents, sample lines): a text that already holds placeholder-style
 * tokens gets a renumbered map, so restoring never turns them into names
 * (`avoidTokenCollisions`).
 */
export async function projectPlaceholderMap(
  ctx: Ctx,
  project: Doc<"projects">,
  transcriptIds: readonly Id<"transcripts">[],
  texts: readonly string[] = []
): Promise<PlaceholderMap> {
  const labels: string[] = [];
  for (const transcriptId of transcriptIds) {
    for (const row of await listSpeakerRows(ctx, transcriptId)) labels.push(row.label);
  }
  const map = buildPlaceholderMap({
    clientName: project.clientName,
    people: [project.interviewer, project.writer, ...(project.interviewees ?? []), ...labels],
  });
  return avoidTokenCollisions(map, [...texts, ...labels]);
}
