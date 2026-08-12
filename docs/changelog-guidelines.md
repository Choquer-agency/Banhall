# Changelog guidelines

The in-app changelog (`/changelog`) is written for SR&ED consultants and
writers — busy, non-technical readers. Every entry, whether AI-drafted by the
pipeline (`npm run changelog` → `convex/ai/changelogPipeline.ts`) or authored
by an admin in the compose form, follows the same structure. Established
2026-08-12 (owner direction: combine the day's changes and file them under the
standard categories every changelog uses).

## Entry structure

One entry per work day (pipeline) or per release note (manual). An entry is:

1. **Title** — a short headline for the release, max 70 chars, no dates, no
   jargon. Lead with the most writer-visible change ("Excel uploads and a
   faster project setup").
2. **Summary** — one or two plain-language sentences on what the work means
   for writers.
3. **Sections**, in this order, each a `###` heading with a bullet list.
   Omit any empty section — never render an empty heading:

   - `### New` — capabilities that did not exist before.
   - `### Improved` — existing behavior that got better (design, speed,
     clarity, workflow smoothness).
   - `### Fixed` — things that were broken and now work.

   A single "Behind-the-scenes reliability work" bullet at the end of
   **Improved** may absorb refactors/tooling; never more than one.

## Voice rules (both AI and human authors)

- **Translate, don't transcribe.** Describe the effect a writer can see or
  feel, never the implementation. No file names, function names, schema or
  table names, model IDs, branch names, or acronyms writers don't use daily
  (PD, QA, CRA are fine).
- **Combine.** Multiple commits that serve one change become one bullet.
  Ten polish commits are one "…looks cleaner and reads more consistently"
  bullet, not ten.
- **Never invent.** Only changes present in the commits.
- **Skip the invisible.** Test-only, tooling, and debug commits either fold
  into the single reliability bullet or disappear.

## Kind (the entry badge and filter)

`kind` is derived from the sections, not chosen by feel:

- `feature` — New is non-empty and Fixed is empty.
- `fix` — Fixed is non-empty and New is empty.
- `mixed` — anything else.

## Example body

> Setting up a project is faster and review feedback is easier to act on.
>
> ### New
> - Start an AI review of any written PD straight from its project — the
>   review inherits every document automatically.
>
> ### Improved
> - Project pages load with the report front and center; the transcript is
>   tucked away until you need it.
>
> ### Fixed
> - Pasted passwords with a stray space no longer fail at sign-in.
