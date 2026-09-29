import { matchesClaimExclusion } from "./claimExclusionMatcher";
import { advancementLinkProblem, experimentsForDroppedUncertainties, pickedLinkSelections, revisionRoots, type ExperimentTest } from "../../shared/advancementLinks";
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
  domainError("INVALID_INPUT", `Seed approval for ${roleId} exceeds the read budget`, {
    reason: "SEED_PROCESSING_LIMIT",
    roleId,
  });
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
/**
 * 2026-09-29 (first): the picked uncertainties and experiments, each
 * experiment with the uncertainty it tested when it records one. An
 * uncertainty and its Feedback revisions count as one (review P2-2): the
 * decision state loads every selected Seed's revision ancestors.
 */
export function pickedLinks(state: Pick<SeedDecisionState, "subsections" | "seeds" | "selectionRows">) {
  const active = materializeActiveSelections(state);
  const uncertaintySeedIds = active.filter(s => s.roleId === "active_uncertainties").map(s => s.seedId as Id<"seeds">);
  const experiments: ExperimentTest[] = active
    .filter(s => s.roleId === "experimentation")
    .map(s => ({ seedId: s.seedId, uncertaintySeedId: s.uncertaintySeedId ?? null }));
  const rootOf = revisionRoots(state.seeds.map(seed => ({ seedId: seed._id, revisionOfSeedId: seed.revisionOfSeedId ?? null })));
  return { active, uncertaintySeedIds, experiments, rootOf, picked: pickedLinkSelections(uncertaintySeedIds, experiments, rootOf) };
}
/**
 * Selected advancements that are not linked: a picked uncertainty and picked
 * experiments that tested it (2026-09-29 first; an experiment recording no
 * uncertainty supports any, as before).
 */
export function unlinkedAdvancementIds(state: SeedDecisionState): Id<"seeds">[] {
  const { active, picked } = pickedLinks(state);
  const selected = new Set(active.filter(s => s.roleId === "specific_advancements").map(s => s.seedId));
  return state.seeds.filter(seed => selected.has(seed._id) && seed.roleId === "specific_advancements" && advancementLinkProblem(seed, picked) !== null).map(s => s._id);
}
/**
 * 2026-09-29 (first): selected experiments that tested an uncertainty the
 * writer no longer has picked. Approval of Subsection 9 and readiness refuse
 * them; an experiment recording no uncertainty is never one of them.
 */
export function droppedUncertaintyExperimentIds(state: SeedDecisionState): Id<"seeds">[] {
  const { uncertaintySeedIds, experiments, rootOf } = pickedLinks(state);
  return experimentsForDroppedUncertainties(new Set<string>(uncertaintySeedIds), experiments, rootOf).map(e => e.seedId as Id<"seeds">);
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
