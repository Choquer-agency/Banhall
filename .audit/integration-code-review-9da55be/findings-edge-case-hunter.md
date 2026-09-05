[
  {
    "location": "convex/reportEditDistance.ts:118-122",
    "trigger_condition": "Report changes or ownership transfers between publication and its scheduled PED callback",
    "guard_snippet": "await recordReportEditDistance(ctx, report, 'client_publish'); // inside the publishing transaction",
    "potential_consequence": "Publication telemetry records a later revision or owner; queued publications can collapse into one reading"
  },
  {
    "location": "convex/projectWorkflow.ts:404-410",
    "trigger_condition": "Another writer edits the report after the reviewer reads it but before submitting",
    "guard_snippet": "assertReportRef(reviewedReport, args.reviewDecision.expectedReportRef);",
    "potential_consequence": "Approval is attributed to an unseen revision because report edits do not advance workflowVersion"
  },
  {
    "location": "convex/projects.ts:919-934",
    "trigger_condition": "A report with methodology blockers is duplicated and published without changing its content",
    "guard_snippet": "await copyMethodologyFindingsForIdenticalContent(ctx, sourceReport._id, reportId, contentHash);",
    "potential_consequence": "Duplication drops substantive blockers and permits publishing the same failed report bytes"
  },
  {
    "location": "scripts/loop-parallel.py:169-171",
    "trigger_condition": "The launcher runs again while an existing lane contains unfinished work",
    "guard_snippet": "if wt.exists() or branch_exists(branch): raise SystemExit('Existing lane requires explicit recovery')",
    "potential_consequence": "Forced worktree removal destroys uncommitted edits and branch reset discards the previous lane tip"
  },
  {
    "location": "scripts/loop-parallel.py:187-200",
    "trigger_condition": "A lane exits unsuccessfully or pauses before native verification and review finish",
    "guard_snippet": "if rc != 0 or native_status(wt) != 'complete': raise SystemExit('Lane incomplete')",
    "potential_consequence": "The collector merges incomplete or failed lane commits into the collection branch"
  },
  {
    "location": "scripts/loop-parallel.py:142-171",
    "trigger_condition": "The supplied --base differs from the currently checked-out branch",
    "guard_snippet": "if git('rev-parse', 'HEAD') != git('rev-parse', base): raise SystemExit('Checkout base first')",
    "potential_consequence": "Lanes inherit unrelated current-branch commits and subsequently merge them into the requested base"
  }
]
