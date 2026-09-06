# B3 shared-storage deletion triage

**Conclusion: real pre-existing API-level data-integrity defect, suitable for bounded native deferral; not introduced by B3.** The standard bundled UI sends fresh storage uploads, so this is not evidence of an ordinary UI incident. However, a permitted caller can reach the destructive branch using valid public API arguments and existing document IDs, without corrupting the database or inventing a shared-storage fixture. This is a static reachability finding, not an executed reproduction.

## Concrete reachable sequence

Use one existing project and an authenticated non-anonymous user with an internal role. Obtain two storage IDs S1 and S2 through `documents.generateUploadUrl` and successful byte uploads. Call public `uploadDocument` to create A (`a.txt`, nonblank content A, S1) and B (`b.txt`, nonblank content B, S2). Now call the same public mutation with A's name/content and S2. All argument validators and project-access checks pass. A is selected as duplicate; A has S1, S1 differs from S2, so `ctx.storage.delete(S2)` executes. The function returns A's ID while B still points at the deleted S2. Neither cross-project access nor two rows sharing an ID beforehand is required. Caller already knows S2 from its own upload response.

`convex/documents.ts:44-66` registers a public mutation, accepts optional `v.id("_storage")`, and authorizes project access. No association, freshness, or exclusive-ownership validation follows. Lines 90-95 select by name/content, 103-112 delete the supplied differing storage ID, and 137-155 show the ordinary insert that creates B. `convex/lib/auth.ts:45-64` checks active internal eligibility and project existence; it does not constrain storage IDs. The generated Convex guidelines' Function registration section confirms `mutation` is publicly callable, not an internal-only helper. Optional reportId and attemptKey can be omitted. List rendering continues deriving `hasFile` from B's stored ID and calls `storage.getUrl` at documents.ts:198-200; the storage guidelines say missing-file URLs are null.

## Actual callers and contract boundaries

The standard callers support the “fresh original” assumption but do not enforce it at the API boundary:

- Project wizard: `src/routes/project/new/+page.svelte:482-491` uploads bytes and returns storageId; 646-655 passes it to uploadDocument. Pasted-note calls omit storageId (693-720).
- Chat: `src/lib/components/chat/AgentChatPanel.svelte:794-803` obtains a fresh ID, 821-834 supplies it.
- File replacement: `src/lib/components/editor/FilesPanel.svelte:256-264` uploads original bytes, 281-290 supplies the returned ID.
- PD review upload: `src/lib/components/review-pd/PdReviewStart.svelte:67-85` follows the same flow.

No inspected normal caller deliberately reuses another document's ID. Project/review copying also does not justify assuming shared IDs are normal: `convex/projectDuplication.ts:25-30,49-61,73-77` explicitly clones bytes to new IDs so deletion cannot break the other copy; `convex/projects.ts:849-875` initially inserts copied rows without storageId. Domain contract `docs/product-domain.md:404-430` requires supporting documents and original bytes to be copied into review projects and keeps lifecycles independent. It does not grant this cleanup permission to delete another document's bytes. The issue is failure to establish that supplied bytes are actually orphaned, not a request for a new role or permission policy.

## Baseline and test evidence

B3's current diff is only 8 added / 5 removed lines gating the existingDocs collect by nonblank content. The complete `if (dup)` branch through its return is byte-identical to HEAD. Nonblank inputs take the same collect/find/cleanup path before and after B3; blank inputs do not select dup in either version.

The present orphan-cleanup regression in `convex/documents.test.ts:210-237` creates a genuinely unreferenced second blob, calls dedupe, and asserts original bytes survive while orphan metadata/URL disappear. It does not attach the second blob to B. That test preserves legitimate cleanup behavior; it neither proves nor disproves safe deletion of a referenced blob.

A deferred proof can use the three registered mutation calls above with supported convex-test storage and assert B's bytes survive dedupe. This report does not implement a fix, prescribe a new permission model, or widen B3. Parent can register the pre-existing defect separately and retain the current blank-content optimization scope.

## Receipt and limitations

HEAD: 0d481e2b76390e0eff3208d91f1f47d83b173474
Current documents.ts SHA256: a2efac59f3d8644b6778e3323112babd921ed35e19c34ef68d1eb0c7bb755753
HEAD documents.ts SHA256: 3ab18a85774fc3bcdd44d68d680831ade83cbc15b1b08ea06c3c214167c8eab9
Identical dedupe branch SHA256: 1bd19a2bde4a2bb108895e9b090c9294cd7a94aedffa1cb41c1233018af90fff

Only this report was written. No tests, product edits, staging, remote operations or other-worktree inspection. No production occurrence, malicious usage, or exhaustive storage-ownership audit is claimed.
