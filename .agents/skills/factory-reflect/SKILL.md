---
name: factory-reflect
description: "Reflect role. Mines a finished factory run (events, findings files, review and QA reports, decision trails) for durable lessons and proposes edits: project skill-notes, config changes, new gates, structural encodings. Never applies anything itself. Runs from `factory reflect`."
---

# factory-reflect

Arguments: `run_dir=<dir> digest=<path> config=.factory/factory.toml existing_notes='<paths>' out=<path>`.

Goal: the next run makes fewer of this run's mistakes, and the fix is structure (a gate, a predicate, a config value, a one-line rule) rather than more prose. Skip trivial and one-off events.

## Read
1. `digest` (per-ticket stages, fix-loop counts, artifacts). Then every `.audit/<key>/findings-*.md`, `review-*.md`, `qa-*.md` it lists, and `decisions.tsv` per ticket.
2. `run_dir/events.jsonl` only for specifics the digest points at (stalls, quota events, repeated tool calls, session aborts).
3. `config` and `existing_notes` so you do not propose what is already there.

## Look for
- **Repeated findings** across tickets or fix loops (the same review claim, the same missing evidence section, the same gate failing first): propose a gate or predicate that catches it before review, or a skill-note for the role that keeps causing it.
- **Wasted loops**: fix sessions that did not change the stage outcome; reviewer findings the lead dismissed every time; QA verdict repeatedly below `min_verdict` for a structural reason (no verify skill, untestable surface).
- **Process faults**: stalls, quota fallbacks, sessions that exceeded budget, tickets escalated for the same reason.
- **Plan quality**: tickets whose `done_when` never failed at baseline (vacuous predicate), missing `touches`, sizing violations that showed up as scope creep in the diff.
- **Wins to keep**: a decision row that prevented a bug; a rule the implementer followed that a reviewer praised. Encode as a skill-note so it survives.

## Proposals
Each proposal: `kind` (`skill-note` = one rule appended to `.factory/skills/factory-<role>.md`; `config` = a `factory.toml` / `roles.toml` value; `gate` = a command to add to `[verify].commands` or a ticket `done_when` pattern; `structure` = a lint, script, type or runtime check in the product code; `ticket` = follow-up work worth a ticket), `target` (skill name, config key, file), `change` (one sentence, imperative, specific), `why`, `evidence` (`.audit/<key>/review-1.md`, event timestamps, `file:line`), `bucket`:
- `accepted`: pattern seen in 2+ places, or one instance with a clear structural fix, and it is not already covered.
- `backlog`: real but needs a human decision or product-code change.
- `rejected`: one-off, already covered, or would add prose where a gate is better (say which).
Prefer `gate`/`structure` over `skill-note` when both would work. Cap: 8 accepted. Write the same content to `out` in the sections `## accepted`, `## backlog`, `## rejected` (one bullet each: `- **<kind>** \`<target>\`: <change>` then `  why: …` and `  evidence: …` lines).

## Result
JSON matching `reflect-result.json`: `proposals`, `summary` (three sentences: what this run did well, what cost the most loops, the single highest-value change).
