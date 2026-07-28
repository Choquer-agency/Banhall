# PSOS-06 manual verification — review-mode contextual research

Use installed Google Chrome, not Playwright. Run against development first and repeat the non-destructive smoke in production after deployment.

## Approved scope

Contextual research remains scoped to an editable `reports` row. In review mode, the uploaded PD is private project evidence for research started from the generated comparison report. Direct selection/research on the immutable source upload is deferred until PSOS-18/19 can represent it as an imported report branch.

The public `/review/[shareToken]` client-comment route must never expose internal research controls.

## Preconditions

1. Sign in as an internal user with access to a review-mode project.
2. The project has:
   - an active uploaded PD (`projectDocuments.source === "review_pd"`);
   - an interview transcript;
   - a generated comparison selected into an editable report.
3. Open Chrome with remote debugging enabled so URL, visible copy, and console/resource failures can be captured.

## Matrix

### A. Generated-report control

1. Open a normal generated-report project.
2. Select non-empty report text.
3. Confirm **Research this selection** appears in the selection toolbar.
4. Activate it by keyboard and confirm the chat rail opens with a **Research:** selection pill.
5. Enter a research direction and start it.
6. Reload after the request appears.

Expected:
- The session remains listed under the same report.
- No raw provider or Convex error is shown.
- The research control and send target are keyboard reachable and at least 44×44 CSS pixels on mobile.

### B. Review mode before comparison generation

1. Open a review-mode project that has an uploaded PD but no generated report.
2. Inspect the AI PD review surface.

Expected:
- Review feedback is visible.
- No direct research control is offered on the source upload under the approved scope.
- **Generate PD for comparison** is the next relevant action when a transcript exists.

### C. Review mode after comparison generation

1. Generate/select a comparison report for the same review-mode project.
2. Select text in the editable generated report.
3. Activate **Research this selection**.
4. Submit a research direction relevant to wording also present in the uploaded PD.
5. Observe the queued/running research entry, then reload.

Expected:
- The research entry is listed after revisit under that exact report.
- The uploaded PD can appear as a `project_document` evidence source in the completed result.
- External research prompts do not include the uploaded PD body or direct client/person identifiers.
- Any proposed edit targets the generated report revision, never the uploaded source document.

### D. Public client-review route

1. Open the project’s `/review/[shareToken]` URL in a signed-out Chrome profile.
2. Enter a reviewer name and select report text.

Expected:
- Comment controls work as designed.
- No contextual-research action, research history, or internal source evidence is exposed.

## Evidence to record

- Project ID and report ID used for each internal scenario.
- Research session ID for scenario C.
- Screenshot or captured visible text for the selection action and revisited feed.
- Confirmation that no provider strings, malformed resources, or authorization errors appeared.
- Backend evidence that the session’s `reportId` matches the generated report and any uploaded-PD source has `kind: "project_document"`.
