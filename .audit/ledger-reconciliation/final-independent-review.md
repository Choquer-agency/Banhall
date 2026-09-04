# Independent reconciliation review

Reviewed 2026-09-04 with GPT-6 Astra, medium effort. Read-only review; no ledger, native state, or gate status was changed. No product tests or sweep ran.

## Finding requiring correction before sweep

**P2: Two live ledger references point to the wrong canonical obligation.** In `deferred-work.application.md:627` (DW-78) and `:659` (DW-82), the reason retains “Distinct from DW-24, which is the ghost-after-terminal branch.” Both records originate in `sprint2-learn-chat` at `b99f1eeef78348df5c14f68031f7f0276527ff3f`. In that source, DW-24 maps to canonical **DW-73** (origin `spec-deferred 1a30854a6bbb`). Canonical DW-24 concerns analyzer Brain exemplar budgeting. A native sweep reading the live ledger without the external mapping can misinterpret this distinction or merge unrelated work. Preserve the immutable source bodies/snapshots, but append explicit source-scoped canonical-reference annotations to these two live application records before sweep. The reconciliation reference scan excludes the ledger itself and therefore did not surface these references. No other DW-number reference occurs inside the application entry bodies.

## Verified evidence

- Independently read all seven exact ledger Git objects in `preview-20260904T214745464731Z-b74bce7a257e/manifest.json`; SHA-256 digests match the manifest.
- Used installed `bmad_loop.deferredwork.parse_ledger`, separately from the reconciliation parser, to compare every one of 340 source occurrences to its mapped canonical entry. Every full body matches after heading-ID normalization and trailing whitespace removal, except the two explicitly evidenced missing status lines.
- The application has 93 unique native-parsed entries, all open; zero legacy or unparsed entries. The first 91 entries equal the preview bytes. Main DW-1 through DW-22 remain byte-for-byte intact.
- Two missing status lines are restored from full-body-identical intact source witnesses, both open. Neither restoration guesses a closure. Original damaged records and exact witness SHA/occurrence/fingerprint are retained.
- The three sprint2-boundary DW-46 headings are distinct occurrences 46, 69, and 70, mapped respectively to canonical DW-46, DW-69, and DW-70. Mapping includes source occurrence, avoiding ambiguity within this damaged source.
- All 249 coalesced copies retain exact normalized full content, including origin and source_spec. Four different-origin alias groups remain separate. No conflicting origin/source content variants were found.
- There are no mechanical `gate:` lines in the provided source/application entries; body comparison preserves prose gate statements and all other fields.
- Nine deterministic artifacts match the fresh replay `preview-20260904T214820074372Z-faa118b64b7d` byte-for-byte: proof, mapping, source damage repairs, preview ledger, entries, content variants, alias candidates, active reference suggestions, and historical references.
- DW-92 and DW-93 exactly match `.audit/qa-native-recovery/operator-obligations.md` except replacement of the placeholder IDs. Native format accepts these operator entries without source_spec. They require genuine original-spec follow-up review and verification, preserve old deferred history, and claim no premature acceptance.

This review approves the source/status preservation and native format, subject to correcting the two live contextual references above. It does not establish that the open obligations are resolved or that a native follow-up has passed.
