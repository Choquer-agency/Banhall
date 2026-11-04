# Question 15 live check: company files a draft could not fit (2026-10-28)

The decision is entry "2026-10-28 (third)" in `docs/product-domain.md`.

**Where it ran.** The F5 live copy on 1242c83f with this change's files. The 101-file stress project ("Release eval - Stress test - Nimtashsil Works", an evaluation project) and its company. Two company files of 120,000 characters were added, written by `scripts/stress/generate.mjs` with invented names and scanned against the copy's real names: `last-year-report.md` (filed as a previous PD) and then `company-background.md` (background), so the background file is the newer. One Step by step draft was started, read and cancelled.

**What it shows** (`inputs-band.json`, read through the same query the page uses, `generations:getContextInclusion`):
- The draft kept the interview and 14 of the project's files; 87 are listed as not captured, as before.
- The newer company file fit and was frozen; the draft records the company it came from. The analysis, which reads at most 12 files, then left it out, so the band shows it as "not included" with no reason. Both company files read "not included" in the band: one with no reason, one "not captured".
- Last year's report did not fit. The draft recorded it in `companyFilesLeftOut`, and the band lists it as "not included", reason "not captured". Before this change it was named nowhere.
- The start dialog's list (`companyFiles:listForProject`) still offers both, each now marked "Read last, newest first, while there is room" (the wording after review round 1) (the wording is checked by the component test; the page was not screenshotted, since the 101-file page was too slow to drive while the gate ran).

**Spend.** $2.04 for this draft (7 AI calls, most of it its first Batch on the 3-hour interview), cancelled once read. With the write-rate check, $7.03 on 2026-10-28, and $27.41 of the owner's $40 with the F5 run.
