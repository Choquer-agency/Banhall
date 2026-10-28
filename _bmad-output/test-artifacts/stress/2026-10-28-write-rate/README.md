# Question 14 live check: a draft's start under the write rate (2026-10-28)

The decision is entry "2026-10-28 (second)" in `docs/product-domain.md`.

**Where it ran.** The F5 live copy (local backend, 4 MiB a second write rate), on b62c6987 for "before" and on b62c6987 with this change's files for "after". Two evaluation projects ("Flood A" and "Flood B", the 3-hour stress interview by reference). Real models; every draft was cancelled after the check.

**How the write rate was reached.** A temporary helper on the live copy only (`zzStressQ14:flood`, removed afterwards) wrote 900 KB rows, 12 at a time, for 14 seconds: about 10 MB a second, of which the backend refused 67 to 106 writes a round. Three seconds into each flood, both drafts were started in the same second. The copy's run limits were raised for the check only, since the test account had already used its hour. The scripts are one-off drivers outside the repo (`floodtest.mjs`, `samesecond.mjs`).

| Run | File | Drafts that began | What the log shows (`refusals-by-function.txt`) |
|---|---|---|---|
| No flood, same second, 3 rounds | `results-samesecond.json` | 6 of 6 | No write refused. |
| Before the fix, 3 rounds | `results-flood-before.json` | 0 of 6 | 2 starts refused outright; 4 failed with "Generation could not begin: TooManyWrites", the 10-27 failure. |
| First try of the fix: begin and progress lines only, 3 rounds | `results-flood-after.json` | 6 of 6 | Later start writes were refused too (writer settings, the Brief pin, the context budget, drafting inputs); one start action ended with its failure record refused. So the change was widened to every write of the start actions. |
| The fix: every write of the start actions, held 25 s, 3 rounds | `results-flood-after2.json` | 6 of 6, each at its first step | Every refused write of the start actions was sent again and went through (listed by function); no start action error. One Seed Batch's claim was refused and its action ended, which would have left the Batch waiting 10 minutes for its lease. So the Batch action was wrapped too. |
| The fix with the Seed Batch, held 40 s, 2 rounds | `results-flood-after3.json` | 4 of 4, each at its first step | The Batch claim refused 3 times and sent again; no start or Batch action error. |

**Spend.** $5.00 of AI on the live copy this day (`generation:seeds:company_context` $4.22, analyzer $0.52, Brief $0.22, Brain query $0.04), $25.38 of the owner's $40 with the F5 run.

**Not shown here.** A usage row's write (`aiUsage:logUsage`) and a model outcome's write were refused too under the flood; whether the scheduler sent the usage rows again was not checked.
