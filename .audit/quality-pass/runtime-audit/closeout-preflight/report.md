# Native closure and archive preflight

Read-only source review; no helper phase, native mutator, staging, test or synthetic ledger operation was invoked.

## Native closure

No blocking mismatch found between the current helper and installed native semantics. Installed deferredwork.py SHA256 is `170c14c0e2d874238d73ad060bf59b49050e73713a853ef7dc7fb7271cc9d872`, matching the pin. Native mark_done_many returns only actually flipped IDs in requested order, skips absent/already-done entries, validates positional notes and date, and writes through its lock/atomic publication. Its replacement is `status: done DATE` followed immediately by `resolution: NOTE`; helper's reverse-span in-memory comparison matches that behavior. Single-line input validation prevents native newline sanitization from changing expected note text.

The helper requires all three exact ordered targets open among105unique entries, current source coverage including link-target hashes, evidence hashes, gate HEAD, successful canonical nine-step command, no unexpected path changes and index_unchanged. Both persisted gate source manifests bind all non-audit/non-ledger paths to current hashes. This matches the strengthened run_gate receipt fields. Prepare captures exact ledger/native/helper/index identity; execute rechecks before one public batch call, then validates full expected text and102untouched entries. Finalize checks the actual staged ledger against the native after snapshot before commit. Exclusive output files and attempt marker prevent a blind retry after uncertain publication.

Important scope qualifications: “clean index” in usage means no unresolved merge/whitespace issue plus unchanged gate index, not an assertion that staging is empty. Current index is frozen between prepare and execute; deliberate final staging is allowed before finalize. Notes/acceptance and exclusive-writer assertions remain root attestations. Gate/source hashes do not prove those attestations themselves. The ledger write and receipts are not a single transaction; the documented manual investigation after interruption remains necessary. No real closure has been proven by this preflight.

The plan's illustrative partial-ID option is not exposed by this all-three-only helper; usage correctly says all three must qualify. Do not feed a partial invocation to it. Preserve HEAD and all non-ledger/non-audit source after the final gate through finalize. A new nonignored spec or source edit will correctly block invocation. Perform finalize before the closeout commit changes HEAD.

## Archive closeout

archive_closeout.py archives declared evidence folders and root evidence files; it does not traverse application source or the native ledger. Live root decisions.tsv/state.json are copied into closeout/ and only those snapshot destinations are passed to git add. It stages an explicit manifest-derived list, not a broad directory or git add-all. Original/stored hashes and gzip round-trip checks preserve source evidence bytes. Compressed originals are retained; immutable Q1–Q8 archives are outside the selected folders.

Current selected inventory has95files, zero symlinks and no transcript.jsonl/messages.json. Those exact private transcript names trigger a refusal before staging. This is an explicit filename guard, not general secret/transcript detection; do not claim it excludes arbitrary renamed private material. Root review of the final enumerated manifest remains necessary. Pre-existing gzip-only files are skipped, so ensure needed proof has either its uncompressed original in this selection or an already committed unit archive. No currently demonstrated required-proof omission was found.

Although no live canonical root decisions/state bytes are staged by this script, it DOES stage evidence and writes compressed/snapshot artifacts. It must run only at the deliberate finalization boundary, not as a read-only check. The manifest-exists guard prevents a finalized rerun; partial failures can leave artifacts and require investigation. Normal uncompressed evidence may be rewritten byte-identically at its existing path; this is not a guarantee of zero filesystem writes. No source files are rewritten by the reviewed selection.

No code change or expanded wrapper is recommended from this bounded inspection. Final actual gate, closure, archive inventory and staged-byte verification remain pending root-owned operations.
