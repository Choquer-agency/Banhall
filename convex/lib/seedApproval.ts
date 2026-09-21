import { matchesClaimExclusion } from "./claimExclusionMatcher";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { PD_SUBSECTIONS, type PdSubsectionRoleId } from "../../shared/pdSubsections";
import { domainError } from "./contracts";
import { SEED_DECISION_COLLECTION_ROWS, materializeActiveSelections, materializeCompleteDecisionSnapshot, type SeedDecisionState } from "./seedDecisionState";
import { completeContributionHashes, contributionHashesFromRows, explainChange, materializeFinalWording, sha256Text, stableSerialize } from "./seedRevisions";

type Ctx = Pick<QueryCtx | MutationCtx, "db">;
export type SeedApprovalChallenge = {
  approvalChallenge: string;
  carriedSeedIds: Id<"seeds">[];
  exclusionEntryIds: Id<"generationBriefEntries">[];
  changedRoleIds: PdSubsectionRoleId[];
  shownBatchOutdated: boolean;
  exclusions: Array<{ entryId: Id<"generationBriefEntries">; text: string; seedIds: Id<"seeds">[] }>;
  contributionHashes: Array<{ roleId: PdSubsectionRoleId; contributionHash: string }>;
};
function processingLimit(roleId: PdSubsectionRoleId): never {
  domainError("INVALID_INPUT", `Seed approval for ${roleId} exceeds the read budget`, { reason: "SEED_PROCESSING_LIMIT" });
}
export const matchesSeedExclusion = matchesClaimExclusion;
export function seedBatchIsOutdated(state: SeedDecisionState, row: Doc<"seedSubsections">, batch: Doc<"seedBatches">): boolean {
  if (batch.consumedContextRevision !== row.currentContextRevision) return true;
  if (!batch.feedbackRequestId) return false;
  const request = state.feedbackRows.find(r => r._id === batch.feedbackRequestId);
  const target = request && state.seeds.find(s => s._id === request.targetSeedId);
  const selection = request && state.selectionRows.find(s => s.seedId === request.targetSeedId);
  return !request || !target || stableSerialize(request.targetWording) !== stableSerialize(materializeFinalWording(target, selection));
}
export function unlinkedAdvancementIds(state: SeedDecisionState): Id<"seeds">[] {
  const active = materializeActiveSelections(state);
  const uncertainty = new Set(active.filter(s => s.roleId === "active_uncertainties").map(s => s.seedId));
  const experiments = new Set(active.filter(s => s.roleId === "experimentation").map(s => s.seedId));
  return state.seeds.filter(seed => active.some(s => s.seedId === seed._id) && seed.roleId === "specific_advancements" && (!seed.uncertaintySeedId || !uncertainty.has(seed.uncertaintySeedId) || !seed.experimentSeedIds?.length || seed.experimentSeedIds.some(id => !experiments.has(id)))).map(s => s._id);
}
export async function buildSeedApprovalChallenge(ctx: Ctx, state: SeedDecisionState, row: Doc<"seedSubsections">): Promise<SeedApprovalChallenge> {
  if (!state.complete) processingLimit(row.roleId);
  const active = materializeActiveSelections(state, row.roleId);
  const currentHashes = await completeContributionHashes(materializeCompleteDecisionSnapshot(state, { targetRoleId: row.roleId }));
  const selectedIds = new Set(active.map(s => s.seedId));
  const selected = state.seeds.filter(s => selectedIds.has(s._id));
  const batchIds = new Set(selected.map(s => s.batchId));
  if (row.shownBatchId) batchIds.add(row.shownBatchId);
  const changed = new Set<PdSubsectionRoleId>();
  const outdated = new Set<Id<"seedBatches">>();
  for (const batchId of batchIds) {
    const batch = state.batches.find(b => b._id === batchId);
    if (!batch || batch.generationId !== row.generationId || batch.roleId !== row.roleId) domainError("INVALID_STATE", "Approval Batch does not belong to this subsection");
    if (!seedBatchIsOutdated(state, row, batch)) continue;
    outdated.add(batchId);
    const context = await state.budget.list(ctx.db.query("seedBatchContext").withIndex("by_batchId", q => q.eq("batchId", batchId)), 129);
    if (!context.complete) processingLimit(row.roleId);
    const before = new Map(contributionHashesFromRows(context.rows));
    // An absent contribution is the same canonical empty role, not a change.
    const emptyHashes = await completeContributionHashes({ v: 1, items: [] });
    for (const role of PD_SUBSECTIONS) if (!before.has(role.roleId)) before.set(role.roleId, emptyHashes.get(role.roleId)!);
    for (const id of explainChange(before, currentHashes).changedRoleIds) changed.add(id);
    if (batch.feedbackRequestId && batch.consumedContextRevision === row.currentContextRevision) changed.add(row.roleId);
  }
  const carriedSeedIds = selected.filter(s => outdated.has(s.batchId)).map(s => s._id).sort();
  const entries = state.generation.briefVersionId ? await state.budget.list(ctx.db.query("generationBriefEntries").withIndex("by_briefId", q => q.eq("briefId", state.generation.briefVersionId!)), SEED_DECISION_COLLECTION_ROWS) : null;
  if (!entries?.complete) processingLimit(row.roleId);
  const exclusions: SeedApprovalChallenge["exclusions"] = [];
  for (const entry of entries.rows) {
    if (entry.projectId !== row.projectId) domainError("INVALID_STATE", "Brief entry belongs to another project");
    if (entry.group !== "claimExclusion" || entry.change === "removed") continue;
    const seedIds = selected.filter(seed => matchesSeedExclusion(materializeFinalWording(seed, state.selectionRows.find(s => s.seedId === seed._id)), entry.text, entry.exactExcerpt)).map(s => s._id);
    if (seedIds.length) exclusions.push({ entryId: entry._id, text: entry.text, seedIds });
  }
  const exclusionEntryIds = exclusions.map(e => e.entryId).sort();
  const changedRoleIds = PD_SUBSECTIONS.filter(r => changed.has(r.roleId)).map(r => r.roleId);
  const selectedHashes = await Promise.all(selected.sort((a,b) => a._id.localeCompare(b._id)).map(async seed => ({ seedId: seed._id, batchId: seed.batchId, wordingHash: await sha256Text(stableSerialize(materializeFinalWording(seed, state.selectionRows.find(s => s.seedId === seed._id)))) })));
  const approvalChallenge = await sha256Text(stableSerialize({ seedStageVersion: state.generation.seedStageVersion ?? 0, selected: selectedHashes, changedRoleIds, matchingExclusionEntryIds: exclusionEntryIds }));
  return { approvalChallenge, carriedSeedIds, exclusionEntryIds, changedRoleIds, shownBatchOutdated: !!row.shownBatchId && outdated.has(row.shownBatchId), exclusions, contributionHashes: [...currentHashes].map(([roleId, contributionHash]) => ({ roleId, contributionHash })) };
}
