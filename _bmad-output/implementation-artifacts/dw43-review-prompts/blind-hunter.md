Conduct a review of CONTENT.
Look for what's missing, not only what's wrong.
Find at least ten issues to fix or improve.
Output a Markdown list of findings only — no severity, priority, or ranking.
If the content is empty, stop and say so.
If you have zero findings, re-check and keep thinking; do not stop with an empty list.

CONTENT:
diff --git a/src/lib/test/convex-svelte-stub.svelte.ts b/src/lib/test/convex-svelte-stub.svelte.ts
index 3e24865..5692a8c 100644
--- a/src/lib/test/convex-svelte-stub.svelte.ts
+++ b/src/lib/test/convex-svelte-stub.svelte.ts
@@ -23,6 +23,7 @@ const calls: Array<{ name: string; args: unknown }> = [];
 // on click is not a live subscription and must not count against a budget.
 const clientQueries: Array<{ name: string; args: unknown }> = [];
 const results: Record<string, unknown> = {};
+const mutationErrors = new Map<string, unknown>();
 
 // Args getters per function name (one per mounted hook instance) — lets
 // tests observe which subscriptions are live (args !== "skip") and HOW MANY
@@ -47,6 +48,10 @@ export function __setMutationResult(name: string, value: unknown) {
   results[name] = value;
 }
 
+export function __setMutationError(name: string, error: unknown) {
+  mutationErrors.set(name, error);
+}
+
 /** Args of every call to `name`, in call order. */
 export function __mutationCalls(name: string) {
   return calls.filter((call) => call.name === name).map((call) => call.args);
@@ -62,6 +67,7 @@ export function __resetConvexStub() {
   registry.pages = {};
   argsGetters.clear();
   calls.length = 0;
+  mutationErrors.clear();
   clientQueries.length = 0;
   for (const key of Object.keys(results)) delete results[key];
 }
@@ -157,6 +163,7 @@ function recordingCall(fn: unknown) {
   const name = getFunctionName(fn as FunctionReference<"mutation">);
   return async (args?: unknown) => {
     calls.push({ name, args });
+    if (mutationErrors.has(name)) throw mutationErrors.get(name);
     return results[name];
   };
 }
diff --git a/_bmad-output/implementation-artifacts/spec-dw43-review-menu-verification.md b/_bmad-output/implementation-artifacts/spec-dw43-review-menu-verification.md
new file mode 100644
index 0000000..f21abb0
--- /dev/null
+++ b/_bmad-output/implementation-artifacts/spec-dw43-review-menu-verification.md
@@ -0,0 +1,66 @@
+---
+title: 'DW-43: Verify production review menu submission'
+type: 'chore'
+created: '2026-09-04'
+status: 'in-review'
+baseline_commit: '9da55bece5948da12129720dd2330a3032c985bf'
+review_loop_iteration: 0
+context:
+  - '{project-root}/docs/svelte-migration.md'
+---
+<frozen-after-approval reason="human-owned intent">
+## Intent
+**Problem:** Backend tests construct their own reviewDecision arguments. Existing ProjectHighlights tests mount drafting without submitting the production ProjectWorkflowMenu. Removing the production decision spread leaves tests green but prevents users returning internal review to edits.
+**Approach:** Execute the real menu and StageChangeDialog in Chromium with the existing Convex browser stub. Pin mutation payloads and visible success/error outcomes. This is component/runtime verification with mocked transport, not a live-backend end-to-end claim.
+
+## Boundaries & Constraints
+**Always:** Use the existing workflow contract, permission-driven options and rendered controls. Retain raw verification and mutation-sensitivity evidence. Install owned dependencies with npm ci. Run full component suite, check, and existing relevant backend tests. Keep production behavior unchanged.
+**Ask First:** A discovered need to change review policy or production APIs.
+**Never:** Change review decision APIs, revision pinning (DW-44), generated Convex files, production UI intent, native state, ledger, other checkouts, push or deploy.
+
+## I/O & Edge-Case Matrix
+| Scenario | Input / State | Expected Output / Behavior | Error Handling |
+|---|---|---|---|
+| Return for edits | Internal review with owner authority, workflow version 7; user opens menu and dialog, selects Edits, enters audit note and submits | Exactly one setWorkflowStage call with projectId, edits, normalized note, expectedVersion 7, reviewDecision return; dialog closes on updated response | No error |
+| Unrelated destination | Internal review to Drafting | Submission omits reviewDecision; normal successful close | Unchanged |
+| Unrelated source | Drafting to Edits | Submission omits reviewDecision despite edits destination; normal successful close | Unchanged |
+| Server rejection | Return for edits rejects with typed domain error | Dialog remains visible, error text and note retained; no false success | Existing error display |
+</frozen-after-approval>
+
+## Code Map
+- src/lib/components/project/ProjectWorkflowMenu.svelte:282: submitStage derives reviewDecision from source and destination then passes expectedVersion from baseline. Mount this real component or its real ProjectHighlights parent; never call a copied helper instead.
+- src/lib/components/project/ProjectHighlights.component.test.ts: existing browser mount and query seeding.
+- src/lib/components/project/StageChangeDialog.component.test.ts: real bits-ui dialog controls and audit note interactions.
+- src/lib/test/convex-svelte-stub.svelte.ts: reusable reactive query registry, mutation capture, configurable results. Add only narrowly necessary rejection support if existing Promise rejection fixtures suffice poorly; isolate errors and reset them with existing registry.
+- src/lib/test/component-setup.ts and vitest.component.config.ts: installed runtime aliases, Chromium setup, serial component suite. Preserve these configurations.
+- shared/workflowTransitions.ts and shared/workflowLabels.ts: canonical source/destination and authority policy; do not copy their calculation into test expectations.
+- docs/product-domain.md:1560: approved decision amendment and unchanged unrelated edges.
+- _bmad-output/specs/spec-ai-engine-sprint-2-boundary/stories/7-review-decisions-required-to-leave-internal-review.md: original contract and production caller gap.
+- convex/projectWorkflow.test.ts: existing real mutation tests cover recording and rejection. These are complementary to the browser test, not proof of a deployed backend.
+
+## Tasks & Acceptance
+**Execution:**
+- [x] src/lib/components/project/ProjectWorkflowMenu.component.test.ts: add meaningful real menu browser interactions for matrix rows, using existing test transport and accessible selectors.
+- [x] src/lib/test/convex-svelte-stub.svelte.ts: only if needed, support controlled mutation failure with reset isolation.
+- [x] .audit/dw43-review-menu-verification/: retain before/after sensitivity logs and commands proving verification; evidence explicitly distinguishes mocked transport from backend tests.
+**Acceptance Criteria:**
+- Given the baseline production spread is temporarily removed, when the new return test executes, then it fails specifically because reviewDecision is absent; restore production byte-for-byte and rerun successfully.
+- Given normal production code, when the full component suite and check and relevant backend suite run, then all required checks pass.
+- Given completion, when reviewing the diff, then only tests/support and work evidence/spec changed.
+
+## Spec Change Log
+
+## Verification
+- npm ci: install this checkout's own lockfile dependencies, do not symlink dependencies.
+- npm run test:component: full required local browser suite.
+- PUBLIC_CONVEX_URL=http://localhost npm run check: zero errors.
+- npx vitest run --project convex convex/projectWorkflow.test.ts convex/dashboardStageCounts.test.ts convex/workItems.test.ts: existing mutation contracts pass.
+- Mutation sensitivity: temporarily remove production reviewDecision spread, run targeted browser test to retain expected failure, restore exactly, targeted test passes.
+
+## Implementation verification
+- Full component suite: 53 files, 315 tests pass.
+- Full npm test: 148 files, 1730 tests pass on restored production source.
+- Svelte check: zero errors and warnings.
+- Existing workflow backend subset: 3 files, 59 tests pass.
+- Production menu byte-for-byte unchanged; git diff --check passes.
+- Review status: REVIEW-PENDING. All three layers must be launched and returned before triage. Root coordinates available slots; no final commit yet.
diff --git a/src/lib/components/project/ProjectWorkflowMenu.component.test.ts b/src/lib/components/project/ProjectWorkflowMenu.component.test.ts
new file mode 100644
index 0000000..799dd7a
--- /dev/null
+++ b/src/lib/components/project/ProjectWorkflowMenu.component.test.ts
@@ -0,0 +1,110 @@
+import { beforeEach, describe, expect, it } from "vitest";
+import { render } from "vitest-browser-svelte";
+import { page } from "vitest/browser";
+import { ConvexError } from "convex/values";
+import ProjectWorkflowMenu from "./ProjectWorkflowMenu.svelte";
+import {
+  __mutationCalls,
+  __resetConvexStub,
+  __setMutationError,
+  __setMutationResult,
+  __setQueryData,
+} from "$lib/test/convex-svelte-stub.svelte";
+
+const mutation = "projectWorkflow:setWorkflowStage";
+
+// Real menu/dialog and browser interactions; only Convex transport is stubbed.
+// Persistence/atomicity remain covered by convex/projectWorkflow.test.ts.
+async function openStageChange(stage: "internal_review" | "drafting" = "internal_review") {
+  __setQueryData("projectWorkflow:getProjectWorkflowHeader", {
+    workflowStage: stage,
+    workflowUpdatedAt: 1,
+    owner: { initials: "DW", label: "Demo Writer" },
+    ownerNeedsReview: false,
+    stageIsFallback: false,
+    workflowVersion: 7,
+    viewerAuthorities: ["owner"],
+  });
+  __setQueryData("workItems:getProjectWorkPanel", {
+    currentHandoffId: null,
+    openItems: [],
+    viewer: { canCreate: true, canCreateFinancial: false },
+    assignable: true,
+    assignableReason: null,
+    pointerHealthy: true,
+    truncated: false,
+  });
+  __setMutationResult(mutation, { status: "updated", version: 8 });
+  await render(ProjectWorkflowMenu, { projectId: "project-1" as never });
+  await page.getByRole("button", { name: "Workflow details", exact: true }).click();
+  await page.getByRole("button", { name: /Status.*Change/ }).click();
+  await expect.element(page.getByRole("dialog")).toBeVisible();
+}
+
+describe("ProjectWorkflowMenu production stage submission", () => {
+  beforeEach(() => {
+    __resetConvexStub();
+    document.body.innerHTML = "";
+  });
+
+  it("returns internal review for edits with its decision, audit note and workflow version", async () => {
+    await openStageChange();
+    await page.getByRole("radio", { name: /^Edits/ }).click();
+    await page.getByRole("textbox", { name: "Audit note" }).fill("  Clarify the uncertainty evidence.  ");
+    await page.getByRole("button", { name: "Change stage", exact: true }).click();
+
+    await expect.poll(() => __mutationCalls(mutation)).toEqual([{
+      projectId: "project-1",
+      toStage: "edits",
+      note: "Clarify the uncertainty evidence.",
+      expectedVersion: 7,
+      reviewDecision: { decision: "return" },
+    }]);
+    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
+    await expect.element(page.getByRole("button", { name: "Workflow details", exact: true })).toBeVisible();
+  });
+
+  it.each([
+    { source: "internal_review", destination: "drafting", label: /^Drafting/ },
+    { source: "drafting", destination: "edits", label: /^Edits/ },
+  ] as const)("omits reviewDecision from $source to $destination", async ({ source, destination, label }) => {
+    await openStageChange(source);
+    await page.getByRole("radio", { name: label }).click();
+    await page.getByRole("button", { name: "Change stage", exact: true }).click();
+
+    await expect.poll(() => __mutationCalls(mutation)).toEqual([{
+      projectId: "project-1",
+      toStage: destination,
+      note: undefined,
+      expectedVersion: 7,
+    }]);
+    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
+  });
+
+  it("keeps a rejected review return open with its note and server explanation", async () => {
+    await openStageChange();
+    __setMutationError(mutation, new ConvexError({
+      code: "INVALID_STATE",
+      message: "There is no report revision to record a review decision against.",
+    }));
+    await page.getByRole("radio", { name: /^Edits/ }).click();
+    await page.getByRole("textbox", { name: "Audit note" }).fill("Clarify the uncertainty evidence.");
+    await page.getByRole("button", { name: "Change stage", exact: true }).click();
+
+    await expect.element(page.getByRole("alert")).toHaveTextContent(
+      "There is no report revision to record a review decision against."
+    );
+    await expect.element(page.getByRole("dialog")).toBeVisible();
+    await expect.element(page.getByRole("textbox", { name: "Audit note" })).toHaveValue(
+      "Clarify the uncertainty evidence."
+    );
+    await expect.element(page.getByRole("button", { name: "Change stage", exact: true })).toBeEnabled();
+    expect(__mutationCalls(mutation)).toEqual([{
+      projectId: "project-1",
+      toStage: "edits",
+      note: "Clarify the uncertainty evidence.",
+      expectedVersion: 7,
+      reviewDecision: { decision: "return" },
+    }]);
+  });
+});


Do not invoke any skill. Return only the review result.
