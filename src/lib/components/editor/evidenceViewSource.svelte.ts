/**
 * The report page's side of the Evidence view (client request 2026-11-02):
 * the person's remembered choice, and the revision's claim record, read
 * only while the view is on. Call during component setup.
 */
import { useQuery } from "convex-svelte";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { EvidenceClaim } from "./evidenceView";
import { loadEvidenceViewPreference, saveEvidenceViewPreference } from "./evidenceViewPreference";

export function useEvidenceView(source: () => { reportId: Id<"reports"> | undefined; userId: string | undefined }) {
  let on = $state(false);
  let loadedFor: string | undefined;
  $effect(() => {
    const { userId } = source();
    if (!userId || userId === loadedFor) return;
    loadedFor = userId;
    on = loadEvidenceViewPreference(userId);
  });

  const provenanceQ = useQuery(api.reports.getProvenance, () => {
    const { reportId } = source();
    return on && reportId ? { reportId } : "skip";
  });

  /** The claim record: undefined while it loads, null when this revision has none. */
  const claims = $derived.by((): readonly EvidenceClaim[] | null | undefined => {
    const data = provenanceQ.data;
    if (data === undefined) return undefined;
    if (data === null || data.status === "unavailable_legacy") return null;
    return data.claims;
  });

  return {
    get on() {
      return on;
    },
    get claims() {
      return claims;
    },
    set(next: boolean) {
      on = next;
      saveEvidenceViewPreference(source().userId, next);
    },
  };
}
