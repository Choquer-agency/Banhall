/**
 * The placeholder map for a project's transcripts (owner decision 26). Names
 * come from the project record (client, interviewer, writer, interviewees)
 * and from the speaker labels of the given transcripts, in that order, so the
 * same inputs always give the same map.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { buildPlaceholderMap, type PlaceholderMap } from "./deidentify";
import { listSpeakerRows } from "./transcriptStructure";

type Ctx = QueryCtx | MutationCtx;

export async function projectPlaceholderMap(
  ctx: Ctx,
  project: Doc<"projects">,
  transcriptIds: readonly Id<"transcripts">[]
): Promise<PlaceholderMap> {
  const labels: string[] = [];
  for (const transcriptId of transcriptIds) {
    for (const row of await listSpeakerRows(ctx, transcriptId)) labels.push(row.label);
  }
  return buildPlaceholderMap({
    clientName: project.clientName,
    people: [project.interviewer, project.writer, ...(project.interviewees ?? []), ...labels],
  });
}
