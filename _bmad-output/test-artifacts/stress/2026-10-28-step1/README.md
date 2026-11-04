# Phase D step 1 live check: one large draft through to its report (2026-10-28)

The decisions are entries "2026-10-28 (fourth)" to "(ninth)" in `docs/product-domain.md`.

**Where it ran.** The F5 live copy (local backend, real models) on 4458dc57, the last step 1 commit. The project is the copy of the 51-file stress project (51 files of about 400,000 characters, 21M characters in all, and a 3-hour interview of 161,895 characters). Its draft froze 14 of the 51 files, as F5's did: filling that pool by relevance is step 2. The run was compared with F5's draft of the same files (`k578k98q09a8s54teakgjfr0dd8h4tsm`, made before step 1). The script picked 46 Seeds across every step, edited every pick, signed off and waited for the report (`part2.mjs`, as in F5). The test account's daily run count was reset on the copy for the check (a temporary helper, never in the repo).

## What each step read of the 14 frozen files (`reads-and-cost.json`)

| Step | F5 (before) | Step 1 draft |
|---|---|---|
| The analysis | 11 in part, 3 not read | 12 in part, 2 not read |
| The Brief | 2 whole, 3 in part, 9 not read | The same: the draft reused the Brief an earlier draft made before step 1 |
| Seeds | 1 whole, 1 in part, 12 not read | 14 in part |
| The facts check | none read | 12 in part, 2 not read |

The draft started, reached its Seeds in 36 seconds, and its report came back 1.4 minutes after sign-off (F5: 1.1 minutes). No refusals. Cost $5.49 against F5's $5.77: no Brief call (reused, $0.58 less), the same Seeds ($4.13), and the facts check now reads files ($0.53 against $0.28).

## What the live check found: Seeds lost their quotes with a reused Brief

Only 4 of the draft's 46 first-version Seeds in the first 8 steps kept a quote, against 45 of 47 in F5 (`seeds-quoted-by-step.json`). The cause predates step 1:

- The draft reused a Brief made by an earlier draft of the same files (same inputs, so no new Brief call). Its 16 entries name that earlier draft's rows: 14 the interview, 2 a notes file.
- A Seed request shows the Brief as it is stored, ids included. A temporary log on the copy showed the model copying those ids into its quotes (`citation-ids-logged.txt`, first line: both quotes name rows that are not the draft's).
- The citation check accepts only the draft's own rows, so it dropped those quotes, and the Seeds became writer-asserted. Nothing failed or warned.

The fix (entry "(ninth)"): Seeds see each entry of a reused Brief with the draft's own row of the same text. With it on the copy, a new draft's model quoted the draft's own rows (`citation-ids-logged.txt`, later lines), and 40 of 46 Seeds in the same 8 steps kept a quote (`seeds-quoted-by-step.json`, `results-fix1-part2.json`). That draft was cancelled at the experimentation step.

## Not shown here

- Seeds quote only the interview, in F5, in the step 1 draft and with the fix (`quotes-by-kind.jsonl`): reading parts of every file did not make any Seed quote a file on this project, whose files are generated notes. A real large project is the next measure.
- The Brief by relevance (entry "(sixth)") was not exercised live: the draft reused its Brief.
- One draft ran past its spending stop: approving a step starts the next step's first Batch, which the script's stop did not count. Spend since F5 began: $38.69 of the owner's $40.
