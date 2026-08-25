export const meta = {
  name: 'bmad-story-loop',
  description: 'Unattended BMAD build loop: per-story build-auto in a worktree, verify, headless retrospective, course-correct docs',
  phases: [
    { title: 'Build', detail: 'one fresh agent per story running bmad-build-auto (folder+id dispatch)' },
    { title: 'Verify', detail: 'svelte-check + vitest over the whole worktree' },
    { title: 'Retro', detail: 'bmad-retrospective -H over the epic' },
    { title: 'Course-correct', detail: 'bake retro findings into spec memlog, SPEC.md and docs' },
  ],
}

const { worktree, specFolder, storyIds, epicLabel, date } = args
const WT = worktree
const SPEC = `${WT}/${specFolder}`

const STORY_SCHEMA = {
  type: 'object',
  properties: {
    storyId: { type: 'string' },
    status: { type: 'string', enum: ['done', 'blocked', 'failed'] },
    blockingCondition: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' } },
    filesChanged: { type: 'array', items: { type: 'string' } },
    followupReviewRecommended: { type: 'boolean' },
    deferredCount: { type: 'number' },
    summary: { type: 'string' },
  },
  required: ['storyId', 'status', 'summary'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    checkPassed: { type: 'boolean' },
    testPassed: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } },
    fixCommits: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['checkPassed', 'testPassed', 'summary'],
}

const TEXT_SCHEMA = {
  type: 'object',
  properties: { path: { type: 'string' }, summary: { type: 'string' }, commit: { type: 'string' } },
  required: ['summary'],
}

const common = `
ENVIRONMENT
- All work happens in the git worktree at ${WT} (branch bmad-loop). Every Bash call must start with: cd ${WT} && ...
- Never touch /Users/johnnynguyen/Documents/Repos/Banhall (the primary checkout). Never git push.
- The BMAD install lives at ${WT}/_bmad and skills at ${WT}/.claude/skills. Project rules: ${WT}/AGENTS.md (read it first). Convex rules: ${WT}/convex/_generated/ai/guidelines.md.
- Tests: cd ${WT} && npm test -- <pattern>  (vitest; convex-test). Typecheck: cd ${WT} && npm run check.
- Commit messages: Conventional Commits, and end every commit body with:
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SGrLqGxUB1wUP5Vo3p5rww
`

phase('Build')
const results = []
for (const id of storyIds) {
  log(`story ${id}: starting build-auto`)
  const r = await agent(`You are one iteration of an unattended BMAD development loop. Execute the bmad-build-auto skill for exactly one story, then return structured results.
${common}
STEPS
1. Run exactly once: cd ${WT} && uv run --no-cache "${WT}/_bmad/scripts/render_skill.py" --project-root "${WT}" --skill "${WT}/.claude/skills/bmad-build-auto"
   It prints one absolute workflow.md path. Read that file fully and follow it, loading each step file only when directed.
2. Dispatch mode is FOLDER+ID: spec_folder = ${SPEC}, story_id = "${id}". The invocation intent is: "Implement story ${id} from ${SPEC}/stories.yaml". Append the entry's invoke_dev_with text as planning context.
3. Where the workflow says to spawn subagents, use the Agent tool synchronously (subagent_type "general-purpose"), never run_in_background. Reviewer subagents in step-04 run in parallel by issuing them in one message. Give every subagent the ENVIRONMENT block above verbatim so it works in the worktree.
4. Follow the HALT protocol exactly: the story spec file at ${SPEC}/stories/${id}-*.md must end with a status of done or blocked and an "## Auto Run Result" section. On done, the workflow commits; make sure the story spec file itself is committed too and the tree is clean.
5. If the tree is dirty before you start, run cd ${WT} && git status --short, report the files in blockingCondition and stop with status blocked; do not stash or reset.
6. Return: storyId "${id}", status, blockingCondition, commits (short SHAs from git log since start), filesChanged, followupReviewRecommended and deferredCount read from the story spec frontmatter, one-paragraph summary.`,
    { label: `story:${id}`, phase: 'Build', schema: STORY_SCHEMA, agentType: 'general-purpose' })
  const row = r || { storyId: id, status: 'failed', summary: 'agent returned null' }
  results.push(row)
  log(`story ${id}: ${row.status}${row.blockingCondition ? ' — ' + row.blockingCondition : ''}`)
}

phase('Verify')
const verify = await agent(`Verify the whole worktree after an unattended build loop, and repair small breakages.
${common}
1. cd ${WT} && npm run check 2>&1 | tail -40   (svelte-check; PUBLIC_CONVEX_URL comes from .env.local)
2. cd ${WT} && npm test 2>&1 | tail -60
3. If either fails because of an obvious small error introduced by the loop (type mismatch, missing import, stale test expectation that contradicts the new intended behavior in ${SPEC}/SPEC.md), fix it minimally, re-run, and commit as "fix(loop): ..." with the required trailers. Do not rewrite features. If a failure is not obviously the loop's fault or needs design judgment, leave it and report it.
4. Ensure cd ${WT} && git status --short is empty at the end (commit anything you changed).
Return checkPassed, testPassed, failures (one line each with file:line), fixCommits, summary.`,
  { label: 'verify', phase: 'Verify', schema: VERIFY_SCHEMA, agentType: 'general-purpose' })

phase('Retro')
const retro = await agent(`Run the BMAD retrospective in headless mode for the epic just built.
${common}
1. Read ${WT}/.claude/skills/bmad-retrospective/SKILL.md fully and follow it in headless mode (-H). This is a stories-mode epic: spec folder ${SPEC} with SPEC.md, stories.yaml and stories/*.md. Epic label: ${epicLabel}. Date: ${date}. If the skill offers a detect-epic script, pass the spec folder explicitly rather than relying on sprint-status detection.
2. Evidence available: story spec files with "## Auto Run Result", git log on branch bmad-loop since the merge-base with bmad-trial (cd ${WT} && git log --oneline bmad-trial..HEAD), the full diff (git diff bmad-trial...HEAD), and these per-story orchestrator results: ${JSON.stringify(results)}. Verify results: ${JSON.stringify(verify)}.
3. Every finding must cite a file, line, commit or story file. Write the retrospective document where the skill says (under ${WT}/_bmad-output/implementation-artifacts or the spec folder), including its Assumptions section. Commit it with the required trailers.
Return path, summary (verdict + top findings, under 200 words), commit.`,
  { label: 'retrospective', phase: 'Retro', schema: TEXT_SCHEMA, agentType: 'general-purpose' })

phase('Course-correct')
const correct = await agent(`Course-correct: bake retrospective findings back into the planning artifacts so the next loop starts from durable knowledge.
${common}
Inputs: retrospective at ${retro && retro.path ? retro.path : 'search ' + WT + '/_bmad-output for the newest retrospective*.md'}; spec folder ${SPEC}; story results ${JSON.stringify(results)}.
1. Append each finding that changes a decision to the spec memlog with: cd ${WT} && uv run _bmad/scripts/memlog.py append --workspace ${specFolder} --type <decision|constraint|question|note|event> --text "..."  (one line each, reason included).
2. Re-derive ${SPEC}/SPEC.md from the memlog per the bmad-spec rules (read ${WT}/.claude/skills/bmad-spec/SKILL.md "Memory and derivation" and "Spec Law"): update Assumptions, Open Questions, and Constraints; preserve CAP ids. Do not touch stories.yaml.
3. In ${WT}/docs/ai-engine-audit-2026-08-25.md, append a section "## Sprint 1 outcome (${date}, branch bmad-loop)" listing each of the 25 ranked findings that this loop closed, partially closed, or left open, with the commit that closed it. In ${WT}/docs/ai-architecture-plan.md, if any plan item is now complete or contradicted, add a dated note under the matching phase; otherwise leave it untouched.
4. If the retrospective surfaced an AGENTS.md pitfall with observed evidence (an agent mistake the loop actually made and fixed), add one line under "## Known pitfalls" inside the bmad:context block of ${WT}/AGENTS.md. No line without evidence.
5. Commit with the required trailers; tree must be clean.
Return summary (what changed in which files) and commit.`,
  { label: 'course-correct', phase: 'Course-correct', schema: TEXT_SCHEMA, agentType: 'general-purpose' })

const done = results.filter(r => r.status === 'done').map(r => r.storyId)
const blocked = results.filter(r => r.status !== 'done').map(r => `${r.storyId}:${r.status}${r.blockingCondition ? ' (' + r.blockingCondition + ')' : ''}`)
log(`loop finished: ${done.length}/${storyIds.length} stories done; blocked/failed: ${blocked.join(', ') || 'none'}`)
return { results, verify, retro, correct, done, blocked }