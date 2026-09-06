# Q8 interim evidence check

Read-only inspection at `e2cfb873b32586d1a620a75e1de61cc49d323eb3`. No builds, tests, installs, source changes, or existing Q8 evidence edits. `receipt.json` binds the four current changed files and independent artifact comparisons.

**No material mismatch found in the dependency/runtime evidence inspected. Final cold-cache browser reproducibility remains unproved.**

- Recomputed complete lock-record differences: exactly45 non-root package paths, exactly45 matching explanation rows, no omissions/extras or version mismatches. All30 Tiptap records are3.30.4. Changes are the scoped repairs/React addition plus explained hoisting; no unexplained package refresh surfaced.
- Manifest/lock hashes match install-receipt.json. Both npm-ci logs show completed456-package installs and zero advisories; repeated-lock checksum says OK. The consolidated install receipt does not contain per-command numeric exits, so retain original CLI execution results for exact exit-code provenance instead of interpreting the command list itself as an exit receipt.
- Saved audit has empty vulnerabilities and total0; peers.log resolves React19.2.8 for Better Auth and aligned core/pm. These are current observed dependency results, not a guarantee of future security.
- Cookie script resolves from Kit and exercises actual0.7.2 serializer, independent malformed fields, actual Kit Cookies and the real Svelte adapter cookie-only getToken. Logs report all checks passed. The stated limitation, no remote login/authentication proof, is accurate.
- Markdown fixture genuinely checks production code fallback/no SVG, partial-to-complete bold markdown and a separate explicit Mermaid SVG control with two nodes and labels. It neither enables production diagrams nor claims an application exploit. Archived fixture/config sources preserve the runnable test; one passing test contains the combined assertions.
- Independently parsed post-ordered client evidence:109 chunks,4439 module rows,1186 rendered rows, no forbidden module IDs. Manifest SHA matches verification receipt. Rehashed every one of109 archived chunk members directly from the tar archive: all match recorded hashes, and archive SHA also matches. This correctly preserves the observed build even if a later standard build overwrites the output directory. No stale first-observer claim is being substituted for the final hash-bound result.

## Remaining decision point

The original combined gate failed after steps1–8: CommonJS `@vercel/oidc` import failures plus optimizer reload-related failures. The three-line explicit prebundle entry is technically aligned with that failure and does not change package versions or mock the module. The subsequent component log proves66files/522tests passed **in that run**. It does not independently establish a clean optimizer-cache run after the change. `canonical-final.log` begins `[1/8]` and ends at the uploader harnesses; it is the browser-free canonical run, not a second successful nine-step browser gate.

Root's planned fresh-cache `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` remains necessary before final acceptance. Bind final source/config hashes and actual cache-reset provenance. Do not combine the later warm browser success with the eight-step log and label it a cold combined pass. This is an outstanding verification condition, not a demonstrated defect in the current four-file patch.

Path correction: this audit originally used repository-root runtime-audit/Q8-interim. At root instruction, only these two newly created files were moved to .audit/quality-pass/runtime-audit/Q8-interim; the now-empty owned directories were removed. No product or existing audit files were changed.
