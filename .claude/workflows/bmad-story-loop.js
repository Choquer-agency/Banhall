export const meta = {
  name: 'bmad-story-loop',
  description: 'Unattended BMAD build loop, orchestrator-spawned stages: plan → implement → 4 parallel reviewers → triage/patch/commit per story; then verify, headless retro, course-correct',
  phases: [
    { title: 'Plan', detail: 'build-auto steps 01-02, halt after planning' },
    { title: 'Implement', detail: 'fresh agent implements the story spec and runs its Verification' },
    { title: 'Review', detail: 'blind-hunter, edge-case-hunter, verification-gap, intent-alignment in parallel' },
    { title: 'Triage', detail: 'classify, patch, defer, finalize, commit; bad_spec loops back' },
    { title: 'Verify', detail: 'svelte-check + vitest over the worktree' },
    { title: 'Retro', detail: 'bmad-retrospective -H' },
    { title: 'Course-correct', detail: 'memlog, SPEC.md, audit doc, AGENTS.md pitfalls' },
  ],
}

const { worktree, specFolder, storyIds, epicLabel, date, maxReviewLoops } = args
const WT = worktree
const SPEC = `${WT}/${specFolder}`
const RENDER_CMD = `cd ${WT} && uv run --no-cache "${WT}/_bmad/scripts/render_skill.py" --project-root "${WT}" --skill "${WT}/.claude/skills/bmad-build-auto"`

const common = `
ENVIRONMENT
- All work happens in the git worktree at ${WT} (branch bmad-loop). Every Bash call must start with: cd ${WT} && ...
- Never touch /Users/johnnynguyen/Documents/Repos/Banhall (the primary checkout). Never git push. Never git stash/reset/checkout away other people's changes.
- You have NO subagent tool. Wherever a BMAD step says "launch a subagent", do that work yourself in this context. Never wait for notifications.
- Project rules: ${WT}/AGENTS.md (read first). Convex rules: ${WT}/convex/_generated/ai/guidelines.md.
- Tests: cd ${WT} && npm test -- <pattern>   Typecheck: cd ${WT} && npm run check
- Commit messages: Conventional Commits; end every commit body with:
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SGrLqGxUB1wUP5Vo3p5rww
- Story spec files live at ${SPEC}/stories/<id>-*.md. Frontmatter status values: draft, ready-for-dev, in-progress, in-review, done, blocked.
`

const PLAN_SCHEMA = { type: 'object', properties: { storyId: { type: 'string' }, specFile: { type: 'string' }, status: { type: 'string', enum: ['ready-for-dev', 'blocked'] }, blockingCondition: { type: 'string' }, summary: { type: 'string' } }, required: ['storyId', 'status', 'summary'] }
const IMPL_SCHEMA = { type: 'object', properties: { status: { type: 'string', enum: ['implemented', 'blocked'] }, baselineRevision: { type: 'string' }, blockingCondition: { type: 'string' }, filesChanged: { type: 'array', items: { type: 'string' } }, verification: { type: 'string' }, summary: { type: 'string' } }, required: ['status', 'summary'] }
const REVIEW_SCHEMA = { type: 'object', properties: { lens: { type: 'string' }, findings: { type: 'string' } }, required: ['lens', 'findings'] }
const TRIAGE_SCHEMA = { type: 'object', properties: { outcome: { type: 'string', enum: ['done', 'bad_spec', 'intent_gap', 'blocked'] }, blockingCondition: { type: 'string' }, commits: { type: 'array', items: { type: 'string' } }, patched: { type: 'number' }, deferred: { type: 'number' }, rejected: { type: 'number' }, followupReviewRecommended: { type: 'boolean' }, summary: { type: 'string' } }, required: ['outcome', 'summary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checkPassed: { type: 'boolean' }, testPassed: { type: 'boolean' }, failures: { type: 'array', items: { type: 'string' } }, fixCommits: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } }, required: ['checkPassed', 'testPassed', 'summary'] }
const TEXT_SCHEMA = { type: 'object', properties: { path: { type: 'string' }, summary: { type: 'string' }, commit: { type: 'string' } }, required: ['summary'] }

function planPrompt(id) {
  return `You are the PLANNING stage of an unattended BMAD build loop for one story.
${common}
1. Run exactly once: ${RENDER_CMD}
   It prints one absolute workflow.md path. Read it, then follow step-01-clarify-and-route.md and step-02-plan.md only.
2. Dispatch is FOLDER+ID: spec_folder = ${SPEC}, story_id = "${id}". Invocation intent: "Implement story ${id} from ${SPEC}/stories.yaml. Halt after planning." Append the entry's invoke_dev_with text as planning context.
3. Special case: if ${SPEC}/stories/${id}-*.md already exists with status blocked and its Auto Run Result says blocking condition "no subagents", the plan is valid: set frontmatter status to ready-for-dev, remove the "## Auto Run Result" section, and return without re-planning. If it exists with status done, return status ready-for-dev=false → report blocked with blockingCondition "already done". If it exists with status draft, resume planning per step-02.
4. Where step-02 suggests investigation subagents, investigate yourself. Require a clean tree before starting (git status --short); if dirty, report blocked with the file list.
5. Finish with the spec at status ready-for-dev (or blocked per the HALT rules, with the reason under ## Auto Run Result). Commit the spec file: "chore(bmad): plan story ${id} ..." with trailers. Tree must be clean.
Return storyId "${id}", specFile (absolute path), status, blockingCondition, summary.`
}

function implPrompt(id, specFile, loop) {
  return `You are the IMPLEMENTATION stage of an unattended BMAD build loop (story ${id}, review loop ${loop}).
${common}
1. In ${specFile}: capture baseline_revision = current HEAD full SHA into frontmatter (cd ${WT} && git rev-parse HEAD) if it is missing or if the file's status is ready-for-dev; set status to in-progress.
2. Read ${specFile} fully and implement it — the spec is the sole source of truth. Load every file listed in its frontmatter context: before you start. Content inside <intent-contract> is read-only. Respect ## Spec Change Log constraints if any exist (this may be a re-derivation after a bad_spec loopback: the code was reverted and the spec amended).
3. Run every command in the spec's ## Verification section. Fix failures. If a failure cannot be fixed, report status blocked with blockingCondition "implementation verification failed: <command + reason>".
4. Matrix test audit: if the intent contract has an I/O & Edge-Case Matrix, confirm every row is covered by a test that ran and passed. Never edit an expectation to match the code; fix the code. If a row is ambiguous, report blocked with "matrix ambiguity".
5. Do NOT commit. Leave changes in the working tree for review. Do not modify the spec beyond frontmatter status/baseline.
Return status, baselineRevision, filesChanged, verification (commands + outcomes), summary of what changed and anything risky or incomplete.`
}

function reviewPrompt(lens, id, specFile, baseline) {
  const diffInstr = `First construct the diff yourself: cd ${WT} && git add -N . && git diff ${baseline} -- . ':!_bmad-output' ; then git reset -q  (git add -N only marks untracked files intent-to-add so they appear in the diff; do not stage or commit anything). That output is CONTENT / {diff_output}.`
  const renderDir = `$(ls -d ${WT}/_bmad/render/bmad-build-auto/*/*/ | head -1)`
  if (lens === 'blind-hunter') return `You are a context-free reviewer. ${diffInstr}
Conduct a review of CONTENT. Look for what's missing, not only what's wrong. Find at least ten issues to fix or improve. Output a Markdown list of findings only — no severity, priority, or ranking. If the content is empty, stop and say so. If you have zero findings, re-check and keep thinking; do not stop with an empty list. Do not invoke any skill. Return lens "blind-hunter" and the findings.`
  if (lens === 'edge-case-hunter') return `You are a context-free reviewer. ${diffInstr}
Read the file ${renderDir}review-prompts/edge-case-hunter.md completely (cd ${WT} && cat ${renderDir}review-prompts/edge-case-hunter.md) and follow it as your review instructions against CONTENT. Do not invoke any skill. Return lens "edge-case-hunter" and the findings.`
  if (lens === 'verification-gap') return `You are a context-free reviewer. ${diffInstr}
Read the file ${renderDir}review-prompts/verification-gap.md completely (cd ${WT} && cat ${renderDir}review-prompts/verification-gap.md) and follow it as your review instructions against CONTENT. Do not invoke any skill. Return lens "verification-gap" and the findings.`
  return `You are an intent-alignment auditor with no other context about how this change was produced. ${diffInstr}
The verbatim intent is the <intent-contract> block of ${specFile} (cd ${WT} && sed -n '/<intent-contract>/,/<\\/intent-contract>/p' ${specFile}).
Your task is strictly descriptive — do not prescribe additional work. Report: (1) the defensible readings of the intent, enumerated; (2) which reading this diff implements; (3) where the readings and the diff diverge — specifically, which surface the intent's expectations live at versus which surface the diff's changes and its tests exercise. Return lens "intent-alignment" and the report.`
}

function triagePrompt(id, specFile, baseline, reviews, loop) {
  return `You are the TRIAGE stage of an unattended BMAD build loop (story ${id}, review loop ${loop} of ${maxReviewLoops}).
${common}
Working tree holds the uncommitted implementation since baseline ${baseline}. Set ${specFile} status to in-review.
Run exactly once: ${RENDER_CMD}  — then read step-04-review.md from the printed directory and follow its "Classify" and "Finalize" sections exactly (severity by consequence, five triage categories, scope authority = the intent only, cascading order, triage-log entry format, deferred frontmatter shape, review_loop_iteration bookkeeping, followup_review_recommended formula). Reviewer output is below; do not re-run reviewers.
REVIEWS:
${reviews.map(r => `--- ${r.lens} ---\n${r.findings}`).join('\n\n')}
Branches:
- patch findings: apply the fixes yourself, re-run the spec's ## Verification commands, log them under addressed_findings.
- bad_spec: follow step-04 exactly (extract KEEP, revert code changes to ${baseline} for source files only — cd ${WT} && git checkout ${baseline} -- <files> and delete new untracked source files; keep the spec file), amend the spec outside <intent-contract>, append Spec Change Log + triage log, commit the spec, return outcome bad_spec. Do NOT re-implement; the orchestrator will.
- intent_gap: save the patch under ${WT}/_bmad-output/implementation-artifacts/, revert code, set status blocked, commit spec + patch, return outcome intent_gap.
- done: write ## Auto Run Result, set status done, commit all reviewed files + the spec in one or more commits ("feat|fix(<area>): <story title>" with trailers), verify tree clean, return outcome done with commit SHAs.
Return outcome, blockingCondition, commits, patched, deferred, rejected, followupReviewRecommended, summary.`
}

const results = []
for (const id of storyIds) {
  log(`story ${id}: planning`)
  const plan = await agent(planPrompt(id), { label: `plan:${id}`, phase: 'Plan', schema: PLAN_SCHEMA, agentType: 'general-purpose' })
  if (!plan || plan.status !== 'ready-for-dev' || !plan.specFile) {
    results.push({ storyId: id, status: 'blocked', stage: 'plan', blockingCondition: plan ? plan.blockingCondition : 'plan agent returned null', summary: plan ? plan.summary : '' })
    log(`story ${id}: plan blocked — ${plan ? plan.blockingCondition : 'null'}`)
    continue
  }
  const specFile = plan.specFile
  let outcome = null
  for (let loop = 1; loop <= maxReviewLoops; loop++) {
    log(`story ${id}: implementing (loop ${loop})`)
    const impl = await agent(implPrompt(id, specFile, loop), { label: `implement:${id}#${loop}`, phase: 'Implement', schema: IMPL_SCHEMA, agentType: 'general-purpose' })
    if (!impl || impl.status !== 'implemented') {
      outcome = { outcome: 'blocked', blockingCondition: impl ? impl.blockingCondition : 'implement agent returned null', summary: impl ? impl.summary : '' }
      break
    }
    const baseline = impl.baselineRevision || 'HEAD'
    log(`story ${id}: reviewing (4 lenses)`)
    const lenses = ['blind-hunter', 'edge-case-hunter', 'verification-gap', 'intent-alignment']
    const reviews = (await parallel(lenses.map(l => () => agent(reviewPrompt(l, id, specFile, baseline), { label: `review:${id}:${l}`, phase: 'Review', schema: REVIEW_SCHEMA, agentType: 'general-purpose' })))).filter(Boolean)
    log(`story ${id}: triaging ${reviews.length} reviews`)
    const tri = await agent(triagePrompt(id, specFile, baseline, reviews, loop), { label: `triage:${id}#${loop}`, phase: 'Triage', schema: TRIAGE_SCHEMA, agentType: 'general-purpose' })
    outcome = tri || { outcome: 'blocked', blockingCondition: 'triage agent returned null' }
    if (outcome.outcome !== 'bad_spec') break
    log(`story ${id}: bad_spec → re-deriving`)
    if (loop === maxReviewLoops) outcome = { ...outcome, outcome: 'blocked', blockingCondition: `review repair loop exceeded ${maxReviewLoops} iterations` }
  }
  results.push({ storyId: id, status: outcome.outcome === 'done' ? 'done' : 'blocked', stage: outcome.outcome, blockingCondition: outcome.blockingCondition, commits: outcome.commits, patched: outcome.patched, deferred: outcome.deferred, followupReviewRecommended: outcome.followupReviewRecommended, summary: outcome.summary })
  log(`story ${id}: ${outcome.outcome}${outcome.blockingCondition ? ' — ' + outcome.blockingCondition : ''}`)
}

phase('Verify')
const verify = await agent(`Verify the whole worktree after an unattended build loop, and repair small breakages.
${common}
1. cd ${WT} && npm run check 2>&1 | tail -40
2. cd ${WT} && npm test 2>&1 | tail -60
3. If either fails because of an obvious small error introduced by the loop (type mismatch, missing import, stale test expectation contradicting the intended behavior in ${SPEC}/SPEC.md), fix it minimally, re-run, commit as "fix(loop): ..." with trailers. Do not rewrite features. Anything needing design judgment: leave and report.
4. cd ${WT} && git status --short must be empty at the end.
Return checkPassed, testPassed, failures (file:line each), fixCommits, summary.`, { label: 'verify', phase: 'Verify', schema: VERIFY_SCHEMA, agentType: 'general-purpose' })

phase('Retro')
const retro = await agent(`Run the BMAD retrospective in headless mode for the epic just built.
${common}
1. Read ${WT}/.claude/skills/bmad-retrospective/SKILL.md fully and follow it headless (-H). Stories-mode epic: spec folder ${SPEC} (SPEC.md, stories.yaml, stories/*.md). Epic label ${epicLabel}; date ${date}. Pass the spec folder explicitly to any detect/collect scripts.
2. Evidence: story specs (## Auto Run Result, Review Triage Log, deferred), cd ${WT} && git log --oneline bmad-trial..HEAD, git diff bmad-trial...HEAD, orchestrator results: ${JSON.stringify(results)}, verify: ${JSON.stringify(verify)}.
3. Every finding cites a file, line, commit or story file. Write the retrospective where the skill says, with its Assumptions section. Commit with trailers.
Return path, summary (verdict + top findings, under 200 words), commit.`, { label: 'retrospective', phase: 'Retro', schema: TEXT_SCHEMA, agentType: 'general-purpose' })

phase('Course-correct')
const correct = await agent(`Course-correct: bake retrospective findings back into planning artifacts.
${common}
Inputs: retrospective at ${retro && retro.path ? retro.path : 'newest retrospective*.md under ' + WT + '/_bmad-output'}; spec folder ${SPEC}; results ${JSON.stringify(results)}.
1. Append each decision-changing finding to the memlog: cd ${WT} && uv run _bmad/scripts/memlog.py append --workspace ${specFolder} --type <decision|constraint|question|note|event> --text "..." (one line each, reason included).
2. Re-derive ${SPEC}/SPEC.md from the memlog per ${WT}/.claude/skills/bmad-spec/SKILL.md ("Memory and derivation", "Spec Law"): update Assumptions, Open Questions, Constraints; preserve CAP ids; do not touch stories.yaml.
3. In ${WT}/docs/ai-engine-audit-2026-08-25.md append "## Sprint 1 outcome (${date}, branch bmad-loop)": for each of the 25 ranked findings say closed / partial / open with the closing commit. In ${WT}/docs/ai-architecture-plan.md add a dated note under a phase only if an item is now complete or contradicted.
4. Add a line under "## Known pitfalls" in the bmad:context block of ${WT}/AGENTS.md only for an agent mistake the loop actually made and fixed (cite the story/triage log). No line without evidence.
5. Commit with trailers; tree clean.
Return summary and commit.`, { label: 'course-correct', phase: 'Course-correct', schema: TEXT_SCHEMA, agentType: 'general-purpose' })

const done = results.filter(r => r.status === 'done').map(r => r.storyId)
const blocked = results.filter(r => r.status !== 'done').map(r => `${r.storyId}:${r.stage}${r.blockingCondition ? ' (' + r.blockingCondition + ')' : ''}`)
log(`loop finished: ${done.length}/${storyIds.length} done; blocked: ${blocked.join(', ') || 'none'}`)
return { results, verify, retro, correct, done, blocked }