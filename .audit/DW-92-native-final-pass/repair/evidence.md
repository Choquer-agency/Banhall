# Wrapper ancestry repair proof

Baseline revision: `54a898d44878bf911eec5fb70777982eae43efde`.

`ancestry-red.json` records the exact registered regression command, timestamps, log hash, and identical before/after source hashes. Five cases fail on the baseline extractor: block entry, block exit, wrapped siblings, horizontal rule, and wrapped horizontal rule. Both actual-token-split controls pass. `ancestry-red.log` retains the live failure output.

`ancestry-green.json` records the complete QA blocking and Tiptap extraction test command. All 81 tests pass. This includes all seven new registered cases, generated-title behavior, deep nesting, existing inline cohesion and block separation. Negative cases verify readiness and atomic publish rejection before saving, then persisted exact-reference findings and both gates after saving. The positive nested-block control splits both uncertainty and because tokens and verifies successful publishing; its paired missing-because control proves the marker survives extraction.

`red-*.txt` and `green-*.txt` retain exact extractor/test source bytes matching the respective manifest hashes. Source and logs were checked against both manifests. The extractor records each block's entry/exit on its heap traversal; the shared block-type set includes horizontal rules. Full parent gates remain subsequent work.
