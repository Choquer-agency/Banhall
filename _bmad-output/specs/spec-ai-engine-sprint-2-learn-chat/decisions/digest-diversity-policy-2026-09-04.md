# Approved digest diversity policy

Human decision recorded on 2026-09-04 for CAP-4, native run `20260904-133944-0158`, story `4`. This companion carries the approved intent and acceptance examples for fresh native planning. It is not an implementation spec and has no workflow status. The original blocked story and resolution evidence are preserved outside the disposable worker.

## Intent

**Problem:** Firm-wide learning currently admits one writer's feedback from one project and stores only an aggregate source count. Administrators cannot inspect the exact signals or each producer's contribution.

**Approach:** Include only source streams whose eligible records contain at least two distinct writers and two distinct projects, evaluated separately for each stream. Omit failing streams without blocking qualifying streams. Generate an unpublished QA calibration or drafting-style candidate only when at least five eligible records remain overall and the existing freshness and other safeguards pass. Persist exact admitted signal IDs and per-producer counts on learningDigests; show these and exclusion counts and reasons on the admin reviews page.

## Boundaries & Constraints

**Always:** Preserve meaningful-signal filters, the five-row aggregate minimum, freshness deduplication, immutable candidates, administrator publication, privacy review, and personal-digest isolation. Read CAP-4 in touchpoints.md. Attribute feedback to its producer, never projects.createdBy or the administrator approving feedback. Keep client identifiers out of firm-wide prompt content.

**Approved admission rule (human decision, 2026-09-04):**
1. Apply the existing eligibility and meaningful-signal filters. Exclude records lacking writer or project attribution before evaluating diversity. Do not invent attribution or count a missing-value placeholder as a distinct writer or project. This applies to projectless admin-approved feedback and unattributed legacy records as well as other streams; approval is not a diversity exemption.
2. Evaluate each stream independently. Include a stream only if its remaining records span at least two distinct writers and two distinct projects. Omit underdiverse or empty streams; they cannot veto other qualifying streams. Never pool writers or projects across individually failing streams to make either pass.
3. Count only the records in included streams toward the five-record aggregate minimum. Five is not a per-stream minimum. If fewer than five records remain, or no stream qualifies, skip generation without calling the model or saving a candidate. For QA's single stream, failing diversity necessarily means no candidate.
4. Build the model input, aggregate sourceCount, exact signal IDs, per-producer counts and freshness cutoff from the same admitted records. Omitted records must not influence the prompt or advance the cutoff; a change confined to omitted records must not trigger redistillation of unchanged admitted input. Preserve the existing freshness semantics otherwise. Keep provenance metadata separate from the prompt's prose payload.
5. Keep excluded source records intact and show exclusion counts and reasons to admins alongside the candidate's admitted provenance, including missing writer, missing project and insufficient stream diversity. When a run cannot produce a candidate, keep its exclusion explanation available to admins without fabricating a learning candidate. Present historical records without recorded provenance/exclusions as unavailable rather than inventing metadata.
6. Save an immutable, unpublished candidate only if distillation produces supported rules. The currently selected guidance remains unchanged until a separate authorized admin review and publication with the existing privacy confirmation. Preserve personal-digest isolation and all other existing safeguards.

**Never:** Auto-publish guidance, mutate report prose, hand-edit generated APIs, change project authority, or edit the parallel boundary epic's forbidden files.

## Acceptance examples

- Given feedback from one writer across two projects, when either digest generator runs, then it cannot save a digest from that stream.
- Given feedback from two writers on one project, when either generator runs, then it cannot save a digest from that stream.
- Given admitted diverse inputs, when a digest is saved and an administrator views its history, then exact signal IDs and per-producer counts are available.
- Given a published digest, when a new candidate is generated, then publication remains unchanged until administrator selection.
- Given six eligible comments from two writers and two projects plus one underdiverse section edit, when the freshness gate passes, then distillation may use the six comments only; the excluded edit affects neither prompt, admitted provenance, sourceCount nor cutoff.
- Given four qualifying records plus any number of records in failing streams, when generation runs, then no model call or candidate occurs because the admitted aggregate remains below five.
- Given two independently qualifying streams containing five eligible records in total, when the other safeguards pass, then generation may proceed; neither stream needs five records of its own.
- Given individually failing streams whose pooled writers/projects would meet the threshold, when evaluated, then both streams remain excluded.
- Given records without writer or project attribution, including admin-approved general feedback or legacy section edits, when evaluating a stream, then those records are excluded before diversity and aggregate counting; no reviewer, project creator or placeholder supplies missing attribution.
- Given only omitted records are newer than the prior candidate, when generation runs, then they do not advance the admitted cutoff or cause another model call for unchanged admitted input.
- Given a candidate or a skipped generation, when an admin reviews its available admission information, then excluded record counts and reasons are visible; original source records are preserved and a skipped generation does not fabricate a candidate.
- Given provenance metadata is retained internally, when a provider request is assembled, then attribution IDs and omitted records are absent from the model payload.
- Given legacy digest metadata is absent, when the history is rendered, then the UI reports unavailable metadata without fabricated counts or identities.
