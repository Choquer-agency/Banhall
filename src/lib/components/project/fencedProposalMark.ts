/**
 * Client sequencing for the one-by-one replace flow's "mark applied" step
 * (audit CAP-2). Shared by CurrentProjectPage and PreviewProjectPage so the
 * fence logic cannot drift between them.
 *
 * Order matters: the editor autosave must be flushed first so the server
 * already holds the accepted replacements, then the mark is queued on the
 * page's save chain (`then(fn, fn)`, the same shape as autosave, so a rejected
 * earlier save does not block it). The fence revision is read via
 * `getRevision()` inside the chained callback, not from the flush result, so
 * an autosave queued on the chain between the flush and the mark still lands
 * first and the mark fences on the latest revision. Finally the returned
 * revision is adopted as the page's local revision so the next autosave is
 * fenced against the bumped report.
 *
 * The chain installed on the page is the *settled* form of the mark: a
 * rejected mark (e.g. STALE_REVISION) is reported once through `onError` and
 * must not leave `saveChain` rejected, because `flushEditor()` awaits the
 * chain bare and would otherwise rethrow the stale mark error on every later
 * apply/snapshot until the next autosave replaced the chain.
 */
export type FencedMarkDeps = {
  flushEditor: () => Promise<unknown>;
  getChain: () => Promise<unknown>;
  setChain: (chain: Promise<unknown>) => void;
  getRevision: () => number;
  setRevision: (rev: number) => void;
  mark: (expectedRevisionNumber: number) => Promise<{ revisionNumber: number }>;
  onError: (err: unknown) => void;
};

const noop = () => {};

export async function runFencedProposalMark(deps: FencedMarkDeps): Promise<void> {
  try {
    await deps.flushEditor();
  } catch (err) {
    deps.onError(err);
    return;
  }
  const mark = async () => {
    const result = await deps.mark(deps.getRevision());
    deps.setRevision(result.revisionNumber);
  };
  const chain = deps.getChain().then(mark, mark);
  deps.setChain(chain.then(noop, noop));
  try {
    await chain;
  } catch (err) {
    deps.onError(err);
  }
}
