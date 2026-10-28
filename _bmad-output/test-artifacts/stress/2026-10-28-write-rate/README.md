# Question 14 live check: a draft's start under the write rate (2026-10-28)

The decision is entry "2026-10-28 (second)" in `docs/product-domain.md`.

**Where it ran.** The F5 live copy (local backend, 4 MiB a second write rate), on b62c6987 for "before" and on b62c6987 with this change's files for "after". Two evaluation projects ("Flood A" and "Flood B", the 3-hour stress interview by reference). Real models; every draft was cancelled after the check.

**How the starts were sent.** In the first four runs the script sent each start through the HTTP client, and in the "after" runs it sent a refused start again itself, as the pages were then meant to. Review round 1 found the browser does not need that: its WebSocket client sends a refused start again by itself (the last two runs).

**How the write rate was reached.** A temporary helper on the live copy only (`zzStressQ14:flood`, removed afterwards) wrote 900 KB rows, 12 at a time, for 14 seconds: about 10 MB a second, of which the backend refused 67 to 106 writes a round. Three seconds into each flood, both drafts were started in the same second. The copy's run limits were raised for the check only, since the test account had already used its hour. The scripts are one-off drivers outside the repo (`floodtest.mjs`, `samesecond.mjs`).

| Run | File | Drafts that began | What the log shows (`refusals-by-function.txt`) |
|---|---|---|---|
| No flood, same second, 3 rounds | `results-samesecond.json` | 6 of 6 | No write refused. |
| Before the fix, 3 rounds | `results-flood-before.json` | 0 of 6 | 2 starts refused outright; 4 failed with "Generation could not begin: TooManyWrites", the 10-27 failure. |
| First try of the fix: begin and progress lines only, 3 rounds | `results-flood-after.json` | 6 of 6 | Later start writes were refused too (writer settings, the Brief pin, the context budget, drafting inputs); one start action ended with its failure record refused. So the change was widened to every write of the start actions. |
| The fix: every write of the start actions, held 25 s, 3 rounds | `results-flood-after2.json` | 6 of 6, each at its first step | Every refused write the start actions made themselves was sent again and went through (listed by function); no start action error. One Seed Batch's claim was refused and its action ended, which would have left the Batch waiting 10 minutes for its lease. So the Batch action was wrapped too. |
| The fix with the Seed Batch, held 40 s, 2 rounds | `results-flood-after3.json` | 4 of 4, each at its first step | The Batch claim refused 3 times and sent again; no start or Batch action error. |
| Review round 1: what the browser's WebSocket client sees, starts sent once, 3 rounds (first waits) | `results-wsclient.json` | 3 of 3 starts went through; 1 draft failed to begin | The deployment closed the connection (code 1013, TooManyWrites) and the client sent the start again on reconnect, with no error logged (4.5 s at most). One begin was refused 5 times inside a 12-second burst: the first waits (about 4 to 6 s) were too short, so they were lengthened to about 16 to 24 s. |
| Review round 1 fixes: schedules and the action limit too, six waits, WebSocket starts, held 30 s, 3 rounds | `results-flood-review1.json` | 3 of 3 that were not stopped by the test account's limit of 40 runs a day, each at its first step | The start refused 7 times and sent again by the client (14.6 s); the first Batch's start refused 8 times and sent again; no start or Batch action error. |

**Spend.** $8.38 of AI on the live copy this day, with the company files check; $28.76 of the owner's $40 with the F5 run.

**Not shown here.** A usage row's write (`aiUsage:logUsage`), a model outcome's write and a Brain search's record were refused too under the flood; whether the scheduler sent the usage rows again was not checked. One-shot drafts were not run.
